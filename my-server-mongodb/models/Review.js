const mongoose = require('mongoose');
const { isValidImageUrl } = require('../utils/imageUrl');

const reviewMediaSchema = new mongoose.Schema({
  type: { type: String, enum: ['image', 'video'], required: true },
  url: {
    type: String,
    required: true,
    trim: true,
    validate: { validator: isValidImageUrl, message: 'URL media không hợp lệ.' }
  }
}, { _id: false });

const reviewReplySchema = new mongoose.Schema({
  id: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  author: { type: String, trim: true },
  avatar: String,
  role: { type: String, enum: ['admin', 'user'], default: 'admin' },
  replyType: {
    type: String,
    enum: ['auto_thank_you', 'staff_support', 'customer_inquiry', 'customer_answer'],
    default: 'staff_support'
  },
  content: { type: String, required: true, trim: true, maxlength: 1000 },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const reviewSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  orderId: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  productId: { type: String, required: true },
  rating: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
  variantIndex: {
    type: Number,
    default: null,
    min: 0,
    validate: (value) => value === null || Number.isInteger(value)
  },
  variantName: { type: String, required: true, trim: true },
  content: { type: String, trim: true, maxlength: 1000, default: '' },
  media: {
    type: [reviewMediaSchema],
    default: [],
    validate: {
      validator: (media) => media.length <= 5,
      message: 'Mỗi đánh giá được đính kèm tối đa 5 ảnh hoặc video.'
    }
  },
  replies: {
    type: [reviewReplySchema],
    default: []
  }
}, { timestamps: true });

reviewSchema.index({ orderId: 1, productId: 1 }, { unique: true });
reviewSchema.index({ productId: 1, createdAt: -1 });
reviewSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Review', reviewSchema);
