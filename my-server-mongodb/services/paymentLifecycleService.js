const mongoose = require('mongoose');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const PaymentTransaction = require('../models/PaymentTransaction');
const Product = require('../models/Product');
const UserVoucher = require('../models/UserVoucher');
const Voucher = require('../models/Voucher');
const { emitCrudChange } = require('../realtime');
const {
  extractPaymentCode,
  parseSepayWebhookPayload
} = require('./paymentService');

class PaymentReservationConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PaymentReservationConflictError';
  }
}

class PaymentReservationInvalidError extends Error {
  constructor(message, paymentId = null, { requiresRollback = false } = {}) {
    super(message);
    this.name = 'PaymentReservationInvalidError';
    this.paymentId = paymentId;
    this.requiresRollback = requiresRollback;
  }
}

const activePaymentConfirmations = new Map();

function isDuplicateKeyError(error) {
  return Boolean(error && (error.code === 11000 || error.codeName === 'DuplicateKey'));
}

function isTransientTransactionError(error) {
  if (!error) return false;
  if (typeof error.hasErrorLabel === 'function') {
    if (error.hasErrorLabel('TransientTransactionError')
      || error.hasErrorLabel('UnknownTransactionCommitResult')) {
      return true;
    }
  }
  if (Array.isArray(error.errorLabels)) {
    if (error.errorLabels.includes('TransientTransactionError')
      || error.errorLabels.includes('UnknownTransactionCommitResult')) {
      return true;
    }
  }
  return error.code === 112 || error.codeName === 'WriteConflict';
}

async function runTransactionWithRetry(session, callback, maxAttempts = 5) {
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      await session.withTransaction(async () => {
        await callback();
      });
      return;
    } catch (error) {
      if (attempt < maxAttempts && isTransientTransactionError(error)) {
        continue;
      }
      throw error;
    }
  }
}

async function saveDocumentInSession(doc, Model, session) {
  if (doc && typeof doc.save === 'function') {
    await doc.save({ session });
    return;
  }
  if (doc && doc._id && Model && typeof Model.updateOne === 'function') {
    const { _id, ...fields } = doc;
    await Model.updateOne({ _id }, { $set: fields }, { session });
  }
}

async function updateStock(reservation, delta, session) {
  const filter = { _id: reservation.productObjectId };
  const update = { $inc: {} };

  if (Number.isInteger(reservation.variantIndex)) {
    const stockPath = `variants.${reservation.variantIndex}.stock`;
    const reservedPath = `variants.${reservation.variantIndex}.reservedStock`;
    if (delta < 0) filter[stockPath] = { $gte: -delta };
    else filter[reservedPath] = { $gte: delta };
    update.$inc[stockPath] = delta;
    update.$inc[reservedPath] = -delta;
    update.$inc.reservedStock = -delta;
    if (reservation.trackProductTotal) update.$inc.stock = delta;
  } else {
    if (delta < 0) filter.stock = { $gte: -delta };
    else filter.reservedStock = { $gte: delta };
    update.$inc.stock = delta;
    update.$inc.reservedStock = -delta;
  }

  if (!Number.isInteger(reservation.variantIndex)) {
    filter.$or = [
      { variants: { $exists: false } },
      { variants: { $size: 0 } }
    ];
  }

  const result = await Product.updateOne(filter, update, { session });
  if (result.modifiedCount !== 1) {
    return false;
  }
  return true;
}

