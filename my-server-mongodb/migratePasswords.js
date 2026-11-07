require('dotenv').config();

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('./models/User');

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$/;

async function migratePasswords() {
  if (!process.env.MONGO_URI) {
    throw new Error('Thiếu MONGO_URI trong cấu hình môi trường.');
  }

  await mongoose.connect(process.env.MONGO_URI);
  const users = await User.find({
    password: { $type: 'string', $not: BCRYPT_HASH_PATTERN }
  }).select('+password');

  if (users.some((user) => Buffer.byteLength(user.password, 'utf8') > 72)) {
    throw new Error('Có mật khẩu cũ vượt quá giới hạn 72 byte; cần xử lý đặt lại mật khẩu trước.');
  }

  const operations = await Promise.all(users.map(async (user) => ({
    updateOne: {
      filter: { _id: user._id, password: user.password },
      update: { $set: { password: await bcrypt.hash(user.password, 12) } }
    }
  })));

  if (operations.length > 0) {
    await User.bulkWrite(operations, { ordered: false });
  }
  console.log(`Đã băm lại mật khẩu cho ${operations.length} tài khoản.`);
}

if (require.main === module) {
  migratePasswords()
    .catch((error) => {
      console.error('Lỗi chuyển đổi mật khẩu:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    });
}

module.exports = { BCRYPT_HASH_PATTERN, migratePasswords };
