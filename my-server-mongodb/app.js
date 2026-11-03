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
const dashboardRoutes = require('./routes/dashboardRoutes');
const chatRoutes = require('./routes/chatRoutes');
const savedMapRoutes = require('./routes/savedMapRoutes');
const customerOrderRoutes = require('./routes/customerOrderRoutes');

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
app.set('allowedOrigins', allowedOrigins);
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
app.use('/api/product', productRoutes);

app.use('/api/categories', categoryRoutes);
app.use('/api/category', categoryRoutes);

app.use('/api/auth', authRoutes);

app.use('/api/orders', orderRoutes);
app.use('/api/order', orderRoutes);
app.use('/api/customer-orders', customerOrderRoutes);
app.use('/api/customer-order', customerOrderRoutes);

app.use('/api/blogs', blogRoutes);
app.use('/api/blog', blogRoutes);

app.use('/api/users', userRoutes);
app.use('/api/user', userRoutes);

app.use('/api/comments', commentRoutes);
app.use('/api/comment', commentRoutes);

app.use('/api/maps', mapRoutes);
app.use('/api/map', mapRoutes);
app.use('/api/gallery', mapRoutes);
app.use('/api/sample-maps', mapRoutes);
app.use('/api/samplemaps', mapRoutes);

app.use('/api/saved-maps', savedMapRoutes);
app.use('/api/saved-map', savedMapRoutes);
app.use('/api/savedmaps', savedMapRoutes);
app.use('/api/saved_maps', savedMapRoutes);

app.use('/api/vouchers', voucherRoutes);
app.use('/api/voucher', voucherRoutes);
app.use('/api/promotions', voucherRoutes);
app.use('/api/promotion', voucherRoutes);

app.use('/api/dashboard', dashboardRoutes);

app.use('/api/chat', chatRoutes);
app.use('/api/chatbot', chatRoutes);

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
