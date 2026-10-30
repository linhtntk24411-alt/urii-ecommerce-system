const User = require('../models/User');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { getPagination } = require('../utils/pagination');

exports.getAllUsers = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    res.json(await User.find()
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean());
  } catch (error) {
    console.error('Lỗi tải người dùng:', error);
    res.status(500).json({ message: 'Không thể tải danh sách người dùng.' });
  }
};

exports.getUserById = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ message: 'Không tìm thấy người dùng.' });
    return;
  }
  try {
    const user = await User.findById(req.params.id).select('-password').lean();
    if (!user) {
      res.status(404).json({ message: 'Không tìm thấy người dùng.' });
      return;
    }
    res.json(user);
  } catch (error) {
    console.error('Lỗi tải người dùng:', error);
    res.status(500).json({ message: 'Không thể tải người dùng.' });
  }
};

exports.createUser = async (req, res) => {
  const { name, email, password } = req.body || {};
  if (typeof name !== 'string' || !name.trim()
    || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    || typeof password !== 'string' || password.length < 8
    || Buffer.byteLength(password, 'utf8') > 72) {
    res.status(400).json({ message: 'Tên, email hợp lệ và mật khẩu từ 8 ký tự (tối đa 72 byte) là bắt buộc.' });
    return;
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await User.create({
      ...req.body,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: hashedPassword
    });
    const safeUser = user.toObject();
    delete safeUser.password;
    res.status(201).json(safeUser);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu người dùng không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Email đã tồn tại.' });
      return;
    }
    console.error('Lỗi tạo người dùng:', error);
    res.status(500).json({ message: 'Không thể tạo người dùng.' });
  }
};

exports.updateUser = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ message: 'Không tìm thấy người dùng.' });
    return;
  }
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ message: 'Dữ liệu người dùng không hợp lệ.' });
    return;
  }

  const updates = { ...req.body };
  delete updates._id;
  delete updates.createdAt;
  delete updates.updatedAt;
  delete updates.__v;
  if (updates.email !== undefined) {
    if (typeof updates.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email.trim())) {
      res.status(400).json({ message: 'Email không hợp lệ.' });
      return;
    }
    updates.email = updates.email.trim().toLowerCase();
  }
  if (updates.password !== undefined) {
    if (typeof updates.password !== 'string' || updates.password.length < 8
      || Buffer.byteLength(updates.password, 'utf8') > 72) {
      res.status(400).json({ message: 'Mật khẩu phải có ít nhất 8 ký tự và không vượt quá 72 byte.' });
      return;
    }
    try {
      updates.password = await bcrypt.hash(updates.password, 12);
    } catch (error) {
      console.error('Lỗi mã hóa mật khẩu:', error);
      res.status(500).json({ message: 'Không thể cập nhật mật khẩu.' });
      return;
    }
  }

  try {
    const user = await User.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true
    }).select('-password');
    if (!user) {
      res.status(404).json({ message: 'Không tìm thấy người dùng.' });
      return;
    }
    res.json(user);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu người dùng không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Email đã tồn tại.' });
      return;
    }
    console.error('Lỗi cập nhật người dùng:', error);
    res.status(500).json({ message: 'Không thể cập nhật người dùng.' });
  }
};

exports.deleteUser = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ message: 'Không tìm thấy người dùng.' });
    return;
  }
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      res.status(404).json({ message: 'Không tìm thấy người dùng.' });
      return;
    }
    res.json({ message: 'Đã xóa người dùng.' });
  } catch (error) {
    console.error('Lỗi xóa người dùng:', error);
    res.status(500).json({ message: 'Không thể xóa người dùng.' });
  }
};