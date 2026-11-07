const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Review = require('../models/Review');
const User = require('../models/User');
const { isValidImageUrl } = require('../utils/imageUrl');
const { getPagination } = require('../utils/pagination');
const { syncProductRating } = require('../utils/commerceFixtures');
const { emitCrudChange } = require('../realtime');

function buildProductLookupFilter(value) {
  const normalized = String(value || '').trim();
  const filters = [{ id: normalized }, { slug: normalized }];
  if (mongoose.isValidObjectId(normalized)) {
    filters.push({ _id: normalized });
  }
  return { $or: filters };
}

function reviewFilter(value) {
  const normalized = String(value || '').trim();
  const filters = [{ id: normalized }];
  if (mongoose.isValidObjectId(normalized)) {
    filters.push({ _id: normalized });
  }
  return { $or: filters };
}

function enrichReview(review, usersById) {
  const user = usersById.get(String(review.userId));
  const replies = (review.replies || []).map((reply) => {
    const replyUser = reply.userId ? usersById.get(String(reply.userId)) : null;
    return {
      ...reply,
      author: reply.author || (reply.role === 'admin' ? 'Urii Store' : (replyUser?.name || 'Khách hàng')),
      avatar: reply.avatar || (reply.role === 'admin' ? 'images/Urii-Logo.png' : (replyUser?.avatar || 'images/avatar-non.jpg'))
    };
  });
  return {
    ...review,
    userName: user?.name || 'Khách hàng',
    userAvatar: user?.avatar || '/images/avatar-non.jpg',
    replies
  };
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

exports.getAllReviews = async (req, res) => {
  if (req.query.productId) {
    req.params.productId = String(req.query.productId);
    return exports.getProductReviews(req, res);
  }

  try {
    const { skip, limit } = getPagination(req.query);
    const reviews = await Review.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
    const userIds = [
      ...new Set(
        reviews
          .flatMap((review) => [review.userId, ...(review.replies || []).map((r) => r.userId)])
          .filter((id) => mongoose.isValidObjectId(id))
          .map(String)
      )
    ];
    const users = userIds.length > 0
      ? await User.find({ _id: { $in: userIds } }).select('name avatar role').lean()
      : [];
    const usersById = new Map(users.map((user) => [String(user._id), user]));

    res.json(reviews.map((review) => enrichReview(review, usersById)));
  } catch (error) {
    console.error('Lỗi tải danh sách đánh giá:', error);
    res.status(500).json({ message: 'Không thể tải danh sách đánh giá.' });
  }
};

exports.getProductReviews = async (req, res) => {
  try {
    const rawProductId = String(req.params.productId || req.params.id || req.query.productId || '').trim();
    if (!rawProductId) {
      res.status(400).json({ message: 'Thiếu mã sản phẩm.' });
      return;
    }

    const product = await Product.findOne(buildProductLookupFilter(rawProductId))
      .select('id name slug rating reviewCount')
      .lean();
    const resolvedProductId = product?.id || rawProductId;

    const { skip, limit } = getPagination(req.query);
    const [reviews, total, aggregate] = await Promise.all([
      Review.find({ productId: resolvedProductId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Review.countDocuments({ productId: resolvedProductId }),
      Review.aggregate([
        { $match: { productId: resolvedProductId } },
        { $group: { _id: '$rating', count: { $sum: 1 } } }
      ])
    ]);

    const userIds = [
      ...new Set(
        reviews
          .flatMap((review) => [review.userId, ...(review.replies || []).map((r) => r.userId)])
          .filter((id) => mongoose.isValidObjectId(id))
          .map(String)
      )
    ];
    const users = userIds.length > 0
      ? await User.find({ _id: { $in: userIds } }).select('name avatar role').lean()
      : [];
    const usersById = new Map(users.map((user) => [String(user._id), user]));
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let ratingTotal = 0;
    aggregate.forEach(({ _id, count }) => {
      if (distribution[_id] !== undefined) {
        distribution[_id] = count;
      }
      ratingTotal += _id * count;
    });

    res.json({
      productId: resolvedProductId,
      productName: product?.name || null,
      total,
      averageRating: total ? Number((ratingTotal / total).toFixed(2)) : (product?.rating || 0),
      distribution,
      reviews: reviews.map((review) => enrichReview(review, usersById))
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
    console.error('Lỗi tải đánh giá của tôi:', error);
    res.status(500).json({ message: 'Không thể tải đánh giá của bạn.' });
  }
};

exports.getEligibleOrders = async (req, res) => {
  try {
    const userId = await getCustomerId(req, res);
    if (!userId) return;

    const [orders, existingReviews] = await Promise.all([
      Order.find({ userId, statusId: 'completed' })
        .sort({ deliveredAt: -1, createdAt: -1 })
        .lean(),
      Review.find({ userId }).select('orderId productId').lean()
    ]);

    const reviewedKeys = new Set(
      existingReviews.map((review) => `${review.orderId}:${review.productId}`)
    );

    const eligibleOrders = orders
      .map((order) => {
        const unreviewedItems = (order.items || []).filter(
          (item) => !reviewedKeys.has(`${order.id}:${item.productId}`)
        );
        return {
          ...order,
          items: unreviewedItems
        };
      })
      .filter((order) => order.items.length > 0);

    res.json(eligibleOrders);
  } catch (error) {
    console.error('Lỗi tải đơn hàng chờ đánh giá:', error);
    res.status(500).json({ message: 'Không thể tải đơn hàng chờ đánh giá.' });
  }
};

exports.createReview = async (req, res) => {
  try {
    const userId = await getCustomerId(req, res);
    if (!userId) return;

    const { orderId, productId, rating, content = '', media = [] } = req.body;
    if (!orderId || !productId || !rating) {
      res.status(400).json({ message: 'Thiếu thông tin đơn hàng, sản phẩm hoặc số sao đánh giá.' });
      return;
    }

    const order = await Order.findOne({ id: orderId, userId, statusId: 'completed' }).lean();
    if (!order) {
      res.status(400).json({ message: 'Chỉ có thể đánh giá các sản phẩm trong đơn hàng đã giao thành công.' });
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
      media,
      replies: []
    });
    const ratingStats = await syncProductRating(productId, {
      ReviewModel: Review,
      ProductModel: Product
    });
    emitCrudChange('products', 'updated', product._id || product.id);
    res.status(201).json({
      ...(typeof review.toObject === 'function' ? review.toObject() : review),
      productRating: ratingStats.rating,
      productReviewCount: ratingStats.reviewCount
    });
  } catch (error) {
    sendReviewError(res, error);
  }
};

exports.createReviewReply = async (req, res) => {
  if (!req.body || typeof req.body.content !== 'string' || !req.body.content.trim()) {
    res.status(400).json({ message: 'Nội dung phản hồi không hợp lệ.' });
    return;
  }
  try {
    const review = await Review.findOne(reviewFilter(req.params.id));
    if (!review) {
      res.status(404).json({ message: 'Không tìm thấy đánh giá.' });
      return;
    }

    const tokenUserId = typeof req.auth?.id === 'string' && mongoose.isValidObjectId(req.auth.id)
      ? req.auth.id
      : undefined;
    const bodyUserId = typeof req.body.userId === 'string' && mongoose.isValidObjectId(req.body.userId)
      ? req.body.userId
      : undefined;
    const resolvedUserId = req.auth?.role === 'admin'
      ? (bodyUserId || tokenUserId)
      : (tokenUserId || bodyUserId);

    let role = req.auth?.role === 'admin' ? 'admin' : 'user';
    let replyType = req.body.replyType;
    if (!replyType) {
      if (role === 'admin') {
        replyType = req.body.isAuto ? 'auto_thank_you' : 'staff_support';
      } else {
        replyType = 'customer_inquiry';
      }
    }

    const replyCount = (review.replies?.length || 0) + 1;
    const replyId = `rr-${review.id}-${replyCount}`;
    const createdAt = req.body.createdAt ? new Date(req.body.createdAt) : new Date();

    const newReply = {
      id: replyId,
      ...(resolvedUserId ? { userId: resolvedUserId } : {}),
      ...(typeof req.body.author === 'string' && req.body.author.trim() ? { author: req.body.author.trim() } : {}),
      content: req.body.content.trim(),
      role,
      replyType,
      createdAt
    };

    review.replies = review.replies || [];
    review.replies.push(newReply);
    await review.save();

    emitCrudChange('reviews', 'updated', review._id);
    res.status(201).json(review);
  } catch (error) {
    console.error('Lỗi phản hồi đánh giá:', error);
    res.status(500).json({ message: 'Không thể phản hồi đánh giá.' });
  }
};
