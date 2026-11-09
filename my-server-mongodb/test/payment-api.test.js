const assert = require('node:assert/strict');
const http = require('node:http');
const { after, before, mock, test } = require('node:test');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const app = require('../app');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Product = require('../models/Product');
const { initializeRealtime } = require('../realtime');
const paymentLifecycleService = require('../services/paymentLifecycleService');

const userId = '6ade4310c044b23d6c6a8681';
const orderObjectId = '6ade4310c044b23d6c6a8682';
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
  process.env.JWT_SECRET = 'payment-api-test-secret';
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

function query(value) {
  return {
    session() {
      return this;
    },
    select() {
      return this;
    },
    async lean() {
      return value;
    },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    }
  };
}

function customerToken() {
  return jwt.sign({ id: userId, role: 'user' }, process.env.JWT_SECRET);
}

function authHeaders(token = customerToken()) {
  return { Authorization: `Bearer ${token}` };
}

test('payment APIs require an authenticated customer and reject admin tokens', async () => {
  const anonymousResponses = await Promise.all([
    fetch(`${baseUrl}/api/orders/order-1/payment`, { method: 'POST' }),
    fetch(`${baseUrl}/api/orders/order-1/payment`)
  ]);
  assert.ok(anonymousResponses.every((response) => response.status === 401));

  const adminToken = jwt.sign(
    { id: orderObjectId, role: 'admin' },
    process.env.JWT_SECRET
  );
  const adminResponses = await Promise.all([
    fetch(`${baseUrl}/api/orders/order-1/payment`, {
      method: 'POST',
      headers: authHeaders(adminToken)
    }),
    fetch(`${baseUrl}/api/orders/order-1/payment`, {
      headers: authHeaders(adminToken)
    })
  ]);
  assert.ok(adminResponses.every((response) => response.status === 403));
});

test('payment creation reports missing QR account settings without accessing orders', async () => {
  const keys = [
    'PAYMENT_QR_BANK_CODE',
    'PAYMENT_QR_ACCOUNT_NUMBER',
    'PAYMENT_QR_ACCOUNT_NAME',
    'PAYMENT_QR_TEMPLATE'
  ];
  const values = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  try {
    const response = await fetch(`${baseUrl}/api/orders/order-bank-1/payment`, {
      method: 'POST',
      headers: authHeaders()
    });
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.match(body.message, /chưa cấu hình/);
  } finally {
    for (const [key, value] of values) process.env[key] = value;
  }
});

