const User = require('../models/User');
const { getPagination } = require('../utils/pagination');

exports.getAllUsers = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    res.json(await User.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean());
  } catch (error) {
    console.error('Lỗi tải người dùng:', error);
    res.status(500).json({ message: 'Không thể tải danh sách người dùng.' });
  }
};