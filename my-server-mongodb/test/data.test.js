const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const bcrypt = require('bcryptjs');

const Product = require('../models/Product');
const Category = require('../models/Category');
const Order = require('../models/Order');
const SavedMap = require('../models/SavedMap');
const LikedProduct = require('../models/LikedProduct');
const LikedBlog = require('../models/LikedBlog');
const Blog = require('../models/Blog');
const Comment = require('../models/Comment');
const Gallery = require('../models/Gallery');
const Voucher = require('../models/Voucher');
const ChatSession = require('../models/ChatSession');
const ChatbotFaq = require('../models/ChatbotFaq');
const CustomOrder = require('../models/CustomOrder');
const Cart = require('../models/Cart');
const Review = require('../models/Review');
const User = require('../models/User');
const { isValidImageUrl } = require('../utils/imageUrl');
const { getPagination } = require('../utils/pagination');
const { prepareUserPassword } = require('../utils/userPassword');
const {
  insertMissing,
  prepareGallery,
  prepareNewUsers,
  seed,
  syncOrderReasonReferences
} = require('../seed');
const { buildProducts } = require('../convert_excel');
const XLSX = require('xlsx');
const { isVoucherAvailable } = require('../controllers/voucherController');
const { prepareSavedMaps } = require('../utils/savedMaps');
const { prepareLikedProducts } = require('../utils/likedProducts');
const { prepareLikedBlogs } = require('../utils/likedBlogs');
const {
  applyProductRatings,
  buildCartResponse,
  calculateProductRatingStats,
  prepareCartFixtures,
  prepareReviewFixtures,
  syncProductRating
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
    [CustomOrder, readJSON('custom_orders.json')],
    [User, readJSON('users.json').users]
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
  assert.ok(readJSON('users.json').users
    .filter((user) => user.authProviders.includes('password'))
    .every((user) => user.password === 'urii123@'));
  const googleUser = readJSON('users.json').users.find(
    (user) => user.email === 'lentnk24411@st.uel.edu.vn'
  );
  assert.deepEqual(googleUser.authProviders, ['google']);
  assert.equal(googleUser.password, null);
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

test('orders reference existing customers, catalog entities, and status IDs', async () => {
  const users = readJSON('users.json').users;
  const products = readJSON('products.json').products;
  const vouchers = readJSON('vouchers.json').vouchers;
  const orders = readJSON('orders.json').orders;
  const statuses = readJSON('order_statuses.json');
  const userIds = new Set(users.map((user) => String(user._id)));
  const productIds = new Set(products.map((product) => product.id));
  const voucherIds = new Set(vouchers.map((voucher) => voucher.id));
  const statusIds = (group) => new Set(statuses[group].map((status) => status.id));
  const orderStatusIds = statusIds('orderStatuses');
  const paymentMethodIds = statusIds('paymentMethods');
  const paymentStatusIds = statusIds('paymentStatuses');
  const shippingMethodIds = statusIds('shippingMethods');
  const timelineStatusIds = statusIds('timelineStatuses');
  const shippingStatusIds = statusIds('shippingStatuses');

  assert.equal(orders.length, 36);
  for (const order of orders) {
    assert.ok(userIds.has(String(order.userId)), `${order.id} must reference a customer`);
    assert.ok(orderStatusIds.has(order.statusId), `${order.id} must reference an order status`);
    assert.equal(typeof order.totalAmount, 'number');
    assert.ok(Number.isSafeInteger(order.totalAmount));
    assert.ok(order.items.length > 0);
    for (const item of order.items) {
      assert.ok(productIds.has(item.productId));
      assert.equal(typeof item.unitPrice, 'number');
      assert.equal(typeof item.quantity, 'number');
      assert.equal(Object.hasOwn(item, 'name'), false);
      assert.equal(Object.hasOwn(item, 'image'), false);
    }
    if (order.voucher) {
      assert.ok(voucherIds.has(order.voucher.voucherId));
      assert.ok(Number.isSafeInteger(order.voucher.discountAmount));
    }
    assert.ok(paymentMethodIds.has(order.payment?.methodId));
    assert.equal(Object.hasOwn(order.payment, 'method'), false);
    if (order.payment?.statusId) assert.ok(paymentStatusIds.has(order.payment.statusId));
    assert.ok(shippingMethodIds.has(order.shipping?.methodId));
    assert.equal(Object.hasOwn(order.shipping, 'carrier'), false);
    assert.equal(Object.hasOwn(order.shipping, 'method'), false);
    assert.ok(order.timeline.every((event) => timelineStatusIds.has(event.statusId)));
    assert.ok(order.shippingTimeline.every((event) => shippingStatusIds.has(event.statusId)));
    for (const duplicateField of ['userName', 'status', 'statusType', 'total', 'icon', 'detailId', 'address']) {
      assert.equal(Object.hasOwn(order, duplicateField), false, `${order.id} should not duplicate ${duplicateField}`);
    }
  }
});

test('order reason fixture is linked to cancelled and returned orders with required evidence', async () => {
  const reasonData = readJSON('order_reasons.json');
  const orders = readJSON('orders.json').orders;
  const cancelReasons = new Map(reasonData.cancelReasons.map((reason) => [reason.id, reason]));
  const returnReasons = new Map(reasonData.returnReasons.map((reason) => [reason.id, reason]));
  const cancelIds = reasonData.cancelReasons.map((reason) => reason.id);
  const returnIds = reasonData.returnReasons.map((reason) => reason.id);
  assert.equal(new Set(cancelIds).size, cancelIds.length);
  assert.equal(new Set(returnIds).size, returnIds.length);

  const cancelledOrders = orders.filter((order) => order.statusId === 'cancelled');
  const returnedOrders = orders.filter((order) => order.statusId === 'returned');
  assert.equal(cancelledOrders.length, 6);
  assert.equal(returnedOrders.length, 6);
  for (const order of cancelledOrders) {
    const reason = cancelReasons.get(order.cancellationReasonId);
    assert.ok(reason, `${order.id} must reference a cancellation reason`);
    if (reason.requiresNote) assert.ok(order.cancellationNote?.trim());
    await new Order(order).validate();
  }
  for (const order of returnedOrders) {
    const reason = returnReasons.get(order.returnReasonId);
    assert.ok(reason, `${order.id} must reference a return reason`);
    const evidence = order.returnEvidence || [];
    assert.ok(evidence.filter((item) => item.type === 'image').length >= (reason.requiresMedia?.images || 0));
    assert.ok(evidence.filter((item) => item.type === 'video').length >= (reason.requiresMedia?.videos || 0));
    for (const item of evidence) {
      assert.ok(['image', 'video'].includes(item.type));
      assert.ok(isValidImageUrl(item.url));
      if (item.url.startsWith('/images/')) {
        assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', item.url.slice(1))));
      }
    }
    await new Order(order).validate();
  }
  assert.equal(orders.filter((order) => order.statusId !== 'cancelled' && order.cancellationReasonId).length, 0);
  assert.equal(orders.filter((order) => order.statusId !== 'returned' && order.returnReasonId).length, 0);

  const syncableOrders = orders.filter((order) => order.cancellationReasonId || order.returnReasonId);
  const result = await syncOrderReasonReferences(syncableOrders, {
    bulkWrite: async (operations, options) => {
      assert.equal(options.ordered, true);
      return operations;
    }
  });
  assert.equal(result.length, 12);
});

test('saved map fixtures link existing customers and allow maps saved by different customers', () => {
  const savedMapData = readJSON('saved_maps.json');
  const fixtureUserIds = new Set(savedMapData.users.map((user) => user.userId));
  const customers = readJSON('users.json').users.filter(
    (user) => user.role === 'user' && fixtureUserIds.has(user._id)
  );
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

test('liked product fixtures link existing customers and products by ID', () => {
  const likedProductData = readJSON('liked_products.json');
  const fixtureUserIds = new Set(likedProductData.users.map((user) => user.userId));
  const customers = readJSON('users.json').users.filter(
    (user) => user.role === 'user' && fixtureUserIds.has(user._id)
  );
  const customerById = new Map(customers.map((user) => [user._id, user]));
  const products = readJSON('products.json').products;
  const productIds = new Set(products.map((product) => product.id));

  assert.equal(LikedProduct.modelName, 'LikedProduct');
  assert.equal(LikedProduct.collection.collectionName, 'liked_products');
  assert.ok(likedProductData.users.every((user) => customerById.has(user.userId)));
  assert.ok(likedProductData.users.every((user) => /^[a-f\d]{24}$/i.test(user.userId)));
  assert.ok(likedProductData.users.every((user) => user.productIds.every((id) => productIds.has(id))));

  const prepared = prepareLikedProducts(likedProductData, customers, products);
  const productsPerCustomer = new Map();
  for (const item of prepared) {
    productsPerCustomer.set(item.userId, (productsPerCustomer.get(item.userId) || 0) + 1);
    for (const duplicateField of ['name', 'image', 'price', 'currentPrice', 'originalPrice', 'slug']) {
      assert.equal(Object.hasOwn(item, duplicateField), false);
    }
  }
  assert.equal(productsPerCustomer.size, customers.length);
  assert.ok([...productsPerCustomer.values()].every((count) => count >= 2 && count <= 10));
  assert.ok(new Set(prepared.map((item) => item.productId)).size >= 25);
  assert.equal(new Set(prepared.map((item) => `${item.userId}:${item.productId}`)).size, prepared.length);
  assert.ok(prepared.length > new Set(prepared.map((item) => item.productId)).size);
  assert.throws(
    () => prepareLikedProducts(
      { users: [{ ...likedProductData.users[0], productIds: ['1075483767', '1075483767'] }] },
      customers,
      products
    ),
    /duplicate liked product/
  );
  for (const item of prepared) {
    assert.doesNotReject(new LikedProduct(item).validate());
  }
});

test('liked blog fixtures link existing customers and blogs and match blog like/comment counts', () => {
  const likedBlogData = readJSON('liked_blogs.json');
  const fixtureUserIds = new Set(likedBlogData.users.map((user) => user.userId));
  const customers = readJSON('users.json').users.filter(
    (user) => user.role === 'user' && fixtureUserIds.has(user._id)
  );
  const customerById = new Map(customers.map((user) => [user._id, user]));
  const blogs = readJSON('blogs.json').blogs;
  const comments = readJSON('comments.json').comments;
  const blogIds = new Set(blogs.map((blog) => blog.id));

  assert.equal(LikedBlog.modelName, 'LikedBlog');
  assert.equal(LikedBlog.collection.collectionName, 'liked_blogs');
  assert.ok(likedBlogData.users.every((user) => customerById.has(user.userId)));
  assert.ok(likedBlogData.users.every((user) => /^[a-f\d]{24}$/i.test(user.userId)));
  assert.ok(likedBlogData.users.every((user) => user.blogIds.every((id) => blogIds.has(id))));

  const prepared = prepareLikedBlogs(likedBlogData, customers, blogs);
  const blogsPerCustomer = new Map();
  const likesPerBlog = new Map();
  for (const item of prepared) {
    blogsPerCustomer.set(item.userId, (blogsPerCustomer.get(item.userId) || 0) + 1);
    likesPerBlog.set(item.blogId, (likesPerBlog.get(item.blogId) || 0) + 1);
    for (const duplicateField of ['title', 'slug', 'image', 'author', 'excerpt']) {
      assert.equal(Object.hasOwn(item, duplicateField), false);
    }
  }
  assert.equal(blogsPerCustomer.size, customers.length);
  assert.ok([...blogsPerCustomer.values()].every((count) => count >= 2 && count <= 12));
  assert.equal(likesPerBlog.size, blogs.length);
  assert.equal(new Set(prepared.map((item) => `${item.userId}:${item.blogId}`)).size, prepared.length);

  for (const blog of blogs) {
    const expectedLikes = likesPerBlog.get(blog.id) || 0;
    const expectedComments = comments.filter((c) => c.blogId === blog.id).length;
    assert.equal(blog.likes, expectedLikes, `Blog ${blog.id} likes must equal liked_blogs count`);
    assert.ok(blog.likes <= customers.length, `Blog ${blog.id} likes cannot exceed customer count`);
    assert.equal(blog.comments, expectedComments, `Blog ${blog.id} comments must equal comments.json count`);
    assert.ok(blog.views >= blog.likes + blog.comments && blog.views <= 60, `Blog ${blog.id} views must be realistic`);
  }

  assert.throws(
    () => prepareLikedBlogs(
      { users: [{ ...likedBlogData.users[0], blogIds: [1, 1] }] },
      customers,
      blogs
    ),
    /duplicate liked blog/
  );
  for (const item of prepared) {
    assert.doesNotReject(new LikedBlog(item).validate());
  }
});

test('cart and review fixtures use real products and delivered customer orders', async () => {
  const cartUserIds = new Set(readJSON('carts.json').carts.map((cart) => cart.userId));
  const users = readJSON('users.json').users.filter(
    (user) => user.role === 'user' && cartUserIds.has(user._id)
  );
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
    assert.equal(order.statusId, 'completed');
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
  assert.deepEqual(ratings, new Set([3, 4, 5]));
  assert.ok(reviews.every((review) => Number.isInteger(review.rating) && review.rating >= 3 && review.rating <= 5));
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
  const allowedOrderKeys = new Set(['id', 'userId', 'statusId', 'deliveredAt', 'items']);
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

  const ratingStats = calculateProductRatingStats(reviews);
  for (const product of products) {
    const expected = ratingStats.get(product.id);
    assert.equal(product.rating, expected.rating, `Product ${product.id} rating must match reviews`);
    assert.equal(product.reviewCount, expected.reviewCount, `Product ${product.id} reviewCount must match reviews`);
  }

  // Verify dynamic recalculation when new reviews are added
  const updatedProducts = applyProductRatings(products, [
    ...reviews,
    { productId: '1075483767', rating: 3 },
    { productId: '1075483767', rating: 4 }
  ]);
  const updatedFirst = updatedProducts.find((p) => p.id === '1075483767');
  assert.equal(updatedFirst.reviewCount, 3);
  assert.equal(updatedFirst.rating, 4);

  let updatedProductPayload = null;
  const syncResult = await syncProductRating('1075483767', {
    ReviewModel: {
      aggregate: async () => [{ _id: '1075483767', reviewCount: 3, ratingSum: 13 }]
    },
    ProductModel: {
      findOneAndUpdate: async (filter, update) => {
        updatedProductPayload = { filter, update };
        return {};
      }
    }
  });
  assert.deepEqual(syncResult, { productId: '1075483767', rating: 4.33, reviewCount: 3 });
  assert.deepEqual(updatedProductPayload, {
    filter: { id: '1075483767' },
    update: { $set: { rating: 4.33, reviewCount: 3 } }
  });
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

test('custom order, comment, blog, and chat session fixtures reference IDs instead of duplicating customer or gallery details', () => {
  const customOrders = readJSON('custom_orders.json');
  const customerIds = new Set(
    readJSON('users.json').users
      .filter((user) => user.role === 'user')
      .map((user) => String(user._id))
  );
  const galleryById = new Map(readJSON('gallery.json').map((map) => [map.map_id, map]));

  assert.ok(customOrders.length > 1);
  assert.ok(new Set(customOrders.map((order) => String(order.userId))).size > 1);
  for (const order of customOrders) {
    assert.ok(customerIds.has(String(order.userId)), `${order.id} must reference an existing customer ID`);
    const galleryMap = galleryById.get(order.mapId);
    assert.ok(galleryMap, `${order.id} must reference an existing gallery map ID`);
    assert.equal(order.imageNote, 'Ảnh mẫu tham khảo từ thư viện Urii.');
    for (const duplicateField of ['fullName', 'phone', 'email', 'imageUrl']) {
      assert.equal(Object.hasOwn(order, duplicateField), false, `${order.id} should not duplicate ${duplicateField}`);
    }
    assert.ok(
      fs.existsSync(path.join(__dirname, '..', 'public', galleryMap.main_image)),
      `${galleryMap.main_image} must point to an image served by this backend`
    );
  }

  const blogData = readJSON('blogs.json');
  const blogIds = new Set(blogData.blogs.map((blog) => blog.id));
  const blogCategoryIds = new Set((blogData.categories || []).map((cat) => cat.id));
  for (const blog of blogData.blogs) {
    assert.ok(customerIds.has(String(blog.userId)), `Blog ${blog.id} must reference userId`);
    assert.ok(blogCategoryIds.has(blog.categoryId), `Blog ${blog.id} must reference categoryId`);
    for (const duplicateField of ['author', 'avatar', 'category', 'categorySlug']) {
      assert.equal(Object.hasOwn(blog, duplicateField), false, `Blog ${blog.id} should not duplicate ${duplicateField}`);
    }
  }

  const comments = readJSON('comments.json').comments;
  for (const comment of comments) {
    assert.ok(blogIds.has(comment.blogId), `Comment ${comment.id} must reference blogId`);
    assert.ok(customerIds.has(String(comment.userId)), `Comment ${comment.id} must reference userId`);
    for (const duplicateField of ['author', 'avatar']) {
      assert.equal(Object.hasOwn(comment, duplicateField), false, `Comment ${comment.id} should not duplicate ${duplicateField}`);
    }
  }

  const chatSessions = readJSON('chat_sessions.json');
  const chatbotSessions = readJSON('chatbot.json').sessions;
  for (const session of [...chatSessions, ...chatbotSessions]) {
    assert.ok(customerIds.has(String(session.userId)), `Session ${session.sessionId} must reference userId`);
    for (const duplicateField of ['userName', 'userEmail', 'avatar']) {
      assert.equal(Object.hasOwn(session, duplicateField), false, `Session ${session.sessionId} should not duplicate ${duplicateField}`);
    }
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
  const users = readJSON('users.json').users.map((user) => ({
    ...user,
    password: '$GENERATE'
  }));
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

test('pre-hashed fixture passwords are inserted without hashing them again', async () => {
  const user = {
    ...readJSON('users.json').users[0],
    password: await bcrypt.hash('urii123@', 10)
  };
  const result = await prepareNewUsers([user], []);

  assert.equal(result.documents[0].password, user.password);
  assert.equal(result.credentials.length, 0);
  assert.equal(await bcrypt.compare('urii123@', result.documents[0].password), true);
});

test('plain fixture passwords are hashed for new users', async () => {
  const user = readJSON('users.json').users[0];
  const result = await prepareNewUsers([user], []);

  assert.notEqual(result.documents[0].password, user.password);
  assert.equal(await bcrypt.compare('urii123@', result.documents[0].password), true);
  assert.equal(result.credentials.length, 0);
});

test('social-only users can be seeded without a local password', async () => {
  const user = readJSON('users.json').users.find(
    (entry) => entry.email === 'lentnk24411@st.uel.edu.vn'
  );
  const result = await prepareNewUsers([user], []);

  assert.equal(result.documents[0].password, null);
  assert.deepEqual(result.documents[0].authProviders, ['google']);
  assert.equal(result.credentials.length, 0);
  assert.equal(await prepareUserPassword(null, null, ['google']), null);
  assert.equal(
    await prepareUserPassword(null, 'existing-password-hash', ['google']),
    'existing-password-hash'
  );
});

test('bcrypt password hashes in data are preserved for upload', async () => {
  const hash = await bcrypt.hash('urii123@', 10);
  const oldHash = await bcrypt.hash('old-password', 4);

  assert.equal(await prepareUserPassword(hash, oldHash), hash);
  assert.equal(await bcrypt.compare('urii123@', hash), true);
});

test('plain passwords are hashed and generated markers preserve existing passwords', async () => {
  const oldHash = await bcrypt.hash('old-password', 4);
  const newHash = await prepareUserPassword('new-password', oldHash);

  assert.notEqual(newHash, 'new-password');
  assert.equal(await bcrypt.compare('new-password', newHash), true);
  assert.equal(await prepareUserPassword('$GENERATE', oldHash), oldHash);
});

test('new generated-marker users receive the existing default password hash', async () => {
  const hash = await prepareUserPassword('$GENERATE');

  assert.equal(await bcrypt.compare('UriiUser@2026Secure', hash), true);
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

test('review routes and getProductReviews serve product reviews without 404 when collection exists', async () => {
  const reviewRoutes = require('../routes/reviewRoutes');
  const productRoutes = require('../routes/productRoutes');
  const reviewController = require('../controllers/reviewController');

  const reviewRoutePaths = reviewRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`);
  assert.ok(reviewRoutePaths.includes('GET /'));
  assert.ok(reviewRoutePaths.includes('GET /product/:productId'));
  assert.ok(reviewRoutePaths.includes('GET /products/:productId'));
  assert.ok(reviewRoutePaths.includes('GET /:productId'));

  const productRoutePaths = productRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`);
  assert.ok(productRoutePaths.includes('GET /:productId/reviews'));

  const origProductFindOne = Product.findOne;
  const origReviewFind = Review.find;
  const origReviewCount = Review.countDocuments;
  const origReviewAggregate = Review.aggregate;
  const origUserFind = User.find;

  try {
    Product.findOne = () => ({ select: () => ({ lean: async () => null }) });
    Review.find = () => ({
      sort: () => ({
        skip: () => ({
          limit: () => ({
            lean: async () => [{
              id: 'rev-1',
              productId: '1075504621',
              userId: '6ade4310c044b23d6c6a8681',
              rating: 3,
              content: 'Tạm ổn',
              media: []
            }]
          })
        })
      })
    });
    Review.countDocuments = async () => 1;
    Review.aggregate = async () => [{ _id: 3, count: 1 }];
    User.find = () => ({
      select: () => ({
        lean: async () => [{ _id: '6ade4310c044b23d6c6a8681', name: 'Nguyễn Minh Anh', avatar: '/images/avatar_user.jpeg' }]
      })
    });

    let statusCode = 200;
    let body = null;
    await reviewController.getProductReviews(
      { params: { productId: '1075504621' }, query: {} },
      {
        status(code) {
          statusCode = code;
          return this;
        },
        json(payload) {
          body = payload;
        }
      }
    );

    assert.equal(statusCode, 200);
    assert.equal(body.productId, '1075504621');
    assert.equal(body.total, 1);
    assert.equal(body.averageRating, 3);
    assert.equal(body.reviews[0].userName, 'Nguyễn Minh Anh');
  } finally {
    Product.findOne = origProductFindOne;
    Review.find = origReviewFind;
    Review.countDocuments = origReviewCount;
    Review.aggregate = origReviewAggregate;
    User.find = origUserFind;
  }
});

test('auth/me, login profile formatting, and self user read work securely with avatar and without password', async () => {
  const authController = require('../controllers/authController');
  const authRoutes = require('../routes/authRoutes');
  const userRoutes = require('../routes/userRoutes');

  const authRoutePaths = authRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`);
  assert.ok(authRoutePaths.includes('GET /me'));
  assert.ok(authRoutePaths.includes('PATCH /me'));

  const userRoutePaths = userRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`);
  assert.ok(userRoutePaths.includes('GET /me'));

  const sampleUser = readJSON('users.json').users[0];
  const formatted = authController.formatAuthUser(sampleUser);
  assert.equal(formatted.avatar, sampleUser.avatar);
  assert.equal(formatted.name, sampleUser.name);
  assert.equal(formatted.email, sampleUser.email);
  assert.equal(Object.hasOwn(formatted, 'password'), false);

  const origFindById = User.findById;
  try {
    User.findById = () => ({
      select(sel) {
        assert.equal(sel, '-password');
        return {
          lean: async () => sampleUser
        };
      }
    });

    let statusCode = 200;
    let body = null;
    await authController.getMe(
      { auth: { id: sampleUser._id, role: 'user' } },
      {
        status(code) {
          statusCode = code;
          return this;
        },
        json(payload) {
          body = payload;
        }
      }
    );

    assert.equal(statusCode, 200);
    assert.equal(body.email, sampleUser.email);
    assert.equal(body.avatar, sampleUser.avatar);
    assert.equal(Object.hasOwn(body, 'password'), false);
  } finally {
    User.findById = origFindById;
  }
});
