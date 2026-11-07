require('dotenv').config();
const dns = require('node:dns');
try {
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
} catch {}

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('./models/User');

async function seedAdmin() {
  const envEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const envPassword = process.env.SEED_ADMIN_PASSWORD;

  const email = (envEmail && envEmail !== 'admin@example.com') ? envEmail : 'admin@gmail.com';
  const password = (envPassword && envPassword !== 'replace-with-a-unique-password-of-at-least-12-characters')
    ? envPassword
    : 'urii123@';
  const name = process.env.SEED_ADMIN_NAME?.trim() || 'Urii Admin';

  if (!process.env.MONGO_URI) {
    throw new Error('Thiếu MONGO_URI trong cấu hình môi trường.');
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Email admin phải hợp lệ.');
  }
  if (!password || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Mật khẩu admin phải có ít nhất 8 ký tự và không vượt quá 72 byte.');
  }

  await mongoose.connect(process.env.MONGO_URI);

  // 1. Seed / Cập nhật tài khoản Admin mật khẩu (admin@gmail.com)
  const existingUser = await User.findOne({ email });
  const hashedPassword = await bcrypt.hash(password, 12);

  if (existingUser) {
    existingUser.name = name;
    existingUser.password = hashedPassword;
    existingUser.role = 'admin';
    if (!existingUser.authProviders.includes('password')) {
      existingUser.authProviders.push('password');
    }
    await existingUser.save();
    console.log(`Đã cập nhật thông tin đăng nhập cho admin ${email}.`);
  } else {
    await User.create({
      name,
      email,
      password: hashedPassword,
      role: 'admin',
      authProviders: ['password']
    });
    console.log(`Đã tạo tài khoản admin ${email}.`);
  }

  // 2. Seed / Đảm bảo danh sách các tài khoản Admin Google
  const googleAdminEmails = [
    'lentnk24411@st.uel.edu.vn',
    'linhtntk24411@st.uel.edu.vn',
    'nhungvthk24411@st.uel.edu.vn',
    'thuhnak24411@st.uel.edu.vn',
    'anhttpk24411@st.uel.edu.vn'
  ];

  for (const gEmail of googleAdminEmails) {
    const existingGoogleAdmin = await User.findOne({ email: gEmail });
    if (existingGoogleAdmin) {
      existingGoogleAdmin.role = 'admin';
      existingGoogleAdmin.password = hashedPassword;
      if (!existingGoogleAdmin.authProviders.includes('google')) {
        existingGoogleAdmin.authProviders.push('google');
      }
      if (!existingGoogleAdmin.authProviders.includes('password')) {
        existingGoogleAdmin.authProviders.push('password');
      }
      await existingGoogleAdmin.save();
      console.log(`Đã đảm bảo quyền admin và mật khẩu cho ${gEmail}.`);
    } else {
      await User.create({
        name: gEmail.split('@')[0],
        email: gEmail,
        password: hashedPassword,
        role: 'admin',
        authProviders: ['google', 'password'],
        orders: 0,
        maps: 0
      });
      console.log(`Đã tạo tài khoản admin Google ${gEmail}.`);
    }
  }
}

if (require.main === module) {
  seedAdmin()
    .catch((error) => {
      console.error('Lỗi tạo tài khoản admin:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    });
}

module.exports = { seedAdmin };
