const jwt = require('jsonwebtoken');

const User = require('../models/User');

const ACCOUNT_LOCKED = { code: 'ACCOUNT_LOCKED', message: 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ cửa hàng để được hỗ trợ.' };
const SESSION_REVOKED = { code: 'SESSION_REVOKED', message: 'Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại.' };

function sessionRejection(user, claims) {
  if (user?.status === 'locked') return { status: 403, body: ACCOUNT_LOCKED };
  if (!user || (user.sessionVersion ?? 0) !== (claims.sessionVersion ?? 0)) {
    return { status: 401, body: SESSION_REVOKED };
  }
  return null;
}

async function checkAccountSession(claims) {
  const user = await User.findAccountSession(claims?.id);
  return sessionRejection(user, claims);
}

async function authenticate(req, res, next) {
  const authorization = req.get?.('authorization') || req.headers?.authorization;
  const [scheme, token] = authorization ? authorization.split(' ') : [];
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Vui lòng đăng nhập.' });
  }
  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ message: 'Máy chủ chưa cấu hình JWT_SECRET.' });
  }

  let claims;
  try {
    claims = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ message: 'Token không hợp lệ hoặc đã hết hạn.' });
  }

  try {
    const rejected = await checkAccountSession(claims);
    if (rejected) return res.status(rejected.status).json(rejected.body);
  } catch (error) {
    return next(error);
  }
  req.auth = claims;
  next();
}

function optionalAuthenticate(req, res, next) {
  if (!(req.get?.('authorization') || req.headers?.authorization)) return next();
  return authenticate(req, res, next);
}

function requireAdmin(req, res, next) {
  if (req.auth?.role !== 'admin') {
    res.status(403).json({ message: 'Bạn không có quyền thực hiện thao tác này.' });
    return;
  }
  next();
}

function requireCustomer(req, res, next) {
  if (req.auth?.role !== 'user' && req.auth?.role !== 'admin') {
    res.status(403).json({ message: 'Chỉ khách hàng mới có thể thực hiện thao tác này.' });
    return;
  }
  next();
}

// Chỉ dành cho tài khoản khách hàng thực sự (không chấp nhận admin),
// dùng cho các nghiệp vụ gắn với lịch sử mua hàng như đánh giá sản phẩm.
function requireCustomerOnly(req, res, next) {
  if (req.auth?.role !== 'user') {
    res.status(403).json({ message: 'Chỉ khách hàng mới có thể thực hiện thao tác này.' });
    return;
  }
  next();
}

module.exports = { authenticate, optionalAuthenticate, requireAdmin, requireCustomer, requireCustomerOnly, ACCOUNT_LOCKED, checkAccountSession, sessionRejection };
