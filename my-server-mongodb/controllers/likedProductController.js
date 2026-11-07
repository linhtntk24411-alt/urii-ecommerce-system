const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const LikedProduct = require('../models/LikedProduct');
const User = require('../models/User');
const Product = require('../models/Product');
const { getPagination } = require('../utils/pagination');
const { emitCrudChange } = require('../realtime');

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function likedProductFilter(value) {
  const filters = [{ id: value }];
  if (mongoose.isValidObjectId(value)) {
    filters.push({ _id: value });
  }
  return { $or: filters };
}

async function getCustomerId(req, res) {
  const id = req.auth?.id;
  if (!mongoose.isValidObjectId(id)) {
    res.status(401).json({ message: 'Phiên đăng nhập khách hàng không hợp lệ.' });
    return null;
  }
  const userExists = await User.exists({ _id: id, role: 'user' });
  if (!userExists) {
    res.status(401).json({ message: 'Tài khoản khách hàng không còn tồn tại.' });
    return null;
  }
  return id;
}

async function referencesExistingCustomerAndProduct(userId, productId) {
  if (!mongoose.isValidObjectId(userId)
    || !await User.exists({ _id: userId, role: 'user' })
    || typeof productId !== 'string'
    || !await Product.exists({ id: productId })) {
    return false;
  }
  return true;
}

async function enrichLikedProducts(records) {
  const productIds = [...new Set(records.map((item) => item.productId).filter(Boolean))];
  const products = productIds.length
    ? await Product.find({ id: { $in: productIds } })
      .select('id name slug category image isSale originalPrice currentPrice stock variants')
      .lean()
    : [];
  const productsById = new Map(products.map((product) => [product.id, product]));
  return records.map((record) => ({
    ...record,
    product: productsById.get(record.productId) || null
  }));
}

exports.getAllLikedProducts = async (req, res) => {
  try {
    const { skip, limit } = getPagination(req.query);
    const items = await LikedProduct.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
    res.json(await enrichLikedProducts(items));
  } catch (error) {
    console.error('Lỗi tải sản phẩm đã thích:', error);
    res.status(500).json({ message: 'Không thể tải danh sách sản phẩm đã thích.' });
  }
};

exports.getLikedProductById = async (req, res) => {
  try {
    const item = await LikedProduct.findOne(likedProductFilter(req.params.id)).lean();
    if (!item) {
      res.status(404).json({ message: 'Không tìm thấy sản phẩm đã thích.' });
      return;
    }
    const [enriched] = await enrichLikedProducts([item]);
    res.json(enriched);
  } catch (error) {
    console.error('Lỗi tải sản phẩm đã thích:', error);
    res.status(500).json({ message: 'Không thể tải sản phẩm đã thích.' });
  }
};

exports.createLikedProduct = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu sản phẩm đã thích không hợp lệ.' });
    return;
  }

  try {
    if (!await referencesExistingCustomerAndProduct(req.body.userId, req.body.productId)) {
      res.status(400).json({ message: 'Khách hàng hoặc sản phẩm không tồn tại.' });
      return;
    }
    const item = await LikedProduct.create({
      ...req.body,
      id: req.body.id || `liked-${String(req.body.userId)}-${req.body.productId}`
    });
    emitCrudChange('likedProducts', 'created', item.id);
    const [enriched] = await enrichLikedProducts([item.toObject()]);
    res.status(201).json(enriched);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu sản phẩm đã thích không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã bản ghi đã tồn tại hoặc khách hàng đã thích sản phẩm này.' });
      return;
    }
    console.error('Lỗi tạo sản phẩm đã thích:', error);
    res.status(500).json({ message: 'Không thể tạo sản phẩm đã thích.' });
  }
};