async function reserveInventory(items, session) {
  const reservations = [];
  for (const item of items) {
    const filter = { id: item.productId };
    const projection = { _id: 1, stock: 1, variants: 1 };
    const product = await Product.findOne(filter).select(projection).session(session).lean();
    if (!product) {
      throw new PaymentReservationConflictError(`Không tìm thấy sản phẩm ${item.productId} khi giữ tồn kho.`);
    }

    const variant = Number.isInteger(item.variantIndex)
      ? product.variants?.[item.variantIndex]
      : null;
    if (Number.isInteger(item.variantIndex) && !variant) {
      throw new PaymentReservationConflictError(`Không tìm thấy biến thể ${item.variantIndex} của sản phẩm ${item.productId}.`);
    }
    // trackProductTotal: chỉ cập nhật product.stock tổng khi sản phẩm không có biến thể
    // (sản phẩm có biến thể quản lý tồn kho riêng qua variants[i].stock)
    const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;
    const reservation = {
      productId: item.productId,
      productObjectId: product._id,
      variantId: variant?._id || null,
      variantIndex: Number.isInteger(item.variantIndex) ? item.variantIndex : null,
      trackProductTotal: !hasVariants && Number.isFinite(product.stock) && product.stock >= item.quantity,
      quantity: item.quantity
    };
    if (!await updateStock(reservation, -item.quantity, session)) {
      throw new PaymentReservationConflictError(`Sản phẩm "${item.name}" vừa hết tồn kho.`);
    }
    reservations.push(reservation);
  }
  return reservations;
}

async function reserveVoucher({ voucherId, userVoucherId, userId, paymentId, expiresAt }, session) {
  const ownership = await UserVoucher.updateOne({
    _id: userVoucherId,
    userId,
    isUsed: false,
    reservedByPaymentId: null
  }, {
    $set: { reservedByPaymentId: paymentId, reservedUntil: expiresAt }
  }, { session });
  if (ownership.modifiedCount !== 1) {
    throw new PaymentReservationConflictError('Voucher đã được giữ hoặc sử dụng trong một đơn hàng khác.');
  }

  const voucherFilter = mongoose.isValidObjectId(voucherId)
    ? { $or: [{ id: voucherId }, { _id: voucherId }] }
    : { id: voucherId };
  const voucher = await Voucher.findOneAndUpdate({
    ...voucherFilter,
    isActive: true,
    $expr: {
      $or: [
        { $eq: [{ $ifNull: ['$quantity', null] }, null] },
        {
          $lt: [
            { $add: [{ $ifNull: ['$used', 0] }, { $ifNull: ['$reservedCount', 0] }] },
            '$quantity'
          ]
        }
      ]
    }
  }, {
    $inc: { reservedCount: 1 }
  }, { returnDocument: 'after', session });
  if (!voucher) {
    throw new PaymentReservationConflictError('Voucher đã hết lượt sử dụng hoặc không còn khả dụng.');
  }
}

async function releaseVoucherReservation(payment, session) {
  const reservation = payment.voucherReservation;
  if (!reservation || reservation.status !== 'reserved') return;

  const ownership = await UserVoucher.updateOne({
    _id: reservation.userVoucherId,
    reservedByPaymentId: payment._id,
    isUsed: false
  }, {
    $set: { reservedByPaymentId: null, reservedUntil: null }
  }, { session });
  if (ownership.modifiedCount !== 1) {
    throw new Error(`Không thể giải phóng UserVoucher cho Payment ${payment._id}.`);
  }

  const voucherFilter = mongoose.isValidObjectId(reservation.voucherId)
    ? { $or: [{ id: reservation.voucherId }, { _id: reservation.voucherId }] }
    : { id: reservation.voucherId };
  const voucher = await Voucher.updateOne({
    ...voucherFilter,
    reservedCount: { $gte: 1 }
  }, {
    $inc: { reservedCount: -1 }
  }, { session });
  if (voucher.modifiedCount !== 1) {
    throw new Error(`Không thể giải phóng quota voucher ${reservation.voucherId}.`);
  }

  reservation.status = 'released';
}

async function releasePaymentReservations(payment, session) {
  for (const reservation of payment.inventoryReservations || []) {
    if (reservation.status !== 'reserved') continue;
    if (!await updateStock(reservation, reservation.quantity, session)) {
      throw new Error(`Không thể giải phóng tồn kho cho Payment ${payment._id}.`);
    }
    reservation.status = 'released';
  }
  await releaseVoucherReservation(payment, session);
}

async function expirePaymentInSession(payment, now, session) {
  if (payment.statusId !== 'awaiting_payment' || payment.expiresAt > now) return false;
  await releasePaymentReservations(payment, session);
  payment.statusId = 'expired';
  await payment.save({ session });
  await Order.updateOne({ _id: payment.orderId }, {
    $set: { 'payment.statusId': 'unpaid', 'payment.status': 'Chưa thanh toán' },
    $unset: { waitingInfo: 1 }
  }, { session });
  return true;
}

