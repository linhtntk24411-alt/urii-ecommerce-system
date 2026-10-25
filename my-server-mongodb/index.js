require('dotenv').config();

const mongoose = require('mongoose');
const app = require('./app');

const port = Number(process.env.PORT || 3002);

async function start() {
  if (!process.env.MONGO_URI) {
    throw new Error('Thiếu MONGO_URI trong cấu hình môi trường.');
  }
  if (!process.env.JWT_SECRET) {
    throw new Error('Thiếu JWT_SECRET trong cấu hình môi trường.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT phải là số nguyên từ 1 đến 65535.');
  }

  await mongoose.connect(process.env.MONGO_URI);
  const server = app.listen(port, () => {
    console.log(`Urii Backend đang chạy tại http://localhost:${port}`);
  });

  const shutdown = async () => {
    server.close(async (error) => {
      if (error) {
        console.error('Lỗi khi dừng HTTP server:', error);
        process.exitCode = 1;
      }
      await mongoose.disconnect();
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Không thể khởi động backend:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { start };
