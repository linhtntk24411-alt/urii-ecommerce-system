const Order = require('../models/Order');
const User = require('../models/User');
const orderStatuses = require('../data/order_statuses.json');
const orderReasons = require('../data/order_reasons.json');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const { getPagination } = require('../utils/pagination');
const { emitCrudChange } = require('../realtime');

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

function addHoursIso(isoOrDate, hours) {
  const base = isoOrDate ? new Date(isoOrDate) : new Date();
  const validBase = Number.isNaN(base.getTime()) ? new Date() : base;
  return new Date(validBase.getTime() + hours * 3600 * 1000).toISOString().slice(0, 19);
}

async function enrichOrders(orders) {
  const userIds = [...new Set(orders.map((o) => o.userId).filter(Boolean).map(String))];
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }).select('name phone address').lean()
    : [];
  const usersById = new Map(users.map((u) => [String(u._id), u]));

  return orders.map((order) => {
    const user = order.userId ? usersById.get(String(order.userId)) : null;
    const statusMeta = order.statusId ? orderStatusesById.get(order.statusId) : null;
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
      orderType: order.orderType || 'normal',
      orderTypeLabel: orderTypesById.get(order.orderType || 'normal')?.label || '',
      status: order.status || statusMeta?.label || '',
      statusType: order.statusType || statusMeta?.statusType || '',
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

    const order = await Order.create({
      ...orderData,
      id: orderData.id || `order-${randomUUID()}`,
      statusId,
      waitingInfo: defaultWaitingInfo
    });
    emitCrudChange('orders', 'created', order._id);
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

exports.requestCancelOrder = async (req, res) => {
  const { reasonId, note } = req.body || {};
  const reason = cancelReasonsById.get(reasonId);
  if (!reason) {
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
    const slaHours = reason.slaHours || orderReasons.waitingPolicies?.awaiting_cancel_approval?.slaHours || 24;
    const deadlineIso = addHoursIso(nowIso, slaHours);

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
    emitCrudChange('orders', 'updated', order._id);
    const [enriched] = await enrichOrders([order.toObject()]);
    res.json(enriched);
  } catch (error) {
    console.error('Lỗi gửi yêu cầu hủy đơn:', error);
    res.status(500).json({ message: 'Không thể gửi yêu cầu hủy đơn hàng.' });
  }
};

exports.requestReturnOrder = async (req, res) => {
  const { reasonId, note, evidence } = req.body || {};
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

    order.statusId = 'return_requested';
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

    await order.save();
    emitCrudChange('orders', 'updated', order._id);
    const [enriched] = await enrichOrders([order.toObject()]);
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

exports.updateOrder = async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ message: 'Dữ liệu đơn hàng không hợp lệ.' });
    return;
  }

  const updates = { ...req.body };
  delete updates._id;
  delete updates.id;
  delete updates.createdAt;
  delete updates.updatedAt;
  delete updates.__v;

  try {
    const filter = mongoose.isValidObjectId(req.params.id)
      ? { _id: req.params.id }
      : { id: req.params.id };
    const order = await Order.findOneAndUpdate(filter, updates, {
      new: true,
      runValidators: true
    });
    if (!order) {
      res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
      return;
    }
    emitCrudChange('orders', 'updated', order._id);
    const [enriched] = await enrichOrders([order.toObject()]);
    res.json(enriched);
  } catch (error) {
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
    const order = await Order.findOneAndDelete(filter);
    if (!order) {
      res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
      return;
    }
    emitCrudChange('orders', 'deleted', order._id);
    res.json({ message: 'Đã xóa đơn hàng.' });
  } catch (error) {
    console.error('Lỗi xóa đơn hàng:', error);
    res.status(500).json({ message: 'Không thể xóa đơn hàng.' });
  }
};
