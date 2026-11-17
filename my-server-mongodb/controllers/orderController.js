const Order = require('../models/Order');
const CustomOrder = require('../models/CustomOrder');
const Product = require('../models/Product');

let productsJsonMap = null;
function getProductsJsonMap() {
  if (!productsJsonMap) {
    productsJsonMap = new Map();
    try {
      const raw = require('../data/products.json');
      const list = Array.isArray(raw) ? raw : (raw.products || []);
      for (const p of list) {
        if (p.id) productsJsonMap.set(String(p.id), p);
        if (p._id) productsJsonMap.set(String(p._id), p);
      }
    } catch (e) {
      console.warn('Cannot load products.json fallback', e);
    }
  }
  return productsJsonMap;
}
const User = require('../models/User');
const Payment = require('../models/Payment');
const orderStatuses = require('../data/order_statuses.json');
const orderReasons = require('../data/order_reasons.json');
const mongoose = require('mongoose');
const { randomInt } = require('node:crypto');
const { getPagination } = require('../utils/pagination');
const { emitCrudChange } = require('../realtime');
const { createAdminNotification } = require('./notificationController');
const { createUserNotification } = require('../utils/userNotificationHelper');
const paymentLifecycleService = require('../services/paymentLifecycleService');

function generateOrderId() {
  return `UR-${randomInt(10000, 100000)}`;
}

class PaymentOrderConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PaymentOrderConflictError';
  }
}

const orderTypesById = new Map((orderStatuses.orderTypes || []).map((t) => [t.id, t]));
const orderStatusesById = new Map((orderStatuses.orderStatuses || []).map((s) => [s.id, s]));
const requestStatusesById = new Map((orderStatuses.requestStatuses || []).map((s) => [s.id, s]));
const paymentMethodsById = new Map((orderStatuses.paymentMethods || []).map((m) => [m.id, m]));
const paymentStatusesById = new Map((orderStatuses.paymentStatuses || []).map((s) => [s.id, s]));
const shippingMethodsById = new Map((orderStatuses.shippingMethods || []).map((m) => [m.id, m]));
const timelineStatusesById = new Map((orderStatuses.timelineStatuses || []).map((s) => [s.id, s]));
const shippingStatusesById = new Map((orderStatuses.shippingStatuses || []).map((s) => [s.id, s]));
const cancelReasonsById = new Map((orderReasons.cancelReasons || []).map((r) => [r.id, r]));
const returnReasonsById = new Map((orderReasons.returnReasons || []).map((r) => [r.id, r]));

const ADMIN_STATUS_TO_ORDER_STATUS = {
  pending: { statusId: 'pending', status: 'Chờ xác nhận', statusType: 'pending' },
  approved: { statusId: 'processing', status: 'Đã xác nhận', statusType: 'approved' },
  processing: { statusId: 'processing', status: 'Chờ lấy hàng', statusType: 'processing' },
  shipping: { statusId: 'shipping', status: 'Chờ giao hàng', statusType: 'shipping' },
  completed: { statusId: 'completed', status: 'Đã giao', statusType: 'completed' },
  returned: { statusId: 'returned', status: 'Trả hàng', statusType: 'returned' },
  cancelled: { statusId: 'cancelled', status: 'Đã hủy', statusType: 'cancelled' }
};

function normalizeOrderStatusUpdates(updates) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return;
  }
  const hasExplicitStatusId = typeof updates.statusId === 'string' && updates.statusId.trim().length > 0;
  const hasExplicitStatusType = typeof updates.statusType === 'string' && updates.statusType.trim().length > 0;
  if (!hasExplicitStatusId && !hasExplicitStatusType) {
    return;
  }
  const rawKey = hasExplicitStatusType && !hasExplicitStatusId
    ? updates.statusType.trim().toLowerCase()
    : updates.statusId.trim().toLowerCase();
  const mapped = ADMIN_STATUS_TO_ORDER_STATUS[rawKey];
  if (!mapped) return;

  if (!hasExplicitStatusId || !orderStatusesById.has(updates.statusId)) {
    updates.statusId = mapped.statusId;
  }
  if (!hasExplicitStatusType) {
    updates.statusType = mapped.statusType;
  }
  if (typeof updates.status !== 'string' || !updates.status.trim()) {
    updates.status = mapped.status;
  }
}

function addHoursIso(isoOrDate, hours) {
  const base = isoOrDate ? new Date(isoOrDate) : new Date();
  const validBase = Number.isNaN(base.getTime()) ? new Date() : base;
  return new Date(validBase.getTime() + hours * 3600 * 1000).toISOString().slice(0, 19);
}

function hasFinancialOrderChanges(order, updates) {
  if (Object.keys(updates).some((field) => field.startsWith('$'))) return true;
  const fields = ['total', 'totalAmount', 'subtotal', 'discount', 'discountAmount', 'shippingFee', 'voucher', 'items'];
  if (fields.some((field) => Object.hasOwn(updates, field)
    && JSON.stringify(order[field]) !== JSON.stringify(updates[field]))) {
    return true;
  }
  if (Object.hasOwn(updates, 'shipping.fee') && order.shipping?.fee !== updates['shipping.fee']) {
    return true;
  }
  if (Object.keys(updates).some((field) => (
    field.startsWith('items.') || field.startsWith('voucher.')
  ))) {
    return true;
  }
  if (Object.hasOwn(updates, 'shipping')
    && Object.hasOwn(updates.shipping || {}, 'fee')
    && order.shipping?.fee !== updates.shipping.fee) {
    return true;
  }
  return Object.hasOwn(updates, 'payment')
    && updates.payment?.methodId !== undefined
    && updates.payment.methodId !== order.payment?.methodId;
}

