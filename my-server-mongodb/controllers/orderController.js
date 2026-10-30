const Order = require('../models/Order');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const { getPagination } = require('../utils/pagination');

exports.getAllOrders = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    res.json(await Order.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean());
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
    res.json(order);
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
    res.status(201).json(order);
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
    res.json(order);
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
    res.json({ message: 'Đã xóa đơn hàng.' });
  } catch (error) {
    console.error('Lỗi xóa đơn hàng:', error);
    res.status(500).json({ message: 'Không thể xóa đơn hàng.' });
  }
};