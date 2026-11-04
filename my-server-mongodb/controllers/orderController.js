const Order = require('../models/Order');
const User = require('../models/User');
const orderStatuses = require('../data/order_statuses.json');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const { getPagination } = require('../utils/pagination');
const { emitCrudChange } = require('../realtime');

const paymentMethodsById = new Map((orderStatuses.paymentMethods || []).map((m) => [m.id, m]));
const shippingMethodsById = new Map((orderStatuses.shippingMethods || []).map((m) => [m.id, m]));

async function enrichOrders(orders) {
  const userIds = [...new Set(orders.map((o) => o.userId).filter(Boolean).map(String))];
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }).select('name phone address').lean()
    : [];
  const usersById = new Map(users.map((u) => [String(u._id), u]));

  return orders.map((order) => {
    const user = order.userId ? usersById.get(String(order.userId)) : null;
    const pm = order.payment?.methodId ? paymentMethodsById.get(order.payment.methodId) : null;
    const sm = order.shipping?.methodId ? shippingMethodsById.get(order.shipping.methodId) : null;

    return {
      ...order,
      address: order.address?.name ? order.address : (user ? {
        name: user.name,
        phone: user.phone || '',
        address: user.address || ''
      } : order.address),
      payment: order.payment ? {
        ...order.payment,
        method: order.payment.method || pm?.label || ''
      } : order.payment,
      shipping: order.shipping ? {
        ...order.shipping,
        carrier: order.shipping.carrier || sm?.carrier || '',
        method: order.shipping.method || sm?.label || ''
      } : order.shipping
    };
  });
}

exports.getAllOrders = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    const orders = await Order.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
    res.json(await enrichOrders(orders));
  } catch (error) {
    console.error('Lỗi tải đơn hàng:', error);
    res.status(500).json({ message: 'Không thể tải danh sách đơn hàng.' });
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
    const order = await Order.create({
      ...req.body,
      id: req.body.id || `order-${randomUUID()}`
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