test('payment creation recalculates totals and persists Payment and Order atomically', async () => {
  const savedOrder = {
    _id: new mongoose.Types.ObjectId(orderObjectId),
    id: 'order-bank-1',
    userId,
    orderType: 'normal',
    statusId: 'pending',
    payment: { method: 'bank_transfer' },
    shipping: { method: 'standard', fee: 30000 },
    items: [{ productId: 'product-1', quantity: 2, price: 1 }],
    async save({ session }) {
      assert.equal(session, fakeSession);
      this.saved = true;
    }
  };
  const fakeSession = {
    async withTransaction(callback) {
      await callback();
    },
    async endSession() {}
  };
  const paymentData = {
    _id: new mongoose.Types.ObjectId(),
    orderId: savedOrder._id,
    paymentCode: 'URII1234567890ABCDEF',
    amountDue: 130000,
    currency: 'VND',
    methodId: 'bank_transfer',
    provider: 'sepay',
    statusId: 'awaiting_payment',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    paidAt: null
  };
  const createdPayment = {
    ...paymentData,
    async save({ session }) {
      assert.equal(session, fakeSession);
      this.saved = true;
    },
    toObject() {
      const { save, toObject, ...data } = this;
      return data;
    }
  };
  const orderFind = mock.method(Order, 'findOne', () => query(savedOrder));
  const paymentFind = mock.method(Payment, 'findOne', () => query(null));
  const productFind = mock.method(Product, 'find', () => query([{
    id: 'product-1',
    name: 'Sản phẩm kiểm thử',
    currentPrice: 50000,
    image: '/images/test.png',
    stock: 5,
    variants: []
  }]));
  const paymentCreate = mock.method(Payment, 'create', async (documents, options) => {
    assert.equal(options.session, fakeSession);
    assert.equal(documents[0].amountDue, 130000);
    assert.equal(documents[0].methodId, 'bank_transfer');
    return [createdPayment];
  });
  const reserveInventory = mock.method(
    paymentLifecycleService,
    'reserveInventory',
    async () => [{
      productId: 'product-1',
      productObjectId: new mongoose.Types.ObjectId(),
      variantId: null,
      variantIndex: null,
      quantity: 2,
      status: 'reserved'
    }]
  );
  const startSession = mock.method(mongoose, 'startSession', async () => fakeSession);

  try {
    const response = await fetch(`${baseUrl}/api/orders/order-bank-1/payment`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountDue: 1, total: '1' })
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.payment.amountDue, 130000);
    assert.equal(body.payment.paymentCode, paymentData.paymentCode);
    assert.match(body.payment.qrCodeUrl, /amount=130000/);
    assert.match(body.payment.qrCodeUrl, /addInfo=URII1234567890ABCDEF/);
    assert.equal(savedOrder.totalAmount, 130000);
    assert.equal(savedOrder.total, '130000');
    assert.equal(savedOrder.items[0].unitPrice, 50000);
    assert.equal(savedOrder.payment.statusId, 'awaiting_payment');
    assert.equal(savedOrder.statusId, 'pending');
    assert.equal(savedOrder.waitingInfo.type, 'awaiting_payment');
    assert.equal(savedOrder.saved, true);
    assert.equal(paymentCreate.mock.callCount(), 1);
    assert.equal(createdPayment.saved, true);
    assert.equal(startSession.mock.callCount(), 1);
  } finally {
    reserveInventory.mock.restore();
    startSession.mock.restore();
    paymentCreate.mock.restore();
    productFind.mock.restore();
    paymentFind.mock.restore();
    orderFind.mock.restore();
  }
});

test('payment creation does not disclose orders owned by another user', async () => {
  const orderFind = mock.method(Order, 'findOne', () => query(null));
  const fakeSession = {
    async withTransaction(callback) {
      await callback();
    },
    async endSession() {}
  };
  const startSession = mock.method(mongoose, 'startSession', async () => fakeSession);
  try {
    const response = await fetch(`${baseUrl}/api/orders/private-order/payment`, {
      method: 'POST',
      headers: authHeaders()
    });
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.match(body.message, /Không tìm thấy đơn hàng/);
  } finally {
    startSession.mock.restore();
    orderFind.mock.restore();
  }
});

