const Category = require('../models/Category');
const { randomUUID } = require('node:crypto');
const { getPagination } = require('../utils/pagination');
const { emitCrudChange } = require('../realtime');

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function categoryFilter(id) {
  return { $or: [{ _id: id }, { slug: id }] };
}

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

exports.getCategoryById = async (req, res) => {
  try {
    const category = await Category.findOne(categoryFilter(req.params.id)).lean();
    if (!category) {
      res.status(404).json({ message: 'Không tìm thấy danh mục.' });
      return;
    }
    res.json(category);
  } catch (error) {
    console.error('Lỗi tải danh mục:', error);
    res.status(500).json({ message: 'Không thể tải danh mục.' });
  }
};

exports.createCategory = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu danh mục không hợp lệ.' });
    return;
  }

  try {
    const category = await Category.create({
      ...req.body,
      _id: req.body._id || `category-${randomUUID()}`
    });
    emitCrudChange('categories', 'created', category._id);
    res.status(201).json(category);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu danh mục không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã hoặc slug danh mục đã tồn tại.' });
      return;
    }
    console.error('Lỗi tạo danh mục:', error);
    res.status(500).json({ message: 'Không thể tạo danh mục.' });
  }
};

exports.updateCategory = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu danh mục không hợp lệ.' });
    return;
  }

  const updates = { ...req.body };
  delete updates._id;

  try {
    const category = await Category.findOneAndUpdate(categoryFilter(req.params.id), updates, {
      new: true,
      runValidators: true
    });
    if (!category) {
      res.status(404).json({ message: 'Không tìm thấy danh mục.' });
      return;
    }
    emitCrudChange('categories', 'updated', category._id);
    res.json(category);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu danh mục không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã hoặc slug danh mục đã tồn tại.' });
      return;
    }
    console.error('Lỗi cập nhật danh mục:', error);
    res.status(500).json({ message: 'Không thể cập nhật danh mục.' });
  }
};

exports.deleteCategory = async (req, res) => {
  try {
    const category = await Category.findOneAndDelete(categoryFilter(req.params.id));
    if (!category) {
      res.status(404).json({ message: 'Không tìm thấy danh mục.' });
      return;
    }
    emitCrudChange('categories', 'deleted', category._id);
    res.json({ message: 'Đã xóa danh mục.' });
  } catch (error) {
    console.error('Lỗi xóa danh mục:', error);
    res.status(500).json({ message: 'Không thể xóa danh mục.' });
  }
};