async function enrichOrders(orders) {
  const userIds = [...new Set(orders.map((o) => o.userId).filter(Boolean).map(String))];
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }).select('name phone address').lean()
    : [];
  const usersById = new Map(users.map((u) => [String(u._id), u]));

  const productIds = [
    ...new Set(
      orders
        .flatMap((o) => (Array.isArray(o.items) ? o.items.map((i) => i.productId) : []))
        .filter(Boolean)
        .map(String)
    )
  ];

  const productsById = new Map();
  if (productIds.length > 0) {
    try {
      const validObjectIds = productIds.filter((id) => mongoose.isValidObjectId(id));
      const dbProducts = await Product.find({
        $or: [
          { id: { $in: productIds } },
          ...(validObjectIds.length ? [{ _id: { $in: validObjectIds } }] : [])
        ]
      }).select('id name slug image originalPrice currentPrice variants').lean();
      for (const p of dbProducts) {
        if (p.id) productsById.set(String(p.id), p);
        if (p._id) productsById.set(String(p._id), p);
      }
    } catch (err) {
      console.warn('Lỗi query Product trong enrichOrders:', err);
    }
  }
  const fallbackMap = getProductsJsonMap();

  return orders.map((order) => {
    const rawItems = Array.isArray(order.items) ? order.items : [];
    const enrichedItems = rawItems.map((item) => {
      const pId = String(item.productId || '');
      const prod = productsById.get(pId) || fallbackMap.get(pId);
      const variant = (prod?.variants && typeof item.variantIndex === 'number' ? prod.variants[item.variantIndex] : null)
        || prod?.variants?.[0];
      const itemImage = item.image || variant?.image || prod?.image || '';
      const itemName = item.name || prod?.name || 'Sản phẩm Urii';
      const itemSlug = prod?.slug || item.slug || item.productSlug || '';
      const itemUnitPrice = Number(item.unitPrice ?? item.price ?? prod?.currentPrice ?? 0);
      const itemOriginalPrice = Number(item.originalPrice ?? prod?.originalPrice ?? 0);
      const variantName = item.variantName || variant?.name || '';

      return {
        ...item,
        productId: pId,
        slug: itemSlug,
        name: itemName,
        image: itemImage,
        unitPrice: itemUnitPrice,
        originalPrice: itemOriginalPrice > itemUnitPrice ? itemOriginalPrice : null,
        variantName: variantName,
        quantity: item.quantity || 1
      };
    });
    const user = order.userId ? usersById.get(String(order.userId)) : null;
    const rawStatusType = typeof order.statusType === 'string' ? order.statusType.trim().toLowerCase() : '';
    const mappedLegacyStatus = (!order.statusId || order.statusId === 'pending') && rawStatusType && rawStatusType !== 'pending'
      ? ADMIN_STATUS_TO_ORDER_STATUS[rawStatusType]
      : null;
    const effectiveStatusId = mappedLegacyStatus?.statusId || order.statusId;
    const statusMeta = effectiveStatusId ? orderStatusesById.get(effectiveStatusId) : null;
    const cancelReasonMeta = order.cancellationReasonId
      ? cancelReasonsById.get(order.cancellationReasonId)
      : null;
    const cancelStatusMeta = order.cancellationStatusId
      ? requestStatusesById.get(order.cancellationStatusId)
      : null;
    const returnReasonMeta = order.returnReasonId
      ? returnReasonsById.get(order.returnReasonId)
      : null;
    const returnStatusMeta = order.returnStatusId
      ? requestStatusesById.get(order.returnStatusId)
      : null;
    const pm = order.payment?.methodId ? paymentMethodsById.get(order.payment.methodId) : null;
    const ps = order.payment?.statusId ? paymentStatusesById.get(order.payment.statusId) : null;
    const sm = order.shipping?.methodId ? shippingMethodsById.get(order.shipping.methodId) : null;
    const waitingPolicy = order.waitingInfo?.type
      ? orderReasons.waitingPolicies?.[order.waitingInfo.type]
      : null;

    return {
      ...order,
      items: enrichedItems,
      statusId: effectiveStatusId,
      orderType: order.orderType || 'normal',
      orderTypeLabel: orderTypesById.get(order.orderType || 'normal')?.label || '',
      status: effectiveStatusId === 'return_requested' ? statusMeta?.label : (mappedLegacyStatus?.status || order.status || statusMeta?.label || ''),
      statusType: effectiveStatusId === 'return_requested' ? 'return_requested' : (order.statusType || statusMeta?.statusType || ''),
      icon: order.icon || statusMeta?.icon || '',
      isWaiting: Boolean(statusMeta?.isWaiting),
      waitingLabel: statusMeta?.waitingLabel || waitingPolicy?.label || '',
      allowCancelRequest: Boolean(statusMeta?.allowCancelRequest),
      allowReturnRequest: Boolean(statusMeta?.allowReturnRequest),
      waitingInfo: order.waitingInfo?.type ? {
        ...order.waitingInfo,
        label: waitingPolicy?.label || statusMeta?.waitingLabel || ''
      } : order.waitingInfo,
      cancellationReason: cancelReasonMeta?.label || undefined,
      cancellationStatus: cancelStatusMeta?.label || undefined,
      returnReason: returnReasonMeta?.label || undefined,
      returnStatus: returnStatusMeta?.label || undefined,
      address: order.address?.name ? order.address : (user ? {
        name: user.name,
        phone: user.phone || '',
        address: user.address || ''
      } : order.address),
      payment: order.payment ? {
        ...order.payment,
        method: order.payment.method || pm?.label || '',
        status: order.payment.status || ps?.label || ''
      } : order.payment,
      shipping: order.shipping ? {
        ...order.shipping,
        carrier: order.shipping.carrier || sm?.carrier || '',
        method: order.shipping.method || sm?.label || ''
      } : order.shipping,
      timeline: Array.isArray(order.timeline)
        ? order.timeline.map((event) => ({
            ...event,
            status: event.status || timelineStatusesById.get(event.statusId)?.label || ''
          }))
        : order.timeline,
      shippingTimeline: Array.isArray(order.shippingTimeline)
        ? order.shippingTimeline.map((event) => ({
            ...event,
            status: event.status || shippingStatusesById.get(event.statusId)?.label || ''
          }))
        : order.shippingTimeline
    };
  });
}

exports.enrichOrders = enrichOrders;

exports.getOrderMetadata = (req, res) => {
  res.json({
    ...orderStatuses,
    ...orderReasons
  });
};

exports.getMyOrders = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    const filter = { userId: req.auth.id };
    if (typeof req.query.statusId === 'string' && req.query.statusId.trim()) {
      filter.statusId = req.query.statusId.trim();
    }
    const orders = await Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
    res.json(await enrichOrders(orders));
  } catch (error) {
    console.error('Lỗi tải đơn hàng của người dùng:', error);
    res.status(500).json({ message: 'Không thể tải danh sách đơn hàng.' });
  }
};

exports.getAllOrders = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    const filter = {};
    if (typeof req.query.statusId === 'string' && req.query.statusId.trim()) {
      filter.statusId = req.query.statusId.trim();
    }
    const orders = await Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
    res.json(await enrichOrders(orders));
  } catch (error) {
    console.error('Lỗi tải đơn hàng:', error);
    res.status(500).json({ message: 'Không thể tải danh sách đơn hàng.' });
  }
};

exports.getMyOrders = async (req, res) => {
  const userId = req.auth?.id;
  if (!mongoose.isValidObjectId(userId)) {
    res.status(401).json({ message: 'Phiên đăng nhập khách hàng không hợp lệ.' });
    return;
  }

  const statusId = typeof req.query.statusId === 'string' ? req.query.statusId : '';
  if (statusId && !orderStatuses.orderStatuses.some((status) => status.id === statusId)) {
    res.status(400).json({ message: 'Trạng thái đơn hàng không hợp lệ.' });
    return;
  }

  try {
    const { skip, limit } = getPagination(req.query);
    const filter = { userId };
    if (statusId) filter.statusId = statusId;

    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Order.countDocuments(filter)
    ]);

    res.json({
      orders: await enrichOrders(orders),
      total,
      page: Math.floor(skip / limit) + 1,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Lỗi tải đơn hàng của khách hàng:', error);
    res.status(500).json({ message: 'Không thể tải danh sách đơn hàng.' });
  }
};