test('payment creation processes expiration and rotates the old payment code', async () => {
  const savedOrder = {
    _id: new mongoose.Types.ObjectId(orderObjectId),
    id: 'order-bank-1',
    userId,
    statusId: 'pending',
    payment: { methodId: 'bank_transfer', statusId: 'unpaid' },
    items: [{ productId: 'product-1', quantity: 2 }],
    async save({ session }) {
      assert.equal(session, fakeSession);
      this.saved = true;
    }
  };
  const fakeSession = {
    async withTransaction(callback) {
      await callback();
    },
    async endSession() {}
  };
  const expiredPayment = {
    _id: new mongoose.Types.ObjectId(),
    orderId: savedOrder._id,
    paymentCode: 'URII1234567890ABCDEF',
    amountDue: 245000,
    currency: 'VND',
    methodId: 'bank_transfer',
    provider: 'sepay',
    statusId: 'expired',
    expiresAt: new Date(Date.now() - 1000),
    paidAt: null,
    inventoryReservations: [],
    async save({ session }) {
      assert.equal(session, fakeSession);
    },
    toObject() {
      const { save, toObject, ...data } = this;
      return data;
    }
  };
  const orderFind = mock.method(Order, 'findOne', () => query(savedOrder));
  const startSession = mock.method(mongoose, 'startSession', async () => fakeSession);
  const paymentFind = mock.method(Payment, 'findOne', (filter) => (
    filter.expiresAt ? query({ _id: expiredPayment._id }) : query(expiredPayment)
  ));
  const expirePayment = mock.method(paymentLifecycleService, 'expirePayment', async () => true);
  const productFind = mock.method(Product, 'find', () => query([{
    id: 'product-1',
    name: 'Sản phẩm kiểm thử',
    currentPrice: 50000,
    stock: 5,
    variants: []
  }]));
  const reserveInventory = mock.method(paymentLifecycleService, 'reserveInventory', async () => []);
  try {
    const response = await fetch(`${baseUrl}/api/orders/order-bank-1/payment`, {
      method: 'POST',
      headers: authHeaders()
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.notEqual(body.payment.paymentCode, 'URII1234567890ABCDEF');
    assert.equal(body.payment.statusId, 'awaiting_payment');
    assert.ok(expirePayment.mock.callCount() > 0);
  } finally {
    reserveInventory.mock.restore();
    productFind.mock.restore();
    expirePayment.mock.restore();
    paymentFind.mock.restore();
    startSession.mock.restore();
    orderFind.mock.restore();
  }
});

test('payment creation refuses cancelled orders', async () => {
  const cancelledOrder = {
    _id: new mongoose.Types.ObjectId(orderObjectId),
    id: 'order-cancelled',
    userId,
    statusId: 'cancelled',
    payment: { methodId: 'bank_transfer' }
  };
  const fakeSession = {
    async withTransaction(callback) {
      await callback();
    },
    async endSession() {}
  };
  const orderFind = mock.method(Order, 'findOne', () => query(cancelledOrder));
  const startSession = mock.method(mongoose, 'startSession', async () => fakeSession);
  const paymentFind = mock.method(Payment, 'findOne', () => query(null));
  try {
    const response = await fetch(`${baseUrl}/api/orders/order-cancelled/payment`, {
      method: 'POST',
      headers: authHeaders()
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.message, /đã bị hủy/);
  } finally {
    paymentFind.mock.restore();
    startSession.mock.restore();
    orderFind.mock.restore();
  }
});

test('payment status is scoped to the owning customer', async () => {
  const orderFind = mock.method(Order, 'findOne', () => query({ _id: orderObjectId }));
  const paymentFind = mock.method(Payment, 'findOne', () => query({
    _id: 'payment-1',
    orderId: orderObjectId,
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
    const response = await fetch(`${baseUrl}/api/orders/order-bank-1/payment`, {
      headers: authHeaders()
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.payment.amountDue, 245000);
    assert.equal(body.payment.statusId, 'awaiting_payment');
    assert.equal(body.payment.isExpired, false);
    assert.equal(Object.hasOwn(body.payment, 'qrCodeUrl'), false);
    assert.deepEqual(orderFind.mock.calls[0].arguments[0], {
      userId,
      $or: [{ id: 'order-bank-1' }]
    });
  } finally {
    paymentFind.mock.restore();
    orderFind.mock.restore();
  }
});

test('payment status is independent of invalid QR configuration', async () => {
  const configKeys = [
    'PAYMENT_QR_BANK_CODE',
    'PAYMENT_QR_ACCOUNT_NUMBER',
    'PAYMENT_QR_ACCOUNT_NAME',
    'PAYMENT_QR_TEMPLATE'
  ];
  const oldConfig = new Map(configKeys.map((key) => [key, process.env[key]]));
  process.env.PAYMENT_QR_BANK_CODE = '../invalid';
  process.env.PAYMENT_QR_ACCOUNT_NUMBER = 'not-a-number';
  const orderFind = mock.method(Order, 'findOne', () => query({ _id: orderObjectId }));
  const paymentFind = mock.method(Payment, 'findOne', () => query({
    _id: 'payment-expired',
    orderId: orderObjectId,
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
    const response = await fetch(`${baseUrl}/api/orders/order-bank-1/payment`, {
      headers: authHeaders()
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.payment.statusId, 'awaiting_payment');
    assert.equal(body.payment.isExpired, false);
    assert.equal(Object.hasOwn(body.payment, 'qrCodeUrl'), false);

    for (const key of configKeys) delete process.env[key];
    const missingConfigResponse = await fetch(`${baseUrl}/api/orders/order-bank-1/payment`, {
      headers: authHeaders()
    });
    const missingConfigBody = await missingConfigResponse.json();
    assert.equal(missingConfigResponse.status, 200);
    assert.equal(missingConfigBody.payment.statusId, 'awaiting_payment');
  } finally {
    for (const [key, value] of oldConfig) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    paymentFind.mock.restore();
    orderFind.mock.restore();
  }
});
