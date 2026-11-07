const Product = require('../models/Product');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const { getPagination } = require('../utils/pagination');
const { emitCrudChange } = require('../realtime');

function productFilter(value) {
  const filters = [{ id: value }, { slug: value }];
  if (mongoose.isValidObjectId(value)) {
    filters.push({ _id: value });
  }
  return { $or: filters };
}

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
    const product = await Product.findOne(productFilter(req.params.id)).lean();
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
    emitCrudChange('products', 'created', newProduct._id);
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
    const filter = productFilter(req.params.id);
    const product = await Product.findOneAndUpdate(filter, updates, {
      new: true,
      runValidators: true
    });
    if (!product) {
      res.status(404).json({ message: 'Không tìm thấy sản phẩm.' });
      return;
    }
    emitCrudChange('products', 'updated', product._id);
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
    const product = await Product.findOneAndDelete(productFilter(req.params.id));
    if (!product) {
      res.status(404).json({ message: 'Không tìm thấy sản phẩm.' });
      return;
    }
    emitCrudChange('products', 'deleted', product._id);
    res.json({ message: 'Đã xóa sản phẩm' });
  } catch (error) {
    console.error('Lỗi xóa sản phẩm:', error);
    res.status(500).json({ message: 'Không thể xóa sản phẩm.' });
  }
};

// Cập nhật số lượng tồn kho của sản phẩm hoặc biến thể
exports.updateStock = async (req, res) => {
  try {
    const { stock, delta, variantName } = req.body;
    const filter = productFilter(req.params.id);

    const product = await Product.findOne(filter);
    if (!product) {
      return res.status(404).json({ message: 'Không tìm thấy sản phẩm.' });
    }

    if (variantName && Array.isArray(product.variants) && product.variants.length > 0) {
      const variant = product.variants.find((v) => v.name === variantName);
      if (!variant) {
        return res.status(404).json({ message: `Không tìm thấy biến thể '${variantName}'.` });
      }

      if (typeof stock === 'number') {
        variant.stock = Math.max(0, stock);
      } else if (typeof delta === 'number') {
        variant.stock = Math.max(0, (variant.stock || 0) + delta);
      }

      // Tự động tính lại tổng tồn kho của sản phẩm từ tất cả biến thể
      product.stock = product.variants.reduce((sum, v) => sum + (v.stock || 0), 0);
    } else {
      if (typeof stock === 'number') {
        product.stock = Math.max(0, stock);
      } else if (typeof delta === 'number') {
        product.stock = Math.max(0, (product.stock || 0) + delta);
      }
    }

    await product.save();
    emitCrudChange('products', 'updated', product._id);

    res.json({
      success: true,
      message: 'Cập nhật số lượng tồn kho thành công.',
      productId: product.id,
      stock: product.stock,
      variants: product.variants
    });
  } catch (error) {
    console.error('Lỗi cập nhật tồn kho:', error);
    res.status(500).json({ message: 'Không thể cập nhật tồn kho.' });
  }
};
