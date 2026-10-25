require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');

const productRoutes = require('./routes/productRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const authRoutes = require('./routes/authRoutes');
const orderRoutes = require('./routes/orderRoutes');
const blogRoutes = require('./routes/blogRoutes');
const userRoutes = require('./routes/userRoutes');
const commentRoutes = require('./routes/commentRoutes');
const mapRoutes = require('./routes/mapRoutes');
const voucherRoutes = require('./routes/voucherRoutes');

const app = express();
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || 'http://localhost:4200,http://localhost:4201')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

app.disable('x-powered-by');
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Origin is not allowed by CORS'));
  }
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - startedAt}ms`);
  });
  next();
});
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0
}));

app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/blogs', blogRoutes);
app.use('/api/users', userRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/maps', mapRoutes);
app.use('/api/vouchers', voucherRoutes);

app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'Urii Backend đang chạy!' });
});

app.use((req, res) => {
  res.status(404).json({ message: 'Không tìm thấy tài nguyên.' });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error.message === 'Origin is not allowed by CORS') {
    res.status(403).json({ message: 'Origin không được phép.' });
    return;
  }
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    res.status(400).json({ message: 'JSON request không hợp lệ.' });
    return;
  }
  if (error.type === 'entity.too.large') {
    res.status(413).json({ message: 'Request vượt quá dung lượng cho phép.' });
    return;
  }
  console.error(error);
  res.status(500).json({ message: 'Đã xảy ra lỗi máy chủ.' });
});

module.exports = app;