async function cancelPaymentInSession(payment, session) {
  if (payment.statusId !== 'awaiting_payment') return false;
  await releasePaymentReservations(payment, session);
  payment.statusId = 'cancelled';
  await payment.save({ session });
  await Order.updateOne({ _id: payment.orderId }, {
    $set: { 'payment.statusId': 'cancelled', 'payment.status': 'Đã hủy' },
    $unset: { waitingInfo: 1 }
  }, { session });
  return true;
}

async function expirePayment(paymentId, now = new Date()) {
  const session = await mongoose.startSession();
  let expired = false;
  try {
    await session.withTransaction(async () => {
      expired = false;
      const payment = await Payment.findOne({
        _id: paymentId,
        statusId: 'awaiting_payment',
        expiresAt: { $lte: now }
      }).session(session);
      if (!payment) return;
      expired = await expirePaymentInSession(payment, now, session);
    });
    return expired;
  } finally {
    await session.endSession();
  }
}

async function expireDuePayments(now = new Date(), batchSize = 100) {
  const duePayments = await Payment.find({
    statusId: 'awaiting_payment',
    expiresAt: { $lte: now }
  }).select('_id').sort({ expiresAt: 1 }).limit(batchSize).lean();
  let expiredCount = 0;
  for (const payment of duePayments) {
    if (await expirePayment(payment._id, now)) expiredCount += 1;
  }
  return expiredCount;
}

function validatePaymentReservations(payment, order = null) {
  const inventoryReservations = payment?.inventoryReservations;
  if (!Array.isArray(inventoryReservations) || inventoryReservations.length === 0) {
    return 'Payment không có dữ liệu giữ tồn kho (inventoryReservations).';
  }

  for (const reservation of inventoryReservations) {
    if (!reservation || reservation.status !== 'reserved') {
      return `Reservation tồn kho của sản phẩm "${reservation?.productId || 'unknown'}" không ở trạng thái reserved.`;
    }
    if (!reservation.productObjectId || !Number.isSafeInteger(reservation.quantity) || reservation.quantity < 1) {
      return `Thông tin số lượng hoặc định danh giữ tồn kho của sản phẩm "${reservation?.productId || 'unknown'}" không hợp lệ.`;
    }
  }

  if (Array.isArray(order?.items) && order.items.length > 0) {
    if (inventoryReservations.length !== order.items.length) {
      return 'Số lượng mặt hàng giữ tồn kho không khớp với đơn hàng.';
    }
  }

  const orderHasVoucher = Boolean(order?.voucher?.voucherId);
  const paymentHasVoucher = Boolean(
    payment?.voucherReservation?.voucherId
    || payment?.voucherReservation?.userVoucherId
    || payment?.voucherReservation?.status !== undefined
  );

  if (orderHasVoucher || paymentHasVoucher) {
    const vr = payment?.voucherReservation;
    if (!vr || vr.status !== 'reserved' || !vr.voucherId || !vr.userVoucherId) {
      return 'Reservation voucher của Payment không hợp lệ hoặc không còn ở trạng thái reserved.';
    }
    if (orderHasVoucher && String(vr.voucherId) !== String(order.voucher.voucherId)) {
      return 'Mã voucher được giữ trong Payment không khớp với voucher của đơn hàng.';
    }
  }

  return null;
}

