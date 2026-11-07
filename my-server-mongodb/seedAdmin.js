require('dotenv').config();

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('./models/User');

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME?.trim() || 'Urii Admin';

  if (!process.env.MONGO_URI) {
    throw new Error('Thiếu MONGO_URI trong cấu hình môi trường.');
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('SEED_ADMIN_EMAIL phải là email hợp lệ.');
  }
  if (!password || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('SEED_ADMIN_PASSWORD phải có ít nhất 12 ký tự và không vượt quá 72 byte.');
  }

  await mongoose.connect(process.env.MONGO_URI);
  const existingUser = await User.findOne({ email });
  if (existingUser && existingUser.role !== 'admin') {
    throw new Error('Email đã thuộc về tài khoản không phải admin; không thể nâng quyền tự động.');
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  if (existingUser) {
    existingUser.name = name;
    existingUser.password = hashedPassword;
    await existingUser.save();
    console.log(`Đã cập nhật thông tin đăng nhập cho admin ${email}.`);
    return;
  }

  await User.create({ name, email, password: hashedPassword, role: 'admin' });
  console.log(`Đã tạo tài khoản admin ${email}.`);
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
