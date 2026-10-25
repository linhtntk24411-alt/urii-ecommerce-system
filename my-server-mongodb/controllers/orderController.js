const Order = require('../models/Order');
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