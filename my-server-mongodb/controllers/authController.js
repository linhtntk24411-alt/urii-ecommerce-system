const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_BYTES = 72;

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
    await User.create({ name: name.trim(), email: normalizedEmail, password: hashedPassword });
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
    const isMatch = user && await bcrypt.compare(password, user.password);
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
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    console.error('Lỗi đăng nhập:', error);
    res.status(500).json({ message: 'Không thể đăng nhập lúc này.' });
  }
};
