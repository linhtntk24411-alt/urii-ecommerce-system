require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const Product = require('./models/Product');
const Category = require('./models/Category');
const SampleMap = require('./models/SampleMap');
const Voucher = require('./models/Voucher');
const Order = require('./models/Order');
const Blog = require('./models/Blog');
const Comment = require('./models/Comment');
const User = require('./models/User');
const SavedMap = require('./models/SavedMap');

function readJSON(fileName) {
  const filePath = path.join(__dirname, 'data', fileName);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function prepareNewUsers(users, existingEmails, generatePassword = () => (
  crypto.randomBytes(24).toString('base64url')
)) {
  if (!Array.isArray(users)) {
    throw new TypeError('User seed data must be an array.');
  }

  const existing = new Set(existingEmails.map((email) => email.toLowerCase()));
  const documents = [];
  const credentials = [];

  for (const user of users) {
    const email = user.email.trim().toLowerCase();
    if (existing.has(email)) {
      continue;
    }
    if (user.password !== '$GENERATE') {
      throw new TypeError(`User fixture for ${email} must use the $GENERATE password marker.`);
    }

    const password = generatePassword();
    if (typeof password !== 'string'
      || password.length < 12
      || Buffer.byteLength(password, 'utf8') > 72) {
      throw new TypeError('Generated user passwords must be 12-72 bytes.');
    }

    documents.push({
      ...user,
      email,
      password: await bcrypt.hash(password, 12)
    });
    credentials.push({ email, name: user.name, password });
    existing.add(email);
  }

  return { documents, credentials };
}

async function insertMissing(Model, documents, key) {
  if (!Array.isArray(documents)) {
    throw new TypeError(`${Model.modelName} seed data must be an array.`);
  }
  if (documents.length === 0) {
    return;
  }

  await Model.bulkWrite(documents.map((document) => ({
    updateOne: {
      filter: { [key]: document[key] },
      update: { $setOnInsert: document },
      upsert: true
    }
  })), { ordered: true });
  console.log(`Đã kiểm tra ${documents.length} bản ghi ${Model.modelName}; dữ liệu đang có được giữ nguyên.`);
}

function prepareMaps(maps) {
  return maps.map((map) => ({
    ...map,
    slug: map.slug || `map-${String(map.map_id).toLowerCase()}`
  }));
}

function saveGeneratedCredentials(credentials) {
  if (credentials.length === 0) {
    return null;
  }

  const credentialsPath = path.join(__dirname, '.seed-user-credentials.json');
  let previousCredentials = [];
  if (fs.existsSync(credentialsPath)) {
    previousCredentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    if (!Array.isArray(previousCredentials)) {
      throw new TypeError('The private seed credentials file must contain an array.');
    }
  }

  const byEmail = new Map(previousCredentials.map((entry) => [entry.email, entry]));
  for (const credential of credentials) {
    byEmail.set(credential.email, credential);
  }

  const temporaryPath = `${credentialsPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(Array.from(byEmail.values()), null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600
  });
  fs.renameSync(temporaryPath, credentialsPath);
  return credentialsPath;
}

async function seed() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Không được nạp dữ liệu fixture vào môi trường production.');
  }
  if (!process.env.MONGO_URI) {
    throw new Error('Thiếu MONGO_URI trong cấu hình môi trường.');
  }

  const credentialsPath = path.join(__dirname, '.seed-user-credentials.json');
  if (fs.existsSync(`${credentialsPath}.tmp`)) {
    throw new Error('Tệp thông tin đăng nhập tạm vẫn tồn tại; hãy kiểm tra và xử lý trước khi seed lại.');
  }

  await mongoose.connect(process.env.MONGO_URI);
  const userFixtures = readJSON('users.json').users;
  const existingUsers = await User.find({
    email: { $in: userFixtures.map((user) => user.email.trim().toLowerCase()) }
  }).select('email').lean();
  const { documents: newUsers, credentials } = await prepareNewUsers(
    userFixtures,
    existingUsers.map((user) => user.email)
  );
  const generatedCredentialsPath = saveGeneratedCredentials(credentials);
  console.log(`Tài khoản user mới: ${newUsers.length}; tài khoản hiện có được giữ nguyên: ${existingUsers.length}.`);

  await insertMissing(Product, readJSON('products.json').products, 'id');
  await insertMissing(Category, readJSON('categories.json'), '_id');
  await insertMissing(Order, readJSON('orders.json').orders, 'id');
  await insertMissing(Blog, readJSON('blogs.json').blogs, 'slug');
  await insertMissing(Comment, readJSON('comments.json').comments, 'id');
  const maps = prepareMaps(readJSON('gallery.json'));
  await SampleMap.bulkWrite(maps.map(({ map_id, slug }) => ({
    updateOne: {
      filter: { map_id, slug: null },
      update: { $set: { slug } }
    }
  })), { ordered: true });
  await insertMissing(SampleMap, maps, 'map_id');
  await insertMissing(Voucher, readJSON('vouchers.json').vouchers, 'code');
  await insertMissing(User, newUsers, 'email');
  await insertMissing(SavedMap, readJSON('saved_maps.json').maps, 'id');
  if (generatedCredentialsPath) {
    console.log(`Đã lưu mật khẩu tạm của user mới vào tệp riêng tư: ${generatedCredentialsPath}`);
  }
}

if (require.main === module) {
  seed()
    .catch((error) => {
      console.error('Lỗi nạp dữ liệu seed:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    });
}

module.exports = {
  insertMissing,
  prepareMaps,
  prepareNewUsers,
  saveGeneratedCredentials,
  seed
};