exports.getMyOrdersSummary = async (req, res) => {
  const userId = req.auth?.id;
  if (!mongoose.isValidObjectId(userId)) {
    res.status(401).json({ message: 'Phiên đăng nhập khách hàng không hợp lệ.' });
    return;
  }

  try {
    const counts = {
      '': 0,
      all: 0,
      pending: 0,
      processing: 0,
      shipping: 0,
      completed: 0,
      returned: 0,
      cancelled: 0,
    };

    let total = 0;
    try {
      const userObjectId = new mongoose.Types.ObjectId(userId);
      const statusAgg = await Order.aggregate([
        {
          $match: {
            userId: { $in: [userObjectId, String(userId)] }
          }
        },
        {
          $group: {
            _id: '$statusId',
            count: { $sum: 1 }
          }
        }
      ]);

      for (const item of statusAgg) {
        if (item._id && Object.hasOwn(counts, item._id)) {
          counts[item._id] = item.count;
        }
        total += item.count;
      }
    } catch {
      total = await Order.countDocuments({ userId });
    }

    counts[''] = total;
    counts.all = total;

    res.json({ counts });
  } catch (error) {
    console.error('Lỗi tải thống kê đơn hàng:', error);
    res.status(500).json({ message: 'Không thể tải thống kê đơn hàng.' });
  }
};

exports.getMyOrderBySlug = async (req, res) => {
  const userId = req.auth?.id;
  if (!mongoose.isValidObjectId(userId)) {
    res.status(401).json({ message: 'Phiên đăng nhập khách hàng không hợp lệ.' });
    return;
  }

  try {
    const order = await Order.findOne({
      userId,
      id: req.params.slug
    }).lean();
    if (!order) {
      res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
      return;
    }

    const [enriched] = await enrichOrders([order]);
    res.json(enriched);
  } catch (error) {
    console.error('Lỗi tải chi tiết đơn hàng của khách hàng:', error);
    res.status(500).json({ message: 'Không thể tải chi tiết đơn hàng.' });
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const order = mongoose.isValidObjectId(req.params.id)
      ? await Order.findById(req.params.id).lean()
      : await Order.findOne({ id: req.params.id }).lean();
    if (!order) {
      res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
      return;
    }
    const [enriched] = await enrichOrders([order]);
    res.json(enriched);
  } catch (error) {
    console.error('Lỗi tải đơn hàng:', error);
    res.status(500).json({ message: 'Không thể tải đơn hàng.' });
  }
};

exports.createOrder = async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ message: 'Dữ liệu đơn hàng không hợp lệ.' });
    return;
  }

  try {
    if (Object.keys(req.body).some(key => /^(return|requestType)/.test(key) || key.startsWith('$'))) {
      return res.status(400).json({ message: 'Không được khởi tạo dữ liệu xử lý hoàn trả qua API tạo đơn.' });
    }
    const isCustomerOrder = req.auth?.role === 'user'
      || (req.auth?.role === 'admin' && !req.body.userId);
    const orderData = isCustomerOrder
      ? {
          ...req.body,
          userId: req.auth.id,
          status: 'Đang chờ duyệt',
          statusId: 'pending',
          statusType: 'pending'
        }
      : req.body;
    const nowIso = new Date().toISOString().slice(0, 19);
    const statusId = isCustomerOrder ? 'pending' : (orderData.statusId || 'pending');
    const waitingPolicy = orderReasons.waitingPolicies?.awaiting_confirmation;
    const defaultWaitingInfo = statusId === 'pending' && !orderData.waitingInfo
      ? {
          type: 'awaiting_confirmation',
          startedAt: nowIso,
          deadlineAt: addHoursIso(nowIso, waitingPolicy?.slaHours || 24),
          expectedHours: waitingPolicy?.slaHours || 24,
          actor: 'admin',
          note: waitingPolicy?.description || 'Chờ cửa hàng xác nhận đơn hàng trong vòng 24 giờ.'
        }
      : orderData.waitingInfo;

    const customId = typeof orderData.id === 'string' && orderData.id.trim()
      ? orderData.id.trim()
      : '';
    let order = null;
    const maxAttempts = customId ? 1 : 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        order = await Order.create({
          ...orderData,
          id: customId || generateOrderId(),
          statusId,
          waitingInfo: defaultWaitingInfo
        });
        break;
      } catch (createError) {
        if (createError?.code === 11000 && !customId && attempt < maxAttempts) {
          continue;
        }
        throw createError;
      }
    }
    emitCrudChange('orders', 'created', order._id, { userId: order.userId, status: order.status });
    await createAdminNotification({ typeId: 'ADMIN_ORDER_NEW', eventId: String(order._id),
      reference: { orderId: String(order.id || order._id) },
      title: 'Đơn hàng mới #' + (order.id || order._id),
      message: 'Có đơn hàng mới cần xử lý.' });
    const [enriched] = await enrichOrders([order.toObject()]);
    res.status(201).json(enriched);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu đơn hàng không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã đơn hàng đã tồn tại.' });
      return;
    }
    console.error('Lỗi tạo đơn hàng:', error);
    res.status(500).json({ message: 'Không thể tạo đơn hàng.' });
  }
};

exports.cancelMyPendingOrder = async (req, res) => {
  const { reasonId, reason, note } = req.body || {};
  const matchedReason = cancelReasonsById.get(reasonId);
  const reasonText = (typeof reason === 'string' && reason.trim())
    || matchedReason?.label
    || (typeof note === 'string' && note.trim())
    || 'Khách hàng hủy đơn khi đang chờ xác nhận';

  try {
    const slugOrId = req.params.slug || req.params.id;
    const filter = mongoose.isValidObjectId(slugOrId)
      ? { _id: slugOrId }
      : { id: slugOrId };
    const order = await Order.findOne(filter);
    if (!order) {
      res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
      return;
    }
    if (req.auth?.role !== 'admin' && String(order.userId) !== String(req.auth?.id)) {
      res.status(403).json({ message: 'Bạn không có quyền hủy đơn hàng này.' });
      return;
    }
    if (order.statusId !== 'pending') {
      res.status(400).json({
        message: 'Chỉ có thể hủy trực tiếp các đơn hàng đang ở trạng thái Chờ xác nhận.'
      });
      return;
    }

    const nowIso = new Date().toISOString().slice(0, 19);
    order.statusId = 'cancelled';
    order.status = 'Đã hủy';
    order.statusType = 'cancelled';
    order.cancellationReasonId = reasonId || 'CANCEL_CHANGE_MIND';
    order.cancellationReason = reasonText;
    order.cancellationNote = typeof note === 'string' ? note.trim() : '';
    order.cancellationStatusId = 'approved';
    order.cancellationRequestedAt = nowIso;
    order.cancellationApprovedAt = nowIso;
    order.cancelledAt = nowIso;
    order.waitingInfo = undefined;
    order.timeline = [
      ...(order.timeline || []),
      { statusId: 'cancelled', status: 'Đã hủy đơn hàng', time: nowIso, note: reasonText }
    ];

    await order.save();

    // Hủy payment đang chờ thanh toán nếu có
    try {
      const payment = await Payment.findOne({ orderId: order._id });
      if (payment && payment.statusId === 'awaiting_payment') {
        await paymentLifecycleService.cancelPaymentInSession(payment, null);
        order.payment = order.payment || {};
        order.payment.statusId = 'cancelled';
        order.payment.status = 'Đã hủy';
        await order.save();
      }
    } catch (payErr) {
      console.warn('Lỗi khi hủy payment cho đơn pending:', payErr);
    }

    emitCrudChange('orders', 'updated', order._id, { userId: order.userId, status: order.status });

    try {
      await createUserNotification({
        userId: order.userId,
        typeId: 'USER_ORDER_CANCELLED',
        reference: { orderId: String(order._id || order.id) },
        title: `Đã hủy đơn hàng #${order.id || order._id}`,
        message: `Đơn hàng #${order.id || order._id} đã được hủy thành công. Lý do: ${reasonText}.`,
        actionUrl: `/orders`
      });
    } catch (notifErr) {
      console.warn('Lỗi tạo notification:', notifErr);
    }

    const [enriched] = await enrichOrders([order.toObject()]);
    res.json({ success: true, message: 'Đã hủy đơn hàng thành công.', order: enriched });
  } catch (error) {
    console.error('Lỗi khi hủy đơn hàng:', error);
    res.status(500).json({ message: 'Không thể hủy đơn hàng. Vui lòng thử lại sau.' });
  }
};

