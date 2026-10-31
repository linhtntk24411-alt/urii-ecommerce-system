const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config(); // Đọc file .env

const app = express();
app.use(express.json());
app.use(cors());

// Kết nối MongoDB Atlas từ file .env
const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/urii-ecommerce';

mongoose.connect(mongoUri).then(() => {
  console.log('Connected to MongoDB Atlas successfully!');
}).catch(err => {
  console.log('MongoDB connection error:', err.message);
});

// Định nghĩa lại Schema khớp với MongoDB Atlas của nhóm
const productSchema = new mongoose.Schema({
  id: String,
  name: String,
  slug: String,
  category: String,
  status: String,
  currentPrice: Number,  // Khớp với DB trên cloud
  originalPrice: Number,
  stock: Number,
  image: String,
  description: String
});
const Product = mongoose.model('Product', productSchema);

// API lấy danh sách sản phẩm
app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find();
    
    // Map lại dữ liệu để chuyển "currentPrice" thành "price" cho đồng bộ với giao diện Angular hiện tại
    const formattedProducts = products.map(p => ({
      ...p.toObject(),
      price: p.currentPrice || p.originalPrice || 0 // Đảm bảo luôn có trường price cho giao diện đọc
    }));

    res.json(formattedProducts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});