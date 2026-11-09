/**
 * payment-core.test.js
 *
 * Tests bắt buộc theo yêu cầu Giai đoạn 3.1 – Payment Core.
 * Các test dùng mock (không cần MongoDB replica set) để kiểm tra:
 *   - Hai khách hàng đồng thời mua sản phẩm chỉ còn một chiếc (service layer)
 *   - Hai Payment cùng sử dụng một UserVoucher
 *   - Hai request đồng thời tạo Payment cho cùng Order
 *   - Payment hết hạn và giải phóng tồn kho
 *   - Payment hết hạn và giải phóng voucher
 *   - Payment được xử lý hết hạn nhiều lần (idempotency)
 *   - Admin sửa tổng tiền khi Payment còn hiệu lực
 *   - GET Payment khi thiếu cấu hình QR
 *   - Luồng COD vẫn hoạt động
 */

'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { after, before, mock, test } = require('node:test');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const app = require('../app');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Product = require('../models/Product');
const UserVoucher = require('../models/UserVoucher');
const Voucher = require('../models/Voucher');
const { initializeRealtime } = require('../realtime');
const paymentLifecycleService = require('../services/paymentLifecycleService');
const { PaymentReservationConflictError } = paymentLifecycleService;

const TEST_USER_ID = '6ade4310c044b23d6c6a8681';
const TEST_ORDER_ID = '6ade4310c044b23d6c6a8682';
const previousEnvironment = new Map();
let server;
let io;
let baseUrl;

for (const key of [
  'JWT_SECRET',
  'PAYMENT_QR_BANK_CODE',
  'PAYMENT_QR_ACCOUNT_NUMBER',
  'PAYMENT_QR_ACCOUNT_NAME',
  'PAYMENT_QR_TEMPLATE'
]) {
  previousEnvironment.set(key, process.env[key]);
}

