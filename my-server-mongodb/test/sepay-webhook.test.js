'use strict';

const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { Readable } = require('node:stream');
const { afterEach, beforeEach, mock, test } = require('node:test');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const app = require('../app');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const PaymentTransaction = require('../models/PaymentTransaction');
const Product = require('../models/Product');
const UserVoucher = require('../models/UserVoucher');
const Voucher = require('../models/Voucher');
const orderController = require('../controllers/orderController');
const paymentLifecycleService = require('../services/paymentLifecycleService');

const TEST_API_KEY = 'sepay-test-webhook-apikey-secret';
const TEST_HMAC_SECRET = 'sepay-test-webhook-hmac-secret';
const VALID_PAYMENT_CODE = 'URII1234567890ABCDEF';
const SECOND_PAYMENT_CODE = 'URIIFEDCBA0987654321';

const ENV_KEYS = [
  'JWT_SECRET',
  'SEPAY_WEBHOOK_API_KEY',
  'SEPAY_WEBHOOK_SECRET',
  'SEPAY_WEBHOOK_TOLERANCE_SECONDS',
  'PAYMENT_QR_BANK_CODE',
  'PAYMENT_QR_ACCOUNT_NUMBER',
  'PAYMENT_QR_ACCOUNT_NAME',
  'PAYMENT_QR_TEMPLATE'
];
const savedEnv = new Map();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
  }
  process.env.JWT_SECRET = 'sepay-webhook-test-jwt-secret';
  process.env.SEPAY_WEBHOOK_API_KEY = TEST_API_KEY;
  delete process.env.SEPAY_WEBHOOK_SECRET;
  delete process.env.SEPAY_WEBHOOK_TOLERANCE_SECONDS;
});

afterEach(() => {
  mock.restoreAll();
  for (const [key, val] of savedEnv) {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
});

/**
 * Gửi request trực tiếp qua toàn bộ Express middleware pipeline của `app`
 * (bao gồm express.raw({ limit: '64kb' }), attachRawBody, route matching và error handler)
 */
async function dispatchWebhookRequest({
  method = 'POST',
  url = '/api/webhooks/sepay',
  headers = {},
  body = undefined
} = {}) {
  let rawBuffer = Buffer.alloc(0);
  if (Buffer.isBuffer(body)) {
    rawBuffer = body;
  } else if (typeof body === 'string') {
    rawBuffer = Buffer.from(body, 'utf8');
  } else if (body !== undefined) {
    rawBuffer = Buffer.from(JSON.stringify(body), 'utf8');
  }

  const normalizedHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined) normalizedHeaders[k.toLowerCase()] = String(v);
  }
  if (body !== undefined && !normalizedHeaders['content-type']) {
    normalizedHeaders['content-type'] = 'application/json';
  }
  normalizedHeaders['content-length'] = String(rawBuffer.length);

  return new Promise((resolve, reject) => {
    const reqStream = Readable.from(rawBuffer.length > 0 ? [rawBuffer] : []);
    reqStream.method = method;
    reqStream.url = url;
    reqStream.originalUrl = url;
    reqStream.path = url.split('?')[0];
    reqStream.headers = normalizedHeaders;
    reqStream.connection = {};
    reqStream.socket = {};
    reqStream.get = (name) => normalizedHeaders[String(name).toLowerCase()];

    const resHeaders = new Map();
    const finishListeners = [];
    const res = {
      statusCode: 200,
      headersSent: false,
      body: null,
      rawText: '',
      setHeader(name, value) {
        resHeaders.set(String(name).toLowerCase(), value);
      },
      getHeader(name) {
        return resHeaders.get(String(name).toLowerCase());
      },
      removeHeader(name) {
        resHeaders.delete(String(name).toLowerCase());
      },
      on(event, listener) {
        if (event === 'finish') finishListeners.push(listener);
        return this;
      },
      once(event, listener) {
        if (event === 'finish') finishListeners.push(listener);
        return this;
      },
      emit(event) {
        if (event === 'finish') {
          for (const fn of finishListeners) fn();
        }
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.headersSent = true;
        this.body = payload;
        this.rawText = JSON.stringify(payload);
        this.emit('finish');
        resolve({ status: this.statusCode, body: this.body });
        return this;
      },
      send(payload) {
        this.headersSent = true;
        if (typeof payload === 'object' && payload !== null && !Buffer.isBuffer(payload)) {
          this.body = payload;
        } else {
          this.rawText = String(payload ?? '');
          try {
            this.body = JSON.parse(this.rawText);
          } catch {
            this.body = { raw: this.rawText };
          }
        }
        this.emit('finish');
        resolve({ status: this.statusCode, body: this.body });
        return this;
      },
      end(chunk) {
        if (!this.headersSent) {
          this.headersSent = true;
          if (chunk) {
            this.rawText = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
            try {
              this.body = JSON.parse(this.rawText);
            } catch {
              this.body = { raw: this.rawText };
            }
          }
          this.emit('finish');
          resolve({ status: this.statusCode, body: this.body });
        }
      }
    };

    try {
      app(reqStream, res, (err) => {
        if (err) reject(err);
        else resolve({ status: res.statusCode, body: res.body });
      });
    } catch (error) {
      reject(error);
    }
  });
}

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

