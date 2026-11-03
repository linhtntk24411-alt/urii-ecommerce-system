const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const CustomerOrder = require('../models/CustomerOrder');
const { getPagination } = require('../utils/pagination');
const { isValidImageUrl } = require('../utils/imageUrl');
const { emitCrudChange } = require('../realtime');

const customerFields = [
  'fullName',
  'phone',
  'email',
  'requestName',
  'size',
  'beadType',
  'description',
  'imageNote',
  'imageUrl'
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateCustomerOrder(body, partial = false) {
  if (!isRecord(body)) {
    return 'Dữ liệu yêu cầu đặt hàng không hợp lệ.';
  }

  const requiredFields = ['fullName', 'phone', 'email', 'requestName', 'size', 'beadType', 'imageUrl'];
  for (const field of requiredFields) {
    if ((!partial || Object.hasOwn(body, field))
      && (typeof body[field] !== 'string' || !body[field].trim())) {
      return `Trường ${field} là bắt buộc.`;
    }
  }

  if (body.email !== undefined
    && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
    return 'Email không hợp lệ.';
  }
  if (body.phone !== undefined && !/^\+?[0-9\s()-]{8,20}$/.test(body.phone.trim())) {
    return 'Số điện thoại không hợp lệ.';
  }
  if (body.imageUrl !== undefined && !isValidImageUrl(body.imageUrl)) {
    return 'imageUrl phải là đường dẫn /images/... hoặc URL http/https hợp lệ.';
  }
  if (body.status !== undefined
    && !['pending', 'quoted', 'processing', 'completed', 'cancelled'].includes(body.status)) {
    return 'Trạng thái không hợp lệ.';
  }

  return null;
}

function customerOrderFilter(value) {
  const filters = [{ id: value }];
  if (mongoose.isValidObjectId(value)) {
    filters.push({ _id: value });
  }
  return { $or: filters };
}

exports.createCustomerOrder = async (req, res) => {
  const validationError = validateCustomerOrder(req.body);
  if (validationError) {
    res.status(400).json({ message: validationError });
    return;
  }

  try {
    const customerOrder = await CustomerOrder.create({
      ...req.body,
      id: `customer-order-${randomUUID()}`,
      fullName: req.body.fullName.trim(),
      phone: req.body.phone.trim(),
      email: req.body.email.trim().toLowerCase(),
      requestName: req.body.requestName.trim(),
      size: req.body.size.trim(),
      beadType: req.body.beadType.trim(),
      description: typeof req.body.description === 'string' ? req.body.description.trim() : '',
      imageNote: typeof req.body.imageNote === 'string' ? req.body.imageNote.trim() : '',
      imageUrl: req.body.imageUrl.trim(),
      status: 'pending'
    });
    emitCrudChange('customerOrders', 'created', customerOrder.id);
    res.status(201).json(customerOrder);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu yêu cầu đặt hàng không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã yêu cầu đặt hàng đã tồn tại.' });
      return;
    }
    console.error('Lỗi tạo yêu cầu đặt hàng:', error);
    res.status(500).json({ message: 'Không thể tạo yêu cầu đặt hàng.' });
  }
};

exports.getAllCustomerOrders = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    const customerOrders = await CustomerOrder.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    res.json(customerOrders);
  } catch (error) {
    console.error('Lỗi tải yêu cầu đặt hàng:', error);
    res.status(500).json({ message: 'Không thể tải danh sách yêu cầu đặt hàng.' });
  }
};

exports.getCustomerOrderById = async (req, res) => {
  try {
    const customerOrder = await CustomerOrder.findOne(customerOrderFilter(req.params.id)).lean();
    if (!customerOrder) {
      res.status(404).json({ message: 'Không tìm thấy yêu cầu đặt hàng.' });
      return;
    }
    res.json(customerOrder);
  } catch (error) {
    console.error('Lỗi tải yêu cầu đặt hàng:', error);
    res.status(500).json({ message: 'Không thể tải yêu cầu đặt hàng.' });
  }
};

exports.updateCustomerOrder = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu yêu cầu đặt hàng không hợp lệ.' });
    return;
  }

  const updates = Object.fromEntries(
    [...customerFields, 'status']
      .filter((field) => Object.hasOwn(req.body, field))
      .map((field) => [field, req.body[field]])
  );
  const validationError = validateCustomerOrder(updates, true);
  if (validationError) {
    res.status(400).json({ message: validationError });
    return;
  }
  if (typeof updates.email === 'string') {
    updates.email = updates.email.trim().toLowerCase();
  }

  try {
    const customerOrder = await CustomerOrder.findOneAndUpdate(
      customerOrderFilter(req.params.id),
      updates,
      { new: true, runValidators: true }
    );
    if (!customerOrder) {
      res.status(404).json({ message: 'Không tìm thấy yêu cầu đặt hàng.' });
      return;
    }
    emitCrudChange('customerOrders', 'updated', customerOrder.id);
    res.json(customerOrder);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu yêu cầu đặt hàng không hợp lệ.' });
      return;
    }
    console.error('Lỗi cập nhật yêu cầu đặt hàng:', error);
    res.status(500).json({ message: 'Không thể cập nhật yêu cầu đặt hàng.' });
  }
};

exports.deleteCustomerOrder = async (req, res) => {
  try {
    const customerOrder = await CustomerOrder.findOneAndDelete(customerOrderFilter(req.params.id));
    if (!customerOrder) {
      res.status(404).json({ message: 'Không tìm thấy yêu cầu đặt hàng.' });
      return;
    }
    emitCrudChange('customerOrders', 'deleted', customerOrder.id);
    res.json({ message: 'Đã xóa yêu cầu đặt hàng.' });
  } catch (error) {
    console.error('Lỗi xóa yêu cầu đặt hàng:', error);
    res.status(500).json({ message: 'Không thể xóa yêu cầu đặt hàng.' });
  }
};
