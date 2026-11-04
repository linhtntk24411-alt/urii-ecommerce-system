const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  category: String,
  image: String, // Link ảnh chính
  isSale: Boolean,
  originalPrice: Number,
  currentPrice: Number,
  rating: { type: Number, default: 0, min: 0, max: 5 },
  reviewCount: { type: Number, default: 0, min: 0 },
  stock: { type: Number, default: 0, min: 0 },
  description: String,
  specifications: { type: Map, of: String },
  variants: [{ 
    name: String, 
    price: Number, 
    stock: { type: Number, default: 0, min: 0 },
    image: String // Link ảnh của từng biến thể
  }]
}, { timestamps: true });

module.exports = mongoose.model('Product', productSchema);
