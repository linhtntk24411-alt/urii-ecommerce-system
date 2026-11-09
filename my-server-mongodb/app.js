require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

const productRoutes = require('./routes/productRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const authRoutes = require('./routes/authRoutes');
const orderRoutes = require('./routes/orderRoutes');
const blogRoutes = require('./routes/blogRoutes');
const userRoutes = require('./routes/userRoutes');
const commentRoutes = require('./routes/commentRoutes');
const galleryRoutes = require('./routes/galleryRoutes');
const voucherRoutes = require('./routes/voucherRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const chatRoutes = require('./routes/chatRoutes');
const savedMapRoutes = require('./routes/savedMapRoutes');
const likedProductRoutes = require('./routes/likedProductRoutes');
const likedBlogRoutes = require('./routes/likedBlogRoutes');
const customOrderRoutes = require('./routes/customOrderRoutes');
const cartRoutes = require('./routes/cartRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const webhookRoutes = require('./routes/webhookRoutes');

const app = express();
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || 'http://localhost:3002,http://localhost:4200,http://localhost:4201')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

app.disable('x-powered-by');
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl || req.path} ${res.statusCode} ${Date.now() - startedAt}ms`);
  });
  next();
});

// Mount webhook routes trước CORS/express.json() toàn cục để giữ nguyên rawBody và giới hạn payload riêng
app.use('/api/webhooks', webhookRoutes);
app.use('/api/webhook', webhookRoutes);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    if (process.env.NODE_ENV !== 'production') {
      if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        callback(null, true);
        return;
      }
    }
    callback(new Error('Origin is not allowed by CORS'));
  }
}));
app.set('allowedOrigins', allowedOrigins);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use('/images', express.static(path.join(__dirname, 'public/images'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0
}));
app.use('/api/images', express.static(path.join(__dirname, 'public/images'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0
}));
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

app.use('/api/cart', cartRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/review', reviewRoutes);

app.use('/api/custom-orders', customOrderRoutes);
app.use('/api/custom-order', customOrderRoutes);

app.use('/api/upload', uploadRoutes);
app.use('/api/uploads', uploadRoutes);

app.use('/api/blogs', blogRoutes);
app.use('/api/blog', blogRoutes);

app.use('/api/users', userRoutes);
app.use('/api/user', userRoutes);

app.use('/api/comments', commentRoutes);
app.use('/api/comment', commentRoutes);

app.use('/api/gallery', galleryRoutes);
app.use('/api/maps', galleryRoutes);
app.use('/api/map', galleryRoutes);

app.use('/api/saved-maps', savedMapRoutes);
app.use('/api/saved-map', savedMapRoutes);
app.use('/api/savedmaps', savedMapRoutes);
app.use('/api/saved_maps', savedMapRoutes);

app.use('/api/liked-products', likedProductRoutes);
app.use('/api/liked-product', likedProductRoutes);
app.use('/api/likedproducts', likedProductRoutes);
app.use('/api/liked_products', likedProductRoutes);

app.use('/api/liked-blogs', likedBlogRoutes);
app.use('/api/liked-blog', likedBlogRoutes);
app.use('/api/likedblogs', likedBlogRoutes);
app.use('/api/liked_blogs', likedBlogRoutes);

app.use('/api/vouchers', voucherRoutes);
app.use('/api/voucher', voucherRoutes);
app.use('/api/promotions', voucherRoutes);
app.use('/api/promotion', voucherRoutes);
app.use('/api/user-vouchers', require('./routes/userVoucherRoutes'));
app.use('/api/user-voucher', require('./routes/userVoucherRoutes'));

app.use('/api/dashboard', dashboardRoutes);

app.use('/api/chat', chatRoutes);
app.use('/api/chatbot', chatRoutes);

app.use('/api/notifications', notificationRoutes);
app.use('/api/notification', notificationRoutes);

// ===================== FACEBOOK REQUIRED PAGES =====================
app.get('/privacy-policy', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Chính sách quyền riêng tư - Urii</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f9f9f9; color: #222; }
    .container { max-width: 820px; margin: 48px auto; background: #fff; border-radius: 12px; padding: 48px; box-shadow: 0 2px 16px rgba(0,0,0,.08); }
    .logo-text { font-size: 24px; font-weight: 700; color: #c0392b; display: block; margin-bottom: 32px; }
    h1 { font-size: 28px; font-weight: 700; color: #c0392b; margin-bottom: 8px; }
    .updated { font-size: 14px; color: #888; margin-bottom: 32px; }
    h2 { font-size: 18px; font-weight: 600; color: #333; margin: 28px 0 10px; }
    p, li { font-size: 15px; line-height: 1.8; color: #444; }
    ul { padding-left: 20px; margin: 8px 0; }
    li { margin-bottom: 6px; }
    a { color: #c0392b; }
    .footer { margin-top: 40px; padding-top: 24px; border-top: 1px solid #eee; font-size: 13px; color: #999; }
  </style>
</head>
<body>
  <div class="container">
    <span class="logo-text">Urii — Chinh sach quyen rieng tu</span>
    <h1>Chinh sach quyen rieng tu</h1>
    <p class="updated">Cap nhat lan cuoi: Thang 11, 2026</p>
    <p>Urii cam ket bao ve quyen rieng tu cua ban. Chinh sach nay giai thich cach chung toi thu thap, su dung va bao ve thong tin khi ban su dung website Urii.</p>
    <h2>1. Thong tin chung toi thu thap</h2>
    <ul>
      <li>Ho ten, dia chi email khi ban dang ky hoac dang nhap qua Facebook/Google.</li>
      <li>Anh dai dien, so dien thoai, dia chi giao hang (neu ban cung cap).</li>
      <li>Lich su don hang, san pham yeu thich, nhan xet san pham.</li>
    </ul>
    <h2>2. Chung toi su dung thong tin de lam gi</h2>
    <ul>
      <li>Tao va quan ly tai khoan cua ban.</li>
      <li>Xu ly don hang va ho tro khach hang.</li>
      <li>Cai thien chat luong dich vu va trai nghiem nguoi dung.</li>
    </ul>
    <h2>3. Dang nhap qua Facebook</h2>
    <p>Khi ban chon dang nhap bang Facebook, Urii chi truy cap thong tin ban da cap quyen (ten, email, anh dai dien cong khai). Chung toi khong dang bai len trang Facebook cua ban hoac truy cap danh sach ban be.</p>
    <h2>4. Chia se thong tin</h2>
    <p>Chung toi khong ban thong tin ca nhan cua ban cho ben thu ba. Thong tin chi duoc chia se de van hanh dich vu hoac theo yeu cau phap luat.</p>
    <h2>5. Quyen cua ban</h2>
    <ul>
      <li>Xem, chinh sua thong tin ca nhan trong muc Ho so tai khoan.</li>
      <li>Yeu cau xoa tai khoan va toan bo du lieu lien quan.</li>
      <li>Huy lien ket tai khoan Facebook bat ky luc nao.</li>
    </ul>
    <h2>6. Lien he</h2>
    <p>Moi thac mac ve quyen rieng tu: <a href="mailto:uriiuicathegioi@gmail.com">uriiuicathegioi@gmail.com</a></p>
    <div class="footer">© 2026 Urii. Tat ca quyen duoc bao luu.</div>
  </div>
</body>
</html>`);
});