exports.requestCancelOrder = async (req, res) => {
  const { reasonId, note, reason: customReason } = req.body || {};
  const reason = cancelReasonsById.get(reasonId) || {
    id: reasonId || 'CANCEL_OTHER',
    label: customReason || (typeof note === 'string' ? note : 'Khách hàng yêu cầu hủy đơn')
  };
  if (!reason && !customReason && !note) {
    res.status(400).json({ message: 'Lý do hủy đơn hàng không hợp lệ.' });
    return;
  }
  if (reason.requiresNote && (!typeof note === 'string' || !String(note || '').trim())) {
    res.status(400).json({ message: 'Vui lòng nhập ghi chú chi tiết cho lý do hủy đơn này.' });
    return;
  }

  try {
    const filter = mongoose.isValidObjectId(req.params.id)
      ? { _id: req.params.id }
      : { id: req.params.id };
    const order = await Order.findOne(filter);
    if (!order) {
      res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
      return;
    }
    if (req.auth?.role !== 'admin' && String(order.userId) !== String(req.auth?.id)) {
      res.status(403).json({ message: 'Bạn không có quyền yêu cầu hủy đơn hàng này.' });
      return;
    }
    const allowedStatuses = reason.allowedOrderStatuses || ['pending', 'processing'];
    if (!allowedStatuses.includes(order.statusId)) {
      res.status(400).json({ message: 'Đơn hàng ở trạng thái hiện tại không thể gửi yêu cầu hủy.' });
      return;
    }

    const nowIso = new Date().toISOString().slice(0, 19);

    // Nếu đơn hàng đang ở trạng thái 'pending' (Chờ xác nhận), cho phép hủy ngay lập tức
    if (order.statusId === 'pending') {
      order.statusId = 'cancelled';
      order.status = 'Đã hủy';
      order.statusType = 'cancelled';
      order.cancellationReasonId = reason.id;
      order.cancellationReason = customReason || reason.label || (typeof note === 'string' ? note.trim() : '');
      order.cancellationNote = typeof note === 'string' ? note.trim() : '';
      order.cancellationStatusId = 'approved';
      order.cancellationRequestedAt = nowIso;
      order.cancellationApprovedAt = nowIso;
      order.cancelledAt = nowIso;
      order.waitingInfo = undefined;
      order.timeline = [
        ...(order.timeline || []),
        { statusId: 'cancelled', status: 'Đã hủy đơn hàng', time: nowIso, note: reason.label }
      ];
      await order.save();
      emitCrudChange('orders', 'updated', order._id, { userId: order.userId, status: order.status });
      const [enriched] = await enrichOrders([order.toObject()]);
      return res.json(enriched);
    }

    const slaHours = reason.slaHours || orderReasons.waitingPolicies?.awaiting_cancel_approval?.slaHours || 24;
    const deadlineIso = addHoursIso(nowIso, slaHours);

    const cancellationEvent = `${order._id}:${order.timeline?.length || 0}`;
    order.statusId = 'cancel_requested';
    order.cancellationReasonId = reason.id;
    order.cancellationNote = typeof note === 'string' ? note.trim() : '';
    order.cancellationStatusId = 'pending_approval';
    order.cancellationRequestedAt = nowIso;
    order.cancellationDeadlineAt = deadlineIso;
    order.waitingInfo = {
      type: 'awaiting_cancel_approval',
      startedAt: nowIso,
      deadlineAt: deadlineIso,
      expectedHours: slaHours,
      actor: 'admin',
      note: 'Chờ cửa hàng kiểm tra kho và xác nhận yêu cầu hủy đơn.'
    };
    order.timeline = [
      ...(order.timeline || []),
      { statusId: 'cancel_requested', time: nowIso }
    ];

    await order.save();
    emitCrudChange('orders', 'updated', order._id, { userId: order.userId, status: order.status });
    if (req.auth?.role !== 'admin') {
      await createAdminNotification({ typeId: 'ADMIN_ORDER_CANCEL_REQUEST', eventId: cancellationEvent,
        reference: { orderId: String(order.id || order._id) },
        title: 'Yêu cầu hủy đơn #' + (order.id || order._id),
        message: 'Khách hàng yêu cầu hủy đơn, cần Admin xem xét.' });
    }
    const [enriched] = await enrichOrders([order.toObject()]);
    res.json(enriched);
  } catch (error) {
    console.error('Lỗi gửi yêu cầu hủy đơn:', error);
    res.status(500).json({ message: 'Không thể gửi yêu cầu hủy đơn hàng.' });
  }
};

