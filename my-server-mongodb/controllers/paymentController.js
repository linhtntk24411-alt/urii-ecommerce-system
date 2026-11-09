const mongoose = require('mongoose');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const orderStatuses = require('../data/order_statuses.json');
const { emitCrudChange } = require('../realtime');
const {
  PaymentValidationError,
  PaymentConfigurationError,
  PaymentWebhookAuthError,
  PaymentWebhookPayloadError,
  assertBankTransferOrder,
  calculateOrderQuote,
  createQrUrl,
  paymentCode,
  paymentQrConfiguration,
  verifySepayWebhookRequest
} = require('../services/paymentService');
const paymentLifecycleService = require('../services/paymentLifecycleService');
const { PaymentReservationConflictError } = paymentLifecycleService;

const paymentMethod = orderStatuses.paymentMethods.find((method) => method.id === 'bank_transfer');
const paymentStatus = orderStatuses.paymentStatuses.find((status) => status.id === 'awaiting_payment');
const PAYMENT_TTL_MS = 24 * 60 * 60 * 1000;

function orderLookup(orderId, userId) {
  return {
    userId,
    $or: [
      { id: orderId },
      ...(mongoose.isValidObjectId(orderId) ? [{ _id: orderId }] : [])
    ]
  };
}

function publicPayment(
  payment,
  { includeQr = false, config = null, now = new Date(), orderStatusId = null } = {}
) {
  const orderBlocksPayment = ['cancelled', 'cancel_requested'].includes(orderStatusId);
  const isCancelled = orderStatusId === 'cancelled'
    && payment.statusId === 'awaiting_payment';
  const isExpired = payment.statusId === 'expired'
    || (!isCancelled && payment.statusId === 'awaiting_payment'
      && new Date(payment.expiresAt).getTime() <= now.getTime());
  const isPayable = payment.statusId === 'awaiting_payment'
    && !orderBlocksPayment
    && !isExpired;
  return {
    id: String(payment._id),
    orderId: String(payment.orderId),
    paymentCode: payment.paymentCode,
    amountDue: payment.amountDue,
    currency: payment.currency,
    methodId: payment.methodId,
    provider: payment.provider,
    statusId: isCancelled ? 'cancelled' : isExpired ? 'expired' : payment.statusId,
    expiresAt: payment.expiresAt,
    paidAt: payment.paidAt,
    isExpired,
    isPayable,
    ...(includeQr && isPayable && config
      ? { qrCodeUrl: createQrUrl(payment, config) }
      : {})
  };
}

function sendPaymentError(res, error) {
  if (error instanceof PaymentValidationError) {
    res.status(400).json({ message: error.message });
    return;
  }
  if (error instanceof PaymentConfigurationError) {
    console.error('Cấu hình thanh toán QR không hợp lệ:', error.message);
    res.status(500).json({ message: 'Máy chủ chưa cấu hình tài khoản nhận thanh toán QR hợp lệ.' });
    return;
  }
  if (error instanceof PaymentReservationConflictError) {
    res.status(409).json({ message: error.message });
    return;
  }
  if (error.name === 'ValidationError' || error.name === 'CastError') {
    res.status(400).json({ message: 'Thông tin thanh toán không hợp lệ.' });
    return;
  }
  if (error.code === 11000) {
    res.status(409).json({ message: 'Yêu cầu thanh toán bị trùng. Vui lòng tải lại trạng thái đơn hàng.' });
    return;
  }
  console.error('Lỗi xử lý thanh toán:', error);
  res.status(500).json({ message: 'Không thể xử lý yêu cầu thanh toán.' });
}

