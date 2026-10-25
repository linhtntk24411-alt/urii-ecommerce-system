const Category = require('../models/Category');
const { getPagination } = require('../utils/pagination');

exports.getAllCategories = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    const categories = await Category.find().sort({ name: 1 }).skip(skip).limit(limit).lean();
    res.json(categories);
  } catch (error) {
    console.error('Lỗi tải danh mục:', error);
    res.status(500).json({ message: 'Không thể tải danh sách danh mục.' });
  }
};