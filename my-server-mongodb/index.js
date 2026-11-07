const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
require('dotenv').config();
const dns = require('node:dns');

try {
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
} catch {
  // Bỏ qua nếu môi trường không cho phép setServers
}

const http = require('node:http');
const mongoose = require('mongoose');
const app = require('./app');
const { initializeRealtime } = require('./realtime');

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
  const server = http.createServer(app);
  const io = initializeRealtime(server, app.get('allowedOrigins'));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.removeListener('error', reject);
      console.log(`Urii Backend & Admin đang chạy tại http://localhost:${port}`);
      resolve();
    });
  });

  const shutdown = async () => {
    await new Promise((resolve) => io.close(resolve));
    await mongoose.disconnect();
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