async function consumePaymentReservations(payment, session) {
  const structureError = validatePaymentReservations(payment);
  if (structureError) {
    throw new PaymentReservationInvalidError(structureError, payment?._id);
  }

  let dbWritesCount = 0;

  for (const reservation of payment.inventoryReservations || []) {
    const filter = { _id: reservation.productObjectId };
    const update = { $inc: {} };
    if (Number.isInteger(reservation.variantIndex)) {
      const reservedPath = `variants.${reservation.variantIndex}.reservedStock`;
      filter[reservedPath] = { $gte: reservation.quantity };
      update.$inc[reservedPath] = -reservation.quantity;
      update.$inc.reservedStock = -reservation.quantity;
    } else {
      filter.reservedStock = { $gte: reservation.quantity };
      update.$inc.reservedStock = -reservation.quantity;
    }
    const result = await Product.updateOne(filter, update, { session });
    if (result.modifiedCount !== 1) {
      throw new PaymentReservationInvalidError(
        `Không thể xác nhận tồn kho đã giữ cho Payment ${payment._id}.`,
        payment._id,
        { requiresRollback: dbWritesCount > 0 }
      );
    }
    dbWritesCount += 1;
  }

  const reservation = payment.voucherReservation;
  if (reservation?.status === 'reserved') {
    const ownership = await UserVoucher.updateOne({
      _id: reservation.userVoucherId,
      reservedByPaymentId: payment._id,
      isUsed: false
    }, {
      $set: { isUsed: true, usedAt: new Date(), reservedByPaymentId: null, reservedUntil: null }
    }, { session });
    if (ownership.modifiedCount !== 1) {
      throw new PaymentReservationInvalidError(
        `Không thể sử dụng UserVoucher cho Payment ${payment._id}.`,
        payment._id,
        { requiresRollback: dbWritesCount > 0 }
      );
    }
    dbWritesCount += 1;

    const voucherFilter = mongoose.isValidObjectId(reservation.voucherId)
      ? { $or: [{ id: reservation.voucherId }, { _id: reservation.voucherId }] }
      : { id: reservation.voucherId };
    const voucher = await Voucher.updateOne({
      ...voucherFilter,
      reservedCount: { $gte: 1 }
    }, {
      $inc: { reservedCount: -1, used: 1 }
    }, { session });
    if (voucher.modifiedCount !== 1) {
      throw new PaymentReservationInvalidError(
        `Không thể xác nhận quota voucher ${reservation.voucherId}.`,
        payment._id,
        { requiresRollback: dbWritesCount > 0 }
      );
    }
    dbWritesCount += 1;
  }

  for (const invReservation of payment.inventoryReservations || []) {
    invReservation.status = 'consumed';
  }
  if (reservation?.status === 'reserved') {
    reservation.status = 'consumed';
  }
}

async function persistInvalidReservationFallback({
  paymentId,
  sepayTransactionId,
  paymentCodeObserved,
  transferAmount,
  bankReference,
  transactionAt,
  now,
  reviewNote
}) {
  const reviewSession = await mongoose.startSession();
  try {
    let fallbackOutcome = null;
    await runTransactionWithRetry(reviewSession, async () => {
      const existing = await PaymentTransaction.findOne({ sepayTransactionId })
        .session(reviewSession)
        .lean();
      if (existing) {
        await PaymentTransaction.updateOne(
          { _id: existing._id },
          {
            $set: {
              classification: 'invalid_reservation',
              reviewStatus: 'pending',
              reviewNote
            }
          },
          { session: reviewSession }
        );
        fallbackOutcome = {
          duplicate: false,
          transactionId: String(existing._id),
          paymentId: paymentId ? String(paymentId) : null,
          classification: 'invalid_reservation',
          reviewStatus: 'pending'
        };
        return;
      }

      const [createdTx] = await PaymentTransaction.create([{
        paymentId,
        sepayTransactionId,
        paymentCodeObserved,
        transferType: 'in',
        transferAmount,
        bankReference,
        transactionAt,
        receivedAt: now,
        classification: 'invalid_reservation',
        reviewStatus: 'pending',
        reviewNote
      }], { session: reviewSession });

      fallbackOutcome = {
        duplicate: false,
        transactionId: String(createdTx._id),
        paymentId: paymentId ? String(paymentId) : null,
        classification: 'invalid_reservation',
        reviewStatus: 'pending'
      };
    });
    return fallbackOutcome;
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const existing = await PaymentTransaction.findOne({ sepayTransactionId }).lean();
      return {
        duplicate: true,
        transactionId: existing ? String(existing._id) : null,
        paymentId: existing?.paymentId ? String(existing.paymentId) : (paymentId ? String(paymentId) : null),
        classification: existing?.classification || 'invalid_reservation',
        reviewStatus: existing?.reviewStatus || 'pending'
      };
    }
    throw error;
  } finally {
    await reviewSession.endSession();
  }
}

