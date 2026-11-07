const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const Otp = require('../models/Otp');
const { sendOtpEmail } = require('../services/emailService');
const oauthProviders = require('../services/oauthProviders');
const { emitCrudChange } = require('../realtime');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_BYTES = 72;
const PROFILE_GENDERS = new Set(['', 'male', 'female', 'other', 'prefer_not_to_say']);

function isValidBirthDate(value) {
  const vietnameseDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const day = vietnameseDate ? Number(vietnameseDate[1]) : isoDate ? Number(isoDate[3]) : 0;
  const month = vietnameseDate ? Number(vietnameseDate[2]) : isoDate ? Number(isoDate[2]) : 0;
  const year = vietnameseDate ? Number(vietnameseDate[3]) : isoDate ? Number(isoDate[1]) : 0;
  const date = new Date(Date.UTC(year, month - 1, day));
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  return Boolean(day && month && year)
    && date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && date <= today;
}

function formatAuthUser(user) {
  if (!user) return null;
  return {
    _id: user._id,
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: (!user.avatar || user.avatar.includes('googleusercontent.com')) ? '/images/avatar-non.jpg' : user.avatar,
    phone: user.phone || '',
    birth: user.birth || '',
    address: user.address || '',
    interests: user.interests || '',
    gender: user.gender || '',
    joinDate: user.joinDate || '',
    orders: user.orders ?? 0,
    maps: user.maps ?? 0,
    authProviders: user.authProviders || []
  };
}

exports.formatAuthUser = formatAuthUser;

