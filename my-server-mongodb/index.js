const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Kết nối MongoDB (hoặc chạy dữ liệu mẫu nếu chưa có mongo local)
mongoose.connect('mongodb://localhost:27017/urii-ecommerce', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('Connected to MongoDB successfully!');
}).catch(err => {
  console.log('MongoDB connection error, running with mock data mode:', err.message);
});

// Định nghĩa Schema & Model sản phẩm
const productSchema = new mongoose.Schema({
  id: Number,
  name: String,
  category: String,
  status: String,
  price: Number,
  stock: Number,
  image: String
});
const Product = mongoose.model('Product', productSchema);

// API lấy danh sách sản phẩm
app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find();
    if (products.length === 0) {
      // Trả về dữ liệu mẫu nếu database trống
      return res.json([
        { id: 1, name: 'Bộ Hạt Nhựa Ủi Perler Beads 24 Màu', category: 'hat-nhua', status: 'hot', price: 185000, stock: 50, image: 'assets/Urii-Logo.jpg' },
        { id: 2, name: 'Khuôn Nhựa Định Hình Size Lớn', category: 'dung-cu', status: 'new', price: 35000, stock: 12, image: 'assets/Urii-Logo.jpg' }
      ]);
    }
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API cập nhật sản phẩm
app.put('/api/products/:id', async (req, res) => {
  try {
    const updated = await Product.findOneAndUpdate(
      { $or: [{ id: req.params.id }, { _id: req.params.id }] },
      req.body,
      { new: true }
    );
    res.json({ success: true, updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API xóa sản phẩm
app.delete('/api/products/:id', async (req, res) => {
  try {
    await Product.findOneAndDelete({ $or: [{ id: req.params.id }, { _id: req.params.id }] });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = 3002;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});