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
const Gallery = require('../models/Gallery');
const Voucher = require('../models/Voucher');
const ChatSession = require('../models/ChatSession');
const ChatbotFaq = require('../models/ChatbotFaq');
const CustomOrder = require('../models/CustomOrder');
const Cart = require('../models/Cart');
const Review = require('../models/Review');
const { isValidImageUrl } = require('../utils/imageUrl');
const { getPagination } = require('../utils/pagination');
const { insertMissing, prepareGallery, prepareNewUsers, seed } = require('../seed');
const { buildProducts } = require('../convert_excel');
const XLSX = require('xlsx');
const { isVoucherAvailable } = require('../controllers/voucherController');
const { prepareSavedMaps } = require('../utils/savedMaps');
const {
  buildCartResponse,
  prepareCartFixtures,
  prepareReviewFixtures
} = require('../utils/commerceFixtures');

const dataPath = (name) => path.join(__dirname, '..', 'data', name);
const readJSON = (name) => JSON.parse(fs.readFileSync(dataPath(name), 'utf8'));

test('seed fixtures validate against their MongoDB schemas', async () => {
  const fixtures = [
    [Product, readJSON('products.json').products],
    [Category, readJSON('categories.json')],
    [Order, readJSON('orders.json').orders],
    [Blog, readJSON('blogs.json').blogs],
    [Comment, readJSON('comments.json').comments],
    [Gallery, readJSON('gallery.json')],
    [Voucher, readJSON('vouchers.json').vouchers],
    [ChatSession, readJSON('chatbot.json').sessions],
    [ChatSession, readJSON('chat_sessions.json')],
    [ChatbotFaq, readJSON('chatbot.json').faqs],
    [ChatbotFaq, readJSON('chatbot_faqs.json')],
    [CustomOrder, readJSON('custom_orders.json')]
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

test('gallery fixture and mongoose model use the gallery collection name', () => {
  assert.equal(Gallery.modelName, 'Gallery');
  assert.equal(Gallery.collection.collectionName, 'gallery');
});

test('active voucher fixtures are available within their configured date range', () => {
  const vouchers = readJSON('vouchers.json').vouchers;
  const now = new Date(2026, 10, 4);

  assert.equal(vouchers.filter((voucher) => isVoucherAvailable(voucher, now)).length, 4);
});

test('saved map fixtures link existing customers and allow maps saved by different customers', () => {
  const savedMapData = readJSON('saved_maps.json');
  const customers = readJSON('users.json').users.filter((user) => user.role === 'user');
  const customerById = new Map(customers.map((user) => [user._id, user]));
  const gallery = readJSON('gallery.json');
  const galleryMapIds = new Set(gallery.map((map) => map.map_id));
  assert.ok(savedMapData.users.every((user) => customerById.has(user.userId)));
  assert.ok(savedMapData.users.every((user) => /^[a-f\d]{24}$/i.test(user.userId)));
  assert.ok(savedMapData.users.every((user) => user.mapIds.every((mapId) => galleryMapIds.has(mapId))));

  const prepared = prepareSavedMaps(savedMapData, customers, gallery);
  const mapsPerCustomer = new Map();
  for (const map of prepared) {
    mapsPerCustomer.set(map.userId, (mapsPerCustomer.get(map.userId) || 0) + 1);
  }
  assert.equal(mapsPerCustomer.size, customers.length);
  assert.ok([...mapsPerCustomer.values()].every((count) => count >= 2 && count <= 5));
  assert.ok(new Set(prepared.map((map) => map.mapId)).size >= 25);
  assert.equal(new Set(prepared.map((map) => `${map.userId}:${map.mapId}`)).size, prepared.length);
  assert.ok(prepared.length > new Set(prepared.map((map) => map.mapId)).size);
  for (const map of prepared) {
    const galleryMap = gallery.find((item) => item.map_id === map.mapId);
    assert.equal(map.title, galleryMap.map_name);
    assert.equal(map.image, galleryMap.main_image);
  }
  assert.throws(
    () => prepareSavedMaps(
      { users: [{ ...savedMapData.users[0], mapIds: ['M01', 'M01'] }] },
      customers,
      gallery
    ),
    /duplicate saved map/
  );
  for (const map of prepared) {
    assert.doesNotReject(new SavedMap(map).validate());
  }
});

test('cart and review fixtures use real products and delivered customer orders', async () => {
  const users = readJSON('users.json').users.filter((user) => user.role === 'user');
  const products = readJSON('products.json').products;
  const carts = prepareCartFixtures(readJSON('carts.json'), users, products);
  const { orders, reviews } = prepareReviewFixtures(readJSON('review_orders.json'), users, products);
  const productsById = new Map(products.map((product) => [product.id, product]));

  assert.equal(carts.length, users.length);
  assert.ok(carts.every((cart) => cart.items.length >= 8));
  assert.equal(new Set(carts.map((cart) => String(cart.userId))).size, users.length);
  for (const cart of carts) {
    await new Cart(cart).validate();
    const response = buildCartResponse(cart, cart.items.map((item) => productsById.get(item.productId)));
    assert.equal(response.items.length, cart.items.length);
    assert.equal(response.subtotal, response.items.reduce((sum, item) => sum + item.lineTotal, 0));
    assert.ok(response.selectedSubtotal <= response.subtotal);
  }

  const orderIds = new Set(orders.map((order) => order.id));
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const productReviewCounts = new Map();
  const ratings = new Set();
  const reviewTopics = new Set();
  let imageReviewCount = 0;
  for (const order of orders) {
    assert.equal(order.statusType, 'completed');
    assert.ok(order.userId);
    await new Order(order).validate();
  }
  for (const review of reviews) {
    assert.ok(orderIds.has(review.orderId));
    assert.ok(productsById.has(review.productId));
    assert.ok(review.createdAt > ordersById.get(review.orderId).deliveredAt);
    const purchasedItem = ordersById.get(review.orderId).items.find((item) => item.productId === review.productId);
    assert.ok(purchasedItem);
    assert.equal(review.variantIndex, purchasedItem.variantIndex);
    assert.equal(review.variantName, purchasedItem.variantName);
    productReviewCounts.set(review.productId, (productReviewCounts.get(review.productId) || 0) + 1);
    ratings.add(review.rating);
    if (review.content.includes('giao') || review.content.includes('đơn')) reviewTopics.add('shipping');
    if (review.content.includes('mong') || review.content.includes('Shop nên')) reviewTopics.add('suggestion');
    if (review.content.includes('chất lượng') || review.content.includes('sản phẩm')) reviewTopics.add('product');
    if (review.media.some((media) => media.type === 'image')) imageReviewCount += 1;
    await new Review(review).validate();
  }
  assert.equal(productReviewCounts.size, products.length);
  assert.equal(reviews.length, 61);
  assert.equal(new Set(reviews.map((review) => review.content).filter(Boolean)).size, 30);
  assert.ok([...ratings].some((rating) => rating <= 2));
  assert.ok(ratings.has(3));
  assert.ok([...ratings].some((rating) => rating >= 4));
  assert.deepEqual(reviewTopics, new Set(['product', 'shipping', 'suggestion']));
  assert.ok(imageReviewCount > 0);

  const reviewBuckets = {
    starsOnly: reviews.filter((review) => !review.content && review.media.length === 0).length,
    text: reviews.filter((review) => review.content && review.media.length === 0).length,
    media: reviews.filter((review) => review.media.length > 0).length,
    image: reviews.filter((review) => review.media.some((media) => media.type === 'image')).length,
    video: reviews.filter((review) => review.media.some((media) => media.type === 'video')).length
  };
  assert.deepEqual(reviewBuckets, {
    starsOnly: 31,
    text: 20,
    media: 10,
    image: 7,
    video: 3
  });

  const rawReviewData = readJSON('review_orders.json');
  const allowedOrderKeys = new Set(['id', 'userId', 'statusType', 'deliveredAt', 'items']);
  const allowedOrderItemKeys = new Set(['productId', 'variantIndex']);
  const allowedReviewKeys = new Set(['orderId', 'productId', 'rating', 'content', 'media']);
  assert.ok(rawReviewData.orders.every((order) => (
    Object.keys(order).every((key) => allowedOrderKeys.has(key))
  )));
  assert.ok(rawReviewData.orders.every((order) => order.items.every((item) => (
    Object.keys(item).every((key) => allowedOrderItemKeys.has(key))
  ))));
  assert.ok(rawReviewData.reviews.every((review) => (
    Object.keys(review).every((key) => allowedReviewKeys.has(key))
  )));
  assert.ok(rawReviewData.reviews.every((review) => (
    typeof review.content === 'string'
      && Number.isInteger(review.rating)
      && !Object.hasOwn(review, 'userId')
      && !Object.hasOwn(review, 'variantName')
  )));

  await new Review({
    id: 'media-only-review',
    orderId: 'UR-REVIEW-001',
    userId: users[0]._id,
    productId: products[0].id,
    rating: 5,
    variantIndex: 0,
    variantName: products[0].variants[0].name,
    media: [{ type: 'video', url: 'https://example.com/review.mp4' }]
  }).validate();
  await new Review({
    id: 'empty-review',
    orderId: 'UR-REVIEW-001',
    userId: users[0]._id,
    productId: products[0].id,
    rating: 5,
    variantIndex: 0,
    variantName: products[0].variants[0].name
  }).validate();

  const unreviewedOrders = orders.filter((order) => order.showReview);
  const reviewedOrders = orders.filter((order) => !order.showReview);
  assert.equal(unreviewedOrders.length, 3);
  assert.equal(reviewedOrders.length, 16);
  assert.ok(unreviewedOrders.every((order) => !reviews.some((review) => review.orderId === order.id)));
  assert.ok(reviewedOrders.every((order) => reviews.some((review) => review.orderId === order.id)));
});

test('custom order model uses the custom_orders collection', () => {
  assert.equal(CustomOrder.modelName, 'CustomOrder');
  assert.equal(CustomOrder.collection.collectionName, 'custom_orders');
});

test('custom order model accepts the requested fields and validates image URL', async () => {
  const customOrder = new CustomOrder({
    id: 'custom-order-test',
    fullName: 'Nguyễn An',
    phone: '0901234567',
    email: 'an@example.com',
    requestName: 'Móc khóa thú cưng',
    size: '15 x 15',
    beadType: 'Hạt Perler 5mm (Midi Beads)',
    description: 'Màu sắc sáng, lấy phần chân dung',
    imageNote: 'Cắt nền giúp mình',
    imageUrl: 'https://example.com/uploaded-image.jpg'
  });
  await assert.doesNotReject(customOrder.validate());
  assert.equal(customOrder.status, 'pending');
  await assert.rejects(
    new CustomOrder({
      id: 'custom-order-invalid',
      fullName: 'Nguyễn An',
      phone: '0901234567',
      email: 'an@example.com',
      requestName: 'Móc khóa thú cưng',
      size: '15 x 15',
      beadType: 'Hạt Perler 5mm (Midi Beads)',
      imageUrl: 'javascript:alert(1)'
    }).validate(),
    { name: 'ValidationError' }
  );
});

test('custom order fixtures use existing customers and images available on this backend', () => {
  const customOrders = readJSON('custom_orders.json');
  const existingCustomers = new Set(
    readJSON('users.json').users
      .filter((user) => user.role === 'user')
      .map((user) => `${user.name}|${user.phone}|${user.email}`)
  );

  assert.ok(customOrders.length > 1);
  assert.ok(new Set(customOrders.map((order) => order.email)).size > 1);
  for (const order of customOrders) {
    assert.ok(
      existingCustomers.has(`${order.fullName}|${order.phone}|${order.email}`),
      `${order.email} must match an existing customer`
    );
    assert.ok(order.imageUrl.startsWith('/images/'));
    assert.ok(isValidImageUrl(order.imageUrl));
    const imagePath = order.imageUrl.replace(/^\/+/, '');
    assert.ok(
      fs.existsSync(path.join(__dirname, '..', 'public', imagePath)),
      `${order.imageUrl} must point to an image served by this backend`
    );
  }
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
  const maps = prepareGallery([{ map_id: 'M01', map_name: 'Map mẫu' }]);
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
  assert.equal(isVoucherAvailable({
    ...voucher,
    startDate: '2026-05-01',
    endDate: '2026-05-31'
  }, now), true);
});

test('Excel conversion keeps the existing product fixture format', () => {
  const workbook = XLSX.readFile(dataPath('Urii_Product.xlsx'));
  const products = buildProducts(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]));
  const fixture = readJSON('products.json').products;

  assert.equal(products.length, fixture.length);
  assert.equal(products[0].id, fixture[0].id);
  assert.equal(products[0].variants.length, fixture[0].variants.length);
});
