const Voucher = require('../models/Voucher');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const { getPagination } = require('../utils/pagination');

function parseVoucherDate(value, endOfDay = false) {
  if (!value) {
    return null;
  }
  const dayFirst = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!dayFirst && !iso) {
    return null;
  }
  const year = Number(dayFirst?.[3] || iso?.[1]);
  const month = Number(dayFirst?.[2] || iso?.[2]);
  const day = Number(dayFirst?.[1] || iso?.[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  }
  return date;
}

function isVoucherAvailable(voucher, now = new Date()) {
  if (!voucher.isActive) {
    return false;
  }
  const startDate = parseVoucherDate(voucher.startDate);
  const endDate = parseVoucherDate(voucher.endDate, true);
  if ((voucher.startDate && !startDate) || (voucher.endDate && !endDate)) {
    return false;
  }
  return (!startDate || startDate <= now)
    && (!endDate || now <= endDate)
    && (voucher.quantity === undefined || voucher.used < voucher.quantity);
}

exports.getActiveVouchers = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    const vouchers = await Voucher.find({ isActive: true }).sort({ code: 1 }).lean();
    res.json(vouchers.filter((voucher) => isVoucherAvailable(voucher)).slice(skip, skip + limit));
  } catch (error) {
    console.error('Lỗi tải voucher:', error);
    res.status(500).json({ message: 'Không thể tải danh sách voucher.' });
  }
};

exports.getAllVouchers = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    res.json(await Voucher.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean());
  } catch (error) {
    console.error('Lỗi tải chương trình khuyến mãi:', error);
    res.status(500).json({ message: 'Không thể tải danh sách khuyến mãi.' });
  }
};

exports.getVoucherById = async (req, res) => {
  try {
    const voucher = mongoose.isValidObjectId(req.params.id)
      ? await Voucher.findById(req.params.id).lean()
      : await Voucher.findOne({ id: req.params.id }).lean();
    if (!voucher) {
      res.status(404).json({ message: 'Không tìm thấy khuyến mãi.' });
      return;
    }
    res.json(voucher);
  } catch (error) {
    console.error('Lỗi tải khuyến mãi:', error);
    res.status(500).json({ message: 'Không thể tải khuyến mãi.' });
  }
};

exports.createVoucher = async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ message: 'Dữ liệu khuyến mãi không hợp lệ.' });
    return;
  }
  try {
    const code = typeof req.body.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    const voucher = await Voucher.create({
      ...req.body,
      id: req.body.id || `promotion-${randomUUID()}`,
      code
    });
    res.status(201).json(voucher);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu khuyến mãi không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã khuyến mãi đã tồn tại.' });
      return;
    }
    console.error('Lỗi tạo khuyến mãi:', error);
    res.status(500).json({ message: 'Không thể tạo khuyến mãi.' });
  }
};

exports.updateVoucher = async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ message: 'Dữ liệu khuyến mãi không hợp lệ.' });
    return;
  }
  const updates = { ...req.body };
  delete updates._id;
  delete updates.id;
  delete updates.createdAt;
  delete updates.updatedAt;
  delete updates.__v;
  if (typeof updates.code === 'string') {
    updates.code = updates.code.trim().toUpperCase();
  }

  try {
    const filter = mongoose.isValidObjectId(req.params.id)
      ? { _id: req.params.id }
      : { id: req.params.id };
    const voucher = await Voucher.findOneAndUpdate(filter, updates, {
      new: true,
      runValidators: true
    });
    if (!voucher) {
      res.status(404).json({ message: 'Không tìm thấy khuyến mãi.' });
      return;
    }
    res.json(voucher);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu khuyến mãi không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã khuyến mãi đã tồn tại.' });
      return;
    }
    console.error('Lỗi cập nhật khuyến mãi:', error);
    res.status(500).json({ message: 'Không thể cập nhật khuyến mãi.' });
  }
};

exports.deleteVoucher = async (req, res) => {
  try {
    const filter = mongoose.isValidObjectId(req.params.id)
      ? { _id: req.params.id }
      : { id: req.params.id };
    const voucher = await Voucher.findOneAndDelete(filter);
    if (!voucher) {
      res.status(404).json({ message: 'Không tìm thấy khuyến mãi.' });
      return;
    }
    res.json({ message: 'Đã xóa khuyến mãi.' });
  } catch (error) {
    console.error('Lỗi xóa khuyến mãi:', error);
    res.status(500).json({ message: 'Không thể xóa khuyến mãi.' });
  }
};

exports.isVoucherAvailable = isVoucherAvailable;