exports.updateLikedProduct = async (req, res) => {
  if (!isRecord(req.body)) {
    res.status(400).json({ message: 'Dữ liệu sản phẩm đã thích không hợp lệ.' });
    return;
  }

  const updates = { ...req.body };
  delete updates._id;
  delete updates.id;
  delete updates.createdAt;
  delete updates.updatedAt;
  delete updates.__v;

  try {
    if (Object.hasOwn(updates, 'userId') || Object.hasOwn(updates, 'productId')) {
      const current = await LikedProduct.findOne(likedProductFilter(req.params.id))
        .select('userId productId')
        .lean();
      if (current && !await referencesExistingCustomerAndProduct(
        updates.userId ?? current.userId,
        updates.productId ?? current.productId
      )) {
        res.status(400).json({ message: 'Khách hàng hoặc sản phẩm không tồn tại.' });
        return;
      }
    }
    const item = await LikedProduct.findOneAndUpdate(likedProductFilter(req.params.id), updates, {
      new: true,
      runValidators: true
    });
    if (!item) {
      res.status(404).json({ message: 'Không tìm thấy sản phẩm đã thích.' });
      return;
    }
    emitCrudChange('likedProducts', 'updated', item.id);
    const [enriched] = await enrichLikedProducts([item.toObject()]);
    res.json(enriched);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu sản phẩm đã thích không hợp lệ.' });
      return;
    }
    if (error.code === 11000) {
      res.status(409).json({ message: 'Mã bản ghi đã tồn tại hoặc khách hàng đã thích sản phẩm này.' });
      return;
    }
    console.error('Lỗi cập nhật sản phẩm đã thích:', error);
    res.status(500).json({ message: 'Không thể cập nhật sản phẩm đã thích.' });
  }
};

exports.deleteLikedProduct = async (req, res) => {
  try {
    const item = await LikedProduct.findOneAndDelete(likedProductFilter(req.params.id));
    if (!item) {
      res.status(404).json({ message: 'Không tìm thấy sản phẩm đã thích.' });
      return;
    }
    emitCrudChange('likedProducts', 'deleted', item.id);
    res.json({ message: 'Đã xóa sản phẩm đã thích.' });
  } catch (error) {
    console.error('Lỗi xóa sản phẩm đã thích:', error);
    res.status(500).json({ message: 'Không thể xóa sản phẩm đã thích.' });
  }
};

exports.getMyLikedProducts = async (req, res) => {
  try {
    const userId = await getCustomerId(req, res);
    if (!userId) return;
    const { skip, limit } = getPagination(req.query);
    const items = await LikedProduct.find({ userId, liked: true })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    res.json(await enrichLikedProducts(items));
  } catch (error) {
    console.error('Lỗi tải danh sách sản phẩm yêu thích của khách hàng:', error);
    res.status(500).json({ message: 'Không thể tải danh sách sản phẩm yêu thích.' });
  }
};

exports.addMyLikedProduct = async (req, res) => {
  const { productId } = req.body || {};
  if (!isRecord(req.body)
    || Object.keys(req.body).some((key) => key !== 'productId')
    || typeof productId !== 'string'
    || !productId.trim()) {
    res.status(400).json({ message: 'Mã sản phẩm không hợp lệ.' });
    return;
  }

  try {
    const userId = await getCustomerId(req, res);
    if (!userId) return;
    const product = await Product.findOne({ id: productId.trim() }).select('id').lean();
    if (!product) {
      res.status(404).json({ message: 'Không tìm thấy sản phẩm.' });
      return;
    }
    const item = await LikedProduct.findOneAndUpdate(
      { userId, productId: product.id },
      {
        $set: { liked: true },
        $setOnInsert: {
          id: `liked-${String(userId)}-${product.id}`,
          userId,
          productId: product.id
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    emitCrudChange('likedProducts', 'updated', item.id);
    const [enriched] = await enrichLikedProducts([item.toObject()]);
    res.status(201).json(enriched);
  } catch (error) {
    console.error('Lỗi lưu sản phẩm yêu thích:', error);
    res.status(500).json({ message: 'Không thể lưu sản phẩm yêu thích.' });
  }
};

exports.removeMyLikedProduct = async (req, res) => {
  try {
    const userId = await getCustomerId(req, res);
    if (!userId) return;
    const item = await LikedProduct.findOneAndDelete({
      userId,
      $or: [{ productId: req.params.productId }, { id: req.params.productId }]
    });
    if (!item) {
      res.status(404).json({ message: 'Không tìm thấy sản phẩm yêu thích.' });
      return;
    }
    emitCrudChange('likedProducts', 'deleted', item.id);
    res.json({ message: 'Đã bỏ thích sản phẩm.' });
  } catch (error) {
    console.error('Lỗi bỏ thích sản phẩm:', error);
    res.status(500).json({ message: 'Không thể bỏ thích sản phẩm.' });
  }
};
