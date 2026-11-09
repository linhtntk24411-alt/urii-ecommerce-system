const assert = require('node:assert/strict');
const { mock, test } = require('node:test');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Product = require('../models/Product');
const orderController = require('../controllers/orderController');
const productController = require('../controllers/productController');
const paymentLifecycleService = require('../services/paymentLifecycleService');

function query(value) {
  return {
    select() {
      return this;
    },
    session() {
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

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

test('admin financial changes cancel an active payment before updating the order', async () => {
  const fakeSession = {
    async withTransaction(callback) {
      await callback();
    },
    async endSession() {}
  };
  const orderDocument = {
    _id: new mongoose.Types.ObjectId(),
    totalAmount: 10000,
    total: '10000',
    payment: { methodId: 'bank_transfer', statusId: 'awaiting_payment' },
    set(updates) {
      Object.assign(this, updates);
    },
    async save({ session }) {
      assert.equal(session, fakeSession);
      this.saved = true;
    },
    toObject() {
      const { set, save, toObject, ...data } = this;
      return data;
    }
  };
  const paymentDocument = {
    _id: new mongoose.Types.ObjectId(),
    statusId: 'awaiting_payment',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000)
  };
  const orderFind = mock.method(Order, 'findOne', () => query({ _id: orderDocument._id }));
  const orderFindById = mock.method(Order, 'findById', () => query(orderDocument));
  const paymentFind = mock.method(Payment, 'findOne', (filter) => (
    filter && Object.hasOwn(filter, 'orderId')
      ? query(paymentDocument)
      : query({ _id: paymentDocument._id })
  ));
  const startSession = mock.method(mongoose, 'startSession', async () => fakeSession);
  const cancelPayment = mock.method(
    paymentLifecycleService,
    'cancelPaymentInSession',
    async (payment) => {
      payment.statusId = 'cancelled';
      return true;
    }
  );

  try {
    const res = response();
    await orderController.updateOrder({
      params: { id: String(orderDocument._id) },
      body: { totalAmount: 9000 }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(cancelPayment.mock.callCount(), 1);
    assert.equal(paymentDocument.statusId, 'cancelled');
    assert.equal(orderDocument.totalAmount, 9000);
    assert.equal(orderDocument.payment.statusId, 'cancelled');
    assert.equal(orderDocument.saved, true);
  } finally {
    cancelPayment.mock.restore();
    startSession.mock.restore();
    paymentFind.mock.restore();
    orderFindById.mock.restore();
    orderFind.mock.restore();
  }
});

test('COD order updates do not require a MongoDB transaction', async () => {
  const orderDocument = {
    _id: new mongoose.Types.ObjectId(),
    payment: { methodId: 'cod' },
    note: 'Đã cập nhật',
    toObject() {
      return { _id: this._id, payment: this.payment, note: this.note };
    }
  };
  const orderFind = mock.method(Order, 'findOne', () => query({ _id: orderDocument._id }));
  const orderFindById = mock.method(Order, 'findById', () => query({
    payment: { methodId: 'cod' }
  }));
  const orderFindOneAndUpdate = mock.method(Order, 'findOneAndUpdate', () => query(orderDocument));
  const paymentFind = mock.method(Payment, 'findOne', () => query(null));
  const startSession = mock.method(mongoose, 'startSession', async () => {
    throw new Error('COD updates must not start a MongoDB transaction.');
  });

  try {
    const res = response();
    await orderController.updateOrder({
      params: { id: String(orderDocument._id) },
      body: { note: 'Đã cập nhật' }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(startSession.mock.callCount(), 0);
    assert.equal(orderFindOneAndUpdate.mock.callCount(), 1);
  } finally {
    startSession.mock.restore();
    paymentFind.mock.restore();
    orderFindOneAndUpdate.mock.restore();
    orderFindById.mock.restore();
    orderFind.mock.restore();
  }
});

test('deleteOrder cancels an active awaiting_payment Payment and rejects paid Orders', async () => {
  const fakeSession = {
    async withTransaction(callback) {
      await callback();
    },
    async endSession() {}
  };
  const orderId = new mongoose.Types.ObjectId();
  const paymentDocument = {
    _id: new mongoose.Types.ObjectId(),
    orderId,
    statusId: 'awaiting_payment'
  };

  const orderFind = mock.method(Order, 'findOne', () => query({
    _id: orderId,
    payment: { methodId: 'bank_transfer' }
  }));
  const paymentFind = mock.method(Payment, 'findOne', () => query(paymentDocument));
  const orderDelete = mock.method(Order, 'findOneAndDelete', async () => ({ _id: orderId }));
  const startSession = mock.method(mongoose, 'startSession', async () => fakeSession);
  const cancelPayment = mock.method(
    paymentLifecycleService,
    'cancelPaymentInSession',
    async (payment) => {
      payment.statusId = 'cancelled';
      return true;
    }
  );

  try {
    const res = response();
    await orderController.deleteOrder({ params: { id: String(orderId) } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(cancelPayment.mock.callCount(), 1);
    assert.equal(paymentDocument.statusId, 'cancelled');

    // Khi Payment đã paid, không cho phép xóa đơn hàng
    paymentDocument.statusId = 'paid';
    const resPaid = response();
    await orderController.deleteOrder({ params: { id: String(orderId) } }, resPaid);
    assert.equal(resPaid.statusCode, 409);
    assert.match(resPaid.body.message, /đã được thanh toán/);
  } finally {
    cancelPayment.mock.restore();
    startSession.mock.restore();
    orderDelete.mock.restore();
    paymentFind.mock.restore();
    orderFind.mock.restore();
  }
});

test('productController.updateStock rejects modifying stock when product or variant has active reservations', async () => {
  const reservedProduct = {
    _id: new mongoose.Types.ObjectId(),
    id: 'prod-reserved',
    stock: 5,
    reservedStock: 1,
    variants: [{ name: 'Đỏ', stock: 5, reservedStock: 1 }],
    async save() {
      throw new Error('Must not save when reservedStock > 0');
    }
  };
  const productFind = mock.method(Product, 'findOne', () => query(reservedProduct));

  try {
    const res = response();
    await productController.updateStock({
      params: { id: 'prod-reserved' },
      body: { stock: 0, variantName: 'Đỏ' }
    }, res);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.message, /đang được giữ cho Payment/);
  } finally {
    productFind.mock.restore();
  }
});
