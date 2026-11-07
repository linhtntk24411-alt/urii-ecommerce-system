const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  itemId: { type: String, required: true },
  productId: { type: String, required: true },
  variantIndex: { type: Number, min: 0, default: null },
  quantity: { type: Number, required: true, min: 1 },
  selected: { type: Boolean, default: true }
}, { _id: false });

const cartSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  items: { type: [cartItemSchema], default: [] }
}, { timestamps: true, optimisticConcurrency: true });

module.exports = mongoose.model('Cart', cartSchema);