exports.createOrderPayment = async (req, res) => {
  const userId = req.auth?.id;
  if (req.auth?.role !== 'user') {
    res.status(403).json({ message: 'Chỉ khách hàng mới có thể tạo yêu cầu thanh toán.' });
    return;
  }
  if (!mongoose.isValidObjectId(userId)) {
    res.status(401).json({ message: 'Phiên đăng nhập khách hàng không hợp lệ.' });
    return;
  }

  let config;
  try {
    config = paymentQrConfiguration();
  } catch (error) {
    sendPaymentError(res, error);
    return;
  }
  if (!config) {
    res.status(503).json({ message: 'Máy chủ chưa cấu hình tài khoản nhận thanh toán QR.' });
    return;
  }

  let session;
  let created = false;
  let payment;
  let order;
  const now = new Date();
  try {
    const ownedOrder = await Order.findOne(orderLookup(req.params.id, userId))
      .select('_id')
      .lean();
    if (!ownedOrder) {
      res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
      return;
    }
    const duePayment = await Payment.findOne({
      orderId: ownedOrder._id,
      statusId: 'awaiting_payment',
      expiresAt: { $lte: now }
    }).select('_id').lean();
    if (duePayment) await paymentLifecycleService.expirePayment(duePayment._id, now);

    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      created = false;
      payment = null;
      order = null;
      order = await Order.findOne(orderLookup(req.params.id, userId)).session(session);
      if (!order) return;

      assertBankTransferOrder(order);
      payment = await Payment.findOne({ orderId: order._id }).session(session);
      if (payment?.statusId === 'paid') {
        throw new PaymentValidationError('Đơn hàng đã được thanh toán.');
      }
      if (payment?.statusId === 'awaiting_payment') {
        if (payment.expiresAt > now) return;
        throw new PaymentReservationConflictError('Payment hết hạn đang được xử lý. Vui lòng thử lại.');
      }

      const quote = await calculateOrderQuote(order, userId, session, now);
      const expiresAt = new Date(now.getTime() + PAYMENT_TTL_MS);
      if (!payment) {
        const [createdPayment] = await Payment.create([{
          orderId: order._id,
          paymentCode: paymentCode(),
          amountDue: quote.amountDue,
          currency: 'VND',
          methodId: 'bank_transfer',
          provider: 'sepay',
          statusId: 'awaiting_payment',
          expiresAt
        }], { session });
        payment = createdPayment;
        created = true;
      } else {
        payment.paymentCode = paymentCode();
        payment.amountDue = quote.amountDue;
        payment.statusId = 'awaiting_payment';
        payment.expiresAt = expiresAt;
        payment.paidAt = null;
        payment.inventoryReservations = [];
        payment.voucherReservation = undefined;
      }

      payment.inventoryReservations = await paymentLifecycleService.reserveInventory(quote.items, session);
      if (quote.voucherReservation) {
        await paymentLifecycleService.reserveVoucher({
          ...quote.voucherReservation,
          userId,
          paymentId: payment._id,
          expiresAt
        }, session);
        payment.voucherReservation = {
          ...quote.voucherReservation,
          status: 'reserved'
        };
      }
      await payment.save({ session });

      order.items = quote.items;
      order.total = String(quote.amountDue);
      order.totalAmount = quote.amountDue;
      order.shipping = {
        ...(order.shipping?.toObject?.() || order.shipping || {}),
        fee: quote.shippingFee
      };
      if (order.voucher?.voucherId) {
        order.voucher.discountAmount = quote.discountAmount;
      }
      order.payment = {
        methodId: 'bank_transfer',
        method: paymentMethod?.label || 'Chuyển khoản ngân hàng',
        statusId: 'awaiting_payment',
        status: paymentStatus?.label || 'Chờ thanh toán'
      };
      order.waitingInfo = {
        type: 'awaiting_payment',
        startedAt: now,
        deadlineAt: expiresAt,
        expectedHours: 24,
        actor: 'customer',
        note: 'Chờ khách hàng hoàn tất chuyển khoản thanh toán trong 24 giờ.'
      };
      await order.save({ session });

      payment = payment.toObject();
    });

    if (!order) {
      res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
      return;
    }
    if (!payment) {
      res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
      return;
    }

    if (created) {
      emitCrudChange('orders', 'updated', order._id);
    }

    if (payment.statusId !== 'awaiting_payment') {
      res.status(409).json({
        message: 'Yêu cầu thanh toán hiện không còn hiệu lực.',
        payment: publicPayment(payment, { now, orderStatusId: order.statusId })
      });
      return;
    }

    res.status(created ? 201 : 200).json({
      payment: publicPayment(payment, { includeQr: true, config, now })
    });
  } catch (error) {
    if (error.code === 11000) {
      try {
        const existingOrder = await Order.findOne(orderLookup(req.params.id, userId)).lean();
        if (existingOrder) {
          const existingPayment = await Payment.findOne({ orderId: existingOrder._id }).lean();
          if (existingPayment && existingPayment.statusId === 'awaiting_payment'
            && new Date(existingPayment.expiresAt).getTime() > Date.now()) {
            res.status(200).json({
              payment: publicPayment(existingPayment, {
                includeQr: true,
                config,
                orderStatusId: existingOrder.statusId
              })
            });
            return;
          }
        }
      } catch (lookupError) {
        sendPaymentError(res, lookupError);
        return;
      }
    }
    sendPaymentError(res, error);
  } finally {
    await session?.endSession();
  }
};

