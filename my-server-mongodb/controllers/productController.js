const Product = require('../models/Product');
const mongoose = require('mongoose');
const { getPagination } = require('../utils/pagination');

exports.getAllProducts = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    const products = await Product.find().sort({ name: 1 }).skip(skip).limit(limit).lean();
    res.json(products);
  } catch (error) {
    console.error('Lỗi tải sản phẩm:', error);
    res.status(500).json({ message: 'Không thể tải danh sách sản phẩm.' });
  }
};

exports.createProduct = async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ message: 'Dữ liệu sản phẩm không hợp lệ.' });
    return;
  }

  try {
    const newProduct = new Product(req.body);
    await newProduct.save();
    res.status(201).json(newProduct);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu sản phẩm không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã sản phẩm hoặc slug đã tồn tại.' });
      return;
    }
    console.error('Lỗi tạo sản phẩm:', error);
    res.status(500).json({ message: 'Không thể tạo sản phẩm.' });
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    const product = mongoose.isValidObjectId(req.params.id)
      ? await Product.findByIdAndDelete(req.params.id)
      : await Product.findOneAndDelete({ id: req.params.id });
    if (!product) {
      res.status(404).json({ message: 'Không tìm thấy sản phẩm.' });
      return;
    }
    res.json({ message: 'Đã xóa sản phẩm' });
  } catch (error) {
    console.error('Lỗi xóa sản phẩm:', error);
    res.status(500).json({ message: 'Không thể xóa sản phẩm.' });
  }
};