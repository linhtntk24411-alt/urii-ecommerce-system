const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const bcrypt = require('bcryptjs');

const Product = require('../models/Product');
const Category = require('../models/Category');
const Order = require('../models/Order');
const SavedMap = require('../models/SavedMap');
const Blog = require('../models/Blog');
const Comment = require('../models/Comment');
const SampleMap = require('../models/SampleMap');
const Voucher = require('../models/Voucher');
const { getPagination } = require('../utils/pagination');
const { insertMissing, prepareMaps, prepareNewUsers, seed } = require('../seed');
const { buildProducts } = require('../convert_excel');
const XLSX = require('xlsx');
const { isVoucherAvailable } = require('../controllers/voucherController');

const dataPath = (name) => path.join(__dirname, '..', 'data', name);
const readJSON = (name) => JSON.parse(fs.readFileSync(dataPath(name), 'utf8'));

test('seed fixtures validate against their MongoDB schemas', async () => {
  const fixtures = [
    [Product, readJSON('products.json').products],
    [Category, readJSON('categories.json')],
    [Order, readJSON('orders.json').orders],
    [Blog, readJSON('blogs.json').blogs],
    [Comment, readJSON('comments.json').comments],
    [SampleMap, readJSON('gallery.json')],
    [Voucher, readJSON('vouchers.json').vouchers],
    [SavedMap, readJSON('saved_maps.json').maps]
  ];

  for (const [Model, documents] of fixtures) {
    assert.ok(documents.length > 0, `${Model.modelName} fixture must not be empty`);
    for (const document of documents) {
      await assert.doesNotReject(
        new Model(document).validate(),
        `${Model.modelName} record failed validation`
      );
    }
  }
  assert.ok(readJSON('users.json').users.every((user) => user.password === '$GENERATE'));
});

test('local image references in JSON fixtures exist under public/images', () => {
  const imagePattern = /images\/[^"'<>]*?\.(?:png|jpe?g|webp|gif|svg)/gi;
  const references = [];

  function visit(value, fileName) {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, fileName));
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach((item) => visit(item, fileName));
    } else if (typeof value === 'string') {
      for (const match of value.matchAll(imagePattern)) {
        references.push({ fileName, relativePath: match[0] });
      }
    }
  }

  for (const file of fs.readdirSync(path.join(__dirname, '..', 'data'))) {
    if (file.endsWith('.json')) {
      visit(readJSON(file), file);
    }
  }

  assert.ok(references.length > 0);
  for (const reference of references) {
    assert.ok(
      fs.existsSync(path.join(__dirname, '..', 'public', reference.relativePath)),
      `${reference.fileName} references missing ${reference.relativePath}`
    );
  }
});

test('seed inserts only missing records and does not replace existing data', async () => {
  let capturedOperations;
  const Model = {
    modelName: 'TestRecord',
    async bulkWrite(operations, options) {
      capturedOperations = { operations, options };
    }
  };

  await insertMissing(Model, [{ id: 'one', value: 'keep existing' }], 'id');
  assert.deepEqual(capturedOperations.operations[0].updateOne.update, {
    $setOnInsert: { id: 'one', value: 'keep existing' }
  });
  assert.equal(capturedOperations.operations[0].updateOne.upsert, true);
  assert.equal(capturedOperations.options.ordered, true);
});

test('map seed creates slugs compatible with legacy unique slug indexes', () => {
  const maps = prepareMaps([{ map_id: 'M01', map_name: 'Map mẫu' }]);
  assert.equal(maps[0].slug, 'map-m01');
});

test('new users get unique bcrypt passwords while existing emails are preserved', async () => {
  const users = readJSON('users.json').users;
  const generated = [];
  const result = await prepareNewUsers(
    users,
    [users[0].email],
    () => {
      const password = `test-password-${generated.length}`;
      generated.push(password);
      return password;
    }
  );

  assert.equal(result.documents.length, users.length - 1);
  assert.equal(result.credentials.length, users.length - 1);
  assert.ok(result.documents.every((user) => /^\$2[aby]\$/.test(user.password)));
  assert.ok(result.credentials.every((user) => user.email !== users[0].email));
  assert.equal(new Set(result.credentials.map((user) => user.password)).size, users.length - 1);
  assert.equal(
    await bcrypt.compare(result.credentials[0].password, result.documents[0].password),
    true
  );
});

test('seed refuses to load fixtures in production', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(seed(), /production/);
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
});

test('pagination defaults and caps page size', () => {
  assert.deepEqual(getPagination({}), { limit: 100, skip: 0 });
  assert.deepEqual(getPagination({ page: '3', limit: '25' }), { limit: 25, skip: 50 });
  assert.deepEqual(getPagination({ page: '-1', limit: '500' }), { limit: 100, skip: 0 });
});

test('voucher availability respects date range, quantity, and active status', () => {
  const now = new Date(2026, 4, 15, 12);
  const voucher = {
    isActive: true,
    startDate: '01/05/2026',
    endDate: '31/05/2026',
    quantity: 5,
    used: 4
  };

  assert.equal(isVoucherAvailable(voucher, now), true);
  assert.equal(isVoucherAvailable({ ...voucher, used: 5 }, now), false);
  assert.equal(isVoucherAvailable({ ...voucher, isActive: false }, now), false);
  assert.equal(isVoucherAvailable({ ...voucher, startDate: '01/06/2026' }, now), false);
  assert.equal(isVoucherAvailable({ ...voucher, endDate: '31/04/2026' }, now), false);
});

test('Excel conversion keeps the existing product fixture format', () => {
  const workbook = XLSX.readFile(dataPath('Urii_Product.xlsx'));
  const products = buildProducts(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]));
  const fixture = readJSON('products.json').products;

  assert.equal(products.length, fixture.length);
  assert.equal(products[0].id, fixture[0].id);
  assert.equal(products[0].variants.length, fixture[0].variants.length);
});