app.get('/data-deletion', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Yeu cau xoa du lieu - Urii</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f9f9f9; color: #222; }
    .container { max-width: 820px; margin: 48px auto; background: #fff; border-radius: 12px; padding: 48px; box-shadow: 0 2px 16px rgba(0,0,0,.08); }
    .logo-text { font-size: 24px; font-weight: 700; color: #c0392b; display: block; margin-bottom: 32px; }
    h1 { font-size: 28px; font-weight: 700; color: #c0392b; margin-bottom: 8px; }
    .updated { font-size: 14px; color: #888; margin-bottom: 32px; }
    h2 { font-size: 18px; font-weight: 600; color: #333; margin: 28px 0 10px; }
    p, li { font-size: 15px; line-height: 1.8; color: #444; }
    ul { padding-left: 20px; margin: 8px 0; }
    li { margin-bottom: 8px; }
    .steps { background: #fff8f8; border-left: 4px solid #c0392b; padding: 20px 24px; border-radius: 0 8px 8px 0; margin: 16px 0; }
    a { color: #c0392b; }
    .footer { margin-top: 40px; padding-top: 24px; border-top: 1px solid #eee; font-size: 13px; color: #999; }
  </style>
</head>
<body>
  <div class="container">
    <span class="logo-text">Urii — Yeu cau xoa du lieu</span>
    <h1>Yeu cau xoa du lieu nguoi dung</h1>
    <p class="updated">Cap nhat lan cuoi: Thang 11, 2026</p>
    <p>Urii ton trong quyen kiem soat du lieu ca nhan cua ban. Neu ban muon xoa toan bo du lieu lien quan den tai khoan Urii (bao gom tai khoan dang nhap qua Facebook):</p>
    <h2>Cach 1 — Tu xoa trong tai khoan (Nhanh nhat)</h2>
    <div class="steps">
      <ul>
        <li>Dang nhap vao trang Urii.</li>
        <li>Vao muc Ho so ca nhan → Cai dat tai khoan.</li>
        <li>Chon "Xoa tai khoan" va xac nhan.</li>
        <li>Toan bo du lieu se bi xoa vinh vien trong vong 30 ngay.</li>
      </ul>
    </div>
    <h2>Cach 2 — Gui yeu cau qua email</h2>
    <p>Gui email den <a href="mailto:uriiuicathegioi@gmail.com">uriiuicathegioi@gmail.com</a> voi tieu de: "Yeu cau xoa du lieu tai khoan Urii" va cung cap dia chi email tai khoan can xoa. Chung toi se xu ly trong vong 7 ngay lam viec.</p>
    <h2>Du lieu se duoc xoa bao gom</h2>
    <ul>
      <li>Thong tin ho so ca nhan (ten, email, so dien thoai, dia chi).</li>
      <li>Lich su don hang va don hang tuy chinh.</li>
      <li>Bai viet blog, nhan xet san pham, ban do da luu.</li>
      <li>Lien ket voi tai khoan Facebook/Google.</li>
    </ul>
    <div class="footer">© 2026 Urii. Tat ca quyen duoc bao luu.</div>
  </div>
</body>
</html>`);
});

// Phục vụ giao diện web Admin trực tiếp trên cổng 3002
const adminDistPath = path.resolve(__dirname, '../dist/my-admin/browser');
if (fs.existsSync(adminDistPath)) {
  app.use(express.static(adminDistPath, {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0
  }));
}

app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/images')) {
    return next();
  }

  // Health check phản hồi JSON cho test runner
  if (process.env.NODE_ENV === 'test' || req.query.health === 'true' || (!req.accepts('html') && req.path === '/')) {
    return res.json({ status: 'OK', message: 'Urii Backend đang chạy!' });
  }

  const indexPath = path.join(adminDistPath, 'index.csr.html');
  const fallbackPath = path.join(adminDistPath, 'index.html');

  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  if (fs.existsSync(fallbackPath)) {
    return res.sendFile(fallbackPath);
  }

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
  const isWebhook = req.path?.startsWith('/api/webhooks') || req.path?.startsWith('/api/webhook');
  if (error.message === 'Origin is not allowed by CORS') {
    res.status(403).json({ message: 'Origin không được phép.' });
    return;
  }
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    res.status(400).json({
      ...(isWebhook ? { success: false } : {}),
      message: 'JSON request không hợp lệ.'
    });
    return;
  }
  if (error.type === 'entity.too.large') {
    res.status(413).json({
      ...(isWebhook ? { success: false } : {}),
      message: 'Request vượt quá dung lượng cho phép.'
    });
    return;
  }
  console.error(error);
  res.status(500).json({
    ...(isWebhook ? { success: false } : {}),
    message: 'Đã xảy ra lỗi máy chủ.'
  });
});

module.exports = app;