exports.register = async (req, res) => {
  const { name, email, password } = req.body || {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (typeof name !== 'string' || !name.trim()
    || !EMAIL_PATTERN.test(normalizedEmail)
    || typeof password !== 'string'
    || password.length < PASSWORD_MIN_LENGTH
    || Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    res.status(400).json({
      message: `Vui lòng nhập tên, email hợp lệ và mật khẩu tối thiểu ${PASSWORD_MIN_LENGTH} ký tự, không vượt quá ${PASSWORD_MAX_BYTES} byte.`
    });
    return;
  }

  try {
    const existingUser = await User.findOne({ email: normalizedEmail }).lean();
    if (existingUser) {
      res.status(409).json({ message: 'Email đã tồn tại.' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Xóa các OTP cũ nếu có
    await Otp.deleteMany({ email: normalizedEmail, purpose: 'register' });

    // Lưu OTP mới với hạn 60 giây
    await Otp.create({
      email: normalizedEmail,
      name: name.trim(),
      hashedPassword,
      otp,
      purpose: 'register',
      createdAt: new Date()
    });

    // Gửi email OTP
    await sendOtpEmail(normalizedEmail, name.trim(), otp, 'register');

    res.status(200).json({
      requireOtp: true,
      email: normalizedEmail,
      message: 'Mã xác thực OTP đã được gửi đến email của bạn. Mã có hiệu lực trong 60 giây.'
    });
  } catch (error) {
    if (error.code === 11000) {
      res.status(409).json({ message: 'Email đã tồn tại.' });
      return;
    }
    console.error('Lỗi gửi OTP đăng ký:', error);
    res.status(500).json({ message: 'Không thể xử lý yêu cầu đăng ký lúc này.' });
  }
};

exports.verifyOtp = async (req, res) => {
  const { email, otp } = req.body || {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const trimmedOtp = typeof otp === 'string' ? otp.trim() : '';

  if (!EMAIL_PATTERN.test(normalizedEmail) || !trimmedOtp) {
    return res.status(400).json({ message: 'Vui lòng cung cấp email và mã OTP 6 chữ số.' });
  }

  try {
    const record = await Otp.findOne({ email: normalizedEmail, purpose: 'register' }).sort({ createdAt: -1 });
    if (!record) {
      return res.status(400).json({
        message: 'Không tìm thấy yêu cầu xác thực hoặc mã đã hết hạn. Vui lòng bấm gửi lại mã OTP.'
      });
    }

    // Kiểm tra thời hạn 60 giây (1 phút)
    const diffSeconds = (Date.now() - record.createdAt.getTime()) / 1000;
    if (diffSeconds > 60) {
      return res.status(400).json({
        message: 'Mã xác thực OTP đã hết hạn (quá 60 giây). Vui lòng nhấn gửi lại mã mới.'
      });
    }

    if (record.otp !== trimmedOtp) {
      return res.status(400).json({
        message: 'Mã xác thực OTP không chính xác. Vui lòng kiểm tra lại.'
      });
    }

    const existingUser = await User.findOne({ email: normalizedEmail }).lean();
    if (existingUser) {
      await Otp.deleteMany({ email: normalizedEmail });
      return res.status(409).json({ message: 'Email này đã được đăng ký tài khoản.' });
    }

    await User.create({
      name: record.name,
      email: normalizedEmail,
      password: record.hashedPassword,
      authProviders: ['password'],
      avatar: '/images/avatar-non.jpg',
      role: 'user',
      joinDate: new Date().toLocaleDateString('vi-VN')
    });

    await Otp.deleteMany({ email: normalizedEmail });

    return res.status(201).json({
      message: 'Đăng ký tài khoản thành công! Vui lòng đăng nhập.'
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'Email đã tồn tại.' });
    }
    console.error('Lỗi xác thực OTP:', error);
    return res.status(500).json({ message: 'Không thể xác thực OTP lúc này.' });
  }
};

exports.resendOtp = async (req, res) => {
  const { email } = req.body || {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!EMAIL_PATTERN.test(normalizedEmail)) {
    return res.status(400).json({ message: 'Email không hợp lệ.' });
  }

  try {
    const existingUser = await User.findOne({ email: normalizedEmail }).lean();
    if (existingUser) {
      return res.status(409).json({ message: 'Email này đã được đăng ký.' });
    }

    const record = await Otp.findOne({ email: normalizedEmail, purpose: 'register' }).sort({ createdAt: -1 });
    if (!record) {
      return res.status(400).json({
        message: 'Không tìm thấy thông tin đăng ký trước đó. Vui lòng thực hiện đăng ký lại từ đầu.'
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    record.otp = otp;
    record.createdAt = new Date();
    await record.save();

    await sendOtpEmail(normalizedEmail, record.name, otp, 'register');

    return res.json({
      message: 'Mã xác thực OTP mới đã được gửi đến email của bạn. Mã có hiệu lực trong 60 giây.'
    });
  } catch (error) {
    console.error('Lỗi gửi lại mã OTP:', error);
    return res.status(500).json({ message: 'Không thể gửi lại mã OTP lúc này.' });
  }
};

exports.forgotPassword = async (req, res) => {
  const { email } = req.body || {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!EMAIL_PATTERN.test(normalizedEmail)) {
    return res.status(400).json({ message: 'Vui lòng cung cấp email hợp lệ.' });
  }

  try {
    const user = await User.findOne({ email: normalizedEmail }).lean();
    if (!user) {
      return res.status(404).json({ message: 'Email này chưa được đăng ký tài khoản tại Urii.' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await Otp.deleteMany({ email: normalizedEmail, purpose: 'reset-password' });

    await Otp.create({
      email: normalizedEmail,
      name: user.name || '',
      otp,
      purpose: 'reset-password',
      createdAt: new Date()
    });

    await sendOtpEmail(normalizedEmail, user.name, otp, 'reset-password');

    return res.status(200).json({
      message: 'Mã xác thực OTP đã được gửi đến email của bạn. Mã có hiệu lực trong 60 giây.'
    });
  } catch (error) {
    console.error('Lỗi yêu cầu đặt lại mật khẩu:', error);
    return res.status(500).json({ message: 'Không thể xử lý yêu cầu quên mật khẩu lúc này.' });
  }
};

exports.verifyResetOtp = async (req, res) => {
  const { email, otp } = req.body || {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const trimmedOtp = typeof otp === 'string' ? otp.trim() : '';

  if (!EMAIL_PATTERN.test(normalizedEmail) || !trimmedOtp) {
    return res.status(400).json({ message: 'Vui lòng cung cấp email và mã OTP.' });
  }

  try {
    const record = await Otp.findOne({ email: normalizedEmail, purpose: 'reset-password' }).sort({ createdAt: -1 });
    if (!record) {
      return res.status(400).json({
        message: 'Không tìm thấy yêu cầu đặt lại mật khẩu hoặc mã đã hết hạn. Vui lòng bấm gửi lại mã.'
      });
    }

    const diffSeconds = (Date.now() - record.createdAt.getTime()) / 1000;
    if (diffSeconds > 60) {
      return res.status(400).json({
        message: 'Mã xác thực OTP đã hết hạn (quá 60 giây). Vui lòng nhấn gửi lại mã mới.'
      });
    }

    if (record.otp !== trimmedOtp) {
      return res.status(400).json({
        message: 'Mã xác thực OTP không chính xác. Vui lòng kiểm tra lại.'
      });
    }

    return res.status(200).json({
      message: 'Xác thực mã OTP thành công. Vui lòng nhập mật khẩu mới.'
    });
  } catch (error) {
    console.error('Lỗi xác thực mã reset OTP:', error);
    return res.status(500).json({ message: 'Không thể xác thực OTP lúc này.' });
  }
};

exports.resetPassword = async (req, res) => {
  const { email, otp, password } = req.body || {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const trimmedOtp = typeof otp === 'string' ? otp.trim() : '';

  if (!EMAIL_PATTERN.test(normalizedEmail) || !trimmedOtp) {
    return res.status(400).json({ message: 'Thông tin xác thực không hợp lệ.' });
  }

  if (typeof password !== 'string'
    || password.length < PASSWORD_MIN_LENGTH
    || Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES
    || !/[A-Z]/.test(password)
    || !/[a-z]/.test(password)
    || !/[0-9]/.test(password)) {
    return res.status(400).json({
      message: 'Mật khẩu mới phải có ít nhất 8 ký tự, bao gồm chữ hoa, chữ thường và chữ số.'
    });
  }

  try {
    const record = await Otp.findOne({ email: normalizedEmail, purpose: 'reset-password' }).sort({ createdAt: -1 });
    if (!record) {
      return res.status(400).json({
        message: 'Phiên xác thực đã hết hạn hoặc không tồn tại. Vui lòng thực hiện lại từ đầu.'
      });
    }

    const diffSeconds = (Date.now() - record.createdAt.getTime()) / 1000;
    if (diffSeconds > 300) {
      return res.status(400).json({
        message: 'Phiên đặt lại mật khẩu đã hết hạn. Vui lòng thực hiện lại từ đầu.'
      });
    }

    if (record.otp !== trimmedOtp) {
      return res.status(400).json({
        message: 'Mã xác thực OTP không hợp lệ.'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await User.findOneAndUpdate(
      { email: normalizedEmail },
      { $set: { password: hashedPassword } }
    );

    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng để cập nhật mật khẩu.' });
    }

    await Otp.deleteMany({ email: normalizedEmail, purpose: 'reset-password' });

    return res.status(200).json({
      message: 'Đặt lại mật khẩu mới thành công! Vui lòng đăng nhập với mật khẩu mới.'
    });
  } catch (error) {
    console.error('Lỗi đặt lại mật khẩu:', error);
    return res.status(500).json({ message: 'Không thể đặt lại mật khẩu lúc này.' });
  }
};

exports.login = async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!EMAIL_PATTERN.test(normalizedEmail)
    || typeof password !== 'string'
    || !password.length
    || Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    res.status(400).json({ message: 'Vui lòng nhập email và mật khẩu hợp lệ.' });
    return;
  }
  if (!process.env.JWT_SECRET) {
    res.status(500).json({ message: 'Máy chủ chưa cấu hình JWT_SECRET.' });
    return;
  }

  try {
    const user = await User.findOne({ email: normalizedEmail }).select('+password');
    const isMatch = user?.password && await bcrypt.compare(password, user.password);
    if (!isMatch) {
      res.status(401).json({ message: 'Sai email hoặc mật khẩu.' });
      return;
    }

    const token = jwt.sign(
      { id: user._id.toString(), role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      message: 'Đăng nhập thành công!',
      token,
      user: formatAuthUser(user)
    });
  } catch (error) {
    console.error('Lỗi đăng nhập:', error);
    res.status(500).json({ message: 'Không thể đăng nhập lúc này.' });
  }
};

exports.getMe = async (req, res) => {
  const userId = req.auth?.id;
  if (!mongoose.isValidObjectId(userId)) {
    res.status(401).json({ message: 'Phiên đăng nhập không hợp lệ.' });
    return;
  }

  try {
    const user = await User.findById(userId).select('-password').lean();
    if (!user) {
      res.status(404).json({ message: 'Không tìm thấy người dùng.' });
      return;
    }
    res.json(formatAuthUser(user));
  } catch (error) {
    console.error('Lỗi tải hồ sơ cá nhân:', error);
    res.status(500).json({ message: 'Không thể tải hồ sơ cá nhân.' });
  }
};

exports.updateMe = async (req, res) => {
  const userId = req.auth?.id;
  if (!mongoose.isValidObjectId(userId)) {
    res.status(401).json({ message: 'Phiên đăng nhập không hợp lệ.' });
    return;
  }
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ message: 'Dữ liệu cập nhật không hợp lệ.' });
    return;
  }

  const allowedFields = ['name', 'phone', 'birth', 'address', 'interests', 'gender', 'avatar', 'password'];
  const updates = {};
  for (const field of allowedFields) {
    if (Object.hasOwn(req.body, field)) {
      updates[field] = req.body[field];
    }
  }

  if (updates.name !== undefined) {
    if (typeof updates.name !== 'string' || !updates.name.trim()) {
      res.status(400).json({ message: 'Tên người dùng không hợp lệ.' });
      return;
    }
    updates.name = updates.name.trim();
  }

  if (updates.phone !== undefined) {
    if (typeof updates.phone !== 'string'
      || !/^\+?[\d\s().-]{7,20}$/.test(updates.phone.trim())) {
      res.status(400).json({ message: 'Số điện thoại là bắt buộc và phải hợp lệ.' });
      return;
    }
    updates.phone = updates.phone.trim();
  }

  if (updates.birth !== undefined) {
    if (typeof updates.birth !== 'string' || !isValidBirthDate(updates.birth.trim())) {
      res.status(400).json({ message: 'Ngày sinh là bắt buộc, phải hợp lệ và không được ở tương lai.' });
      return;
    }
    updates.birth = updates.birth.trim();
  }

  if (updates.interests !== undefined) {
    if (typeof updates.interests !== 'string' || updates.interests.length > 500) {
      res.status(400).json({ message: 'Sở thích không được vượt quá 500 ký tự.' });
      return;
    }
    updates.interests = updates.interests.trim();
  }

  if (updates.gender !== undefined
    && (typeof updates.gender !== 'string' || !PROFILE_GENDERS.has(updates.gender))) {
    res.status(400).json({ message: 'Giới tính không hợp lệ.' });
    return;
  }


  if (updates.password !== undefined) {
    if (typeof updates.password !== 'string'
      || updates.password.length < PASSWORD_MIN_LENGTH
      || Buffer.byteLength(updates.password, 'utf8') > PASSWORD_MAX_BYTES) {
      res.status(400).json({ message: 'Mật khẩu phải có ít nhất 8 ký tự và không vượt quá 72 byte.' });
      return;
    }
    updates.password = await bcrypt.hash(updates.password, 12);
  }

  try {
    const user = await User.findByIdAndUpdate(userId, updates, {
      new: true,
      runValidators: true
    }).select('-password').lean();
    if (!user) {
      res.status(404).json({ message: 'Không tìm thấy người dùng.' });
      return;
    }
    emitCrudChange('users', 'updated', user._id);
    res.json(formatAuthUser(user));
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: 'Dữ liệu người dùng không hợp lệ.' });
      return;
    }
    console.error('Lỗi cập nhật hồ sơ cá nhân:', error);
    res.status(500).json({ message: 'Không thể cập nhật hồ sơ cá nhân.' });
  }
};

function oauthStateCookie(provider, state, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `urii_oauth_state_${provider}=${state}; HttpOnly; SameSite=Lax; Path=/api/auth/oauth/${provider}; Max-Age=${maxAge}${secure}`;
}

function oauthLinkCookie(provider, linkToken, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `urii_oauth_link_${provider}=${linkToken}; HttpOnly; SameSite=Lax; Path=/api/auth/oauth/${provider}; Max-Age=${maxAge}${secure}`;
}

function readCookie(req, name) {
  const cookies = req.headers?.cookie || '';
  for (const cookie of cookies.split(';')) {
    const separator = cookie.indexOf('=');
    if (separator > 0 && cookie.slice(0, separator).trim() === name) {
      return cookie.slice(separator + 1).trim();
    }
  }
  return '';
}

function oauthErrorStatus(error) {
  return error.code === 'OAUTH_CONFIGURATION_ERROR' ? 503 : 502;
}

function getFrontendOrigin() {
  const configured = (process.env.OAUTH_FRONTEND_ORIGIN || '').trim();
  if (configured) return configured;
  const firstCors = (process.env.CORS_ORIGINS || 'http://localhost:4201')
    .split(',')
    .map((origin) => origin.trim())
    .find(Boolean);
  return firstCors || 'http://localhost:4201';
}

function extractLinkTokenFromRequest(req) {
  const queryToken = typeof req.query?.token === 'string' ? req.query.token.trim() : '';
  if (queryToken) return queryToken;
  const authorization = req.get?.('authorization') || req.headers?.authorization || '';
  const [scheme, bearerToken] = authorization.split(' ');
  return scheme === 'Bearer' && bearerToken ? bearerToken.trim() : '';
}

function verifyLinkUser(token) {
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded?.role === 'user' && mongoose.isValidObjectId(decoded.id)) {
      return decoded.id;
    }
  } catch {
    return null;
  }
  return null;
}

function serializeForInlineScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function sendOAuthCallbackResult(req, res, statusCode, provider, payload) {
  const targetOrigin = getFrontendOrigin();
  const message = {
    type: 'urii-oauth',
    provider,
    ok: statusCode >= 200 && statusCode < 300,
    status: statusCode,
    ...payload
  };
  const serializedMessage = serializeForInlineScript(message);
  const serializedOrigin = serializeForInlineScript(targetOrigin);
  const safeText = String(payload?.message || (message.ok ? 'Đăng nhập thành công!' : 'Đăng nhập không thành công.'))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>Đăng nhập Urii</title>
</head>
<body>
  <p id="oauth-message">${safeText}</p>
  <script id="oauth-payload" type="application/json">${serializedMessage}</script>
  <script>
    (function () {
      var payload = ${serializedMessage};
      var targetOrigin = ${serializedOrigin};
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, targetOrigin);
        }
      } catch (e) {}
      try {
        window.close();
      } catch (e) {}
    })();
  </script>
</body>
</html>`;

  res.status(statusCode);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

exports.oauthStart = (req, res) => {
  const { provider } = req.params;
  if (!['google', 'facebook'].includes(provider)) {
    res.status(404).json({ message: 'Nhà cung cấp OAuth không được hỗ trợ.' });
    return;
  }

  const rawLinkToken = extractLinkTokenFromRequest(req);
  if (rawLinkToken && !verifyLinkUser(rawLinkToken)) {
    res.status(401).json({ message: 'Phiên đăng nhập để liên kết tài khoản không hợp lệ hoặc đã hết hạn.' });
    return;
  }

  try {
    const state = crypto.randomBytes(32).toString('hex');
    const authorizationUrl = oauthProviders.buildAuthorizationUrl(provider, state);
    const cookies = [oauthStateCookie(provider, state, 600)];
    if (rawLinkToken) {
      cookies.push(oauthLinkCookie(provider, rawLinkToken, 600));
    } else {
      cookies.push(oauthLinkCookie(provider, '', 0));
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Set-Cookie', cookies);
    res.redirect(authorizationUrl);
  } catch (error) {
    console.error(`Không thể khởi tạo OAuth ${provider}:`, error.message);
    res.status(oauthErrorStatus(error)).json({
      message: `Chưa cấu hình OAuth ${provider} đầy đủ.`
    });
  }
};

exports.oauthCallback = async (req, res) => {
  const { provider } = req.params;
  if (!['google', 'facebook'].includes(provider)) {
    res.status(404).json({ message: 'Nhà cung cấp OAuth không được hỗ trợ.' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const linkCookieToken = readCookie(req, `urii_oauth_link_${provider}`);
  res.setHeader('Set-Cookie', [
    oauthStateCookie(provider, '', 0),
    oauthLinkCookie(provider, '', 0)
  ]);

  if (typeof req.query.error === 'string') {
    sendOAuthCallbackResult(req, res, 401, provider, {
      message: 'Bạn đã hủy hoặc từ chối đăng nhập OAuth.'
    });
    return;
  }
  const { code, state } = req.query;
  const cookieState = readCookie(req, `urii_oauth_state_${provider}`);
  if (typeof code !== 'string' || !code || typeof state !== 'string'
    || !/^[a-f\d]{64}$/i.test(state)
    || !/^[a-f\d]{64}$/i.test(cookieState)
    || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(cookieState))) {
    sendOAuthCallbackResult(req, res, 400, provider, {
      message: 'Trạng thái OAuth không hợp lệ hoặc đã hết hạn.'
    });
    return;
  }
  if (!process.env.JWT_SECRET) {
    sendOAuthCallbackResult(req, res, 500, provider, {
      message: 'Máy chủ chưa cấu hình JWT_SECRET.'
    });
    return;
  }

  try {
    const identity = await oauthProviders.exchangeAuthorizationCode(provider, code);
    const providerUserId = typeof identity.providerUserId === 'string'
      ? identity.providerUserId.trim()
      : '';
    const email = typeof identity.email === 'string' ? identity.email.trim().toLowerCase() : '';

    if (!providerUserId) {
      sendOAuthCallbackResult(req, res, 401, provider, {
        message: 'Nhà cung cấp không trả về danh tính hợp lệ.'
      });
      return;
    }

    const linkedByProviderId = await User.findOne({
      oauthAccounts: { $elemMatch: { provider, providerUserId } }
    }).select('+password');

    let user = null;

    if (provider === 'google') {
      if (!EMAIL_PATTERN.test(email) || identity.emailVerified !== true) {
        sendOAuthCallbackResult(req, res, 401, provider, {
          message: 'Nhà cung cấp không trả về danh tính/email hợp lệ.'
        });
        return;
      }

      const existingByEmail = await User.findOne({ email }).select('+password');
      if (linkedByProviderId && existingByEmail && String(linkedByProviderId._id) !== String(existingByEmail._id)) {
        sendOAuthCallbackResult(req, res, 409, provider, {
          message: 'Tài khoản Google này đã được liên kết với một người dùng khác.'
        });
        return;
      }

      user = existingByEmail || linkedByProviderId;
      if (!user) {
        sendOAuthCallbackResult(req, res, 403, provider, {
          message: 'Email này chưa đăng ký tài khoản Urii. Vui lòng đăng ký tài khoản trước.'
        });
        return;
      }
      if (user.role !== 'user') {
        sendOAuthCallbackResult(req, res, 403, provider, {
          message: 'Tài khoản quản trị không thể đăng nhập qua OAuth.'
        });
        return;
      }

      const linkedGoogle = user.oauthAccounts?.find((account) => account.provider === 'google');
      if (linkedGoogle && linkedGoogle.providerUserId !== providerUserId) {
        sendOAuthCallbackResult(req, res, 409, provider, {
          message: 'Email này đã liên kết với một tài khoản Google khác.'
        });
        return;
      }

      let changed = false;
      if (!user.authProviders.includes('google')) {
        user.authProviders.push('google');
        changed = true;
      }
      if (!linkedGoogle) {
        user.oauthAccounts.push({ provider: 'google', providerUserId });
        changed = true;
      }
      if (!user.avatar && identity.picture) {
        user.avatar = identity.picture;
        changed = true;
      }
      if (changed) {
        await user.save();
      }
    } else if (provider === 'facebook') {
      const linkUserId = verifyLinkUser(linkCookieToken);
      if (linkUserId) {
        const currentUser = await User.findById(linkUserId).select('+password');
        if (!currentUser || currentUser.role !== 'user') {
          sendOAuthCallbackResult(req, res, 403, provider, {
            message: 'Chỉ tài khoản khách hàng đã đăng nhập mới có thể liên kết Facebook.'
          });
          return;
        }
        if (linkedByProviderId && String(linkedByProviderId._id) !== String(currentUser._id)) {
          sendOAuthCallbackResult(req, res, 409, provider, {
            message: 'Tài khoản Facebook này đã được liên kết với một tài khoản Urii khác.'
          });
          return;
        }
        const existingFbLink = currentUser.oauthAccounts?.find((account) => account.provider === 'facebook');
        if (existingFbLink && existingFbLink.providerUserId !== providerUserId) {
          sendOAuthCallbackResult(req, res, 409, provider, {
            message: 'Tài khoản Urii này đã liên kết với một tài khoản Facebook khác.'
          });
          return;
        }
        if (!currentUser.authProviders.includes('facebook')) {
          currentUser.authProviders.push('facebook');
        }
        if (!existingFbLink) {
          currentUser.oauthAccounts.push({ provider: 'facebook', providerUserId });
        }
        if (!currentUser.avatar && identity.picture) {
          currentUser.avatar = identity.picture;
        }
        await currentUser.save();
        user = currentUser;
      } else {
        if (!linkedByProviderId) {
          sendOAuthCallbackResult(req, res, 403, provider, {
            message: 'Tài khoản Facebook này chưa được liên kết với tài khoản Urii. Vui lòng đăng nhập và liên kết Facebook trước.'
          });
          return;
        }
        if (linkedByProviderId.role !== 'user') {
          sendOAuthCallbackResult(req, res, 403, provider, {
            message: 'Tài khoản quản trị không thể đăng nhập qua OAuth.'
          });
          return;
        }
        user = linkedByProviderId;
      }
    }

    const token = jwt.sign(
      { id: user._id.toString(), role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    sendOAuthCallbackResult(req, res, 200, provider, {
      message: 'Đăng nhập thành công!',
      token,
      user: formatAuthUser(user)
    });
  } catch (error) {
    if (error.code === 11000) {
      sendOAuthCallbackResult(req, res, 409, provider, {
        message: 'Tài khoản này đã được liên kết với một người dùng khác.'
      });
      return;
    }
    console.error(`Lỗi đăng nhập OAuth ${provider}:`, error.message);
    sendOAuthCallbackResult(req, res, oauthErrorStatus(error), provider, {
      message: `Không thể hoàn tất đăng nhập OAuth ${provider} lúc này.`
    });
  }
};

exports.googleLogin = async (req, res) => {
  const { token, target } = req.body || {};

  if (typeof token !== 'string' || !token) {
    return res.status(400).json({
      message: 'Không nhận được thông tin xác thực từ Google.'
    });
  }

  if (!process.env.JWT_SECRET) {
    return res.status(500).json({
      message: 'Máy chủ chưa cấu hình JWT_SECRET.'
    });
  }

  try {
    // 1. Dùng access_token lấy thông tin tài khoản Google
    const googleRes = await fetch(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    if (!googleRes.ok) {
      return res.status(401).json({
        message: 'Token Google không hợp lệ hoặc đã hết hạn.'
      });
    }

    const payload = await googleRes.json();

    if (
      !payload.sub ||
      !payload.email ||
      payload.email_verified !== true
    ) {
      return res.status(401).json({
        message: 'Tài khoản Google chưa được xác minh hợp lệ.'
      });
    }

    const email = payload.email.trim().toLowerCase();
    const googleId = payload.sub;

    // 2. Tìm kiếm tài khoản theo Google ID hoặc theo email
    let user = await User.findOne({
      'oauthAccounts.provider': 'google',
      'oauthAccounts.providerUserId': googleId
    });

    if (!user) {
      user = await User.findOne({ email });
    }

    // 3. Nếu là yêu cầu từ trang Admin (target === 'admin')
    if (target === 'admin') {
      if (!user || user.role !== 'admin') {
        return res.status(403).json({
          message: 'Tài khoản Google không có quyền truy cập Admin.'
        });
      }
    }

    // 4. Nếu tài khoản chưa tồn tại -> Tự động đăng ký người dùng mới (role: 'user')
    if (!user) {
      const displayName = payload.name?.trim() || email.split('@')[0];
      const todayFormatted = new Date().toLocaleDateString('vi-VN');

      user = await User.create({
        name: displayName,
        email,
        avatar: '/images/avatar-non.jpg',
        role: 'user',
        joinDate: todayFormatted,
        authProviders: ['google'],
        oauthAccounts: [{ provider: 'google', providerUserId: googleId }]
      });
    } else {
      // 5. Nếu tài khoản đã tồn tại, kiểm tra và liên kết Google ID
      const linkedOtherUser = await User.findOne({
        'oauthAccounts.provider': 'google',
        'oauthAccounts.providerUserId': googleId,
        _id: { $ne: user._id }
      });

      if (linkedOtherUser) {
        return res.status(409).json({
          message: 'Tài khoản Google này đã được liên kết với một tài khoản khác.'
        });
      }

      if (!Array.isArray(user.oauthAccounts)) {
        user.oauthAccounts = [];
      }
      const existingGoogleAccount = user.oauthAccounts.find(
        account => account.provider === 'google'
      );

      if (
        existingGoogleAccount &&
        existingGoogleAccount.providerUserId !== googleId
      ) {
        return res.status(409).json({
          message: 'Email này đã liên kết với một tài khoản Google khác.'
        });
      }

      let changed = false;
      if (!existingGoogleAccount) {
        user.oauthAccounts.push({
          provider: 'google',
          providerUserId: googleId
        });
        changed = true;
      }

      if (!Array.isArray(user.authProviders)) {
        user.authProviders = [];
      }
      if (!user.authProviders.includes('google')) {
        user.authProviders.push('google');
        changed = true;
      }

      if (!user.avatar || user.avatar.includes('googleusercontent.com')) {
        user.avatar = '/images/avatar-non.jpg';
        changed = true;
      }

      if (changed) {
        await user.save();
      }
    }

    // 6. Cấp JWT
    const jwtToken = jwt.sign(
      {
        id: user._id.toString(),
        role: user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      message: 'Đăng nhập Google thành công!',
      token: jwtToken,
      user: formatAuthUser(user)
    });

  } catch (error) {
    console.error('Lỗi xác thực Google:', error);

    return res.status(500).json({
      message: 'Không thể xác thực Google lúc này.'
    });
  }
};
