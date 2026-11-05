const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
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
    avatar: user.avatar || '/images/avatar-non.jpg',
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
    await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      authProviders: ['password']
    });
    res.status(201).json({ message: 'Đăng ký thành công!' });
  } catch (error) {
    if (error.code === 11000) {
      res.status(409).json({ message: 'Email đã tồn tại.' });
      return;
    }
    console.error('Lỗi đăng ký tài khoản:', error);
    res.status(500).json({ message: 'Không thể đăng ký tài khoản lúc này.' });
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
    if (!user) {
      res.status(404).json({ message: 'Không tìm thấy tài khoản với email này.' });
      return;
    }

    const isMatch = user.password && await bcrypt.compare(password, user.password);
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

function readCookie(req, name) {
  const cookies = req.headers.cookie || '';
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

exports.oauthStart = (req, res) => {
  const { provider } = req.params;
  if (!['google', 'facebook'].includes(provider)) {
    res.status(404).json({ message: 'Nhà cung cấp OAuth không được hỗ trợ.' });
    return;
  }

  try {
    const state = crypto.randomBytes(32).toString('hex');
    const authorizationUrl = oauthProviders.buildAuthorizationUrl(provider, state);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Set-Cookie', oauthStateCookie(provider, state, 600));
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
  res.setHeader('Set-Cookie', oauthStateCookie(provider, '', 0));
  if (typeof req.query.error === 'string') {
    res.status(401).json({ message: 'Bạn đã hủy hoặc từ chối đăng nhập OAuth.' });
    return;
  }
  const { code, state } = req.query;
  const cookieState = readCookie(req, `urii_oauth_state_${provider}`);
  if (typeof code !== 'string' || !code || typeof state !== 'string'
    || !/^[a-f\d]{64}$/i.test(state)
    || !/^[a-f\d]{64}$/i.test(cookieState)
    || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(cookieState))) {
    res.status(400).json({ message: 'Trạng thái OAuth không hợp lệ hoặc đã hết hạn.' });
    return;
  }
  if (!process.env.JWT_SECRET) {
    res.status(500).json({ message: 'Máy chủ chưa cấu hình JWT_SECRET.' });
    return;
  }

  try {
    const identity = await oauthProviders.exchangeAuthorizationCode(provider, code);
    const email = typeof identity.email === 'string' ? identity.email.trim().toLowerCase() : '';

    if (!identity.providerUserId || !EMAIL_PATTERN.test(email)
      || (provider === 'google' && identity.emailVerified !== true)) {
      res.status(401).json({ message: 'Nhà cung cấp không trả về danh tính/email hợp lệ.' });
      return;
    }

    const existing = await User.findOne({ email }).select('+password');
    if (existing) {
      if (existing.role === 'admin') {
        res.status(403).json({ message: 'Tài khoản quản trị không thể đăng nhập qua OAuth.' });
        return;
      }
      const linkedAccount = existing.oauthAccounts?.find((account) => account.provider === provider);
      if (linkedAccount && linkedAccount.providerUserId !== identity.providerUserId) {
        res.status(409).json({ message: 'Email này đã liên kết với một tài khoản OAuth khác.' });
        return;
      }
      if (!linkedAccount && (existing.password
        || existing.authProviders?.some((authProvider) => authProvider !== provider))) {
        res.status(409).json({
          message: 'Email này đã có tài khoản. Hãy đăng nhập bằng phương thức đã đăng ký.'
        });
        return;
      }
    }

    const profileName = typeof identity.name === 'string' && identity.name.trim()
      ? identity.name.trim()
      : email;
    let user = existing;
    if (!user) {
      user = await User.create({
        email,
        name: profileName,
        avatar: identity.picture || undefined,
        role: 'user',
        password: null,
        authProviders: [provider],
        oauthAccounts: [{ provider, providerUserId: identity.providerUserId }]
      });
    } else {
      if (!user.authProviders.includes(provider)) user.authProviders.push(provider);
      if (!user.oauthAccounts?.some((account) => account.provider === provider)) {
        user.oauthAccounts.push({ provider, providerUserId: identity.providerUserId });
      }
      if ([email, email.split('@')[0]].includes(user.name) && profileName !== user.name) {
        user.name = profileName;
      }
      if (!user.avatar && identity.picture) user.avatar = identity.picture;
      await user.save();
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
    if (error.code === 11000) {
      res.status(409).json({ message: 'Email đã được đăng ký. Hãy đăng nhập bằng phương thức đã liên kết.' });
      return;
    }
    console.error(`Lỗi đăng nhập OAuth ${provider}:`, error.message);
    res.status(oauthErrorStatus(error)).json({
      message: `Không thể hoàn tất đăng nhập OAuth ${provider} lúc này.`
    });
  }
};
