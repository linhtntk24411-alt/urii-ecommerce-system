const assert = require('node:assert/strict');
const { mock, test } = require('node:test');
const Payment = require('../models/Payment');
const PaymentTransaction = require('../models/PaymentTransaction');
const Product = require('../models/Product');
const UserVoucher = require('../models/UserVoucher');
const Voucher = require('../models/Voucher');
const {
  PaymentValidationError,
  PaymentConfigurationError,
  calculateOrderQuote,
  createQrUrl,
  paymentCode,
  paymentQrConfiguration
} = require('../services/paymentService');

const userId = '6ade4310c044b23d6c6a8681';

function queryResult(value) {
  return {
    session() {
      return this;
    },
    select() {
      return this;
    },
    async lean() {
      return value;
    }
  };
}

test('payment models declare the required unique and lookup indexes', () => {
  const paymentIndexes = Payment.schema.indexes();
  assert.ok(paymentIndexes.some(([keys, options]) => (
    keys.orderId === 1 && options.unique === true
  )));
  assert.ok(paymentIndexes.some(([keys, options]) => (
    keys.paymentCode === 1 && options.unique === true
  )));

  const transactionIndexes = PaymentTransaction.schema.indexes();
  assert.ok(transactionIndexes.some(([keys, options]) => (
    keys.sepayTransactionId === 1 && options.unique === true
  )));
  assert.ok(transactionIndexes.some(([keys]) => keys.paymentId === 1 && keys.transactionAt === -1));
  assert.ok(transactionIndexes.some(([keys]) => keys.reviewStatus === 1 && keys.transactionAt === 1));
  assert.ok(transactionIndexes.some(([keys]) => (
    keys.paymentCodeObserved === 1 && keys.transactionAt === -1
  )));
});

test('payment schemas validate required provider fields and transaction review data', async () => {
  const payment = new Payment({
    orderId: userId,
    paymentCode: 'urii1234567890ABCDEF',
    amountDue: 245000,
    expiresAt: new Date('2026-11-10T00:00:00.000Z')
  });
  await payment.validate();
  assert.equal(payment.paymentCode, 'URII1234567890ABCDEF');
  assert.equal(payment.methodId, 'bank_transfer');
  assert.equal(payment.provider, 'sepay');

  await assert.rejects(
    new PaymentTransaction({
      sepayTransactionId: 'sepay-1',
      transferType: 'invalid',
      transferAmount: 245000,
      transactionAt: new Date(),
      classification: 'matched'
    }).validate(),
    { name: 'ValidationError' }
  );
  await new PaymentTransaction({
    sepayTransactionId: 'sepay-2',
    transferType: 'in',
    transferAmount: 245000,
    transactionAt: new Date(),
    classification: 'matched'
  }).validate();
});

test('payment quote uses current catalog price and stock, not order-supplied prices', async () => {
  const find = mock.method(Product, 'find', () => queryResult([{
    id: 'product-1',
    name: 'Sản phẩm kiểm thử',
    image: '/images/product.png',
    currentPrice: 999999,
    stock: 5,
    variants: [
      { name: 'Nhỏ', price: 25000, stock: 2 },
      { name: 'Lớn', price: 50000, stock: 5, image: '/images/large.png' }
    ]
  }]));
  try {
    const quote = await calculateOrderQuote({
      items: [{
        productId: 'product-1',
        variantIndex: 1,
        quantity: 2,
        price: 1
      }]
    }, userId, {}, new Date('2026-11-09T00:00:00.000Z'));

    assert.equal(quote.subtotal, 100000);
    assert.equal(quote.shippingFee, 30000);
    assert.equal(quote.amountDue, 130000);
    assert.deepEqual(quote.items, [{
      productId: 'product-1',
      name: 'Sản phẩm kiểm thử',
      price: 50000,
      unitPrice: 50000,
      quantity: 2,
      image: '/images/large.png',
      variantIndex: 1,
      variantName: 'Lớn'
    }]);
  } finally {
    find.mock.restore();
  }
});