function apiKeyHeaders(key = TEST_API_KEY, extra = {}) {
  return {
    Authorization: `Apikey ${key}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

function createFakeSession() {
  return {
    async withTransaction(callback) {
      await callback();
    },
    async endSession() {}
  };
}

function createSampleOrderAndPayment({
  paymentCode = VALID_PAYMENT_CODE,
  amountDue = 185000,
  paymentStatusId = 'awaiting_payment',
  orderStatusId = 'pending',
  expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000),
  withVoucher = true
} = {}) {
  const orderId = new mongoose.Types.ObjectId();
  const paymentId = new mongoose.Types.ObjectId();
  const productObjectId = new mongoose.Types.ObjectId();
  const userVoucherId = new mongoose.Types.ObjectId();

  const orderDoc = {
    _id: orderId,
    id: 'order-sepay-1',
    userId: new mongoose.Types.ObjectId(),
    orderType: 'normal',
    statusId: orderStatusId,
    status: orderStatusId === 'cancelled' ? 'Đã hủy' : 'Đang chờ duyệt',
    totalAmount: amountDue,
    total: String(amountDue),
    items: [
      {
        productId: 'prod-1',
        name: 'Bộ kit hạt cườm Urii',
        price: 100000,
        unitPrice: 100000,
        quantity: 2,
        variantIndex: null
      }
    ],
    ...(withVoucher ? { voucher: { voucherId: 'voucher-1', discountAmount: 15000 } } : {}),
    payment: {
      methodId: 'bank_transfer',
      method: 'Chuyển khoản ngân hàng',
      statusId: paymentStatusId === 'paid' ? 'paid' : 'awaiting_payment',
      status: paymentStatusId === 'paid' ? 'Đã thanh toán' : 'Chờ thanh toán'
    },
    waitingInfo: {
      type: 'awaiting_payment',
      startedAt: new Date(),
      deadlineAt: expiresAt,
      expectedHours: 24,
      actor: 'customer',
      note: 'Chờ khách hàng hoàn tất chuyển khoản thanh toán trong 24 giờ.'
    },
    savedCount: 0,
    async save() {
      this.savedCount += 1;
    }
  };

  const paymentDoc = {
    _id: paymentId,
    orderId,
    paymentCode,
    amountDue,
    currency: 'VND',
    methodId: 'bank_transfer',
    provider: 'sepay',
    statusId: paymentStatusId,
    expiresAt,
    paidAt: paymentStatusId === 'paid' ? new Date() : null,
    inventoryReservations: [
      {
        productId: 'prod-1',
        productObjectId,
        variantId: null,
        variantIndex: null,
        trackProductTotal: true,
        quantity: 2,
        status: paymentStatusId === 'paid' ? 'consumed' : 'reserved'
      }
    ],
    voucherReservation: withVoucher
      ? {
          voucherId: 'voucher-1',
          userVoucherId,
          status: paymentStatusId === 'paid' ? 'consumed' : 'reserved'
        }
      : undefined,
    savedCount: 0,
    async save() {
      this.savedCount += 1;
    }
  };

  return { orderDoc, paymentDoc, productObjectId, userVoucherId };
}

function buildSepayPayload(overrides = {}) {
  return {
    id: 92704,
    gateway: 'Vietcombank',
    transactionDate: '2026-11-09 17:20:00',
    accountNumber: '1017588888',
    subAccount: null,
    code: VALID_PAYMENT_CODE,
    content: `MBVCB.92704.${VALID_PAYMENT_CODE}.NGUYEN VAN A chuyen tien`,
    transferType: 'in',
    description: `BankAPINotify ${VALID_PAYMENT_CODE}`,
    transferAmount: 185000,
    accumulated: 105000000,
    referenceCode: 'FT26313123456',
    ...overrides
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Webhook hợp lệ xác nhận thanh toán (API Key & HMAC-SHA256 trên raw body)
// ─────────────────────────────────────────────────────────────────────────────
test('1. Webhook hợp lệ xác nhận thanh toán, consume reservation và giữ nguyên Order.statusId', async () => {
  const { orderDoc, paymentDoc, productObjectId, userVoucherId } = createSampleOrderAndPayment();
  const createdTransactions = [];
  const productUpdates = [];
  const uvUpdates = [];
  const voucherUpdates = [];

  mock.method(mongoose, 'startSession', async () => createFakeSession());
  mock.method(PaymentTransaction, 'findOne', () => query(null));
  mock.method(PaymentTransaction, 'create', async (docs) => {
    const doc = { _id: new mongoose.Types.ObjectId(), ...docs[0] };
    createdTransactions.push(doc);
    return [doc];
  });
  mock.method(Payment, 'findOne', (filter) => {
    assert.equal(filter.paymentCode, VALID_PAYMENT_CODE);
    return query(paymentDoc);
  });
  mock.method(Order, 'findById', () => query(orderDoc));
  mock.method(Product, 'updateOne', async (filter, update) => {
    productUpdates.push({ filter, update });
    return { modifiedCount: 1 };
  });
  mock.method(UserVoucher, 'updateOne', async (filter, update) => {
    uvUpdates.push({ filter, update });
    return { modifiedCount: 1 };
  });
  mock.method(Voucher, 'updateOne', async (filter, update) => {
    voucherUpdates.push({ filter, update });
    return { modifiedCount: 1 };
  });

  const response = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: buildSepayPayload()
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.duplicate, false);
  assert.equal(response.body.classification, 'matched');
  assert.equal(response.body.reviewStatus, 'not_required');

  // Kiểm tra Payment chuyển sang paid
  assert.equal(paymentDoc.statusId, 'paid');
  assert.ok(paymentDoc.paidAt instanceof Date);
  assert.equal(paymentDoc.savedCount, 1);
  assert.equal(paymentDoc.inventoryReservations[0].status, 'consumed');
  assert.equal(paymentDoc.voucherReservation.status, 'consumed');

  // Kiểm tra Order.payment = paid nhưng Order.statusId giữ nguyên pending
  assert.equal(orderDoc.payment.statusId, 'paid');
  assert.equal(orderDoc.payment.status, 'Đã thanh toán');
  assert.equal(orderDoc.statusId, 'pending', 'Không được tự chuyển Order.statusId sang trạng thái shop đã xác nhận');
  assert.equal(orderDoc.waitingInfo.type, 'awaiting_confirmation');
  assert.equal(orderDoc.savedCount, 1);

  // Kiểm tra không giảm stock lần 2, chỉ giảm reservedStock
  assert.equal(productUpdates.length, 1);
  assert.deepEqual(productUpdates[0].filter, {
    _id: productObjectId,
    reservedStock: { $gte: 2 }
  });
  assert.deepEqual(productUpdates[0].update, {
    $inc: { reservedStock: -2 }
  });
  assert.equal(productUpdates[0].update.$inc.stock, undefined, 'Không được giảm stock thêm lần nữa');

  // Kiểm tra consume voucher
  assert.equal(uvUpdates.length, 1);
  assert.equal(String(uvUpdates[0].filter._id), String(userVoucherId));
  assert.equal(uvUpdates[0].update.$set.isUsed, true);
  assert.equal(uvUpdates[0].update.$set.reservedByPaymentId, null);

  assert.equal(voucherUpdates.length, 1);
  assert.deepEqual(voucherUpdates[0].update.$inc, { reservedCount: -1, used: 1 });

  // Kiểm tra PaymentTransaction
  assert.equal(createdTransactions.length, 1);
  assert.equal(createdTransactions[0].sepayTransactionId, '92704');
  assert.equal(String(createdTransactions[0].paymentId), String(paymentDoc._id));
  assert.equal(createdTransactions[0].classification, 'matched');
  assert.equal(createdTransactions[0].reviewStatus, 'not_required');
});

test('1b. Webhook hợp lệ xác thực bằng chữ ký HMAC-SHA256 trên raw body (X-SePay-Signature & X-SePay-Timestamp)', async () => {
  delete process.env.SEPAY_WEBHOOK_API_KEY;
  process.env.SEPAY_WEBHOOK_SECRET = TEST_HMAC_SECRET;

  const { orderDoc, paymentDoc } = createSampleOrderAndPayment({ withVoucher: false });
  mock.method(mongoose, 'startSession', async () => createFakeSession());
  mock.method(PaymentTransaction, 'findOne', () => query(null));
  mock.method(PaymentTransaction, 'create', async (docs) => [{ _id: new mongoose.Types.ObjectId(), ...docs[0] }]);
  mock.method(Payment, 'findOne', () => query(paymentDoc));
  mock.method(Order, 'findById', () => query(orderDoc));
  mock.method(Product, 'updateOne', async () => ({ modifiedCount: 1 }));

  const rawJson = JSON.stringify(buildSepayPayload({ id: 92705 }), null, 2); // Có khoảng trắng/format riêng
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', TEST_HMAC_SECRET)
    .update(`${timestamp}.${rawJson}`, 'utf8')
    .digest('hex');

  const response = await dispatchWebhookRequest({
    headers: {
      'Content-Type': 'application/json',
      'X-SePay-Timestamp': timestamp,
      'X-SePay-Signature': `sha256=${signature}`
    },
    body: rawJson
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.classification, 'matched');
  assert.equal(paymentDoc.statusId, 'paid');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Sai chữ ký / Sai API Key / Raw body bị thay đổi
// ─────────────────────────────────────────────────────────────────────────────
test('2. Webhook sai chữ ký hoặc sai API Key bị từ chối 401 và không ghi nhận giao dịch', async () => {
  let txCreated = false;
  mock.method(PaymentTransaction, 'create', async () => {
    txCreated = true;
    return [];
  });

  // 2a. Sai API Key
  const wrongApiKeyRes = await dispatchWebhookRequest({
    headers: apiKeyHeaders('wrong-api-key'),
    body: buildSepayPayload()
  });
  assert.equal(wrongApiKeyRes.status, 401);
  assert.equal(wrongApiKeyRes.body.success, false);
  assert.equal(txCreated, false);

  // 2b. Sai chữ ký HMAC-SHA256
  process.env.SEPAY_WEBHOOK_SECRET = TEST_HMAC_SECRET;
  const wrongSigRes = await dispatchWebhookRequest({
    headers: apiKeyHeaders(TEST_API_KEY, {
      'X-SePay-Signature': `sha256=${'0'.repeat(64)}`
    }),
    body: buildSepayPayload()
  });
  assert.equal(wrongSigRes.status, 401);
  assert.equal(wrongSigRes.body.success, false);
  assert.equal(txCreated, false);

  // 2c. Chữ ký đúng với payload gốc nhưng rawBody đã bị chỉnh sửa trên đường truyền
  const originalBody = JSON.stringify(buildSepayPayload({ transferAmount: 10000 }));
  const tamperedBody = JSON.stringify(buildSepayPayload({ transferAmount: 185000 }));
  const validSigForOriginal = createHmac('sha256', TEST_HMAC_SECRET)
    .update(originalBody, 'utf8')
    .digest('hex');

  const tamperedRes = await dispatchWebhookRequest({
    headers: apiKeyHeaders(TEST_API_KEY, {
      'X-SePay-Signature': `sha256=${validSigForOriginal}`
    }),
    body: tamperedBody
  });
  assert.equal(tamperedRes.status, 401);
  assert.equal(tamperedRes.body.success, false);
  assert.equal(txCreated, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Thiếu header xác thực / Dùng nhầm JWT customer-admin
// ─────────────────────────────────────────────────────────────────────────────
test('3. Thiếu header xác thực hoặc dùng Bearer JWT của customer/admin bị từ chối 401', async () => {
  let txCreated = false;
  mock.method(PaymentTransaction, 'create', async () => {
    txCreated = true;
    return [];
  });

  // Không có header xác thực
  const missingHeaderRes = await dispatchWebhookRequest({
    headers: { 'Content-Type': 'application/json' },
    body: buildSepayPayload()
  });
  assert.equal(missingHeaderRes.status, 401);
  assert.equal(missingHeaderRes.body.success, false);

  // Dùng Bearer token của admin/customer thay cho xác thực SePay
  const adminJwt = jwt.sign({ id: '6ade4310c044b23d6c6a8681', role: 'admin' }, process.env.JWT_SECRET);
  const bearerRes = await dispatchWebhookRequest({
    headers: {
      Authorization: `Bearer ${adminJwt}`,
      'Content-Type': 'application/json'
    },
    body: buildSepayPayload()
  });
  assert.equal(bearerRes.status, 401);
  assert.equal(bearerRes.body.success, false);
  assert.equal(txCreated, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Payload không hợp lệ & vượt kích thước cho phép
// ─────────────────────────────────────────────────────────────────────────────
test('4. Payload không hợp lệ bị từ chối 400 (hoặc 413 khi quá dung lượng) và không lưu giao dịch', async () => {
  let txCreated = false;
  mock.method(PaymentTransaction, 'create', async () => {
    txCreated = true;
    return [];
  });

  // JSON lỗi cú pháp
  const invalidJsonRes = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: '{invalid-json'
  });
  assert.equal(invalidJsonRes.status, 400);
  assert.equal(invalidJsonRes.body.success, false);

  // Thiếu transaction id
  const missingIdRes = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: buildSepayPayload({ id: null })
  });
  assert.equal(missingIdRes.status, 400);

  // transferType không hợp lệ
  const invalidTypeRes = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: buildSepayPayload({ transferType: 'invalid' })
  });
  assert.equal(invalidTypeRes.status, 400);

  // transferAmount âm hoặc bằng 0 hoặc số thực
  for (const invalidAmount of [0, -50000, 123.45, '185000']) {
    const res = await dispatchWebhookRequest({
      headers: apiKeyHeaders(),
      body: buildSepayPayload({ transferAmount: invalidAmount })
    });
    assert.equal(res.status, 400);
  }

  // transactionDate không hợp lệ
  const badDateRes = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: buildSepayPayload({ transactionDate: 'not-a-date' })
  });
  assert.equal(badDateRes.status, 400);

  // Payload vượt quá 64KB
  const hugePayload = JSON.stringify({
    ...buildSepayPayload(),
    description: 'A'.repeat(70 * 1024)
  });
  const tooLargeRes = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: hugePayload
  });
  assert.equal(tooLargeRes.status, 413);
  assert.equal(tooLargeRes.body.success, false);
  assert.equal(txCreated, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Giao dịch tiền ra (transferType = 'out')
// ─────────────────────────────────────────────────────────────────────────────
test('5. Giao dịch tiền ra không xác nhận Payment và được lưu với classification = outgoing', async () => {
  const { paymentDoc } = createSampleOrderAndPayment();
  const createdTransactions = [];

  mock.method(mongoose, 'startSession', async () => createFakeSession());
  mock.method(PaymentTransaction, 'findOne', () => query(null));
  mock.method(PaymentTransaction, 'create', async (docs) => {
    const doc = { _id: new mongoose.Types.ObjectId(), ...docs[0] };
    createdTransactions.push(doc);
    return [doc];
  });
  const paymentFindSpy = mock.method(Payment, 'findOne', () => query(paymentDoc));

  const response = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: buildSepayPayload({
      id: 93001,
      transferType: 'out',
      transferAmount: 185000,
      code: VALID_PAYMENT_CODE,
      content: `${VALID_PAYMENT_CODE} chuyen tien ra`
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.classification, 'outgoing');
  assert.equal(response.body.reviewStatus, 'not_required');
  assert.equal(paymentFindSpy.mock.callCount(), 0, 'Giao dịch tiền ra không được tra cứu/xác nhận Payment');
  assert.equal(paymentDoc.statusId, 'awaiting_payment');
  assert.equal(createdTransactions.length, 1);
  assert.equal(createdTransactions[0].paymentId, null);
  assert.equal(createdTransactions[0].transferType, 'out');
  assert.equal(createdTransactions[0].classification, 'outgoing');
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Sai paymentCode (sai định dạng / không có mã / hai mã mơ hồ)
// ─────────────────────────────────────────────────────────────────────────────
test('6. Sai paymentCode hoặc nhiều mã mơ hồ: lưu giao dịch unknown_payment_code, cần review', async () => {
  const createdTransactions = [];
  mock.method(mongoose, 'startSession', async () => createFakeSession());
  mock.method(PaymentTransaction, 'findOne', () => query(null));
  mock.method(PaymentTransaction, 'create', async (docs) => {
    const doc = { _id: new mongoose.Types.ObjectId(), ...docs[0] };
    createdTransactions.push(doc);
    return [doc];
  });
  const paymentFindSpy = mock.method(Payment, 'findOne', () => query(null));

  // 6a. Mã ngắn sai định dạng URII12345
  const shortCodeRes = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: buildSepayPayload({
      id: 93002,
      code: 'URII12345',
      content: 'Chuyen khoan URII12345'
    })
  });
  assert.equal(shortCodeRes.status, 200);
  assert.equal(shortCodeRes.body.classification, 'unknown_payment_code');
  assert.equal(shortCodeRes.body.reviewStatus, 'pending');

  // 6b. Hai mã thanh toán khác nhau trong cùng nội dung chuyển khoản (tránh nhầm đơn hàng)
  const ambiguousRes = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: buildSepayPayload({
      id: 93003,
      code: null,
      content: `Thanh toan ${VALID_PAYMENT_CODE} hoac ${SECOND_PAYMENT_CODE}`
    })
  });
  assert.equal(ambiguousRes.status, 200);
  assert.equal(ambiguousRes.body.classification, 'unknown_payment_code');
  assert.equal(ambiguousRes.body.reviewStatus, 'pending');

  assert.equal(paymentFindSpy.mock.callCount(), 0, 'Mã sai định dạng/mơ hồ không được match vào Payment');
  assert.equal(createdTransactions.length, 2);
  assert.equal(createdTransactions[0].paymentId, null);
  assert.equal(createdTransactions[0].paymentCodeObserved, 'URII12345');
  assert.equal(createdTransactions[1].paymentId, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Không tìm thấy Payment
// ─────────────────────────────────────────────────────────────────────────────
test('7. Không tìm thấy Payment: lưu unmatched transaction với paymentId = null và reviewStatus = pending', async () => {
  const createdTransactions = [];
  mock.method(mongoose, 'startSession', async () => createFakeSession());
  mock.method(PaymentTransaction, 'findOne', () => query(null));
  mock.method(PaymentTransaction, 'create', async (docs) => {
    const doc = { _id: new mongoose.Types.ObjectId(), ...docs[0] };
    createdTransactions.push(doc);
    return [doc];
  });
  mock.method(Payment, 'findOne', () => query(null));

  const unknownCode = 'URII0000000000000000';
  const response = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: buildSepayPayload({
      id: 93004,
      code: unknownCode,
      content: `${unknownCode} chuyen tien`
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.paymentId, null);
  assert.equal(response.body.classification, 'unknown_payment_code');
  assert.equal(response.body.reviewStatus, 'pending');
  assert.equal(createdTransactions.length, 1);
  assert.equal(createdTransactions[0].paymentId, null);
  assert.equal(createdTransactions[0].paymentCodeObserved, unknownCode);
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Thiếu tiền (underpaid)
// ─────────────────────────────────────────────────────────────────────────────
test('8. Thiếu tiền: không xác nhận paid, không consume reservation, lưu underpaid cần review', async () => {
  const { orderDoc, paymentDoc } = createSampleOrderAndPayment({ amountDue: 185000 });
  const createdTransactions = [];

  mock.method(mongoose, 'startSession', async () => createFakeSession());
  mock.method(PaymentTransaction, 'findOne', () => query(null));
  mock.method(PaymentTransaction, 'create', async (docs) => {
    const doc = { _id: new mongoose.Types.ObjectId(), ...docs[0] };
    createdTransactions.push(doc);
    return [doc];
  });
  mock.method(Payment, 'findOne', () => query(paymentDoc));
  mock.method(Order, 'findById', () => query(orderDoc));
  const productUpdateSpy = mock.method(Product, 'updateOne', async () => ({ modifiedCount: 1 }));

  const response = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: buildSepayPayload({
      id: 93005,
      transferAmount: 180000 // Thiếu 5.000đ
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.classification, 'underpaid');
  assert.equal(response.body.reviewStatus, 'pending');
  assert.equal(paymentDoc.statusId, 'awaiting_payment');
  assert.equal(orderDoc.payment.statusId, 'awaiting_payment');
  assert.equal(paymentDoc.inventoryReservations[0].status, 'reserved');
  assert.equal(productUpdateSpy.mock.callCount(), 0);
  assert.equal(createdTransactions.length, 1);
  assert.equal(String(createdTransactions[0].paymentId), String(paymentDoc._id));
  assert.equal(createdTransactions[0].classification, 'underpaid');
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Thừa tiền (overpaid)
// ─────────────────────────────────────────────────────────────────────────────
test('9. Thừa tiền: không tự xác nhận paid, không consume reservation, lưu overpaid cần review', async () => {
  const { orderDoc, paymentDoc } = createSampleOrderAndPayment({ amountDue: 185000 });
  const createdTransactions = [];

  mock.method(mongoose, 'startSession', async () => createFakeSession());
  mock.method(PaymentTransaction, 'findOne', () => query(null));
  mock.method(PaymentTransaction, 'create', async (docs) => {
    const doc = { _id: new mongoose.Types.ObjectId(), ...docs[0] };
    createdTransactions.push(doc);
    return [doc];
  });
  mock.method(Payment, 'findOne', () => query(paymentDoc));
  mock.method(Order, 'findById', () => query(orderDoc));
  const productUpdateSpy = mock.method(Product, 'updateOne', async () => ({ modifiedCount: 1 }));

  const response = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: buildSepayPayload({
      id: 93006,
      transferAmount: 200000 // Thừa 15.000đ
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.classification, 'overpaid');
  assert.equal(response.body.reviewStatus, 'pending');
  assert.equal(paymentDoc.statusId, 'awaiting_payment');
  assert.equal(orderDoc.payment.statusId, 'awaiting_payment');
  assert.equal(paymentDoc.inventoryReservations[0].status, 'reserved');
  assert.equal(productUpdateSpy.mock.callCount(), 0);
  assert.equal(createdTransactions.length, 1);
  assert.equal(createdTransactions[0].classification, 'overpaid');
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Giao dịch trùng transaction ID (SePay retry tuần tự)
// ─────────────────────────────────────────────────────────────────────────────
test('10. Giao dịch trùng transaction ID không xử lý lần hai', async () => {
  const { orderDoc, paymentDoc } = createSampleOrderAndPayment({ withVoucher: false });
  const txStore = new Map();
  let productUpdateCalls = 0;

  mock.method(mongoose, 'startSession', async () => createFakeSession());
  mock.method(PaymentTransaction, 'findOne', (filter) => {
    const found = txStore.get(filter.sepayTransactionId) || null;
    return query(found);
  });
  mock.method(PaymentTransaction, 'create', async (docs) => {
    const item = docs[0];
    if (txStore.has(item.sepayTransactionId)) {
      const err = new Error('E11000 duplicate key error');
      err.code = 11000;
      throw err;
    }
    const created = { _id: new mongoose.Types.ObjectId(), ...item };
    txStore.set(item.sepayTransactionId, created);
    return [created];
  });
  mock.method(Payment, 'findOne', () => query(paymentDoc));
  mock.method(Order, 'findById', () => query(orderDoc));
  mock.method(Product, 'updateOne', async () => {
    productUpdateCalls += 1;
    return { modifiedCount: 1 };
  });

  const payload = buildSepayPayload({ id: 93007 });
  const firstRes = await dispatchWebhookRequest({ headers: apiKeyHeaders(), body: payload });
  const secondRes = await dispatchWebhookRequest({ headers: apiKeyHeaders(), body: payload });

  assert.equal(firstRes.status, 200);
  assert.equal(firstRes.body.duplicate, false);
  assert.equal(secondRes.status, 200);
  assert.equal(secondRes.body.duplicate, true);
  assert.equal(txStore.size, 1);
  assert.equal(productUpdateCalls, 1, 'Tồn kho chỉ được consume đúng 1 lần');
  assert.equal(paymentDoc.savedCount, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Hai webhook cùng transaction ID đến đồng thời
// ─────────────────────────────────────────────────────────────────────────────
test('11. Hai webhook cùng transaction ID đến đồng thời: unique index chặn xử lý trùng lặp', async () => {
  const { orderDoc, paymentDoc } = createSampleOrderAndPayment({ withVoucher: false });
  const txStore = new Map();
  let productUpdateCalls = 0;

  mock.method(mongoose, 'startSession', async () => createFakeSession());
  // Giả lập race condition: cả hai request đều thấy findOne = null trước khi insert
  mock.method(PaymentTransaction, 'findOne', (filter) => {
    const found = txStore.get(filter.sepayTransactionId) || null;
    return query(found);
  });
  mock.method(PaymentTransaction, 'create', async (docs) => {
    const item = docs[0];
    if (txStore.has(item.sepayTransactionId)) {
      const err = new Error('E11000 duplicate key error on sepayTransactionId');
      err.code = 11000;
      throw err;
    }
    const created = { _id: new mongoose.Types.ObjectId(), ...item };
    txStore.set(item.sepayTransactionId, created);
    return [created];
  });
  mock.method(Payment, 'findOne', () => query(paymentDoc));
  mock.method(Order, 'findById', () => query(orderDoc));
  mock.method(Product, 'updateOne', async () => {
    productUpdateCalls += 1;
    return { modifiedCount: 1 };
  });

  const payload = buildSepayPayload({ id: 93008 });
  const [res1, res2] = await Promise.all([
    dispatchWebhookRequest({ headers: apiKeyHeaders(), body: payload }),
    dispatchWebhookRequest({ headers: apiKeyHeaders(), body: payload })
  ]);

  assert.equal(res1.status, 200);
  assert.equal(res2.status, 200);
  const duplicates = [res1.body.duplicate, res2.body.duplicate];
  assert.equal(duplicates.filter(Boolean).length, 1, 'Phải có đúng 1 request được đánh dấu duplicate');
  assert.equal(duplicates.filter((d) => !d).length, 1, 'Phải có đúng 1 request xử lý chính');
  assert.equal(txStore.size, 1, 'Chỉ lưu 1 PaymentTransaction duy nhất');
  assert.equal(productUpdateCalls, 1, 'Chỉ consume tồn kho đúng 1 lần');
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Hai giao dịch khác nhau cùng thanh toán một Payment đồng thời
// ─────────────────────────────────────────────────────────────────────────────
test('12. Hai giao dịch khác nhau cùng thanh toán một Payment: chỉ 1 giao dịch xác nhận paid, giao dịch thứ 2 cần review', async () => {
  const { orderDoc, paymentDoc } = createSampleOrderAndPayment({ withVoucher: false });
  const txStore = new Map();
  let productUpdateCalls = 0;

  mock.method(mongoose, 'startSession', async () => createFakeSession());
  mock.method(PaymentTransaction, 'findOne', (filter) => {
    const found = txStore.get(filter.sepayTransactionId) || null;
    return query(found);
  });
  mock.method(PaymentTransaction, 'create', async (docs) => {
    const item = docs[0];
    const created = { _id: new mongoose.Types.ObjectId(), ...item };
    txStore.set(item.sepayTransactionId, created);
    return [created];
  });
  mock.method(Payment, 'findOne', () => query(paymentDoc));
  mock.method(Order, 'findById', () => query(orderDoc));
  mock.method(Product, 'updateOne', async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    productUpdateCalls += 1;
    return { modifiedCount: 1 };
  });

  const [res1, res2] = await Promise.all([
    dispatchWebhookRequest({
      headers: apiKeyHeaders(),
      body: buildSepayPayload({ id: 93009 })
    }),
    dispatchWebhookRequest({
      headers: apiKeyHeaders(),
      body: buildSepayPayload({ id: 93010 })
    })
  ]);

  assert.equal(res1.status, 200);
  assert.equal(res2.status, 200);
  const classifications = [res1.body.classification, res2.body.classification].sort();
  assert.deepEqual(classifications, ['duplicate_payment', 'matched']);
  assert.equal(txStore.size, 2, 'Cả 2 giao dịch đều phải được lưu lại');
  assert.equal(productUpdateCalls, 1, 'Tồn kho chỉ được consume 1 lần duy nhất');
  assert.equal(paymentDoc.statusId, 'paid');
  assert.equal(paymentDoc.savedCount, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// 12b. Hai Payment khác nhau nhận giao dịch gần như đồng thời
// ─────────────────────────────────────────────────────────────────────────────
test('12b. Hai Payment khác nhau nhận giao dịch đồng thời đều được xác nhận chính xác', async () => {
  const first = createSampleOrderAndPayment({
    paymentCode: VALID_PAYMENT_CODE,
    amountDue: 185000,
    withVoucher: false
  });
  const second = createSampleOrderAndPayment({
    paymentCode: SECOND_PAYMENT_CODE,
    amountDue: 250000,
    withVoucher: false
  });

  mock.method(mongoose, 'startSession', async () => createFakeSession());
  mock.method(PaymentTransaction, 'findOne', () => query(null));
  mock.method(PaymentTransaction, 'create', async (docs) => [{ _id: new mongoose.Types.ObjectId(), ...docs[0] }]);
  mock.method(Payment, 'findOne', (filter) => {
    if (filter.paymentCode === VALID_PAYMENT_CODE) return query(first.paymentDoc);
    if (filter.paymentCode === SECOND_PAYMENT_CODE) return query(second.paymentDoc);
    return query(null);
  });
  mock.method(Order, 'findById', (id) => {
    if (String(id) === String(first.orderDoc._id)) return query(first.orderDoc);
    if (String(id) === String(second.orderDoc._id)) return query(second.orderDoc);
    return query(null);
  });
  mock.method(Product, 'updateOne', async () => ({ modifiedCount: 1 }));

  const [res1, res2] = await Promise.all([
    dispatchWebhookRequest({
      headers: apiKeyHeaders(),
      body: buildSepayPayload({
        id: 93011,
        code: VALID_PAYMENT_CODE,
        content: VALID_PAYMENT_CODE,
        transferAmount: 185000
      })
    }),
    dispatchWebhookRequest({
      headers: apiKeyHeaders(),
      body: buildSepayPayload({
        id: 93012,
        code: SECOND_PAYMENT_CODE,
        content: SECOND_PAYMENT_CODE,
        transferAmount: 250000
      })
    })
  ]);

  assert.equal(res1.status, 200);
  assert.equal(res2.status, 200);
  assert.equal(res1.body.classification, 'matched');
  assert.equal(res2.body.classification, 'matched');
  assert.equal(first.paymentDoc.statusId, 'paid');
  assert.equal(second.paymentDoc.statusId, 'paid');
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. Payment đã paid, có giao dịch mới
// ─────────────────────────────────────────────────────────────────────────────
test('13. Payment đã paid nhận giao dịch mới: ghi nhận duplicate_payment, cần review, không consume lại', async () => {
  const { orderDoc, paymentDoc } = createSampleOrderAndPayment({
    paymentStatusId: 'paid'
  });
  const createdTransactions = [];

  mock.method(mongoose, 'startSession', async () => createFakeSession());
  mock.method(PaymentTransaction, 'findOne', () => query(null));
  mock.method(PaymentTransaction, 'create', async (docs) => {
    const doc = { _id: new mongoose.Types.ObjectId(), ...docs[0] };
    createdTransactions.push(doc);
    return [doc];
  });
  mock.method(Payment, 'findOne', () => query(paymentDoc));
  mock.method(Order, 'findById', () => query(orderDoc));
  const productUpdateSpy = mock.method(Product, 'updateOne', async () => ({ modifiedCount: 1 }));

  const response = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: buildSepayPayload({ id: 93013 })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.classification, 'duplicate_payment');
  assert.equal(response.body.reviewStatus, 'pending');
  assert.equal(productUpdateSpy.mock.callCount(), 0);
  assert.equal(createdTransactions.length, 1);
  assert.equal(String(createdTransactions[0].paymentId), String(paymentDoc._id));
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. Payment đã expired
// ─────────────────────────────────────────────────────────────────────────────
test('14. Payment đã expired: ghi nhận late_after_expire, cần review, không tự mở lại đơn', async () => {
  const { orderDoc, paymentDoc } = createSampleOrderAndPayment({
    paymentStatusId: 'expired',
    expiresAt: new Date(Date.now() - 60 * 1000)
  });
  orderDoc.payment.statusId = 'unpaid';
  const createdTransactions = [];

  mock.method(mongoose, 'startSession', async () => createFakeSession());
  mock.method(PaymentTransaction, 'findOne', () => query(null));
  mock.method(PaymentTransaction, 'create', async (docs) => {
    const doc = { _id: new mongoose.Types.ObjectId(), ...docs[0] };
    createdTransactions.push(doc);
    return [doc];
  });
  mock.method(Payment, 'findOne', () => query(paymentDoc));
  mock.method(Order, 'findById', () => query(orderDoc));
  const productUpdateSpy = mock.method(Product, 'updateOne', async () => ({ modifiedCount: 1 }));

  const response = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: buildSepayPayload({ id: 93014 })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.classification, 'late_after_expire');
  assert.equal(response.body.reviewStatus, 'pending');
  assert.equal(paymentDoc.statusId, 'expired');
  assert.equal(orderDoc.payment.statusId, 'unpaid', 'Không được tự chuyển đơn đã hết hạn sang paid');
  assert.equal(productUpdateSpy.mock.callCount(), 0);
  assert.equal(createdTransactions.length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. Order đã cancelled
// ─────────────────────────────────────────────────────────────────────────────
test('15. Order đã cancelled: ghi nhận late_after_cancel, cần review, không tự mở lại đơn', async () => {
  const { orderDoc, paymentDoc } = createSampleOrderAndPayment({
    paymentStatusId: 'awaiting_payment',
    orderStatusId: 'cancelled'
  });
  orderDoc.payment.statusId = 'cancelled';
  const createdTransactions = [];

  mock.method(mongoose, 'startSession', async () => createFakeSession());
  mock.method(PaymentTransaction, 'findOne', () => query(null));
  mock.method(PaymentTransaction, 'create', async (docs) => {
    const doc = { _id: new mongoose.Types.ObjectId(), ...docs[0] };
    createdTransactions.push(doc);
    return [doc];
  });
  mock.method(Payment, 'findOne', () => query(paymentDoc));
  mock.method(Order, 'findById', () => query(orderDoc));
  const productUpdateSpy = mock.method(Product, 'updateOne', async () => ({ modifiedCount: 1 }));

  const response = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: buildSepayPayload({ id: 93015 })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.classification, 'late_after_cancel');
  assert.equal(response.body.reviewStatus, 'pending');
  assert.equal(orderDoc.statusId, 'cancelled', 'Không được tự động mở lại Order đã hủy');
  assert.equal(orderDoc.payment.statusId, 'cancelled');
  assert.equal(productUpdateSpy.mock.callCount(), 0);
  assert.equal(createdTransactions.length, 1);
  assert.equal(createdTransactions[0].classification, 'late_after_cancel');
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. Reservation không hợp lệ
// ─────────────────────────────────────────────────────────────────────────────
test('16. Reservation không hợp lệ: không tự xác nhận paid, lưu invalid_reservation cần review', async () => {
  // 16a. Reservation đã bị released trước đó
  const { orderDoc, paymentDoc } = createSampleOrderAndPayment({ withVoucher: false });
  paymentDoc.inventoryReservations[0].status = 'released';
  const createdTransactions = [];

  mock.method(mongoose, 'startSession', async () => createFakeSession());
  mock.method(PaymentTransaction, 'findOne', () => query(null));
  mock.method(PaymentTransaction, 'create', async (docs) => {
    const doc = { _id: new mongoose.Types.ObjectId(), ...docs[0] };
    createdTransactions.push(doc);
    return [doc];
  });
  mock.method(Payment, 'findOne', () => query(paymentDoc));
  mock.method(Order, 'findById', () => query(orderDoc));
  const productUpdateSpy = mock.method(Product, 'updateOne', async () => ({ modifiedCount: 0 }));

  const resReleased = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: buildSepayPayload({ id: 93016 })
  });
  assert.equal(resReleased.status, 200);
  assert.equal(resReleased.body.classification, 'invalid_reservation');
  assert.equal(resReleased.body.reviewStatus, 'pending');
  assert.equal(paymentDoc.statusId, 'awaiting_payment');
  assert.equal(productUpdateSpy.mock.callCount(), 0);

  // 16b. Reservation trạng thái reserved nhưng Product.reservedStock trong DB không khớp (modifiedCount = 0)
  paymentDoc.inventoryReservations[0].status = 'reserved';
  mock.method(PaymentTransaction, 'updateOne', async () => ({ modifiedCount: 1 }));

  const resDbMismatch = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: buildSepayPayload({ id: 93017 })
  });
  assert.equal(resDbMismatch.status, 200);
  assert.equal(resDbMismatch.body.classification, 'invalid_reservation');
  assert.equal(resDbMismatch.body.reviewStatus, 'pending');
  assert.equal(paymentDoc.statusId, 'awaiting_payment');
  assert.equal(orderDoc.payment.statusId, 'awaiting_payment');
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. MongoDB transaction rollback khi có lỗi & retry khi gặp lỗi transient
// ─────────────────────────────────────────────────────────────────────────────
test('17. MongoDB transaction rollback khi có lỗi DB và trả HTTP 500 để SePay retry', async () => {
  const { orderDoc, paymentDoc } = createSampleOrderAndPayment({ withVoucher: false });
  orderDoc.save = async () => {
    throw new Error('Simulated MongoDB write failure on Order.save');
  };

  mock.method(mongoose, 'startSession', async () => createFakeSession());
  mock.method(PaymentTransaction, 'findOne', () => query(null));
  mock.method(PaymentTransaction, 'create', async (docs) => [{ _id: new mongoose.Types.ObjectId(), ...docs[0] }]);
  mock.method(Payment, 'findOne', () => query(paymentDoc));
  mock.method(Order, 'findById', () => query(orderDoc));
  mock.method(Product, 'updateOne', async () => ({ modifiedCount: 1 }));

  const response = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: buildSepayPayload({ id: 93018 })
  });

  assert.equal(response.status, 500, 'Phải trả 500 để SePay thực hiện retry theo lịch trình');
  assert.equal(response.body.success, false);
  // Kiểm tra trạng thái đã được rollback
  assert.equal(paymentDoc.statusId, 'awaiting_payment');
  assert.equal(paymentDoc.paidAt, null);
  assert.equal(paymentDoc.inventoryReservations[0].status, 'reserved');
  assert.equal(orderDoc.payment.statusId, 'awaiting_payment');
});

test('17b. MongoDB transaction tự động retry và thành công khi gặp lỗi TransientTransactionError', async () => {
  const { orderDoc, paymentDoc } = createSampleOrderAndPayment({ withVoucher: false });
  let txAttempts = 0;

  mock.method(mongoose, 'startSession', async () => ({
    async withTransaction(callback) {
      txAttempts += 1;
      if (txAttempts === 1) {
        const transientErr = new Error('WriteConflict during transaction');
        transientErr.errorLabels = ['TransientTransactionError'];
        throw transientErr;
      }
      await callback();
    },
    async endSession() {}
  }));
  mock.method(PaymentTransaction, 'findOne', () => query(null));
  mock.method(PaymentTransaction, 'create', async (docs) => [{ _id: new mongoose.Types.ObjectId(), ...docs[0] }]);
  mock.method(Payment, 'findOne', () => query(paymentDoc));
  mock.method(Order, 'findById', () => query(orderDoc));
  mock.method(Product, 'updateOne', async () => ({ modifiedCount: 1 }));

  const response = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: buildSepayPayload({ id: 93019 })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.classification, 'matched');
  assert.equal(txAttempts, 2, 'Transaction phải được retry sau lỗi transient');
  assert.equal(paymentDoc.statusId, 'paid');
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. Inventory và voucher chỉ được consume một lần
// ─────────────────────────────────────────────────────────────────────────────
test('18. Inventory và voucher chỉ được consume đúng một lần qua toàn bộ vòng đời thanh toán', async () => {
  const { orderDoc, paymentDoc } = createSampleOrderAndPayment({ withVoucher: true });
  const txStore = new Map();
  let stockConsumedCount = 0;
  let userVoucherConsumedCount = 0;
  let voucherQuotaConsumedCount = 0;

  mock.method(mongoose, 'startSession', async () => createFakeSession());
  mock.method(PaymentTransaction, 'findOne', (filter) => (
    query(txStore.get(filter.sepayTransactionId) || null)
  ));
  mock.method(PaymentTransaction, 'create', async (docs) => {
    const doc = { _id: new mongoose.Types.ObjectId(), ...docs[0] };
    txStore.set(doc.sepayTransactionId, doc);
    return [doc];
  });
  mock.method(Payment, 'findOne', (filter) => {
    // expirePayment chỉ tìm statusId = awaiting_payment
    if (filter.statusId === 'awaiting_payment' && paymentDoc.statusId !== 'awaiting_payment') {
      return query(null);
    }
    return query(paymentDoc);
  });
  mock.method(Order, 'findById', () => query(orderDoc));
  mock.method(Product, 'updateOne', async (_filter, update) => {
    assert.equal(update.$inc.stock, undefined, 'Tuyệt đối không giảm stock lần 2 khi consume');
    stockConsumedCount += 1;
    return { modifiedCount: 1 };
  });
  mock.method(UserVoucher, 'updateOne', async () => {
    userVoucherConsumedCount += 1;
    return { modifiedCount: 1 };
  });
  mock.method(Voucher, 'updateOne', async () => {
    voucherQuotaConsumedCount += 1;
    return { modifiedCount: 1 };
  });

  // Lần 1: Webhook xác nhận thanh toán hợp lệ
  const res1 = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: buildSepayPayload({ id: 93020 })
  });
  assert.equal(res1.status, 200);
  assert.equal(res1.body.classification, 'matched');

  // Lần 2: SePay gửi lại cùng transaction ID
  const res2 = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: buildSepayPayload({ id: 93020 })
  });
  assert.equal(res2.status, 200);
  assert.equal(res2.body.duplicate, true);

  // Lần 3: Khách chuyển khoản nhầm thêm 1 giao dịch mới cho cùng Payment đã paid
  const res3 = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: buildSepayPayload({ id: 93021 })
  });
  assert.equal(res3.status, 200);
  assert.equal(res3.body.classification, 'duplicate_payment');

  // Lần 4: Expiration worker chạy sau 24 giờ cũng không được đụng vào Payment đã paid
  const expired = await paymentLifecycleService.expirePayment(
    paymentDoc._id,
    new Date(Date.now() + 48 * 60 * 60 * 1000)
  );
  assert.equal(expired, false);

  assert.equal(stockConsumedCount, 1, 'Inventory chỉ được consume đúng 1 lần');
  assert.equal(userVoucherConsumedCount, 1, 'UserVoucher chỉ được consume đúng 1 lần');
  assert.equal(voucherQuotaConsumedCount, 1, 'Voucher quota chỉ được consume đúng 1 lần');
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. COD vẫn hoạt động bình thường
// ─────────────────────────────────────────────────────────────────────────────
test('19. Luồng đơn hàng COD vẫn hoạt động bình thường, không bị ảnh hưởng bởi SePay webhook', async () => {
  delete process.env.SEPAY_WEBHOOK_API_KEY;
  delete process.env.SEPAY_WEBHOOK_SECRET;
  delete process.env.PAYMENT_QR_BANK_CODE;

  const codOrderId = new mongoose.Types.ObjectId();
  const codOrderDoc = {
    _id: codOrderId,
    id: 'order-cod-1',
    statusId: 'pending',
    payment: { methodId: 'cod', method: 'Thanh toán khi nhận hàng (COD)', statusId: 'unpaid' },
    totalAmount: 120000,
    total: '120000',
    note: 'Giao giờ hành chính',
    toObject() {
      return { ...this };
    }
  };

  mock.method(Order, 'findOne', () => query({ _id: codOrderId }));
  mock.method(Order, 'findById', () => query({ payment: { methodId: 'cod' } }));
  mock.method(Payment, 'findOne', () => query(null));
  mock.method(Order, 'findOneAndUpdate', () => query(codOrderDoc));
  const startSessionSpy = mock.method(mongoose, 'startSession', async () => {
    throw new Error('Đơn hàng COD không được khởi tạo MongoDB transaction');
  });

  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };

  await orderController.updateOrder({
    params: { id: String(codOrderId) },
    body: { statusId: 'processing', note: 'Shop đã xác nhận đơn COD' }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(startSessionSpy.mock.callCount(), 0);
});


// ─────────────────────────────────────────────────────────────────────────────
// 8b. Khách thanh toán thiếu trước rồi chuyển tiếp phần còn thiếu bằng giao dịch thứ hai
// ─────────────────────────────────────────────────────────────────────────────
test('8b. Khách thanh toán thiếu trước rồi chuyển tiếp phần còn thiếu ở giao dịch thứ hai: không tự cộng dồn, cả 2 giao dịch đều lưu underpaid chờ đối soát', async () => {
  const { orderDoc, paymentDoc } = createSampleOrderAndPayment({
    amountDue: 200000,
    withVoucher: false
  });
  const createdTransactions = [];

  mock.method(mongoose, 'startSession', async () => createFakeSession());
  mock.method(PaymentTransaction, 'findOne', () => query(null));
  mock.method(PaymentTransaction, 'create', async (docs) => {
    const doc = { _id: new mongoose.Types.ObjectId(), ...docs[0] };
    createdTransactions.push(doc);
    return [doc];
  });
  mock.method(Payment, 'findOne', () => query(paymentDoc));
  mock.method(Order, 'findById', () => query(orderDoc));
  const productUpdateSpy = mock.method(Product, 'updateOne', async () => ({ modifiedCount: 1 }));

  // Giao dịch 1: Khách chuyển thiếu 150.000 / 200.000
  const res1 = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: buildSepayPayload({ id: 93022, transferAmount: 150000 })
  });
  assert.equal(res1.status, 200);
  assert.equal(res1.body.classification, 'underpaid');
  assert.equal(res1.body.reviewStatus, 'pending');

  // Giao dịch 2: Khách chuyển tiếp 50.000 phần còn thiếu
  const res2 = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: buildSepayPayload({ id: 93023, transferAmount: 50000 })
  });
  assert.equal(res2.status, 200);
  assert.equal(res2.body.classification, 'underpaid');
  assert.equal(res2.body.reviewStatus, 'pending');

  // Hệ thống không tự cộng dồn 2 giao dịch lẻ, Payment vẫn giữ awaiting_payment và cả 2 giao dịch đều gắn với paymentId để admin đối soát
  assert.equal(paymentDoc.statusId, 'awaiting_payment');
  assert.equal(orderDoc.payment.statusId, 'awaiting_payment');
  assert.equal(productUpdateSpy.mock.callCount(), 0);
  assert.equal(createdTransactions.length, 2);
  assert.equal(String(createdTransactions[0].paymentId), String(paymentDoc._id));
  assert.equal(String(createdTransactions[1].paymentId), String(paymentDoc._id));
  assert.equal(createdTransactions[0].transferAmount + createdTransactions[1].transferAmount, 200000);
});

// ─────────────────────────────────────────────────────────────────────────────
// 20. Payload SePay Test Webhook (code: "SEPAYTEST", id: 0)
// ─────────────────────────────────────────────────────────────────────────────
test('20. Payload kiểm thử SePay (code = SEPAYTEST, id = 0) trả HTTP 200, không lưu giao dịch thật và không xác nhận đơn hàng', async () => {
  const startSessionSpy = mock.method(mongoose, 'startSession', async () => createFakeSession());
  const createTxSpy = mock.method(PaymentTransaction, 'create', async () => {
    throw new Error('Không được lưu payload SEPAYTEST vào PaymentTransaction');
  });
  const paymentFindSpy = mock.method(Payment, 'findOne', () => {
    throw new Error('Không được truy vấn hay xác nhận Payment cho payload SEPAYTEST');
  });

  const testPayloadRes = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: {
      id: 0,
      gateway: 'SePay',
      transactionDate: '2026-11-09 19:07:53',
      accountNumber: '0000000000',
      subAccount: null,
      transferType: 'in',
      transferAmount: 10000,
      accumulated: 10000,
      code: 'SEPAYTEST',
      content: 'SEPAY TEST WEBHOOK',
      referenceCode: 'TEST1794226073',
      description: 'SePay test webhook delivery'
    }
  });

  assert.equal(testPayloadRes.status, 200);
  assert.equal(testPayloadRes.body.success, true);
  assert.equal(testPayloadRes.body.testWebhook, true);
  assert.equal(testPayloadRes.body.classification, 'test_webhook');
  assert.equal(testPayloadRes.body.transactionId, null);
  assert.equal(testPayloadRes.body.paymentId, null);
  assert.equal(startSessionSpy.mock.callCount(), 0);
  assert.equal(createTxSpy.mock.callCount(), 0);
  assert.equal(paymentFindSpy.mock.callCount(), 0);

  // Ngược lại, giao dịch thật không phải SEPAYTEST nhưng có id = 0 vẫn bị từ chối 400
  const invalidZeroIdRes = await dispatchWebhookRequest({
    headers: apiKeyHeaders(),
    body: buildSepayPayload({
      id: 0,
      code: VALID_PAYMENT_CODE,
      content: VALID_PAYMENT_CODE
    })
  });
  assert.equal(invalidZeroIdRes.status, 400);
  assert.equal(invalidZeroIdRes.body.success, false);
});