exports.requestReturnOrder = async (req, res) => {
  const { reasonId, note, evidence, requestType } = req.body || {};
  if (requestType !== undefined && !RETURN_TYPES.includes(requestType)) {
    return res.status(400).json({ message: 'Loại yêu cầu không hợp lệ.' });
  }
  const reason = returnReasonsById.get(reasonId);
  if (!reason) {
    res.status(400).json({ message: 'Lý do hoàn trả không hợp lệ.' });
    return;
  }
  if (reason.requiresNote && !String(note || '').trim()) {
    res.status(400).json({ message: 'Vui lòng nhập mô tả chi tiết cho yêu cầu hoàn trả.' });
    return;
  }

  const mediaList = Array.isArray(evidence) ? evidence : [];
  const requiredImages = reason.requiresMedia?.images || 0;
  const requiredVideos = reason.requiresMedia?.videos || 0;
  const imageCount = mediaList.filter((item) => item?.type === 'image').length;
  const videoCount = mediaList.filter((item) => item?.type === 'video').length;
  if (imageCount < requiredImages || videoCount < requiredVideos) {
    res.status(400).json({
      message: `Yêu cầu hoàn trả cần tối thiểu ${requiredImages} hình ảnh và ${requiredVideos} video minh chứng.`
    });
    return;
  }

  try {
    const filter = mongoose.isValidObjectId(req.params.id)
      ? { _id: req.params.id }
      : { id: req.params.id };
    const order = await Order.findOne(filter);
    if (!order) {
      res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
      return;
    }
    if (req.auth?.role !== 'admin' && String(order.userId) !== String(req.auth?.id)) {
      res.status(403).json({ message: 'Bạn không có quyền yêu cầu hoàn trả đơn hàng này.' });
      return;
    }
    const allowedStatuses = reason.allowedOrderStatuses || ['completed'];
    if (!allowedStatuses.includes(order.statusId)) {
      res.status(400).json({ message: 'Chỉ đơn hàng đã giao thành công mới có thể yêu cầu hoàn trả.' });
      return;
    }

    const nowIso = new Date().toISOString().slice(0, 19);
    const slaHours = reason.slaHours || orderReasons.waitingPolicies?.awaiting_return_approval?.slaHours || 48;
    const deadlineIso = addHoursIso(nowIso, slaHours);
    const previousStatus = { statusId: order.statusId, status: order.status, statusType: order.statusType };
    if (await linkedReturnReason(order, 'order')) return res.status(409).json({ message: 'Cần xác nhận nguồn giao dịch Custom liên kết trước khi tiếp nhận yêu cầu.' });

    order.statusId = 'return_requested';
    order.status = 'Chờ xác nhận hoàn trả';
    order.statusType = 'return_requested';
    if (requestType) order.requestType = requestType;
    order.returnReasonId = reason.id;
    order.returnNote = typeof note === 'string' ? note.trim() : '';
    order.returnEvidence = mediaList;
    order.returnStatusId = 'pending_approval';
    order.returnRequestedAt = nowIso;
    order.returnDeadlineAt = deadlineIso;
    order.waitingInfo = {
      type: 'awaiting_return_approval',
      startedAt: nowIso,
      deadlineAt: deadlineIso,
      expectedHours: slaHours,
      actor: 'admin',
      note: 'Chờ cửa hàng kiểm tra minh chứng và xác nhận yêu cầu trả hàng/hoàn tiền.'
    };
    order.timeline = [
      ...(order.timeline || []),
      { statusId: 'return_requested', time: nowIso },
      { statusId: 'awaiting_return_confirmation', time: nowIso }
    ];

    const intake = await Order.findOneAndUpdate({ _id: order._id, statusId: { $in: allowedStatuses }, returnStatusId: { $exists: false } }, {
      $set: {
        statusId: order.statusId, status: order.status, statusType: order.statusType,
        ...(requestType ? { requestType } : {}),
        returnReasonId: order.returnReasonId, returnNote: order.returnNote,
        returnEvidence: order.returnEvidence, returnStatusId: order.returnStatusId,
        returnRequestedAt: order.returnRequestedAt, returnDeadlineAt: order.returnDeadlineAt,
        returnPreviousStatus: previousStatus,
        waitingInfo: order.waitingInfo
      },
      $push: { timeline: { $each: [{ statusId: 'return_requested', time: nowIso }, { statusId: 'awaiting_return_confirmation', time: nowIso }] },
        returnHistory: { action: 'requested', toStatus: 'pending_approval', actorId: String(req.auth.id), at: nowIso, note: order.returnNote } },
      $inc: { returnRevision: 1 }
    }, { new: true, runValidators: true, returnWorkflow: true });
    if (!intake) return res.status(409).json({ message: 'Đơn hàng đã có yêu cầu hoặc vừa được cập nhật. Vui lòng tải lại.' });
    await createAdminNotification({ typeId: 'ADMIN_ORDER_RETURN_REQUEST', eventId: String(intake._id) + ':' + new Date(intake.returnRequestedAt).toISOString(),
      reference: { orderId: String(intake.id) }, title: 'Yêu cầu hoàn trả #' + intake.id, message: 'Có yêu cầu trả hàng/hoàn tiền cần kiểm duyệt.' });
    emitCrudChange('orders', 'updated', order._id, { userId: order.userId, status: order.status });
    const [enriched] = await enrichOrders([intake.toObject()]);
    res.json(enriched);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu minh chứng hoàn trả không hợp lệ.' });
      return;
    }
    console.error('Lỗi gửi yêu cầu hoàn trả:', error);
    res.status(500).json({ message: 'Không thể gửi yêu cầu hoàn trả.' });
  }
};

const RETURN_TYPES = ['return_only', 'refund_only', 'return_and_refund'];
const RETURN_OPEN = ['pending_approval', 'approved', 'awaiting_return_pickup', 'inspecting', 'refund_pending', 'refunded'];
const RETURN_TYPE_LABELS = { return_only: 'Chỉ trả hàng', refund_only: 'Chỉ hoàn tiền', return_and_refund: 'Trả hàng và hoàn tiền' };

function returnError(message, status = 409) {
  const error = new Error(message); error.status = status; return error;
}