exports.getOrderPaymentStatus = async (req, res) => {
  const userId = req.auth?.id;
  if (req.auth?.role !== 'user') {
    res.status(403).json({ message: 'Chỉ khách hàng mới có thể tra cứu thanh toán.' });
    return;
  }
  if (!mongoose.isValidObjectId(userId)) {
    res.status(401).json({ message: 'Phiên đăng nhập khách hàng không hợp lệ.' });
    return;
  }

  try {
    const order = await Order.findOne(orderLookup(req.params.id, userId))
      .select('_id statusId')
      .lean();
    if (!order) {
      res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
      return;
    }
    let payment = await Payment.findOne({ orderId: order._id }).lean();
    if (!payment) {
      res.status(404).json({ message: 'Đơn hàng chưa có yêu cầu thanh toán.' });
      return;
    }
    if (payment.statusId === 'awaiting_payment' && payment.expiresAt <= new Date()) {
      await paymentLifecycleService.expirePayment(payment._id);
      payment = await Payment.findById(payment._id).lean();
    }
    res.json({
      payment: publicPayment(payment, {
        orderStatusId: order.statusId
      })
    });
  } catch (error) {
    sendPaymentError(res, error);
  }
};

function parseWebhookBody(req) {
  const contentType = req.headers?.['content-type'];
  if (typeof contentType === 'string' && !contentType.toLowerCase().includes('application/json')) {
    throw new PaymentWebhookPayloadError('Content-Type của webhook phải là application/json.');
  }

  if (Buffer.isBuffer(req.body)) {
    if (req.body.length === 0) {
      throw new PaymentWebhookPayloadError('Payload webhook không được để trống.');
    }
    try {
      const parsed = JSON.parse(req.body.toString('utf8'));
      req.body = parsed;
      return parsed;
    } catch {
      throw new PaymentWebhookPayloadError('JSON request không hợp lệ.');
    }
  }

  if (typeof req.body === 'string') {
    if (!req.body.trim()) {
      throw new PaymentWebhookPayloadError('Payload webhook không được để trống.');
    }
    try {
      const parsed = JSON.parse(req.body);
      req.body = parsed;
      return parsed;
    } catch {
      throw new PaymentWebhookPayloadError('JSON request không hợp lệ.');
    }
  }

  return req.body;
}

exports.handleSepayWebhook = async (req, res) => {
  try {
    verifySepayWebhookRequest(req);
    const payload = parseWebhookBody(req);
    const outcome = await paymentLifecycleService.processSepayWebhook(payload);
    res.status(200).json({
      success: true,
      ...outcome
    });
  } catch (error) {
    if (error instanceof PaymentWebhookAuthError) {
      res.status(401).json({
        success: false,
        message: error.message
      });
      return;
    }
    if (error instanceof PaymentConfigurationError) {
      console.error('Lỗi cấu hình SePay webhook:', error.message);
      res.status(503).json({
        success: false,
        message: 'Máy chủ chưa cấu hình xác thực SePay webhook hợp lệ.'
      });
      return;
    }
    if (error instanceof PaymentWebhookPayloadError
      || error.name === 'ValidationError'
      || error.name === 'CastError') {
      res.status(400).json({
        success: false,
        message: error.message || 'Payload webhook không hợp lệ.'
      });
      return;
    }
    console.error('Lỗi xử lý SePay webhook:', error.name, error.message);
    res.status(500).json({
      success: false,
      message: 'Không thể xử lý webhook thanh toán.'
    });
  }
};

exports.publicPayment = publicPayment;
