const mongoose = require('mongoose');

const likedProductSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  productId: { type: String, required: true, trim: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  liked: { type: Boolean, default: true }
}, { timestamps: true });

likedProductSchema.index(
  { userId: 1, productId: 1 },
  { unique: true, name: 'userId_1_productId_1_unique' }
);

module.exports = mongoose.model('LikedProduct', likedProductSchema, 'liked_products');