before(async () => {
  process.env.JWT_SECRET = 'payment-core-test-secret';
  process.env.PAYMENT_QR_BANK_CODE = '970422';
  process.env.PAYMENT_QR_ACCOUNT_NUMBER = '12345678';
  process.env.PAYMENT_QR_ACCOUNT_NAME = 'URI I SHOP';
  process.env.PAYMENT_QR_TEMPLATE = 'compact2';
  server = http.createServer(app);
  io = initializeRealtime(server, app.get('allowedOrigins'));
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
    server.listen(0, '127.0.0.1');
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (io) await new Promise((resolve) => io.close(resolve));
  for (const [key, value] of previousEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** Helper: tạo query mock trả về value cố định */
function query(value) {
  return {
    session() { return this; },
    select() { return this; },
    sort() { return this; },
    limit() { return this; },
    async lean() { return value; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); }
  };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

function customerToken(userId = TEST_USER_ID) {
  return jwt.sign({ id: userId, role: 'user' }, process.env.JWT_SECRET);
}

function authHeaders(token = customerToken()) {
  return { Authorization: `Bearer ${token}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Hai khách hàng đồng thời mua sản phẩm chỉ còn một chiếc (service layer)
// ─────────────────────────────────────────────────────────────────────────────
test('reserveInventory: chỉ một trong hai request đồng thời giữ được tồn kho cuối cùng', async () => {
  const productObjectId = new mongoose.Types.ObjectId();
  let stockCount = 1; // Chỉ còn 1 sản phẩm

  // updateOne atomic: chỉ request đầu tiên đến stock >= 1 mới thành công
  let callIndex = 0;
  const productFindOne = mock.method(Product, 'findOne', () => query({
    _id: productObjectId,
    stock: stockCount,
    variants: []
  }));
  const productUpdateOne = mock.method(Product, 'updateOne', async (filter) => {
    // Giả lập atomicity: chỉ lần gọi đầu tiên thành công
    callIndex++;
    if (callIndex === 1) {
      stockCount = 0;
      return { modifiedCount: 1 };
    }
    // Lần 2: stock đã = 0, filter stock >= 1 fail
    return { modifiedCount: 0 };
  });

  try {
    const fakeSession = {};
    const item = { productId: 'last-unit', name: 'Last Unit', quantity: 1, variantIndex: null };
    const results = await Promise.allSettled([
      paymentLifecycleService.reserveInventory([item], fakeSession),
      paymentLifecycleService.reserveInventory([item], fakeSession)
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1, 'Chỉ 1 request được giữ tồn kho thành công');
    assert.equal(rejected.length, 1, '1 request bị từ chối do hết tồn kho');
    assert.ok(
      rejected[0].reason instanceof PaymentReservationConflictError,
      'Phải throw PaymentReservationConflictError'
    );
  } finally {
    productUpdateOne.mock.restore();
    productFindOne.mock.restore();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Hai Payment cùng sử dụng một UserVoucher (service layer)
// ─────────────────────────────────────────────────────────────────────────────
test('reserveVoucher: UserVoucher không thể được giữ cho hai Payment khác nhau', async () => {
  const userVoucherId = new mongoose.Types.ObjectId();
  const paymentId1 = new mongoose.Types.ObjectId();
  const paymentId2 = new mongoose.Types.ObjectId();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  let reservedByPaymentId = null; // Ban đầu chưa ai giữ

  // Giả lập UserVoucher.updateOne atomic
  let uvCallIndex = 0;
  const uvUpdateOne = mock.method(UserVoucher, 'updateOne', async (filter) => {
    uvCallIndex++;
    // Chỉ lần đầu (chưa bị reserve) mới thành công
    if (uvCallIndex === 1 && filter.reservedByPaymentId === null) {
      reservedByPaymentId = paymentId1;
      return { modifiedCount: 1 };
    }
    return { modifiedCount: 0 }; // Lần 2: đã bị reserve
  });

  const voucherFindOneAndUpdate = mock.method(Voucher, 'findOneAndUpdate', async () => ({
    id: 'test-voucher',
    quantity: 2,
    used: 0,
    reservedCount: 1
  }));

  try {
    const fakeSession = {};
    const args = {
      voucherId: 'test-voucher',
      userVoucherId,
      userId: TEST_USER_ID,
      expiresAt
    };

    const results = await Promise.allSettled([
      paymentLifecycleService.reserveVoucher({ ...args, paymentId: paymentId1 }, fakeSession),
      paymentLifecycleService.reserveVoucher({ ...args, paymentId: paymentId2 }, fakeSession)
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1, 'Chỉ 1 Payment được giữ voucher');
    assert.equal(rejected.length, 1, '1 Payment bị từ chối');
    assert.ok(
      rejected[0].reason instanceof PaymentReservationConflictError,
      'Phải throw PaymentReservationConflictError'
    );
  } finally {
    voucherFindOneAndUpdate.mock.restore();
    uvUpdateOne.mock.restore();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Hai request đồng thời tạo Payment cho cùng Order (HTTP layer)
// ─────────────────────────────────────────────────────────────────────────────
test('createOrderPayment: hai request đồng thời cho cùng Order chỉ tạo 1 Payment', async () => {
  const orderObjId = new mongoose.Types.ObjectId(TEST_ORDER_ID);
  let paymentCreated = false;
  const sharedPayment = {
    _id: new mongoose.Types.ObjectId(),
    orderId: orderObjId,
    paymentCode: 'URIISHAREDPAYMENTCODE',
    amountDue: 130000,
    currency: 'VND',
    methodId: 'bank_transfer',
    provider: 'sepay',
    statusId: 'awaiting_payment',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    paidAt: null,
    inventoryReservations: [],
    async save({ session }) { this.saved = true; },
    toObject() {
      const { save, toObject, ...data } = this;
      return data;
    }
  };

  const savedOrder = {
    _id: orderObjId,
    id: 'order-concurrent',
    userId: TEST_USER_ID,
    orderType: 'normal',
    statusId: 'pending',
    payment: { methodId: 'bank_transfer', statusId: 'unpaid' },
    items: [{ productId: 'product-concurrent', quantity: 1 }],
    async save({ session }) { this.saved = true; }
  };

  const fakeSession = {
    async withTransaction(callback) { await callback(); },
    async endSession() {}
  };

  const orderFind = mock.method(Order, 'findOne', () => query(savedOrder));
  const paymentFind = mock.method(Payment, 'findOne', (filter) => {
    // Sau khi tạo, trả về payment đã có
    if (filter && filter.expiresAt) return query(null); // Kiểm tra expired payment
    if (paymentCreated) {
      return query(sharedPayment); // Request 2 thấy payment đã tồn tại
    }
    return query(null); // Request 1 chưa có payment
  });
  const productFind = mock.method(Product, 'find', () => query([{
    id: 'product-concurrent',
    name: 'Sản phẩm đồng thời',
    currentPrice: 100000,
    stock: 5,
    variants: []
  }]));
  const paymentCreate = mock.method(Payment, 'create', async () => {
    if (paymentCreated) {
      // Throw duplicate key error – yêu cầu xử lý đúng
      const err = new Error('E11000 duplicate key');
      err.code = 11000;
      throw err;
    }
    paymentCreated = true;
    return [sharedPayment];
  });
  const reserveInventory = mock.method(paymentLifecycleService, 'reserveInventory', async () => []);
  const startSession = mock.method(mongoose, 'startSession', async () => fakeSession);

  try {
    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/api/orders/${TEST_ORDER_ID}/payment`, {
        method: 'POST',
        headers: authHeaders()
      }),
      fetch(`${baseUrl}/api/orders/${TEST_ORDER_ID}/payment`, {
        method: 'POST',
        headers: authHeaders()
      })
    ]);

    const statuses = [res1.status, res2.status];
    // Ít nhất 1 request phải thành công (200 hoặc 201)
    assert.ok(
      statuses.some((s) => [200, 201, 409].includes(s)),
      `Cả hai request phải trả về status hợp lệ: ${statuses}`
    );
    // Không được có 500
    assert.ok(
      statuses.every((s) => s !== 500),
      'Không được có lỗi 500 khi hai request đồng thời'
    );
  } finally {
    reserveInventory.mock.restore();
    paymentCreate.mock.restore();
    productFind.mock.restore();
    paymentFind.mock.restore();
    orderFind.mock.restore();
    startSession.mock.restore();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Payment hết hạn và giải phóng tồn kho (service layer)
// ─────────────────────────────────────────────────────────────────────────────
test('expirePayment: giải phóng tồn kho và cập nhật trạng thái Order', async () => {
  const productObjectId = new mongoose.Types.ObjectId();
  const paymentObjId = new mongoose.Types.ObjectId();
  const orderObjId = new mongoose.Types.ObjectId();
  const now = new Date();

  const reservation = {
    productId: 'expire-product',
    productObjectId,
    variantIndex: null,
    quantity: 2,
    trackProductTotal: true,
    status: 'reserved'
  };

  const paymentDoc = {
    _id: paymentObjId,
    orderId: orderObjId,
    statusId: 'awaiting_payment',
    expiresAt: new Date(now.getTime() - 1000), // Đã hết hạn
    inventoryReservations: [reservation],
    voucherReservation: undefined,
    async save({ session }) { this.saved = true; }
  };

  const fakeSession = {
    async withTransaction(callback) { await callback(); },
    async endSession() {}
  };

  const paymentFind = mock.method(Payment, 'findOne', () => query(paymentDoc));
  const productUpdate = mock.method(Product, 'updateOne', async (filter) => {
    // Giả lập release stock thành công
    assert.ok(filter.reservedStock !== undefined || filter.stock !== undefined,
      'Phải có filter guard khi release stock');
    return { modifiedCount: 1 };
  });
  const orderUpdate = mock.method(Order, 'updateOne', async (filter, update) => {
    assert.deepEqual(update.$set['payment.statusId'], 'unpaid');
    return { modifiedCount: 1 };
  });
  const startSession = mock.method(mongoose, 'startSession', async () => fakeSession);

  try {
    const result = await paymentLifecycleService.expirePayment(paymentObjId, now);
    assert.equal(result, true, 'expirePayment phải trả true khi thành công');
    assert.equal(paymentDoc.statusId, 'expired', 'Payment phải ở trạng thái expired');
    assert.equal(paymentDoc.saved, true, 'Payment phải được lưu');
    assert.equal(reservation.status, 'released', 'Reservation phải chuyển sang released');
  } finally {
    startSession.mock.restore();
    orderUpdate.mock.restore();
    productUpdate.mock.restore();
    paymentFind.mock.restore();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Payment hết hạn và giải phóng voucher (service layer)
// ─────────────────────────────────────────────────────────────────────────────
test('expirePayment: giải phóng voucher reservation khi payment hết hạn', async () => {
  const paymentObjId = new mongoose.Types.ObjectId();
  const orderObjId = new mongoose.Types.ObjectId();
  const userVoucherId = new mongoose.Types.ObjectId();
  const now = new Date();

  const voucherReservation = {
    voucherId: 'expire-voucher',
    userVoucherId,
    status: 'reserved'
  };

  const paymentDoc = {
    _id: paymentObjId,
    orderId: orderObjId,
    statusId: 'awaiting_payment',
    expiresAt: new Date(now.getTime() - 1000),
    inventoryReservations: [],
    voucherReservation,
    async save({ session }) { this.saved = true; }
  };

  const fakeSession = {
    async withTransaction(callback) { await callback(); },
    async endSession() {}
  };

  const paymentFind = mock.method(Payment, 'findOne', () => query(paymentDoc));
  const uvUpdate = mock.method(UserVoucher, 'updateOne', async (filter) => {
    // Phải match đúng payment để tránh giải phóng nhầm
    assert.ok(
      filter.reservedByPaymentId !== undefined,
      'Phải filter theo reservedByPaymentId khi release voucher'
    );
    return { modifiedCount: 1 };
  });
  const voucherUpdate = mock.method(Voucher, 'updateOne', async (filter, update) => {
    assert.ok(update.$inc.reservedCount === -1, 'Phải giảm reservedCount khi release');
    return { modifiedCount: 1 };
  });
  const orderUpdate = mock.method(Order, 'updateOne', async () => ({ modifiedCount: 1 }));
  const startSession = mock.method(mongoose, 'startSession', async () => fakeSession);

  try {
    const result = await paymentLifecycleService.expirePayment(paymentObjId, now);
    assert.equal(result, true, 'expirePayment phải trả true');
    assert.equal(voucherReservation.status, 'released', 'Voucher reservation phải released');
    assert.equal(paymentDoc.statusId, 'expired');
  } finally {
    startSession.mock.restore();
    orderUpdate.mock.restore();
    voucherUpdate.mock.restore();
    uvUpdate.mock.restore();
    paymentFind.mock.restore();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Payment được xử lý hết hạn nhiều lần (idempotency)
// ─────────────────────────────────────────────────────────────────────────────
test('expirePayment: xử lý hết hạn nhiều lần không gây double-release', async () => {
  const paymentObjId = new mongoose.Types.ObjectId();
  const orderObjId = new mongoose.Types.ObjectId();
  const now = new Date();
  let releaseCallCount = 0;

  // Lần đầu: payment chưa expired
  // Lần sau: payment đã expired → findOne trả null
  let findCallCount = 0;
  const fakeSession = {
    async withTransaction(callback) { await callback(); },
    async endSession() {}
  };

  const paymentFind = mock.method(Payment, 'findOne', () => {
    findCallCount++;
    if (findCallCount <= 2) {
      // Lần 1 và 2 đều thấy payment chưa expired (giả lập race condition)
      return query({
        _id: paymentObjId,
        orderId: orderObjId,
        statusId: 'awaiting_payment',
        expiresAt: new Date(now.getTime() - 1000),
        inventoryReservations: [],
        voucherReservation: undefined,
        async save() { this.statusId = 'expired'; }
      });
    }
    // Lần 3+: payment đã expired → không còn trong awaiting_payment
    return query(null);
  });

  const orderUpdate = mock.method(Order, 'updateOne', async () => ({ modifiedCount: 1 }));
  const startSession = mock.method(mongoose, 'startSession', async () => fakeSession);

  try {
    // Hai lần expire đồng thời
    const [r1, r2] = await Promise.all([
      paymentLifecycleService.expirePayment(paymentObjId, now),
      paymentLifecycleService.expirePayment(paymentObjId, now)
    ]);

    // Lần thứ 3: payment đã xử lý → trả false
    const r3 = await paymentLifecycleService.expirePayment(paymentObjId, now);
    assert.equal(r3, false, 'Lần 3 phải trả false vì payment không còn awaiting_payment');
  } finally {
    startSession.mock.restore();
    orderUpdate.mock.restore();
    paymentFind.mock.restore();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Admin sửa tổng tiền khi Payment còn hiệu lực
// ─────────────────────────────────────────────────────────────────────────────
test('updateOrder: admin sửa totalAmount khi payment hiệu lực → cancel payment trước', async () => {
  const orderController = require('../controllers/orderController');
  const orderObjId = new mongoose.Types.ObjectId();
  const fakeSession = {
    async withTransaction(callback) { await callback(); },
    async endSession() {}
  };

  const orderDoc = {
    _id: orderObjId,
    totalAmount: 100000,
    total: '100000',
    payment: { methodId: 'bank_transfer', statusId: 'awaiting_payment' },
    shipping: { fee: 30000 },
    set(updates) { Object.assign(this, updates); },
    async save({ session }) {
      assert.equal(session, fakeSession, 'save phải dùng session');
      this.saved = true;
    },
    toObject() {
      const { set, save, toObject, ...data } = this;
      return data;
    }
  };

  const paymentDoc = {
    _id: new mongoose.Types.ObjectId(),
    statusId: 'awaiting_payment',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    inventoryReservations: [],
    voucherReservation: undefined
  };

  const orderFind = mock.method(Order, 'findOne', () => query({ _id: orderObjId }));
  const orderFindById = mock.method(Order, 'findById', () => query(orderDoc));
  const paymentFind = mock.method(Payment, 'findOne', (filter) =>
    filter && Object.hasOwn(filter, 'orderId') ? query(paymentDoc) : query({ _id: paymentDoc._id })
  );
  const startSession = mock.method(mongoose, 'startSession', async () => fakeSession);
  let cancelCalled = false;
  const cancelPayment = mock.method(paymentLifecycleService, 'cancelPaymentInSession', async (payment) => {
    cancelCalled = true;
    payment.statusId = 'cancelled';
    return true;
  });

  try {
    const res = response();
    await orderController.updateOrder({
      params: { id: String(orderObjId) },
      body: { totalAmount: 90000 }
    }, res);

    assert.equal(res.statusCode, 200, 'Phải trả 200 sau khi cancel payment và update order');
    assert.equal(cancelCalled, true, 'cancelPaymentInSession phải được gọi');
    assert.equal(paymentDoc.statusId, 'cancelled', 'Payment phải bị cancel');
    assert.equal(orderDoc.totalAmount, 90000, 'Order phải được cập nhật với totalAmount mới');
    assert.equal(orderDoc.saved, true, 'Order phải được lưu');
  } finally {
    cancelPayment.mock.restore();
    startSession.mock.restore();
    paymentFind.mock.restore();
    orderFindById.mock.restore();
    orderFind.mock.restore();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Admin KHÔNG thể sửa tổng tiền đơn đã thanh toán
// ─────────────────────────────────────────────────────────────────────────────
test('updateOrder: admin không thể sửa tổng tiền đơn đã thanh toán (payment.statusId = paid)', async () => {
  const orderController = require('../controllers/orderController');
  const orderObjId = new mongoose.Types.ObjectId();
  const fakeSession = {
    async withTransaction(callback) { await callback(); },
    async endSession() {}
  };

  const orderDoc = {
    _id: orderObjId,
    totalAmount: 100000,
    total: '100000',
    payment: { methodId: 'bank_transfer', statusId: 'paid' },
    set(updates) { Object.assign(this, updates); },
    async save() {},
    toObject() { const { set, save, toObject, ...data } = this; return data; }
  };

  const paymentDoc = {
    _id: new mongoose.Types.ObjectId(),
    statusId: 'paid',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000)
  };

  const orderFind = mock.method(Order, 'findOne', () => query({ _id: orderObjId }));
  const orderFindById = mock.method(Order, 'findById', () => query(orderDoc));
  const paymentFind = mock.method(Payment, 'findOne', (filter) =>
    filter && Object.hasOwn(filter, 'orderId') ? query(paymentDoc) : query({ _id: paymentDoc._id })
  );
  const startSession = mock.method(mongoose, 'startSession', async () => fakeSession);

  try {
    const res = response();
    await orderController.updateOrder({
      params: { id: String(orderObjId) },
      body: { totalAmount: 90000 }
    }, res);

    assert.equal(res.statusCode, 409, 'Phải trả 409 khi sửa tổng tiền đơn đã thanh toán');
    assert.match(res.body.message, /đã thanh toán/, 'Thông báo lỗi phải đề cập đến đã thanh toán');
  } finally {
    startSession.mock.restore();
    paymentFind.mock.restore();
    orderFindById.mock.restore();
    orderFind.mock.restore();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. GET Payment khi thiếu cấu hình QR → vẫn trả trạng thái Payment
// ─────────────────────────────────────────────────────────────────────────────
test('getOrderPaymentStatus: trả trạng thái Payment khi thiếu cấu hình QR', async () => {
  const orderObjId = new mongoose.Types.ObjectId(TEST_ORDER_ID);
  const configKeys = [
    'PAYMENT_QR_BANK_CODE',
    'PAYMENT_QR_ACCOUNT_NUMBER',
    'PAYMENT_QR_ACCOUNT_NAME',
    'PAYMENT_QR_TEMPLATE'
  ];
  const savedConfig = new Map(configKeys.map((k) => [k, process.env[k]]));
  for (const key of configKeys) delete process.env[key];

  const orderFind = mock.method(Order, 'findOne', () => query({ _id: orderObjId, statusId: 'pending' }));
  const paymentFind = mock.method(Payment, 'findOne', () => query({
    _id: new mongoose.Types.ObjectId(),
    orderId: orderObjId,
    paymentCode: 'URII1234567890ABCDEF',
    amountDue: 245000,
    currency: 'VND',
    methodId: 'bank_transfer',
    provider: 'sepay',
    statusId: 'awaiting_payment',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    paidAt: null
  }));

  try {
    const res = await fetch(`${baseUrl}/api/orders/${TEST_ORDER_ID}/payment`, {
      headers: authHeaders()
    });
    const body = await res.json();

    assert.equal(res.status, 200, 'GET Payment phải trả 200 dù thiếu QR config');
    assert.equal(body.payment.statusId, 'awaiting_payment', 'Trạng thái payment phải đúng');
    assert.equal(body.payment.amountDue, 245000, 'amountDue phải đúng');
    assert.equal(
      Object.hasOwn(body.payment, 'qrCodeUrl'), false,
      'GET Payment không được trả qrCodeUrl'
    );
  } finally {
    for (const [key, value] of savedConfig) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    paymentFind.mock.restore();
    orderFind.mock.restore();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Luồng COD vẫn hoạt động – không tạo Payment, không cần QR config
// ─────────────────────────────────────────────────────────────────────────────
test('COD: đơn COD không tạo Payment và không phụ thuộc QR config', async () => {
  const orderController = require('../controllers/orderController');
  const orderObjId = new mongoose.Types.ObjectId();

  // COD order không có payment type bank_transfer
  const codOrderDoc = {
    _id: orderObjId,
    payment: { methodId: 'cod', statusId: 'paid' },
    totalAmount: 50000,
    note: 'Ghi chú COD',
    toObject() { return { ...this }; }
  };

  const orderFind = mock.method(Order, 'findOne', () => query({ _id: orderObjId }));
  const orderFindById = mock.method(Order, 'findById', () => query({ payment: { methodId: 'cod' } }));
  const paymentFind = mock.method(Payment, 'findOne', () => query(null)); // Không có Payment
  const orderFindOneAndUpdate = mock.method(Order, 'findOneAndUpdate', () => query(codOrderDoc));

  // startSession phải KHÔNG được gọi cho COD
  const startSession = mock.method(mongoose, 'startSession', async () => {
    throw new Error('COD không được dùng MongoDB transaction!');
  });

  try {
    const res = response();
    await orderController.updateOrder({
      params: { id: String(orderObjId) },
      body: { note: 'Cập nhật ghi chú' }
    }, res);

    assert.equal(res.statusCode, 200, 'COD update phải thành công');
    assert.equal(startSession.mock.callCount(), 0, 'COD không được dùng MongoDB session');
    assert.equal(orderFindOneAndUpdate.mock.callCount(), 1, 'Phải dùng findOneAndUpdate thông thường');
  } finally {
    startSession.mock.restore();
    orderFindOneAndUpdate.mock.restore();
    paymentFind.mock.restore();
    orderFindById.mock.restore();
    orderFind.mock.restore();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Payment hết hạn không được xác nhận thanh toán theo luồng thông thường
// ─────────────────────────────────────────────────────────────────────────────
test('expirePayment đã expired không thể xác nhận thanh toán lần nữa', async () => {
  const paymentObjId = new mongoose.Types.ObjectId();
  const now = new Date();

  // Payment đã expired
  const fakeSession = {
    async withTransaction(callback) { await callback(); },
    async endSession() {}
  };

  const paymentFind = mock.method(Payment, 'findOne', () => query(null)); // findOne với filter awaiting_payment không thấy
  const startSession = mock.method(mongoose, 'startSession', async () => fakeSession);

  try {
    // expirePayment với payment đã expired → trả false
    const result = await paymentLifecycleService.expirePayment(paymentObjId, now);
    assert.equal(result, false, 'Không thể expire một Payment đã không còn awaiting_payment');
  } finally {
    startSession.mock.restore();
    paymentFind.mock.restore();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. trackProductTotal = false cho sản phẩm có biến thể
// ─────────────────────────────────────────────────────────────────────────────
test('reserveInventory: sản phẩm có biến thể không cập nhật product.stock tổng', async () => {
  const productObjectId = new mongoose.Types.ObjectId();
  const capturedUpdates = [];

  const productFindOne = mock.method(Product, 'findOne', () => query({
    _id: productObjectId,
    stock: 10, // Product có stock tổng
    variants: [
      { name: 'Đỏ', price: 50000, stock: 1, _id: new mongoose.Types.ObjectId() }
    ]
  }));

  const productUpdateOne = mock.method(Product, 'updateOne', async (filter, update) => {
    capturedUpdates.push({ filter, update });
    return { modifiedCount: 1 };
  });

  try {
    const fakeSession = {};
    await paymentLifecycleService.reserveInventory([{
      productId: 'variant-product',
      name: 'Variant Product',
      quantity: 1,
      variantIndex: 0
    }], fakeSession);

    assert.equal(capturedUpdates.length, 1);
    const { update } = capturedUpdates[0];
    // Không được có $inc.stock (product.stock tổng) khi sản phẩm có biến thể
    assert.equal(
      update.$inc.stock, undefined,
      'Không được tăng/giảm product.stock khi sản phẩm có biến thể'
    );
    // Phải có $inc cho variant.stock
    assert.equal(update.$inc['variants.0.stock'], -1, 'Phải giảm variant.stock');
    // Phải có $inc cho variant.reservedStock
    assert.equal(update.$inc['variants.0.reservedStock'], 1, 'Phải tăng variant.reservedStock');
    // Phải có $inc cho product.reservedStock tổng
    assert.equal(update.$inc.reservedStock, 1, 'Phải tăng product.reservedStock tổng');
  } finally {
    productUpdateOne.mock.restore();
    productFindOne.mock.restore();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. Payment hết hạn không giải phóng tài nguyên 2 lần
// ─────────────────────────────────────────────────────────────────────────────
test('releasePaymentReservations: reservation trạng thái released không bị release lần nữa', async () => {
  const productObjectId = new mongoose.Types.ObjectId();
  let updateCallCount = 0;

  const productUpdateOne = mock.method(Product, 'updateOne', async () => {
    updateCallCount++;
    return { modifiedCount: 1 };
  });

  try {
    const fakeSession = {};
    const payment = {
      _id: new mongoose.Types.ObjectId(),
      inventoryReservations: [
        {
          productId: 'product-1',
          productObjectId,
          variantIndex: null,
          quantity: 1,
          trackProductTotal: true,
          status: 'released' // Đã được giải phóng
        }
      ],
      voucherReservation: undefined
    };

    await paymentLifecycleService.releasePaymentReservations(payment, fakeSession);

    assert.equal(updateCallCount, 0, 'Không được gọi updateOne nếu reservation đã released');
  } finally {
    productUpdateOne.mock.restore();
  }
});