function confirmedOrderAmount(order) {
  if (order.payment?.methodId && order.payment.methodId !== 'cod') return null;
  const raw = order.totalAmount ?? order.total;
  let amount = raw;
  if (typeof raw === 'string') {
    const value = raw.trim().replace(/\s*(đ|₫|VND)$/i, '').trim();
    if (!/^(\d+|\d{1,3}(\.\d{3})+|\d{1,3}(,\d{3})+)$/.test(value)) return null;
    amount = Number(value.replace(/[.,]/g, ''));
  }
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function returnActions(order, blockedReason = '') {
  if (blockedReason) return [];
  const state = order.returnStatusId;
  if (state === 'pending_approval') return ['approve', 'reject'];
  if (!RETURN_TYPES.includes(order.requestType)) return [];
  if (state === 'approved') return ['start'];
  if (state === 'awaiting_return_pickup' && order.requestType !== 'refund_only') return ['receive'];
  if (state === 'inspecting' && order.returnReceivedAt && order.requestType !== 'refund_only' && !order.returnInspection?.result) return ['inspect'];
  if (state === 'inspecting' && order.returnReceivedAt && order.returnInspection?.result === 'passed') return [order.requestType === 'return_only' ? 'complete' : 'prepare-refund'];
  if (state === 'refund_pending' && order.requestType !== 'return_only' && !order.returnRefund?.refundedAt) {
    if (order.requestType === 'return_and_refund' && (!order.returnReceivedAt || order.returnInspection?.result !== 'passed')) return [];
    return order.returnCod?.confirmedAt && Number.isSafeInteger(order.returnCod.amount) && order.returnCod.amount > 0
      ? ['confirm-refund'] : confirmedOrderAmount(order) ? ['confirm-cod'] : [];
  }
  if (state === 'refunded' && order.requestType !== 'return_only' && order.returnRefund?.refundedAt && order.returnRefund.amount === order.returnCod?.amount) return ['complete'];
  return [];
}

async function linkedReturnReason(order, source) {
  if (order.payment?.statusId === 'refunded' && !order.returnRefund?.refundedAt) return 'Dữ liệu cũ ghi đã hoàn tiền. Cần đối chiếu trước khi xử lý để tránh hoàn trùng.';
  if (source === 'order' && order.returnStatusId === 'refund_pending' && await Payment.exists({ orderId: order._id })) {
    return 'Đơn có bản ghi thanh toán riêng. Cần xác nhận nguồn COD trước khi xử lý.';
  }
  if (source === 'custom_order') {
    if (await Order.exists({ customOrderId: { $in: [String(order.id), String(order._id)] } })) {
      return 'Custom có Order liên kết. Cần xác nhận nguồn giao dịch trước khi xử lý để tránh trùng.';
    }
  } else if (order.customOrderId) {
    return 'Đơn có customOrderId. Cần xác nhận nguồn giao dịch Custom trước khi xử lý.';
  }
  return '';
}

function returnView(order, source, blockedReason = '') {
  const state = order.returnStatusId;
  const availableActions = returnActions(order, blockedReason);
  return {
    ...order, source,
    customerName: source === 'custom_order' ? order.fullName : (order.userName || order.address?.name),
    orderTypeLabel: source === 'custom_order' || order.orderType === 'custom' ? 'Custom' : 'Thường',
    requestTypeLabel: RETURN_TYPE_LABELS[order.requestType] || 'Chưa phân loại',
    returnReason: returnReasonsById.get(order.returnReasonId)?.label || order.returnReasonId || '',
    returnStatusLabel: requestStatusesById.get(state)?.label || state || 'Chưa xác định',
    blockedReason: blockedReason || (state === 'inspecting' && order.returnInspection?.result === 'failed'
      ? 'Kiểm hàng không đạt. Tạm dừng, cần xác nhận phương án xử lý.'
      : state === 'refund_pending' && !order.returnCod?.confirmedAt && !confirmedOrderAmount(order)
        ? 'Chưa xác định được số tiền COD hợp lệ từ đơn hàng. Không thể xác nhận thanh toán/hoàn tiền.'
        : RETURN_OPEN.includes(state) && !availableActions.length ? 'Dữ liệu yêu cầu cũ chưa đủ để tiếp tục an toàn. Cần đối chiếu trước khi xử lý.' : ''),
    availableActions,
    codAmount: order.returnCod?.amount ?? confirmedOrderAmount(order)
  };
}

async function getReturnRecord(req) {
  const source = req.params.source;
  if (!['order', 'custom_order'].includes(source)) throw returnError('Nguồn đơn không hợp lệ.', 400);
  const Model = source === 'order' ? Order : CustomOrder;
  const order = await Model.findOne({ id: req.params.id }).lean();
  if (!order || !order.returnStatusId) throw returnError('Không tìm thấy yêu cầu.', 404);
  return { source, Model, order, blockedReason: await linkedReturnReason(order, source) };
}

exports.getReturnRequests = async (req, res) => {
  if (req.auth?.role !== 'admin') return res.status(403).json({ message: 'Chỉ Admin được xử lý yêu cầu.' });
  try {
    const { skip, limit } = getPagination(req.query);
    const match = { returnStatusId: { $exists: true, $ne: null } };
    if (req.query.requestType === 'unclassified') match.requestType = { $nin: RETURN_TYPES };
    else if (req.query.requestType) {
      if (!RETURN_TYPES.includes(req.query.requestType)) throw returnError('Bộ lọc loại yêu cầu không hợp lệ.', 400);
      match.requestType = req.query.requestType;
    }
    if (req.query.status) {
      if (!requestStatusesById.has(req.query.status)) throw returnError('Bộ lọc trạng thái không hợp lệ.', 400);
      match.returnStatusId = req.query.status;
    }
    if (req.query.orderType) {
      if (!['normal', 'custom'].includes(req.query.orderType)) throw returnError('Loại đơn không hợp lệ.', 400);
      match.orderType = req.query.orderType;
    }
    if (req.query.orderId) match.id = String(req.query.orderId);
    const [result] = await Order.aggregate([
      { $match: { returnStatusId: { $exists: true } } },
      { $addFields: { source: 'order', orderType: { $ifNull: ['$orderType', 'normal'] } } },
      { $unionWith: { coll: CustomOrder.collection.name, pipeline: [
        { $match: { returnStatusId: { $exists: true } } }, { $addFields: { source: 'custom_order', orderType: 'custom' } }
      ] } },
      { $match: match },
      { $addFields: { returnPriority: { $cond: [{ $in: ['$returnStatusId', RETURN_OPEN] }, 0, 1] } } },
      { $sort: { returnPriority: 1, returnRequestedAt: -1, source: 1, id: 1 } },
      { $facet: { requests: [{ $skip: skip }, { $limit: limit }], count: [{ $count: 'total' }] } }
    ]);
    const requests = await Promise.all((result?.requests || []).map(async order => returnView(order, order.source, await linkedReturnReason(order, order.source))));
    res.json({ requests, total: result?.count?.[0]?.total || 0, page: Math.floor(skip / limit) + 1, limit });
  } catch (error) { res.status(error.status || 500).json({ message: error.status ? error.message : 'Không thể tải yêu cầu hoàn trả.' }); }
};

exports.getReturnRequest = async (req, res) => {
  if (req.auth?.role !== 'admin') return res.status(403).json({ message: 'Chỉ Admin được xử lý yêu cầu.' });
  try {
    const { order, source, blockedReason } = await getReturnRecord(req);
    const detail = source === 'order' ? (await enrichOrders([order]))[0] : order;
    res.json(returnView(detail, source, blockedReason));
  } catch (error) { res.status(error.status || 500).json({ message: error.status ? error.message : 'Không thể tải chi tiết yêu cầu.' }); }
};

exports.processReturnRequest = async (req, res) => {
  if (req.auth?.role !== 'admin') return res.status(403).json({ message: 'Chỉ Admin được xử lý yêu cầu.' });
  try {
    const { order, source, Model, blockedReason } = await getReturnRecord(req);
    if (blockedReason) throw returnError(blockedReason);
    const body = req.body || {};
    const action = req.params.action;
    if (!Number.isSafeInteger(body.revision) || body.revision !== (order.returnRevision || 0)) throw returnError('Yêu cầu đã thay đổi. Vui lòng tải lại.');
    if (!returnActions(order).includes(action)) throw returnError('Thao tác không hợp lệ với trạng thái hiện tại.');
    const now = new Date(); const actorId = String(req.auth.id);
    const set = {}; let next = order.returnStatusId;
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 4000) : '';
    if (action === 'approve') {
      const type = RETURN_TYPES.includes(order.requestType) ? order.requestType : body.requestType;
      if (!RETURN_TYPES.includes(type)) throw returnError('Vui lòng chọn loại xử lý.', 400);
      if (RETURN_TYPES.includes(order.requestType) && body.requestType && body.requestType !== order.requestType) throw returnError('Không được thay đổi loại yêu cầu khách đã chọn.', 400);
      Object.assign(set, { requestType: type, returnApprovedAt: now, returnApprovedBy: actorId }); next = 'approved';
    } else if (action === 'reject') {
      if (!note) throw returnError('Bắt buộc nhập lý do từ chối.', 400);
      set.returnRejectionReason = note; set.returnResolvedAt = now; next = 'rejected';
    } else if (action === 'start') next = order.requestType === 'refund_only' ? 'refund_pending' : 'awaiting_return_pickup';
    else if (action === 'receive') { set.returnReceivedAt = now; next = 'inspecting'; }
    else if (action === 'inspect') {
      if (!['passed', 'failed'].includes(body.result)) throw returnError('Chọn Đạt hoặc Không đạt.', 400);
      set.returnInspection = { result: body.result, note, inspectedAt: now, inspectedBy: actorId };
    } else if (action === 'prepare-refund') next = 'refund_pending';
    else if (action === 'confirm-cod') {
      const amount = confirmedOrderAmount(order);
      if (!amount || order.returnCod?.confirmedAt) throw returnError('Không xác định được số tiền COD hoặc đã xác nhận.');
      set.returnCod = { amount, confirmedAt: now, confirmedBy: actorId };
      if (source === 'order') set.payment = { ...order.payment, statusId: 'paid', status: 'Đã thanh toán' };
    } else if (action === 'confirm-refund') {
      if (!order.returnCod?.confirmedAt || !Number.isSafeInteger(order.returnCod.amount) || order.returnCod.amount <= 0 || order.returnRefund?.refundedAt) throw returnError('Chưa xác nhận COD hoặc đã hoàn tiền.');
      set.returnRefund = { amount: order.returnCod.amount, method: 'manual', refundedAt: now, confirmedBy: actorId }; next = 'refunded';
      if (source === 'order') set.payment = { ...order.payment, statusId: 'refunded', status: 'Đã hoàn tiền' };
    } else if (action === 'complete') { set.returnResolvedAt = now; next = 'completed'; }
    set.returnStatusId = next;
    if (source === 'order' && ['completed', 'rejected'].includes(next) && order.returnPreviousStatus?.statusId) {
      Object.assign(set, order.returnPreviousStatus);
      set.waitingInfo = null;
    }
    const payment = source === 'order' ? await Payment.exists({ orderId: order._id }) : false;
    if (payment && ['confirm-cod', 'confirm-refund'].includes(action)) throw returnError('Đơn có bản ghi thanh toán riêng. Cần xác nhận nguồn COD trước khi xử lý.');
    const updated = await Model.findOneAndUpdate({ _id: order._id, returnStatusId: order.returnStatusId,
      ...(order.returnRevision === undefined ? { returnRevision: { $exists: false } } : { returnRevision: order.returnRevision }) }, {
      $set: set, $inc: { returnRevision: 1 },
      $push: { returnHistory: { action, fromStatus: order.returnStatusId, toStatus: next, actorId, at: now, note } }
    }, { new: true, runValidators: true, returnWorkflow: true }).lean();
    if (!updated) throw returnError('Có người vừa cập nhật yêu cầu. Vui lòng tải lại.');
    emitCrudChange(source === 'order' ? 'orders' : 'customOrders', 'updated', updated._id, { userId: updated.userId });
    const detail = source === 'order' ? (await enrichOrders([updated]))[0] : updated;
    res.json(returnView(detail, source));
  } catch (error) { res.status(error.status || (error.name === 'ValidationError' ? 400 : 500)).json({ message: error.status ? error.message : 'Không thể xử lý yêu cầu.' }); }
};

