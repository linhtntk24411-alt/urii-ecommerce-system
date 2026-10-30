const Product = require('../models/Product');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
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

exports.getProductById = async (req, res) => {
  try {
    const product = mongoose.isValidObjectId(req.params.id)
      ? await Product.findById(req.params.id).lean()
      : await Product.findOne({ id: req.params.id }).lean();
    if (!product) {
      res.status(404).json({ message: 'Không tìm thấy sản phẩm.' });
      return;
    }
    res.json(product);
  } catch (error) {
    console.error('Lỗi tải sản phẩm:', error);
    res.status(500).json({ message: 'Không thể tải sản phẩm.' });
  }
};

exports.createProduct = async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ message: 'Dữ liệu sản phẩm không hợp lệ.' });
    return;
  }

  try {
    const newProduct = new Product({
      ...req.body,
      id: req.body.id || `product-${randomUUID()}`
    });
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

exports.updateProduct = async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ message: 'Dữ liệu sản phẩm không hợp lệ.' });
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
    const product = await Product.findOneAndUpdate(filter, updates, {
      new: true,
      runValidators: true
    });
    if (!product) {
      res.status(404).json({ message: 'Không tìm thấy sản phẩm.' });
      return;
    }
    res.json(product);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu sản phẩm không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã sản phẩm hoặc slug đã tồn tại.' });
      return;
    }
    console.error('Lỗi cập nhật sản phẩm:', error);
    res.status(500).json({ message: 'Không thể cập nhật sản phẩm.' });
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