test('payment quote rejects ambiguous variants, invalid quantities, and unavailable stock', async () => {
  const find = mock.method(Product, 'find', () => queryResult([{
    id: 'product-1',
    name: 'Sản phẩm kiểm thử',
    currentPrice: 25000,
    stock: 5,
    variants: [
      { name: 'Nhỏ', price: 25000, stock: 2 },
      { name: 'Lớn', price: 50000, stock: 5 }
    ]
  }]));
  try {
    await assert.rejects(
      calculateOrderQuote({ items: [{ productId: 'product-1', quantity: 1 }] }, userId, {}),
      PaymentValidationError
    );
    await assert.rejects(
      calculateOrderQuote({
        items: [{ productId: 'product-1', variantIndex: 0, quantity: 3 }]
      }, userId, {}),
      /không đủ tồn kho/
    );
    await assert.rejects(
      calculateOrderQuote({
        items: [{ productId: 'product-1', variantIndex: 0, quantity: 0 }]
      }, userId, {}),
      /Số lượng/
    );
  } finally {
    find.mock.restore();
  }
});

test('payment quote validates voucher ownership, availability, and discount from server records', async () => {
  const productFind = mock.method(Product, 'find', () => queryResult([{
    id: 'product-1',
    name: 'Sản phẩm kiểm thử',
    currentPrice: 100000,
    stock: 5,
    variants: []
  }]));
  const ownershipFind = mock.method(UserVoucher, 'findOne', () => queryResult({
    userId,
    voucherId: 'voucher-1',
    isUsed: false,
    source: 'promotion'
  }));
  const voucherFind = mock.method(Voucher, 'findOne', () => queryResult({
    id: 'voucher-1',
    isActive: true,
    type: 'percent',
    discountValue: 20,
    maxDiscount: 15000,
    minOrder: 50000,
    used: 0
  }));
  try {
    const quote = await calculateOrderQuote({
      items: [{ productId: 'product-1', quantity: 2 }],
      voucher: { voucherId: 'voucher-1', discountAmount: 999999 }
    }, userId, {});

    assert.equal(quote.subtotal, 200000);
    assert.equal(quote.shippingFee, 0);
    assert.equal(quote.discountAmount, 15000);
    assert.equal(quote.amountDue, 185000);
    assert.deepEqual(ownershipFind.mock.calls[0].arguments[0], {
      userId,
      voucherId: 'voucher-1',
      isUsed: false,
      reservedByPaymentId: null
    });
  } finally {
    voucherFind.mock.restore();
    ownershipFind.mock.restore();
    productFind.mock.restore();
  }
});

test('QR settings come from environment configuration and payment references are unique', () => {
  assert.equal(paymentQrConfiguration({}), null);
  assert.throws(
    () => paymentQrConfiguration({
      PAYMENT_QR_BANK_CODE: '../bank',
      PAYMENT_QR_ACCOUNT_NUMBER: '12345678',
      PAYMENT_QR_ACCOUNT_NAME: 'Urii',
      PAYMENT_QR_TEMPLATE: 'compact2'
    }),
    PaymentConfigurationError
  );

  const payment = {
    amountDue: 245000,
    paymentCode: 'URII1234567890ABCDEF'
  };
  const qrUrl = createQrUrl(payment, {
    bankCode: '970422',
    accountNumber: '12345678',
    accountName: 'URI I SHOP',
    template: 'compact2'
  });
  const url = new URL(qrUrl);
  assert.equal(url.origin, 'https://img.vietqr.io');
  assert.equal(url.searchParams.get('amount'), '245000');
  assert.equal(url.searchParams.get('addInfo'), payment.paymentCode);
  assert.equal(url.searchParams.get('accountName'), 'URI I SHOP');
  assert.match(paymentCode(), /^URII[A-F0-9]{16}$/);
});
