const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const User = require('../models/User');
const { buildCartResponse, getProductPrice, normalizeCartItem } = require('../utils/commerceFixtures');

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

async function getOrCreateCart(userId) {
  return Cart.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId, items: [] } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

function isValidBody(body, allowedKeys) {
  return body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).every((key) => allowedKeys.includes(key));
}

function sendCartError(res, error) {
  if (error instanceof RangeError || error instanceof TypeError) {
    res.status(400).json({ message: error.message });
    return;
  }
  if (error.name === 'VersionError') {
    res.status(409).json({ message: 'Giỏ hàng vừa được cập nhật ở nơi khác. Vui lòng tải lại.' });
    return;
  }
  console.error('Lỗi xử lý giỏ hàng:', error);
  res.status(500).json({ message: 'Không thể cập nhật giỏ hàng.' });
}

exports.getCart = async (req, res) => {
  try {
    const userId = await getCustomerId(req, res);
    if (!userId) return;
    const cart = await Cart.findOne({ userId }).lean() || { userId, items: [] };
    const products = cart.items.length
      ? await Product.find({ id: { $in: cart.items.map((item) => item.productId) } }).lean()
      : [];
    res.json(buildCartResponse(cart, products));
  } catch (error) {
    sendCartError(res, error);
  }
};

exports.addItem = async (req, res) => {
  if (!isValidBody(req.body, ['productId', 'variantIndex', 'quantity', 'selected'])
    || typeof req.body.productId !== 'string'
    || !Number.isInteger(req.body.quantity)
    || req.body.quantity < 1
    || (req.body.variantIndex !== undefined && req.body.variantIndex !== null
      && !Number.isInteger(req.body.variantIndex))
    || (req.body.selected !== undefined && typeof req.body.selected !== 'boolean')) {
    res.status(400).json({ message: 'Thông tin sản phẩm trong giỏ hàng không hợp lệ.' });
    return;
  }

  try {
    const userId = await getCustomerId(req, res);
    if (!userId) return;
    const product = await Product.findOne({ id: req.body.productId }).lean();
    if (!product) {
      res.status(404).json({ message: 'Không tìm thấy sản phẩm.' });
      return;
    }

    const normalized = normalizeCartItem({
      ...req.body,
      itemId: randomUUID(),
      selected: req.body.selected ?? true
    }, product);
    const cart = await getOrCreateCart(userId);
    const existing = cart.items.find((item) => (
      item.productId === normalized.productId
      && item.variantIndex === normalized.variantIndex
    ));
    if (existing) {
      const newQuantity = existing.quantity + normalized.quantity;
      if (newQuantity > getProductPrice(product, normalized.variantIndex).stock) {
        throw new RangeError(`Sản phẩm "${product.name}" không đủ tồn kho cho số lượng yêu cầu.`);
      }
      existing.quantity = newQuantity;
      existing.selected = normalized.selected;
    } else {
      cart.items.push(normalized);
    }
    await cart.save();
    const products = await Product.find({ id: { $in: cart.items.map((item) => item.productId) } }).lean();
    res.status(existing ? 200 : 201).json(buildCartResponse(cart, products));
  } catch (error) {
    sendCartError(res, error);
  }
};

exports.updateItem = async (req, res) => {
  if (!isValidBody(req.body, ['quantity', 'selected'])
    || Object.keys(req.body).length === 0
    || (req.body.quantity !== undefined && !Number.isInteger(req.body.quantity))
    || (req.body.selected !== undefined && typeof req.body.selected !== 'boolean')) {
    res.status(400).json({ message: 'Thông tin cập nhật giỏ hàng không hợp lệ.' });
    return;
  }

  try {
    const userId = await getCustomerId(req, res);
    if (!userId) return;
    const cart = await Cart.findOne({ userId });
    const item = cart?.items.find((entry) => entry.itemId === req.params.itemId);
    if (!item) {
      res.status(404).json({ message: 'Không tìm thấy sản phẩm trong giỏ hàng.' });
      return;
    }
    const product = await Product.findOne({ id: item.productId }).lean();
    if (!product) {
      res.status(409).json({ message: 'Sản phẩm trong giỏ hàng hiện không còn tồn tại.' });
      return;
    }
    if (req.body.quantity !== undefined) {
      normalizeCartItem({ ...item.toObject(), quantity: req.body.quantity }, product);
      item.quantity = req.body.quantity;
    }
    if (req.body.selected !== undefined) item.selected = req.body.selected;
    await cart.save();
    const products = await Product.find({ id: { $in: cart.items.map((entry) => entry.productId) } }).lean();
    res.json(buildCartResponse(cart, products));
  } catch (error) {
    sendCartError(res, error);
  }
};

exports.removeItem = async (req, res) => {
  try {
    const userId = await getCustomerId(req, res);
    if (!userId) return;
    const cart = await Cart.findOne({ userId });
    if (!cart || !cart.items.some((item) => item.itemId === req.params.itemId)) {
      res.status(404).json({ message: 'Không tìm thấy sản phẩm trong giỏ hàng.' });
      return;
    }
    cart.items = cart.items.filter((item) => item.itemId !== req.params.itemId);
    await cart.save();
    const products = await Product.find({ id: { $in: cart.items.map((item) => item.productId) } }).lean();
    res.json(buildCartResponse(cart, products));
  } catch (error) {
    sendCartError(res, error);
  }
};

exports.clearCart = async (req, res) => {
  try {
    const userId = await getCustomerId(req, res);
    if (!userId) return;
    const cart = await getOrCreateCart(userId);
    cart.items = [];
    await cart.save();
    res.json(buildCartResponse(cart, []));
  } catch (error) {
    sendCartError(res, error);
  }
};
