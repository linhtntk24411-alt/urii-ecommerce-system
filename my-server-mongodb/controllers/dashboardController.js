const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const Voucher = require('../models/Voucher');

exports.getDashboardStats = async (req, res) => {
  try {
    const [products, orders, users, promotions, activePromotions, pendingOrders] = await Promise.all([
      Product.countDocuments(),
      Order.countDocuments(),
      User.countDocuments(),
      Voucher.countDocuments(),
      Voucher.countDocuments({ isActive: true }),
      Order.countDocuments({ statusType: 'pending' })
    ]);
    res.json({ products, orders, users, promotions, activePromotions, pendingOrders });
  } catch (error) {
    console.error('Lỗi tải thống kê dashboard:', error);
    res.status(500).json({ message: 'Không thể tải thống kê tổng quan.' });
  }
};
