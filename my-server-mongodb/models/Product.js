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
  stock: Number,
  description: String,
  specifications: { type: Map, of: String },
  variants: [{ 
    name: String, 
    price: Number, 
    stock: Number,
    image: String // Link ảnh của từng biến thể
  }]
}, { timestamps: true });

module.exports = mongoose.model('Product', productSchema);