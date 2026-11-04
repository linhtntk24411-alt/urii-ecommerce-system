const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Review = require('../models/Review');
const User = require('../models/User');
const { isValidImageUrl } = require('../utils/imageUrl');
const { getPagination } = require('../utils/pagination');

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

function sendReviewError(res, error) {
  if (error.name === 'ValidationError') {
    res.status(400).json({ message: 'Nội dung đánh giá không hợp lệ.' });
    return;
  }
  if (error.code === 11000) {
    res.status(409).json({ message: 'Bạn đã đánh giá sản phẩm này trong đơn hàng.' });
    return;
  }
  console.error('Lỗi xử lý đánh giá:', error);
  res.status(500).json({ message: 'Không thể xử lý đánh giá.' });
}

exports.getProductReviews = async (req, res) => {
  try {
    const product = await Product.findOne({ id: req.params.productId }).select('id name').lean();
    if (!product) {
      res.status(404).json({ message: 'Không tìm thấy sản phẩm.' });
      return;
    }
    const { skip, limit } = getPagination(req.query);
    const [reviews, total, aggregate] = await Promise.all([
      Review.find({ productId: product.id }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Review.countDocuments({ productId: product.id }),
      Review.aggregate([
        { $match: { productId: product.id } },
        { $group: { _id: '$rating', count: { $sum: 1 } } }
      ])
    ]);
    const userIds = [...new Set(reviews.map((review) => String(review.userId)))];
    const users = await User.find({ _id: { $in: userIds } }).select('name').lean();
    const userNames = new Map(users.map((user) => [String(user._id), user.name]));
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let ratingTotal = 0;
    aggregate.forEach(({ _id, count }) => {
      distribution[_id] = count;
      ratingTotal += _id * count;
    });
    res.json({
      productId: product.id,
      productName: product.name,
      total,
      averageRating: total ? Number((ratingTotal / total).toFixed(2)) : 0,
      distribution,
      reviews: reviews.map((review) => ({
        ...review,
        userName: userNames.get(String(review.userId)) || 'Khách hàng'
      }))
    });
  } catch (error) {
    console.error('Lỗi tải đánh giá sản phẩm:', error);
    res.status(500).json({ message: 'Không thể tải đánh giá sản phẩm.' });
  }
};

exports.getMyReviews = async (req, res) => {
  try {
    const userId = await getCustomerId(req, res);
    if (!userId) return;
    const { skip, limit } = getPagination(req.query);
    const reviews = await Review.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
    const productIds = [...new Set(reviews.map((review) => review.productId))];
    const products = await Product.find({ id: { $in: productIds } }).select('id name image').lean();
    const productsById = new Map(products.map((product) => [product.id, product]));
    res.json(reviews.map((review) => ({
      ...review,
      product: productsById.get(review.productId) || null
    })));
  } catch (error) {
    sendReviewError(res, error);
  }
};

exports.getEligibleOrders = async (req, res) => {
  try {
    const userId = await getCustomerId(req, res);
    if (!userId) return;
    const orders = await Order.find({
      userId,
      $or: [{ statusId: 'completed' }, { statusType: 'completed' }]
    }).sort({ createdAt: -1 }).lean();
    const reviews = await Review.find({ userId }).select('orderId productId').lean();
    const reviewed = new Set(reviews.map((review) => `${review.orderId}:${review.productId}`));
    const productIds = [...new Set(orders.flatMap((order) => (
      (order.items || []).map((item) => item.productId)
    )))];
    const products = await Product.find({ id: { $in: productIds } }).select('id name image').lean();
    const productsById = new Map(products.map((product) => [product.id, product]));
    res.json(orders.map((order) => ({
      id: order.id,
      date: order.date,
      deliveredAt: order.deliveredAt || null,
      items: (order.items || []).map((item) => ({
        productId: item.productId,
        product: productsById.get(item.productId) || null,
        variantIndex: item.variantIndex ?? null,
        variantName: item.variantName || 'Mặc định',
        reviewed: reviewed.has(`${order.id}:${item.productId}`)
      }))
    })));
  } catch (error) {
    sendReviewError(res, error);
  }
};

exports.createReview = async (req, res) => {
  const { orderId, productId, rating, content = '', media = [] } = req.body || {};
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
    || Object.keys(req.body).some((key) => !['orderId', 'productId', 'rating', 'content', 'media'].includes(key))
    || typeof orderId !== 'string' || typeof productId !== 'string'
    || !Number.isInteger(rating) || rating < 1 || rating > 5
    || typeof content !== 'string' || content.trim().length > 1000
    || !Array.isArray(media) || media.length > 5
    || media.some((item) => !item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).some((key) => !['type', 'url'].includes(key))
      || !['image', 'video'].includes(item.type)
      || !isValidImageUrl(item.url))) {
    res.status(400).json({ message: 'Thông tin đánh giá không hợp lệ.' });
    return;
  }

  try {
    const userId = await getCustomerId(req, res);
    if (!userId) return;
    const order = await Order.findOne({ id: orderId, userId }).lean();
    if (!order) {
      res.status(404).json({ message: 'Không tìm thấy đơn hàng của khách hàng.' });
      return;
    }
    if ((order.statusId || order.statusType) !== 'completed') {
      res.status(409).json({ message: 'Chỉ có thể đánh giá sản phẩm từ đơn hàng đã giao thành công.' });
      return;
    }
    const orderItem = (order.items || []).find((item) => item.productId === productId);
    if (!orderItem) {
      res.status(400).json({ message: 'Sản phẩm không thuộc đơn hàng này.' });
      return;
    }
    const product = await Product.findOne({ id: productId }).lean();
    if (!product) {
      res.status(404).json({ message: 'Không tìm thấy sản phẩm.' });
      return;
    }
    const variantIndex = orderItem.variantIndex ?? (product.variants?.length ? 0 : null);
    const variantName = orderItem.variantName
      || product.variants?.[variantIndex]?.name
      || 'Mặc định';
    const review = await Review.create({
      id: `review-${randomUUID()}`,
      orderId,
      userId,
      productId,
      rating,
      variantIndex,
      variantName,
      content: content.trim(),
      media
    });
    res.status(201).json(review);
  } catch (error) {
    sendReviewError(res, error);
  }
};