exports.returnActions = returnActions;
exports.confirmedOrderAmount = confirmedOrderAmount;

async function notifyUserOnOrderStatusChange(order, newStatusId) {
  if (!order || !order.userId || !newStatusId) return;
  const orderCode = String(order.id || order._id).slice(-8);

  if (newStatusId === 'processing') {
    await createUserNotification({
      userId: order.userId,
      typeId: 'USER_ORDER_CONFIRMED',
      reference: { orderId: String(order._id || order.id) },
      title: `Đơn hàng #${orderCode} đã được xác nhận`,
      message: `Shop đã xác nhận đơn hàng #${orderCode} và đang đóng gói chuẩn bị giao hàng.`,
      actionUrl: `/orders`
    });
  } else if (newStatusId === 'shipping') {
    await createUserNotification({
      userId: order.userId,
      typeId: 'USER_ORDER_SHIPPING',
      reference: { orderId: String(order._id || order.id) },
      title: `Đơn hàng #${orderCode} đang được giao`,
      message: `Đơn hàng #${orderCode} đã được bàn giao cho đơn vị vận chuyển.`,
      actionUrl: `/orders`
    });
  } else if (newStatusId === 'completed') {
    await createUserNotification({
      userId: order.userId,
      typeId: 'USER_ORDER_DELIVERED',
      reference: { orderId: String(order._id || order.id) },
      title: `Giao hàng thành công #${orderCode}`,
      message: `Đơn hàng #${orderCode} đã giao thành công. Cảm ơn bạn đã mua sắm tại Urii!`,
      actionUrl: `/orders`
    });
  } else if (newStatusId === 'cancelled') {
    await createUserNotification({
      userId: order.userId,
      typeId: 'USER_ORDER_CANCEL_APPROVED',
      reference: { orderId: String(order._id || order.id) },
      title: `Đã hủy đơn hàng #${orderCode}`,
      message: `Đơn hàng #${orderCode} đã được chuyển sang trạng thái đã hủy.`,
      actionUrl: `/orders`
    });
  }
}

exports.updateOrder = async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ message: 'Dữ liệu đơn hàng không hợp lệ.' });
    return;
  }

  const updates = { ...req.body };
  if (Object.keys(updates).some(key => key.startsWith('$') || /^(return|requestType)/.test(key)) ||
      ['refund_pending', 'refunded'].includes(updates.payment?.statusId) ||
      ['refund_pending', 'refunded'].includes(updates['payment.statusId']) ||
      updates.statusId === 'returned' || updates.statusType === 'returned') {
    return res.status(409).json({ message: 'Vui lòng sử dụng API xử lý yêu cầu hoàn trả.' });
  }
  delete updates._id;
  delete updates.id;
  delete updates.createdAt;
  delete updates.updatedAt;
  delete updates.__v;
  normalizeOrderStatusUpdates(updates);
  if (updates.statusId === 'returned') return res.status(409).json({ message: 'Vui lòng sử dụng API xử lý yêu cầu hoàn trả.' });

  try {
    let order;
    const filter = mongoose.isValidObjectId(req.params.id)
      ? { _id: req.params.id }
      : { id: req.params.id };
    const currentOrder = await Order.findOne(filter).select('_id statusId status returnStatusId').lean();
    if (!currentOrder) {
      res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
      return;
    }
    if (currentOrder.returnStatusId && !['completed', 'rejected'].includes(currentOrder.returnStatusId) &&
        Object.keys(updates).some(key => /^(status|payment|total|items|shipping|voucher)/.test(key))) {
      return res.status(409).json({ message: 'Đơn hàng đang có yêu cầu hoàn trả cần xử lý.' });
    }

    // Quy định: Dữ liệu đang chờ xác nhận thì không được giao hàng. Khi nào xác nhận xong mới tiến hành chuẩn bị và giao.
    if (currentOrder.statusId === 'pending') {
      const targetStatusId = updates.statusId || (updates.statusType ? ADMIN_STATUS_TO_ORDER_STATUS[String(updates.statusType).toLowerCase()]?.statusId : undefined);
      if (targetStatusId === 'shipping' || targetStatusId === 'completed') {
        res.status(400).json({
          message: 'Đơn hàng đang chờ xác nhận không được giao hàng. Vui lòng xác nhận đơn hàng trước khi tiến hành chuẩn bị và giao.'
        });
        return;
      }
    }
    const currentPayment = await Payment.findOne({ orderId: currentOrder._id })
      .select('_id')
      .lean();
    if (!currentPayment) {
      const currentDetails = await Order.findById(currentOrder._id).select('payment.methodId').lean();
      if (currentDetails?.payment?.methodId !== 'bank_transfer') {
        order = await Order.findOneAndUpdate(filter, updates, {
          new: true,
          runValidators: true
        });
        if (!order) {
          res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
          return;
        }
        if (updates.statusId) {
          notifyUserOnOrderStatusChange(order, updates.statusId).catch(console.error);
        }
        emitCrudChange('orders', 'updated', order._id, {
          userId: order.userId,
          status: order.status
        });
        const [enriched] = await enrichOrders([order.toObject()]);
        res.json(enriched);
        return;
      }
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        order = await Order.findById(currentOrder._id).session(session);
        if (!order) return;

        const payment = await Payment.findOne({ orderId: order._id }).session(session);
        if (RETURN_OPEN.includes(order.returnStatusId) && Object.keys(updates).some(key => /^(status|payment|total|items|shipping|voucher)/.test(key))) {
          throw new PaymentOrderConflictError('Đơn hàng đang có yêu cầu hoàn trả cần xử lý.');
        }
        if (!payment) {
          order = await Order.findOneAndUpdate(filter, updates, {
            new: true,
            runValidators: true,
            session
          });
          return;
        }

        if (Object.hasOwn(updates, 'payment')
          && updates.payment?.statusId !== undefined
          && updates.payment.statusId !== order.payment?.statusId) {
          throw new PaymentOrderConflictError('Không thể thay đổi trạng thái thanh toán trực tiếp qua API Order.');
        }

        const financialChange = hasFinancialOrderChanges(order, updates);
        if (payment.statusId === 'paid' && financialChange) {
          throw new PaymentOrderConflictError('Không thể sửa thông tin tài chính của đơn đã thanh toán.');
        }

        const now = new Date();
        if (payment.statusId === 'awaiting_payment' && payment.expiresAt <= now) {
          await paymentLifecycleService.expirePaymentInSession(payment, now, session);
        } else if (payment.statusId === 'awaiting_payment'
          && (financialChange || updates.statusId === 'cancelled')) {
          await paymentLifecycleService.cancelPaymentInSession(payment, session);
        }

        const usesMongoOperators = Object.keys(updates).some((field) => field.startsWith('$'));
        if (usesMongoOperators) {
          order = await Order.findOneAndUpdate(filter, updates, {
            new: true,
            runValidators: true,
            session
          });
          if (!order) return;
        } else {
          order.set(updates);
        }
        if (payment.statusId === 'cancelled') {
          order.payment.statusId = 'cancelled';
          order.payment.status = 'Đã hủy';
        } else if (payment.statusId === 'expired') {
          order.payment.statusId = 'unpaid';
          order.payment.status = 'Chưa thanh toán';
        }
        await order.save({ session });
      });
    } finally {
      await session.endSession();
    }
    if (!order) {
      res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
      return;
    }
    if (updates.statusId) {
      notifyUserOnOrderStatusChange(order, updates.statusId).catch(console.error);
    }
    emitCrudChange('orders', 'updated', order._id, {
      userId: order.userId,
      status: order.status
    });
    const [enriched] = await enrichOrders([order.toObject()]);
    res.json(enriched);
  } catch (error) {
    if (error instanceof PaymentOrderConflictError) {
      res.status(409).json({ message: error.message });
      return;
    }
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu đơn hàng không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã đơn hàng đã tồn tại.' });
      return;
    }
    console.error('Lỗi cập nhật đơn hàng:', error);
    res.status(500).json({ message: 'Không thể cập nhật đơn hàng.' });
  }
};