async function processSepayWebhook(rawPayload, { now = new Date() } = {}) {
  const payload = parseSepayWebhookPayload(rawPayload, now);
  if (payload.isTestWebhook) {
    return {
      duplicate: false,
      testWebhook: true,
      transactionId: null,
      paymentId: null,
      orderId: null,
      classification: 'test_webhook',
      reviewStatus: 'not_required'
    };
  }
  const {
    sepayTransactionId,
    transferType,
    transferAmount,
    bankReference,
    transactionAt
  } = payload;
  const extracted = extractPaymentCode(payload);

  const session = await mongoose.startSession();
  let outcome = null;
  let confirmedOrderId = null;

  try {
    try {
      await runTransactionWithRetry(session, async () => {
        outcome = null;
        confirmedOrderId = null;

        // 1. Kiểm tra nếu giao dịch đã được ghi nhận ở lần xử lý trước
        const existingTx = await PaymentTransaction.findOne({ sepayTransactionId })
          .session(session)
          .lean();
        if (existingTx) {
          outcome = {
            duplicate: true,
            transactionId: String(existingTx._id),
            paymentId: existingTx.paymentId ? String(existingTx.paymentId) : null,
            classification: existingTx.classification,
            reviewStatus: existingTx.reviewStatus
          };
          return;
        }

        // 2. Giao dịch tiền ra -> lưu log, không xác nhận Payment
        if (transferType === 'out') {
          const [createdTx] = await PaymentTransaction.create([{
            paymentId: null,
            sepayTransactionId,
            paymentCodeObserved: extracted.paymentCodeObserved,
            transferType: 'out',
            transferAmount,
            bankReference,
            transactionAt,
            receivedAt: now,
            classification: 'outgoing',
            reviewStatus: 'not_required',
            reviewNote: 'Giao dịch tiền ra, không xác nhận thanh toán.'
          }], { session });
          outcome = {
            duplicate: false,
            transactionId: String(createdTx._id),
            paymentId: null,
            classification: 'outgoing',
            reviewStatus: 'not_required'
          };
          return;
        }

        // 3. Sai hoặc không trích xuất được paymentCode hợp lệ
        if (!extracted.paymentCode) {
          const [createdTx] = await PaymentTransaction.create([{
            paymentId: null,
            sepayTransactionId,
            paymentCodeObserved: extracted.paymentCodeObserved,
            transferType: 'in',
            transferAmount,
            bankReference,
            transactionAt,
            receivedAt: now,
            classification: 'unknown_payment_code',
            reviewStatus: 'pending',
            reviewNote: extracted.reason === 'ambiguous_payment_code'
              ? 'Nội dung chuyển khoản chứa nhiều mã thanh toán không đồng nhất.'
              : 'Sai mã thanh toán hoặc không tìm thấy mã thanh toán hợp lệ trong nội dung chuyển khoản.'
          }], { session });
          outcome = {
            duplicate: false,
            transactionId: String(createdTx._id),
            paymentId: null,
            classification: 'unknown_payment_code',
            reviewStatus: 'pending'
          };
          return;
        }

        // 4. Tìm Payment tương ứng theo paymentCode chính xác
        const payment = await Payment.findOne({ paymentCode: extracted.paymentCode }).session(session);
        if (!payment || payment.paymentCode !== extracted.paymentCode) {
          const [createdTx] = await PaymentTransaction.create([{
            paymentId: null,
            sepayTransactionId,
            paymentCodeObserved: extracted.paymentCode,
            transferType: 'in',
            transferAmount,
            bankReference,
            transactionAt,
            receivedAt: now,
            classification: 'unknown_payment_code',
            reviewStatus: 'pending',
            reviewNote: 'Không tìm thấy Payment tương ứng với mã thanh toán.'
          }], { session });
          outcome = {
            duplicate: false,
            transactionId: String(createdTx._id),
            paymentId: null,
            classification: 'unknown_payment_code',
            reviewStatus: 'pending'
          };
          return;
        }

        // Đồng bộ hóa khi hai giao dịch khác nhau cùng nhắm tới một Payment đồng thời
        const paymentKey = String(payment._id);
        const existingClaim = activePaymentConfirmations.get(paymentKey);
        if (existingClaim && existingClaim.txId !== sepayTransactionId) {
          await existingClaim.promise;
          const conflictError = new Error('Payment vừa được xử lý bởi một giao dịch đồng thời khác.');
          conflictError.errorLabels = ['TransientTransactionError'];
          throw conflictError;
        }

        let releaseClaim;
        if (!existingClaim) {
          const claimPromise = new Promise((resolve) => {
            releaseClaim = resolve;
          });
          activePaymentConfirmations.set(paymentKey, {
            txId: sepayTransactionId,
            promise: claimPromise
          });
        }

        try {
          const order = await Order.findById(payment.orderId).session(session);

          // 5. Payment đã paid -> ghi nhận giao dịch mới và đánh dấu cần review
          if (payment.statusId === 'paid') {
            const [createdTx] = await PaymentTransaction.create([{
              paymentId: payment._id,
              sepayTransactionId,
              paymentCodeObserved: extracted.paymentCode,
              transferType: 'in',
              transferAmount,
              bankReference,
              transactionAt,
              receivedAt: now,
              classification: 'duplicate_payment',
              reviewStatus: 'pending',
              reviewNote: 'Payment đã ở trạng thái paid, phát sinh giao dịch chuyển khoản mới cần kiểm tra.'
            }], { session });
            outcome = {
              duplicate: false,
              transactionId: String(createdTx._id),
              paymentId: String(payment._id),
              classification: 'duplicate_payment',
              reviewStatus: 'pending'
            };
            return;
          }

          // 6. Order đã cancelled hoặc Payment đã cancelled -> ghi nhận late payment, không tự mở lại đơn
          const isOrderCancelled = !order || ['cancelled', 'cancel_requested'].includes(order.statusId);
          if (payment.statusId === 'cancelled' || isOrderCancelled) {
            const [createdTx] = await PaymentTransaction.create([{
              paymentId: payment._id,
              sepayTransactionId,
              paymentCodeObserved: extracted.paymentCode,
              transferType: 'in',
              transferAmount,
              bankReference,
              transactionAt,
              receivedAt: now,
              classification: 'late_after_cancel',
              reviewStatus: 'pending',
              reviewNote: 'Giao dịch đến sau khi đơn hàng hoặc yêu cầu thanh toán đã bị hủy.'
            }], { session });
            outcome = {
              duplicate: false,
              transactionId: String(createdTx._id),
              paymentId: String(payment._id),
              classification: 'late_after_cancel',
              reviewStatus: 'pending'
            };
            return;
          }

          // 7. Payment đã expired hoặc quá hạn expiresAt -> ghi nhận late payment, không tự mở lại đơn
          const isExpiredByTime = new Date(payment.expiresAt).getTime() <= now.getTime();
          if (payment.statusId === 'expired' || isExpiredByTime) {
            const [createdTx] = await PaymentTransaction.create([{
              paymentId: payment._id,
              sepayTransactionId,
              paymentCodeObserved: extracted.paymentCode,
              transferType: 'in',
              transferAmount,
              bankReference,
              transactionAt,
              receivedAt: now,
              classification: 'late_after_expire',
              reviewStatus: 'pending',
              reviewNote: 'Giao dịch đến muộn sau khi yêu cầu thanh toán đã hết hạn.'
            }], { session });
            outcome = {
              duplicate: false,
              transactionId: String(createdTx._id),
              paymentId: String(payment._id),
              classification: 'late_after_expire',
              reviewStatus: 'pending'
            };
            return;
          }

          if (payment.statusId !== 'awaiting_payment') {
            const [createdTx] = await PaymentTransaction.create([{
              paymentId: payment._id,
              sepayTransactionId,
              paymentCodeObserved: extracted.paymentCode,
              transferType: 'in',
              transferAmount,
              bankReference,
              transactionAt,
              receivedAt: now,
              classification: 'late_after_cancel',
              reviewStatus: 'pending',
              reviewNote: `Payment không còn ở trạng thái awaiting_payment (hiện tại: ${payment.statusId}).`
            }], { session });
            outcome = {
              duplicate: false,
              transactionId: String(createdTx._id),
              paymentId: String(payment._id),
              classification: 'late_after_cancel',
              reviewStatus: 'pending'
            };
            return;
          }

          // 8. Kiểm tra số tiền giao dịch với amountDue (thiếu tiền / thừa tiền)
          if (transferAmount < payment.amountDue) {
            const [createdTx] = await PaymentTransaction.create([{
              paymentId: payment._id,
              sepayTransactionId,
              paymentCodeObserved: extracted.paymentCode,
              transferType: 'in',
              transferAmount,
              bankReference,
              transactionAt,
              receivedAt: now,
              classification: 'underpaid',
              reviewStatus: 'pending',
              reviewNote: `Số tiền nhận được (${transferAmount}) nhỏ hơn số tiền cần thanh toán (${payment.amountDue}).`
            }], { session });
            outcome = {
              duplicate: false,
              transactionId: String(createdTx._id),
              paymentId: String(payment._id),
              classification: 'underpaid',
              reviewStatus: 'pending'
            };
            return;
          }

          if (transferAmount > payment.amountDue) {
            const [createdTx] = await PaymentTransaction.create([{
              paymentId: payment._id,
              sepayTransactionId,
              paymentCodeObserved: extracted.paymentCode,
              transferType: 'in',
              transferAmount,
              bankReference,
              transactionAt,
              receivedAt: now,
              classification: 'overpaid',
              reviewStatus: 'pending',
              reviewNote: `Số tiền nhận được (${transferAmount}) lớn hơn số tiền cần thanh toán (${payment.amountDue}).`
            }], { session });
            outcome = {
              duplicate: false,
              transactionId: String(createdTx._id),
              paymentId: String(payment._id),
              classification: 'overpaid',
              reviewStatus: 'pending'
            };
            return;
          }

          // 9. Kiểm tra cấu trúc reservation tồn kho và voucher trước khi xác nhận
          const structureError = validatePaymentReservations(payment, order);
          if (structureError) {
            const [createdTx] = await PaymentTransaction.create([{
              paymentId: payment._id,
              sepayTransactionId,
              paymentCodeObserved: extracted.paymentCode,
              transferType: 'in',
              transferAmount,
              bankReference,
              transactionAt,
              receivedAt: now,
              classification: 'invalid_reservation',
              reviewStatus: 'pending',
              reviewNote: structureError
            }], { session });
            outcome = {
              duplicate: false,
              transactionId: String(createdTx._id),
              paymentId: String(payment._id),
              classification: 'invalid_reservation',
              reviewStatus: 'pending'
            };
            return;
          }

          // 10. Insert PaymentTransaction trước để unique index sepayTransactionId chặn race condition
          const [createdTx] = await PaymentTransaction.create([{
            paymentId: payment._id,
            sepayTransactionId,
            paymentCodeObserved: extracted.paymentCode,
            transferType: 'in',
            transferAmount,
            bankReference,
            transactionAt,
            receivedAt: now,
            classification: 'matched',
            reviewStatus: 'not_required',
            reviewNote: null
          }], { session });

          const prevPaymentStatusId = payment.statusId;
          const prevPaidAt = payment.paidAt;
          const prevInvStatuses = (payment.inventoryReservations || []).map((r) => r.status);
          const prevVoucherStatus = payment.voucherReservation?.status;
          const prevOrderPayment = order.payment
            ? { ...(order.payment.toObject?.() || order.payment) }
            : undefined;
          const prevOrderWaitingInfo = order.waitingInfo
            ? { ...(order.waitingInfo.toObject?.() || order.waitingInfo) }
            : undefined;

          try {
            // 11. Consume inventory & voucher reservations
            try {
              await consumePaymentReservations(payment, session);
            } catch (reservationError) {
              if (reservationError instanceof PaymentReservationInvalidError
                && !reservationError.requiresRollback) {
                if (createdTx && typeof createdTx === 'object') {
                  createdTx.classification = 'invalid_reservation';
                  createdTx.reviewStatus = 'pending';
                  createdTx.reviewNote = reservationError.message;
                }
                if (typeof createdTx?.save === 'function') {
                  await createdTx.save({ session });
                } else if (typeof PaymentTransaction.updateOne === 'function') {
                  await PaymentTransaction.updateOne(
                    { _id: createdTx._id },
                    {
                      $set: {
                        classification: 'invalid_reservation',
                        reviewStatus: 'pending',
                        reviewNote: reservationError.message
                      }
                    },
                    { session }
                  );
                }
                outcome = {
                  duplicate: false,
                  transactionId: String(createdTx._id),
                  paymentId: String(payment._id),
                  classification: 'invalid_reservation',
                  reviewStatus: 'pending'
                };
                return;
              }
              throw reservationError;
            }

            // 12. Cập nhật Payment -> paid
            payment.statusId = 'paid';
            payment.paidAt = now;
            await saveDocumentInSession(payment, Payment, session);

            // 13. Cập nhật Order.payment -> paid (giữ nguyên Order.statusId)
            order.payment = {
              ...(order.payment?.toObject?.() || order.payment || {}),
              methodId: order.payment?.methodId || 'bank_transfer',
              method: order.payment?.method || 'Chuyển khoản ngân hàng',
              statusId: 'paid',
              status: 'Đã thanh toán'
            };
            if (order.waitingInfo?.type === 'awaiting_payment') {
              if (order.statusId === 'pending') {
                order.waitingInfo = {
                  type: 'awaiting_confirmation',
                  startedAt: now,
                  deadlineAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
                  expectedHours: 24,
                  actor: 'admin',
                  note: 'Chờ cửa hàng xác nhận đơn hàng trong vòng 24 giờ.'
                };
              } else {
                order.waitingInfo = undefined;
              }
            }
            await saveDocumentInSession(order, Order, session);

            confirmedOrderId = order._id;
            outcome = {
              duplicate: false,
              transactionId: String(createdTx._id),
              paymentId: String(payment._id),
              classification: 'matched',
              reviewStatus: 'not_required'
            };
          } catch (innerError) {
            // Khôi phục trạng thái in-memory khi transaction rollback
            payment.statusId = prevPaymentStatusId;
            payment.paidAt = prevPaidAt;
            (payment.inventoryReservations || []).forEach((r, idx) => {
              r.status = prevInvStatuses[idx];
            });
            if (payment.voucherReservation && prevVoucherStatus !== undefined) {
              payment.voucherReservation.status = prevVoucherStatus;
            }
            order.payment = prevOrderPayment;
            order.waitingInfo = prevOrderWaitingInfo;
            throw innerError;
          }
        } finally {
          if (releaseClaim) {
            activePaymentConfirmations.delete(paymentKey);
            releaseClaim();
          }
        }
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        const existingTx = await PaymentTransaction.findOne({ sepayTransactionId }).lean();
        return {
          duplicate: true,
          transactionId: existingTx ? String(existingTx._id) : null,
          paymentId: existingTx?.paymentId ? String(existingTx.paymentId) : null,
          classification: existingTx?.classification || 'matched',
          reviewStatus: existingTx?.reviewStatus || 'not_required'
        };
      }
      if (error instanceof PaymentReservationInvalidError) {
        return persistInvalidReservationFallback({
          paymentId: error.paymentId,
          sepayTransactionId,
          paymentCodeObserved: extracted.paymentCode,
          transferAmount,
          bankReference,
          transactionAt,
          now,
          reviewNote: error.message
        });
      }
      throw error;
    }

    if (confirmedOrderId) {
      emitCrudChange('orders', 'updated', confirmedOrderId);
    }

    return outcome;
  } finally {
    await session.endSession();
  }
}

module.exports = {
  PaymentReservationConflictError,
  PaymentReservationInvalidError,
  cancelPaymentInSession,
  consumePaymentReservations,
  expireDuePayments,
  expirePayment,
  expirePaymentInSession,
  processSepayWebhook,
  reserveVoucher,
  reserveInventory,
  releasePaymentReservations,
  validatePaymentReservations
};
