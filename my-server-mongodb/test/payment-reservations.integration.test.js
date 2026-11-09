const assert = require('node:assert/strict');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { test } = require('node:test');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const app = require('../app');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const PaymentTransaction = require('../models/PaymentTransaction');
const Product = require('../models/Product');
const UserVoucher = require('../models/UserVoucher');
const Voucher = require('../models/Voucher');
const { initializeRealtime } = require('../realtime');
const {
  consumePaymentReservations,
  expirePayment,
  reserveInventory,
  reserveVoucher
} = require('../services/paymentLifecycleService');

const mongoUri = process.env.PAYMENT_TEST_MONGO_URI;

test('real MongoDB transactions protect inventory, voucher quota, expiry, and idempotency', {
  timeout: 90000
}, async (t) => {
  if (!mongoUri) {
    t.skip('Set PAYMENT_TEST_MONGO_URI to run isolated replica-set transaction tests.');
    return;
  }

  const databaseName = `urii_payment_test_${randomBytes(8).toString('hex')}`;
  const previousEnvironment = new Map(
    [
      'JWT_SECRET',
      'PAYMENT_QR_BANK_CODE',
      'PAYMENT_QR_ACCOUNT_NUMBER',
      'PAYMENT_QR_ACCOUNT_NAME',
      'PAYMENT_QR_TEMPLATE',
      'SEPAY_WEBHOOK_API_KEY'
    ].map((key) => [key, process.env[key]])
  );
  let server;
  let io;
  await mongoose.connect(mongoUri, {
    dbName: databaseName,
    serverSelectionTimeoutMS: 15000
  });

  try {
    await Promise.all([
      Payment.createIndexes(),
      PaymentTransaction.createIndexes(),
      Product.createIndexes(),
      UserVoucher.createIndexes(),
      Voucher.createIndexes(),
      Order.createIndexes()
    ]);

    const userIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    process.env.JWT_SECRET = 'payment-reservation-integration-test';
    process.env.PAYMENT_QR_BANK_CODE = '970422';
    process.env.PAYMENT_QR_ACCOUNT_NUMBER = '12345678';
    process.env.PAYMENT_QR_ACCOUNT_NAME = 'URI I SHOP';
    process.env.PAYMENT_QR_TEMPLATE = 'compact2';
    process.env.SEPAY_WEBHOOK_API_KEY = 'sepay-integration-test-apikey';
    server = http.createServer(app);
    io = initializeRealtime(server, app.get('allowedOrigins'));
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
      server.listen(0, '127.0.0.1');
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    async function createPaymentRequest(orderId, userId) {
      const token = jwt.sign(
        { id: String(userId), role: 'user' },
        process.env.JWT_SECRET
      );
      return fetch(`${baseUrl}/api/orders/${orderId}/payment`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
    }

    async function postSepayWebhook(payload, apiKey = process.env.SEPAY_WEBHOOK_API_KEY) {
      return fetch(`${baseUrl}/api/webhooks/sepay`, {
        method: 'POST',
        headers: {
          Authorization: `Apikey ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
    }

    const makeOrder = async (id, userId, orderObjectId) => Order.create({
      ...(orderObjectId ? { _id: orderObjectId } : {}),
      id,
      userId,
      statusId: 'pending',
      orderType: 'normal',
      total: '10000',
      totalAmount: 10000,
      items: [{ productId: 'placeholder', quantity: 1 }],
      payment: { methodId: 'bank_transfer', statusId: 'awaiting_payment' }
    });
    const makePayableOrder = async (id, userId, productId, orderObjectId) => Order.create({
      _id: orderObjectId,
      id,
      userId,
      statusId: 'pending',
      orderType: 'normal',
      items: [{ productId, quantity: 1 }],
      payment: { methodId: 'bank_transfer', statusId: 'unpaid' }
    });

    async function reservePayment({ orderId, userId, productId, variantIndex = null, voucher }) {
      const session = await mongoose.startSession();
      let paymentId;
      try {
        await session.withTransaction(async () => {
          const [payment] = await Payment.create([{
            orderId,
            paymentCode: `URII${randomBytes(8).toString('hex')}`,
            amountDue: 10000,
            expiresAt,
            statusId: 'awaiting_payment'
          }], { session });
          const inventoryReservations = await reserveInventory([{
            productId,
            name: productId,
            quantity: 1,
            variantIndex
          }], session);
          payment.inventoryReservations = inventoryReservations;
          if (voucher) {
            await reserveVoucher({
              ...voucher,
              userId,
              paymentId: payment._id,
              expiresAt
            }, session);
            payment.voucherReservation = {
              voucherId: voucher.voucherId,
              userVoucherId: voucher.userVoucherId,
              status: 'reserved'
            };
          }
          await payment.save({ session });
          paymentId = payment._id;
        });
        return paymentId;
      } finally {
        await session.endSession();
      }
    }

    const lastItem = await Product.create({
      id: 'one-unit',
      name: 'One unit',
      slug: 'one-unit',
      currentPrice: 10000,
      stock: 1
    });
    const httpStockOrders = [
      new mongoose.Types.ObjectId(),
      new mongoose.Types.ObjectId()
    ];
    await Promise.all(httpStockOrders.map((id, index) => makePayableOrder(
      `http-stock-${index}`,
      userIds[index],
      lastItem.id,
      id
    )));
    const httpStockResponses = await Promise.all(httpStockOrders.map((orderId, index) => (
      createPaymentRequest(String(orderId), userIds[index])
    )));
    const httpStockResults = await Promise.all(httpStockResponses.map(async (response) => ({
      status: response.status,
      body: await response.json()
    })));
    assert.equal(
      httpStockResults.filter((result) => result.status === 201).length,
      1,
      JSON.stringify(httpStockResults)
    );
    const httpStockProduct = await Product.findById(lastItem._id).lean();
    assert.equal(httpStockProduct.stock, 0);
    assert.equal(httpStockProduct.reservedStock, 1);
    assert.equal(await Payment.countDocuments({ orderId: { $in: httpStockOrders } }), 1);

    const serviceLastItem = await Product.create({
      id: 'service-one-unit',
      name: 'Service one unit',
      slug: 'service-one-unit',
      stock: 1
    });
    const stockOrders = [
      new mongoose.Types.ObjectId(),
      new mongoose.Types.ObjectId()
    ];
    await Promise.all(stockOrders.map((id, index) => makeOrder(`stock-${index}`, userIds[index], id)));
    const stockAttempts = await Promise.allSettled(stockOrders.map((orderId, index) => reservePayment({
      orderId,
      userId: userIds[index],
      productId: serviceLastItem.id
    })));
    assert.equal(stockAttempts.filter((result) => result.status === 'fulfilled').length, 1);
    let updatedProduct = await Product.findById(lastItem._id).lean();
    assert.equal(updatedProduct.stock, 0);
    assert.equal(updatedProduct.reservedStock, 1);

    const uniqueOrderId = new mongoose.Types.ObjectId();
    await Product.create({
      id: 'shared-two-units',
      name: 'Shared stock',
      slug: 'shared-two-units',
      stock: 2
    });
    await makeOrder('same-order-race', userIds[0], uniqueOrderId);
    const sameOrderAttempts = await Promise.allSettled([
      reservePayment({
        orderId: uniqueOrderId,
        userId: userIds[0],
        productId: 'shared-two-units'
      }),
      reservePayment({
        orderId: uniqueOrderId,
        userId: userIds[0],
        productId: 'shared-two-units'
      })
    ]);
    assert.equal(sameOrderAttempts.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(await Payment.countDocuments({ orderId: uniqueOrderId }), 1);

    const sameOrderProduct = await Product.create({
      id: 'same-order-stock',
      name: 'Same order stock',
      slug: 'same-order-stock',
      currentPrice: 10000,
      stock: 2
    });
    const httpSameOrderId = new mongoose.Types.ObjectId();
    await makePayableOrder('http-same-order', userIds[0], sameOrderProduct.id, httpSameOrderId);
    const sameOrderResponses = await Promise.all([
      createPaymentRequest(String(httpSameOrderId), userIds[0]),
      createPaymentRequest(String(httpSameOrderId), userIds[0])
    ]);
    assert.ok(sameOrderResponses.every((response) => [200, 201].includes(response.status)));
    const sameOrderBodies = await Promise.all(sameOrderResponses.map((response) => response.json()));
    assert.equal(sameOrderBodies[0].payment.paymentCode, sameOrderBodies[1].payment.paymentCode);
    assert.equal(await Payment.countDocuments({ orderId: httpSameOrderId }), 1);

    const voucherProduct = await Product.create({
      id: 'voucher-stock',
      name: 'Voucher stock',
      slug: 'voucher-stock',
      stock: 2
    });
    const quotaVoucher = await Voucher.create({
      id: 'single-use',
      code: 'SINGLE',
      name: 'Single use',
      type: 'fixed',
      discountValue: 1000,
      quantity: 1,
      used: 0,
      reservedCount: 0,
      isActive: true
    });
    const userVoucher = await UserVoucher.create({
      userId: userIds[0],
      voucherId: quotaVoucher.id,
      code: quotaVoucher.code
    });
    const voucherOrderIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
    await Promise.all(voucherOrderIds.map((id, index) => makeOrder(`voucher-${index}`, userIds[0], id)));
    const voucherAttempts = await Promise.allSettled(voucherOrderIds.map((orderId) => reservePayment({
      orderId,
      userId: userIds[0],
      productId: voucherProduct.id,
      voucher: { voucherId: quotaVoucher.id, userVoucherId: userVoucher._id }
    })));
    assert.equal(voucherAttempts.filter((result) => result.status === 'fulfilled').length, 1);
    let updatedVoucher = await Voucher.findById(quotaVoucher._id).lean();
    assert.equal(updatedVoucher.reservedCount, 1);
    assert.ok((await UserVoucher.findById(userVoucher._id).lean()).reservedByPaymentId);

    const winningVoucherPaymentId = voucherAttempts.find((result) => result.status === 'fulfilled').value;
    await Payment.updateOne({ _id: winningVoucherPaymentId }, { $set: { expiresAt: new Date(now.getTime() - 1) } });
    const expiryResults = await Promise.all([
      expirePayment(winningVoucherPaymentId, now),
      expirePayment(winningVoucherPaymentId, now)
    ]);
    assert.equal(expiryResults.filter(Boolean).length, 1);
    assert.equal(await expirePayment(winningVoucherPaymentId, now), false);
    updatedVoucher = await Voucher.findById(quotaVoucher._id).lean();
    assert.equal(updatedVoucher.reservedCount, 0);
    const releasedUserVoucher = await UserVoucher.findById(userVoucher._id).lean();
    assert.equal(releasedUserVoucher.reservedByPaymentId, null);
    assert.equal(releasedUserVoucher.isUsed, false);
    updatedProduct = await Product.findById(voucherProduct._id).lean();
    assert.equal(updatedProduct.stock, 2);
    assert.equal(updatedProduct.reservedStock, 0);
    assert.equal((await Payment.findById(winningVoucherPaymentId).lean()).statusId, 'expired');
    assert.equal((await Order.findById(voucherOrderIds[voucherAttempts.findIndex((result) => result.status === 'fulfilled')]).lean())
      .payment.statusId, 'unpaid');

    const variantProduct = await Product.create({
      id: 'variant-item',
      name: 'Variant item',
      slug: 'variant-item',
      stock: 1,
      variants: [{ name: 'Blue', price: 10000, stock: 1 }]
    });
    const variantOrderId = new mongoose.Types.ObjectId();
    await makeOrder('variant-order', userIds[1], variantOrderId);
    const variantPaymentId = await reservePayment({
      orderId: variantOrderId,
      userId: userIds[1],
      productId: variantProduct.id,
      variantIndex: 0
    });
    updatedProduct = await Product.findById(variantProduct._id).lean();
    assert.equal(updatedProduct.variants[0].stock, 0);
    assert.equal(updatedProduct.variants[0].reservedStock, 1);
    await Payment.updateOne({ _id: variantPaymentId }, { $set: { expiresAt: new Date(now.getTime() - 1) } });
    await expirePayment(variantPaymentId, now);
    updatedProduct = await Product.findById(variantProduct._id).lean();
    assert.equal(updatedProduct.variants[0].stock, 1);
    assert.equal(updatedProduct.variants[0].reservedStock, 0);

    const paidProduct = await Product.create({
      id: 'paid-item',
      name: 'Paid item',
      slug: 'paid-item',
      stock: 2
    });
    const paidOrderId = new mongoose.Types.ObjectId();
    await makeOrder('paid-order', userIds[0], paidOrderId);
    const paidPaymentId = await reservePayment({
      orderId: paidOrderId,
      userId: userIds[0],
      productId: paidProduct.id,
      voucher: { voucherId: quotaVoucher.id, userVoucherId: userVoucher._id }
    });
    const paidSession = await mongoose.startSession();
    try {
      await paidSession.withTransaction(async () => {
        const payment = await Payment.findById(paidPaymentId).session(paidSession);
        await consumePaymentReservations(payment, paidSession);
        payment.statusId = 'paid';
        payment.paidAt = now;
        await payment.save({ session: paidSession });
      });
    } finally {
      await paidSession.endSession();
    }
    updatedProduct = await Product.findById(paidProduct._id).lean();
    assert.equal(updatedProduct.stock, 1);
    assert.equal(updatedProduct.reservedStock, 0);
    updatedVoucher = await Voucher.findById(quotaVoucher._id).lean();
    assert.equal(updatedVoucher.reservedCount, 0);
    assert.equal(updatedVoucher.used, 1);
    assert.equal((await UserVoucher.findById(userVoucher._id).lean()).isUsed, true);
    assert.equal(await expirePayment(paidPaymentId, new Date(now.getTime() + 48 * 60 * 60 * 1000)), false);

    // ─── Integration Test cho POST /api/webhooks/sepay trên Replica Set ───
    const webhookProduct = await Product.create({
      id: 'webhook-item',
      name: 'Webhook item',
      slug: 'webhook-item',
      currentPrice: 50000,
      stock: 3
    });
    const webhookOrderId = new mongoose.Types.ObjectId();
    await makePayableOrder('webhook-order-1', userIds[0], webhookProduct.id, webhookOrderId);
    const createPayRes = await createPaymentRequest(String(webhookOrderId), userIds[0]);
    assert.equal(createPayRes.status, 201);
    const createdPayBody = await createPayRes.json();
    const webhookPayCode = createdPayBody.payment.paymentCode;
    const webhookAmountDue = createdPayBody.payment.amountDue;

    // 1. Hai webhook cùng transaction ID gửi đồng thời
    const sameTxPayload = {
      id: 880001,
      gateway: 'Vietcombank',
      transactionDate: '2026-11-09 17:30:00',
      code: webhookPayCode,
      content: `${webhookPayCode} chuyen tien`,
      transferType: 'in',
      transferAmount: webhookAmountDue,
      referenceCode: 'FT880001'
    };
    const [dupRes1, dupRes2] = await Promise.all([
      postSepayWebhook(sameTxPayload),
      postSepayWebhook(sameTxPayload)
    ]);
    assert.equal(dupRes1.status, 200);
    assert.equal(dupRes2.status, 200);
    const dupBodies = await Promise.all([dupRes1.json(), dupRes2.json()]);
    assert.equal(dupBodies.filter((b) => !b.duplicate).length, 1);
    assert.equal(dupBodies.filter((b) => b.duplicate).length, 1);
    assert.equal(await PaymentTransaction.countDocuments({ sepayTransactionId: '880001' }), 1);

    const confirmedPayment = await Payment.findOne({ paymentCode: webhookPayCode }).lean();
    assert.equal(confirmedPayment.statusId, 'paid');
    assert.equal(confirmedPayment.inventoryReservations[0].status, 'consumed');
    const confirmedOrder = await Order.findById(webhookOrderId).lean();
    assert.equal(confirmedOrder.payment.statusId, 'paid');
    assert.equal(confirmedOrder.statusId, 'pending');

    const webhookProductAfter = await Product.findById(webhookProduct._id).lean();
    assert.equal(webhookProductAfter.stock, 2);
    assert.equal(webhookProductAfter.reservedStock, 0);

    // 2. Hai giao dịch khác nhau cùng thanh toán một Payment trên Replica Set
    const raceOrderId = new mongoose.Types.ObjectId();
    await makePayableOrder('webhook-order-2', userIds[1], webhookProduct.id, raceOrderId);
    const racePayRes = await createPaymentRequest(String(raceOrderId), userIds[1]);
    assert.equal(racePayRes.status, 201);
    const racePayBody = await racePayRes.json();
    const racePayCode = racePayBody.payment.paymentCode;
    const raceAmount = racePayBody.payment.amountDue;

    const [diffTxRes1, diffTxRes2] = await Promise.all([
      postSepayWebhook({
        id: 880002,
        gateway: 'MBBank',
        transactionDate: '2026-11-09 17:31:00',
        code: racePayCode,
        content: racePayCode,
        transferType: 'in',
        transferAmount: raceAmount
      }),
      postSepayWebhook({
        id: 880003,
        gateway: 'MBBank',
        transactionDate: '2026-11-09 17:31:01',
        code: racePayCode,
        content: racePayCode,
        transferType: 'in',
        transferAmount: raceAmount
      })
    ]);
    assert.equal(diffTxRes1.status, 200);
    assert.equal(diffTxRes2.status, 200);
    const diffTxBodies = await Promise.all([diffTxRes1.json(), diffTxRes2.json()]);
    assert.deepEqual(
      diffTxBodies.map((b) => b.classification).sort(),
      ['duplicate_payment', 'matched']
    );

    // 3. Sản phẩm có variants: reserve -> SePay webhook consume -> không trừ stock lần 2
    const variantWebhookOrderId = new mongoose.Types.ObjectId();
    await Order.create({
      _id: variantWebhookOrderId,
      id: 'webhook-variant-order',
      userId: userIds[1],
      statusId: 'pending',
      orderType: 'normal',
      items: [{ productId: variantProduct.id, quantity: 1, variantIndex: 0 }],
      payment: { methodId: 'bank_transfer', statusId: 'unpaid' }
    });
    const varPayRes = await createPaymentRequest(String(variantWebhookOrderId), userIds[1]);
    assert.equal(varPayRes.status, 201);
    const varPayBody = await varPayRes.json();
    let varProdAfterReserve = await Product.findById(variantProduct._id).lean();
    assert.equal(varProdAfterReserve.variants[0].stock, 0);
    assert.equal(varProdAfterReserve.variants[0].reservedStock, 1);
    assert.equal(varProdAfterReserve.reservedStock, 1);

    const varWhRes = await postSepayWebhook({
      id: 880004,
      gateway: 'ACB',
      transactionDate: '2026-11-09 17:32:00',
      code: varPayBody.payment.paymentCode,
      content: varPayBody.payment.paymentCode,
      transferType: 'in',
      transferAmount: varPayBody.payment.amountDue
    });
    assert.equal(varWhRes.status, 200);
    assert.equal((await varWhRes.json()).classification, 'matched');
    let varProdAfterConsume = await Product.findById(variantProduct._id).lean();
    assert.equal(varProdAfterConsume.variants[0].stock, 0);
    assert.equal(varProdAfterConsume.variants[0].reservedStock, 0);
    assert.equal(varProdAfterConsume.reservedStock, 0);

    // 4. Order cancelled -> release tồn kho & voucher, webhook đến muộn ghi nhận late_after_cancel
    const cancelVoucher = await Voucher.create({
      id: 'cancel-voucher',
      code: 'CANCELV',
      name: 'Cancel voucher',
      type: 'fixed',
      discountValue: 5000,
      quantity: 2,
      used: 0,
      reservedCount: 0,
      isActive: true
    });
    const cancelUserVoucher = await UserVoucher.create({
      userId: userIds[0],
      voucherId: cancelVoucher.id,
      code: cancelVoucher.code
    });
    const cancelOrderId = new mongoose.Types.ObjectId();
    await Order.create({
      _id: cancelOrderId,
      id: 'webhook-cancel-order',
      userId: userIds[0],
      statusId: 'pending',
      orderType: 'normal',
      items: [{ productId: webhookProduct.id, quantity: 1 }],
      voucher: { voucherId: cancelVoucher.id, discountAmount: 5000 },
      payment: { methodId: 'bank_transfer', statusId: 'unpaid' }
    });
    const cancelPayRes = await createPaymentRequest(String(cancelOrderId), userIds[0]);
    assert.equal(cancelPayRes.status, 201);
    const cancelPayBody = await cancelPayRes.json();

    const adminToken = jwt.sign({ id: String(userIds[0]), role: 'admin' }, process.env.JWT_SECRET);
    const cancelOrderRes = await fetch(`${baseUrl}/api/orders/${cancelOrderId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ statusId: 'cancelled', status: 'Đã hủy' })
    });
    assert.equal(cancelOrderRes.status, 200);

    const prodAfterCancel = await Product.findById(webhookProduct._id).lean();
    assert.equal(prodAfterCancel.stock, 1);
    assert.equal(prodAfterCancel.reservedStock, 0);
    const voucherAfterCancel = await Voucher.findById(cancelVoucher._id).lean();
    assert.equal(voucherAfterCancel.reservedCount, 0);
    assert.equal(voucherAfterCancel.used, 0);
    const uvAfterCancel = await UserVoucher.findById(cancelUserVoucher._id).lean();
    assert.equal(uvAfterCancel.reservedByPaymentId, null);
    assert.equal(uvAfterCancel.isUsed, false);

    const lateCancelWhRes = await postSepayWebhook({
      id: 880005,
      gateway: 'ACB',
      transactionDate: '2026-11-09 17:35:00',
      code: cancelPayBody.payment.paymentCode,
      content: cancelPayBody.payment.paymentCode,
      transferType: 'in',
      transferAmount: cancelPayBody.payment.amountDue
    });
    assert.equal(lateCancelWhRes.status, 200);
    const lateCancelBody = await lateCancelWhRes.json();
    assert.equal(lateCancelBody.classification, 'late_after_cancel');
    assert.equal(lateCancelBody.reviewStatus, 'pending');
    assert.equal((await Order.findById(cancelOrderId).lean()).statusId, 'cancelled');

    // 5. E2E Xuyên suốt: Frontend Checkout Payload -> POST /api/orders -> POST /api/orders/:id/payment -> GET /api/orders/:id/payment -> SePay Webhook -> GET /api/orders/:id/payment + COD Regression
    const e2eNormalProduct = await Product.create({
      id: 'e2e-normal-prod',
      name: 'Áo thun Urii Basic',
      slug: 'ao-thun-urii-basic',
      currentPrice: 120000,
      stock: 5
    });
    const e2eVariantProduct = await Product.create({
      id: 'e2e-variant-prod',
      name: 'Quần Jean Urii',
      slug: 'quan-jean-urii',
      currentPrice: 150000,
      stock: 10,
      variants: [
        { name: 'Size S', price: 150000, stock: 4 },
        { name: 'Size M', price: 160000, stock: 6 }
      ]
    });
    const e2eVoucher = await Voucher.create({
      id: 'e2e-voucher-30k',
      code: 'URII30K',
      name: 'Giảm 30.000đ',
      type: 'fixed',
      discountValue: 30000,
      minOrder: 200000,
      quantity: 5,
      used: 0,
      reservedCount: 0,
      isActive: true
    });
    const e2eUserVoucher = await UserVoucher.create({
      userId: userIds[0],
      voucherId: e2eVoucher.id,
      code: e2eVoucher.code
    });

    const customerToken = jwt.sign({ id: String(userIds[0]), role: 'user' }, process.env.JWT_SECRET);

    // 5a. Tạo đơn hàng QR từ payload chuẩn của Frontend CheckOut (cố tình gửi total sai từ client để xác minh backend tự tính lại)
    const createQrOrderRes = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userName: 'Khách hàng E2E',
        date: new Date().toISOString(),
        status: 'Đang chờ duyệt',
        statusType: 'pending',
        total: '1000',
        items: [
          {
            productId: e2eNormalProduct.id,
            name: e2eNormalProduct.name,
            price: 500,
            quantity: 1,
            image: ''
          },
          {
            productId: e2eVariantProduct.id,
            name: e2eVariantProduct.name,
            price: 500,
            quantity: 1,
            image: '',
            variantName: 'Size M',
            variantIndex: 1
          }
        ],
        payment: {
          method: 'bank_transfer',
          methodId: 'bank_transfer',
          status: 'Chờ thanh toán',
          statusId: 'awaiting_payment'
        },
        shipping: { method: 'standard', fee: 0 },
        voucher: { voucherId: e2eVoucher.id, discountAmount: 999999 },
        address: {
          name: 'Khách hàng E2E',
          phone: '0901234567',
          address: 'Số 1 Đường Mẫu, Phường 1, TP.HCM'
        }
      })
    });
    assert.equal(createQrOrderRes.status, 201);
    const createdQrOrder = await createQrOrderRes.json();
    assert.ok(createdQrOrder.id.startsWith('order-'));
    assert.equal(createdQrOrder.statusId, 'pending');
    assert.equal(createdQrOrder.payment.methodId, 'bank_transfer');
    assert.equal(createdQrOrder.payment.statusId, 'awaiting_payment');

    // 5b. Frontend gọi POST /api/orders/:id/payment bằng order slug (createdQrOrder.id)
    const initQrPayRes = await fetch(`${baseUrl}/api/orders/${encodeURIComponent(createdQrOrder.id)}/payment`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert.equal(initQrPayRes.status, 201);
    const initQrPayBody = await initQrPayRes.json();
    // Subtotal = 120000 + 160000 = 280000 (>= 200000 -> free ship 0) - voucher 30000 = 250000
    assert.equal(initQrPayBody.payment.amountDue, 250000);
    assert.equal(initQrPayBody.payment.statusId, 'awaiting_payment');
    assert.equal(initQrPayBody.payment.isPayable, true);
    assert.ok(initQrPayBody.payment.qrCodeUrl.includes('amount=250000'));
    assert.ok(initQrPayBody.payment.qrCodeUrl.includes(`addInfo=${initQrPayBody.payment.paymentCode}`));

    // Kiểm tra trạng thái giữ tồn kho & voucher (State A)
    const normalAfterReserve = await Product.findById(e2eNormalProduct._id).lean();
    assert.equal(normalAfterReserve.stock, 4);
    assert.equal(normalAfterReserve.reservedStock, 1);
    const variantAfterReserve = await Product.findById(e2eVariantProduct._id).lean();
    assert.equal(variantAfterReserve.variants[0].stock, 4);
    assert.equal(variantAfterReserve.variants[0].reservedStock, 0);
    assert.equal(variantAfterReserve.variants[1].stock, 5);
    assert.equal(variantAfterReserve.variants[1].reservedStock, 1);
    assert.equal(variantAfterReserve.reservedStock, 1);
    const voucherAfterReserve = await Voucher.findById(e2eVoucher._id).lean();
    assert.equal(voucherAfterReserve.reservedCount, 1);
    assert.equal(voucherAfterReserve.used, 0);

    // 5c. Frontend polling GET /api/orders/:id/payment trước khi nhận Webhook
    const pollBeforeRes = await fetch(`${baseUrl}/api/orders/${encodeURIComponent(initQrPayBody.payment.orderId)}/payment`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert.equal(pollBeforeRes.status, 200);
    const pollBeforeBody = await pollBeforeRes.json();
    assert.equal(pollBeforeBody.payment.statusId, 'awaiting_payment');
    assert.equal(pollBeforeBody.payment.amountDue, 250000);

    // 5d. SePay gửi Webhook thanh toán đủ 250000
    const e2eWebhookRes = await postSepayWebhook({
      id: 880099,
      gateway: 'MBBank',
      transactionDate: '2026-11-09 18:00:00',
      code: initQrPayBody.payment.paymentCode,
      content: `Chuyen khoan ${initQrPayBody.payment.paymentCode}`,
      transferType: 'in',
      transferAmount: 250000,
      referenceCode: 'FT880099'
    });
    assert.equal(e2eWebhookRes.status, 200);
    const e2eWebhookBody = await e2eWebhookRes.json();
    assert.equal(e2eWebhookBody.classification, 'matched');

    // 5e. Frontend polling GET /api/orders/:id/payment sau khi nhận Webhook -> nhận paid
    const pollAfterRes = await fetch(`${baseUrl}/api/orders/${encodeURIComponent(initQrPayBody.payment.orderId)}/payment`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert.equal(pollAfterRes.status, 200);
    const pollAfterBody = await pollAfterRes.json();
    assert.equal(pollAfterBody.payment.statusId, 'paid');
    assert.equal(pollAfterBody.payment.isPayable, false);
    assert.ok(pollAfterBody.payment.paidAt);

    // Kiểm tra tồn kho, voucher và Order sau khi paid (State B)
    const normalAfterPaid = await Product.findById(e2eNormalProduct._id).lean();
    assert.equal(normalAfterPaid.stock, 4);
    assert.equal(normalAfterPaid.reservedStock, 0);
    const variantAfterPaid = await Product.findById(e2eVariantProduct._id).lean();
    assert.equal(variantAfterPaid.variants[1].stock, 5);
    assert.equal(variantAfterPaid.variants[1].reservedStock, 0);
    assert.equal(variantAfterPaid.reservedStock, 0);
    const voucherAfterPaid = await Voucher.findById(e2eVoucher._id).lean();
    assert.equal(voucherAfterPaid.reservedCount, 0);
    assert.equal(voucherAfterPaid.used, 1);
    const uvAfterPaid = await UserVoucher.findById(e2eUserVoucher._id).lean();
    assert.equal(uvAfterPaid.isUsed, true);
    assert.equal(uvAfterPaid.reservedByPaymentId, null);
    const orderAfterPaid = await Order.findById(initQrPayBody.payment.orderId).lean();
    assert.equal(orderAfterPaid.payment.statusId, 'paid');
    assert.equal(orderAfterPaid.statusId, 'pending');

    // 5f. COD Regression trên cùng môi trường: tạo đơn COD không sinh Payment hay giữ tồn kho QR
    const codOrderRes = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userName: 'Khách hàng COD',
        date: new Date().toISOString(),
        status: 'Đang chờ duyệt',
        statusType: 'pending',
        total: '150000',
        items: [
          {
            productId: e2eNormalProduct.id,
            name: e2eNormalProduct.name,
            price: 120000,
            quantity: 1,
            image: ''
          }
        ],
        payment: { method: 'cod', status: 'pending' },
        shipping: { method: 'standard', fee: 30000 },
        address: {
          name: 'Khách hàng COD',
          phone: '0901234567',
          address: 'Số 2 Đường Mẫu, Phường 1, TP.HCM'
        }
      })
    });
    assert.equal(codOrderRes.status, 201);
    const codOrder = await codOrderRes.json();
    assert.equal(codOrder.statusId, 'pending');
    assert.equal(codOrder.payment.method, 'cod');
    assert.equal(await Payment.countDocuments({ orderId: codOrder._id }), 0);

    // 5g. Kiểm thử SePay Test Webhook (code = SEPAYTEST, id = 0) & các mã HTTP 401/400/413 qua HTTP thực tế
    const txCountBeforeTestProbe = await PaymentTransaction.countDocuments({});
    const sepayTestProbeRes = await postSepayWebhook({
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
    });
    assert.equal(sepayTestProbeRes.status, 200);
    const sepayTestProbeBody = await sepayTestProbeRes.json();
    assert.equal(sepayTestProbeBody.success, true);
    assert.equal(sepayTestProbeBody.testWebhook, true);
    assert.equal(sepayTestProbeBody.classification, 'test_webhook');
    assert.equal(await PaymentTransaction.countDocuments({}), txCountBeforeTestProbe);

    const noKeyRes = await fetch(`${baseUrl}/api/webhooks/sepay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 0, gateway: 'SePay', transferType: 'in', transferAmount: 10000, code: 'SEPAYTEST' })
    });
    assert.equal(noKeyRes.status, 401);

    const wrongKeyRes = await postSepayWebhook(
      { id: 0, gateway: 'SePay', transferType: 'in', transferAmount: 10000, code: 'SEPAYTEST' },
      'wrong-api-key'
    );
    assert.equal(wrongKeyRes.status, 401);

    const invalidJsonRes = await fetch(`${baseUrl}/api/webhooks/sepay`, {
      method: 'POST',
      headers: {
        Authorization: `Apikey ${process.env.SEPAY_WEBHOOK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: '{"id": 123, broken json'
    });
    assert.equal(invalidJsonRes.status, 400);

    const tooLargeRes = await fetch(`${baseUrl}/api/webhooks/sepay`, {
      method: 'POST',
      headers: {
        Authorization: `Apikey ${process.env.SEPAY_WEBHOOK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        id: 880999,
        gateway: 'SePay',
        transferType: 'in',
        transferAmount: 10000,
        code: 'SEPAYTEST',
        content: 'X'.repeat(70 * 1024)
      })
    });
    assert.equal(tooLargeRes.status, 413);
  } catch (error) {
    console.error(`Payment integration failed in isolated database ${databaseName}:`, error);
    throw error;
  } finally {
    try {
      if (io) await new Promise((resolve) => io.close(resolve));
      await Promise.all([
        Order.deleteMany({}),
        Payment.deleteMany({}),
        PaymentTransaction.deleteMany({}),
        Product.deleteMany({}),
        UserVoucher.deleteMany({}),
        Voucher.deleteMany({})
      ]);
    } finally {
      await mongoose.disconnect();
      for (const [key, value] of previousEnvironment) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }
});