exports.deleteOrder = async (req, res) => {
  try {
    const filter = mongoose.isValidObjectId(req.params.id)
      ? { _id: req.params.id }
      : { id: req.params.id };
    const currentOrder = await Order.findOne(filter).select('_id payment.methodId').lean();
    if (!currentOrder) {
      res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
      return;
    }

    const currentPayment = await Payment.findOne({ orderId: currentOrder._id })
      .select('_id statusId')
      .lean();
    if (!currentPayment && currentOrder.payment?.methodId !== 'bank_transfer') {
      const order = await Order.findOneAndDelete(filter);
      if (!order) {
        res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
        return;
      }
      emitCrudChange('orders', 'deleted', order._id);
      res.json({ message: 'Đã xóa đơn hàng.' });
      return;
    }

    let deletedOrder = null;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const payment = await Payment.findOne({ orderId: currentOrder._id }).session(session);
        if (payment) {
          if (payment.statusId === 'paid') {
            throw new PaymentOrderConflictError('Không thể xóa đơn hàng đã được thanh toán.');
          }
          if (payment.statusId === 'awaiting_payment') {
            await paymentLifecycleService.cancelPaymentInSession(payment, session);
          }
        }
        deletedOrder = await Order.findOneAndDelete({ _id: currentOrder._id }, { session });
      });
    } finally {
      await session.endSession();
    }

    if (!deletedOrder) {
      res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
      return;
    }
    emitCrudChange('orders', 'deleted', deletedOrder._id);
    res.json({ message: 'Đã xóa đơn hàng.' });
  } catch (error) {
    if (error instanceof PaymentOrderConflictError) {
      res.status(409).json({ message: error.message });
      return;
    }
    console.error('Lỗi xóa đơn hàng:', error);
    res.status(500).json({ message: 'Không thể xóa đơn hàng.' });
  }
};


exports.updateMyOrderAddress = async (req, res) => {
  const userId = req.auth?.id;
  if (!mongoose.isValidObjectId(userId)) {
    res.status(401).json({ message: 'Phiên đăng nhập không hợp lệ.' });
    return;
  }

  const { name, phone, address } = req.body || {};
  if (!name || !phone || !address) {
    res.status(400).json({ message: 'Vui lòng cung cấp đầy đủ họ tên, số điện thoại và địa chỉ giao hàng.' });
    return;
  }

  const orderId = req.params.slug || req.params.id;
  try {
    const filter = mongoose.isValidObjectId(orderId)
      ? { _id: orderId, userId }
      : { id: orderId, userId };

    const order = await Order.findOne(filter);
    if (!order) {
      res.status(404).json({ message: 'Không tìm thấy đơn hàng của bạn.' });
      return;
    }

    const currentStatus = order.statusId || order.statusType || 'pending';
    if (currentStatus !== 'pending') {
      res.status(400).json({ message: 'Chỉ đơn hàng ở trạng thái Chờ xác nhận mới có thể thay đổi địa chỉ.' });
      return;
    }

    const trimmedAddress = {
      name: String(name).trim(),
      phone: String(phone).trim(),
      address: String(address).trim()
    };

    order.address = trimmedAddress;
    if (trimmedAddress.name) {
      order.userName = trimmedAddress.name;
    }

    await order.save();

    try {
      const ordersJsonPath = path.resolve(__dirname, '../data/orders.json');
      if (fs.existsSync(ordersJsonPath)) {
        const rawJson = JSON.parse(fs.readFileSync(ordersJsonPath, 'utf8'));
        const orderList = Array.isArray(rawJson) ? rawJson : (rawJson.orders || []);
        const found = orderList.find(o => String(o.id) === String(order.id) || String(o._id) === String(order._id));
        if (found) {
          found.address = trimmedAddress;
          if (trimmedAddress.name) found.userName = trimmedAddress.name;
          fs.writeFileSync(ordersJsonPath, JSON.stringify(rawJson, null, 2), 'utf8');
        }
      }
    } catch (syncErr) {
      console.warn('Lỗi đồng bộ orders.json khi cập nhật địa chỉ:', syncErr);
    }

    emitCrudChange('orders', 'updated', order._id, { userId: order.userId, address: order.address });
    const [enriched] = await enrichOrders([order.toObject()]);
    res.json({
      success: true,
      message: 'Cập nhật địa chỉ nhận hàng thành công.',
      address: trimmedAddress,
      order: enriched
    });
  } catch (error) {
    console.error('Lỗi cập nhật địa chỉ đơn hàng:', error);
    res.status(500).json({ message: 'Không thể cập nhật địa chỉ đơn hàng.' });
  }
};
