const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
  const authorization = req.get('authorization');
  const [scheme, token] = authorization ? authorization.split(' ') : [];

  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ message: 'Vui lòng đăng nhập.' });
    return;
  }
  if (!process.env.JWT_SECRET) {
    res.status(500).json({ message: 'Máy chủ chưa cấu hình JWT_SECRET.' });
    return;
  }

  try {
    req.auth = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Token không hợp lệ hoặc đã hết hạn.' });
  }
}

function requireAdmin(req, res, next) {
  if (req.auth?.role !== 'admin') {
    res.status(403).json({ message: 'Bạn không có quyền thực hiện thao tác này.' });
    return;
  }
  next();
}

module.exports = { authenticate, requireAdmin };
