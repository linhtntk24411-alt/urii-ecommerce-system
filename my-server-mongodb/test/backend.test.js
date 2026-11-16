const assert = require('node:assert/strict');
const http = require('node:http');
const { after, before, mock, test } = require('node:test');
const jwt = require('jsonwebtoken');
const { io: connectSocket } = require('socket.io-client');
const app = require('../app');
const { emitCrudChange, initializeRealtime } = require('../realtime');
const oauthProviders = require('../services/oauthProviders');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const Voucher = require('../models/Voucher');
const UserVoucher = require('../models/UserVoucher');
const ChatSession = require('../models/ChatSession');
const mongoose = require('mongoose');

let server;
let io;
let baseUrl;
const previousJwtSecret = process.env.JWT_SECRET;
const previousNodeEnv = process.env.NODE_ENV;
const previousPublicUserReads = process.env.ALLOW_PUBLIC_USER_READS;

before(async () => {
  process.env.JWT_SECRET = 'test-secret-only';
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_PUBLIC_USER_READS = 'false';
  server = http.createServer(app);
  io = initializeRealtime(server, app.get('allowedOrigins'));
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
    server.listen(0, '127.0.0.1');
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (io) {
    await new Promise((resolve) => io.close(resolve));
  }
  if (previousJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = previousJwtSecret;
  }
  if (previousNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = previousNodeEnv;
  }
  if (previousPublicUserReads === undefined) {
    delete process.env.ALLOW_PUBLIC_USER_READS;
  } else {
    process.env.ALLOW_PUBLIC_USER_READS = previousPublicUserReads;
  }
});

function openAdminSocket(token, extraOptions = {}) {
  return new Promise((resolve, reject) => {
    const socket = connectSocket(`${baseUrl}/admin`, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      reconnection: false,
      timeout: 3000,
      ...extraOptions
    });
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('Timed out while connecting to the admin socket.'));
    }, 4000);
    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      socket.close();
      reject(error);
    });
  });
}

test('health endpoint responds without a database connection', async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'OK');
});

async function beginOAuth(provider) {
  const buildUrl = mock.method(
    oauthProviders,
    'buildAuthorizationUrl',
    (name, state) => `https://provider.example/${name}?state=${state}`
  );
  const response = await fetch(`${baseUrl}/api/auth/oauth/${provider}`, { redirect: 'manual' });
  buildUrl.mock.restore();
  const state = new URL(response.headers.get('location')).searchParams.get('state');
  const cookie = response.headers.get('set-cookie').split(';')[0];
  return { response, state, cookie };
}

test('OAuth start issues a state cookie and callback rejects missing or mismatched state', async () => {
  const { response, state, cookie } = await beginOAuth('google');
  assert.equal(response.status, 302);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);

  const missingCookie = await fetch(
    `${baseUrl}/api/auth/oauth/google/callback?code=auth-code&state=${state}`
  );
  assert.equal(missingCookie.status, 400);

  const mismatchedState = await fetch(
    `${baseUrl}/api/auth/oauth/google/callback?code=auth-code&state=${'a'.repeat(64)}`,
    { headers: { Cookie: cookie } }
  );
  assert.equal(mismatchedState.status, 400);
});

test('OAuth callback signs in registered users without creating new accounts', async () => {
  for (const provider of ['google', 'facebook']) {
    const identity = {
      providerUserId: `${provider}-provider-id`,
      email: `${provider}.user@example.test`,
      emailVerified: provider === 'google',
      name: `${provider} Test User`,
      picture: 'https://example.test/avatar.jpg'
    };
    const existingUser = {
      _id: '6ade4310c044b23d6c6a8681',
      email: identity.email,
      name: identity.name,
      role: 'user',
      avatar: identity.picture,
      authProviders: provider === 'facebook' ? ['password', 'facebook'] : ['password'],
      oauthAccounts: provider === 'facebook'
        ? [{ provider: 'facebook', providerUserId: identity.providerUserId }]
        : [],
      async save() {}
    };
    const { state, cookie } = await beginOAuth(provider);
    const exchange = mock.method(
      oauthProviders,
      'exchangeAuthorizationCode',
      async () => identity
    );
    const findOne = mock.method(User, 'findOne', () => ({
      select: async () => existingUser
    }));
    const create = mock.method(User, 'create', async () => {
      throw new Error('User should not be created.');
    });

    try {
      const response = await fetch(
        `${baseUrl}/api/auth/oauth/${provider}/callback?code=auth-code&state=${state}`,
        { headers: { Cookie: cookie } }
      );
      assert.equal(response.status, 200);
      const html = await response.text();
      const match = /<script id="oauth-payload" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
      assert.ok(match);
      const result = JSON.parse(match[1]);
      assert.equal(result.user.email, identity.email);
      assert.equal(create.mock.callCount(), 0);
    } finally {
      create.mock.restore();
      findOne.mock.restore();
      exchange.mock.restore();
    }
  }
});

test('Google OAuth rejects profiles without a verified email', async () => {
  const { state, cookie } = await beginOAuth('google');
  const exchange = mock.method(oauthProviders, 'exchangeAuthorizationCode', async () => ({
    providerUserId: 'unverified-google-id',
    email: 'unverified@example.test',
    emailVerified: false
  }));
  const findOne = mock.method(User, 'findOne', () => ({
    select: async () => null
  }));
  const create = mock.method(User, 'create', async () => {
    throw new Error('User should not be created.');
  });

  try {
    const response = await fetch(
      `${baseUrl}/api/auth/oauth/google/callback?code=auth-code&state=${state}`,
      { headers: { Cookie: cookie } }
    );
    assert.equal(response.status, 401);
    assert.equal(create.mock.callCount(), 0);
  } finally {
    create.mock.restore();
    findOne.mock.restore();
    exchange.mock.restore();
  }
});

test('canonical API routes and supported aliases resolve', async () => {
  const protectedRequests = [
    ['/api/gallery', 'POST'],
    ['/api/maps', 'POST'],
    ['/api/map', 'POST'],
    ['/api/vouchers', 'POST'],
    ['/api/promotions', 'POST'],
    ['/api/promotion', 'POST'],
    ['/api/voucher', 'POST'],
    ['/api/saved-maps', 'GET'],
    ['/api/savedmaps', 'GET'],
    ['/api/saved_maps', 'GET'],
    ['/api/saved-map', 'GET'],
    ['/api/liked-products', 'GET'],
    ['/api/likedproducts', 'GET'],
    ['/api/liked_products', 'GET'],
    ['/api/liked-product', 'GET'],
    ['/api/liked-products/mine', 'GET'],
    ['/api/liked-products/mine', 'POST'],
    ['/api/liked-blogs', 'GET'],
    ['/api/likedblogs', 'GET'],
    ['/api/liked_blogs', 'GET'],
    ['/api/liked-blog', 'GET'],
    ['/api/liked-blogs/mine', 'GET'],
    ['/api/liked-blogs/mine', 'POST'],
    ['/api/products', 'POST'],
    ['/api/product', 'POST'],
    ['/api/categories', 'POST'],
    ['/api/category', 'POST'],
    ['/api/blogs', 'POST'],
    ['/api/blog', 'POST'],
    ['/api/orders', 'POST'],
    ['/api/order', 'POST'],
    ['/api/orders/order-1/payment', 'POST'],
    ['/api/orders/order-1/payment', 'GET'],
    ['/api/cart', 'GET'],
    ['/api/cart/items', 'POST'],
    ['/api/reviews/mine', 'GET'],
    ['/api/reviews/eligible-orders', 'GET'],
    ['/api/reviews', 'POST'],
    ['/api/comments', 'POST'],
    ['/api/comment', 'POST'],
    ['/api/users', 'POST'],
    ['/api/user', 'POST'],
    ['/api/custom-orders', 'GET'],
    ['/api/custom-order', 'GET'],
  ];
  const protectedResponses = await Promise.all(protectedRequests.map(([path, method]) => (
    fetch(`${baseUrl}${path}`, { method })
  )));
  assert.ok(protectedResponses.every((response) => response.status === 401));

  const chatbotAlias = await fetch(`${baseUrl}/api/chatbot/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(chatbotAlias.status, 400);

  const removedAliases = ['/api/customer-orders', '/api/customer-order', '/api/sample-maps', '/api/samplemaps'];
  const removedAliasResponses = await Promise.all(removedAliases.map((path) => fetch(`${baseUrl}${path}`)));
  assert.ok(removedAliasResponses.every((response) => response.status === 404));

});

test('serves image files from public/images', async () => {
  const response = await fetch(`${baseUrl}/images/avatar-non.jpg`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^image\/jpeg/);
});

test('allows localhost user reads only with the development opt-in and never returns password hashes', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousPublicReads = process.env.ALLOW_PUBLIC_USER_READS;
  process.env.NODE_ENV = 'development';
  process.env.ALLOW_PUBLIC_USER_READS = 'true';
  const find = mock.method(User, 'find', () => {
    const query = {
      select(selection) {
        assert.equal(selection, '-password');
        return query;
      },
      sort() {
        return query;
      },
      skip() {
        return query;
      },
      limit() {
        return query;
      },
      async lean() {
        return [{ _id: 'user-id', email: 'user@example.test', address: 'test address' }];
      }
    };
    return query;
  });
  const findById = mock.method(User, 'findById', () => {
    const query = {
      select(selection) {
        assert.equal(selection, '-password');
        return query;
      },
      async lean() {
        return { _id: '507f1f77bcf86cd799439011', email: 'user@example.test' };
      }
    };
    return query;
  });

  try {
    const listResponse = await fetch(`${baseUrl}/api/users`);
    assert.equal(listResponse.status, 200);
    const users = await listResponse.json();
    assert.equal(users[0].address, 'test address');
    assert.equal(Object.hasOwn(users[0], 'password'), false);

    const userResponse = await fetch(
      `${baseUrl}/api/users/507f1f77bcf86cd799439011`
    );
    assert.equal(userResponse.status, 200);
    assert.equal(Object.hasOwn(await userResponse.json(), 'password'), false);

    process.env.NODE_ENV = 'production';
    const productionResponse = await fetch(`${baseUrl}/api/users`);
    assert.equal(productionResponse.status, 401);
  } finally {
    find.mock.restore();
    findById.mock.restore();
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousPublicReads === undefined) {
      delete process.env.ALLOW_PUBLIC_USER_READS;
    } else {
      process.env.ALLOW_PUBLIC_USER_READS = previousPublicReads;
    }
  }
});

test('requires admin authentication for private reads and all CRUD mutations', async () => {
  const requests = [
    fetch(`${baseUrl}/api/products`, { method: 'POST' }),
    fetch(`${baseUrl}/api/products/sku-1`, { method: 'PUT' }),
    fetch(`${baseUrl}/api/products/sku-1`, { method: 'PATCH' }),
    fetch(`${baseUrl}/api/products/sku-1`, { method: 'DELETE' }),
    fetch(`${baseUrl}/api/users`),
    fetch(`${baseUrl}/api/users/507f1f77bcf86cd799439011`),
    fetch(`${baseUrl}/api/users`, { method: 'POST' }),
    fetch(`${baseUrl}/api/users/507f1f77bcf86cd799439011`, { method: 'PATCH' }),
    fetch(`${baseUrl}/api/users/507f1f77bcf86cd799439011`, { method: 'DELETE' }),
    fetch(`${baseUrl}/api/orders`),
    fetch(`${baseUrl}/api/orders`, { method: 'POST' }),
    fetch(`${baseUrl}/api/orders/UR-82901`, { method: 'PUT' }),
    fetch(`${baseUrl}/api/orders/UR-82901`, { method: 'DELETE' }),
    fetch(`${baseUrl}/api/cart`),
    fetch(`${baseUrl}/api/cart`, { method: 'DELETE' }),
    fetch(`${baseUrl}/api/cart/items/item-1`, { method: 'PATCH' }),
    fetch(`${baseUrl}/api/cart/items/item-1`, { method: 'DELETE' }),
    fetch(`${baseUrl}/api/reviews/mine`),
    fetch(`${baseUrl}/api/reviews/eligible-orders`),
    fetch(`${baseUrl}/api/reviews`, { method: 'POST' }),
    fetch(`${baseUrl}/api/custom-orders`),
    fetch(`${baseUrl}/api/custom-orders/custom-order-1`, { method: 'GET' }),
    fetch(`${baseUrl}/api/custom-orders/custom-order-1`, { method: 'PUT' }),
    fetch(`${baseUrl}/api/custom-orders/custom-order-1`, { method: 'DELETE' }),
    fetch(`${baseUrl}/api/vouchers/manage`),
    fetch(`${baseUrl}/api/vouchers`, { method: 'POST' }),
    fetch(`${baseUrl}/api/vouchers/WELCOME10`, { method: 'PATCH' }),
    fetch(`${baseUrl}/api/vouchers/WELCOME10`, { method: 'DELETE' }),
    fetch(`${baseUrl}/api/categories`, { method: 'POST' }),
    fetch(`${baseUrl}/api/categories/beads`, { method: 'PUT' }),
    fetch(`${baseUrl}/api/categories/beads`, { method: 'DELETE' }),
    fetch(`${baseUrl}/api/blogs`, { method: 'POST' }),
    fetch(`${baseUrl}/api/blogs/tutorial`, { method: 'PATCH' }),
    fetch(`${baseUrl}/api/blogs/tutorial`, { method: 'DELETE' }),
    fetch(`${baseUrl}/api/comments`, { method: 'POST' }),
    fetch(`${baseUrl}/api/comments/1`, { method: 'PUT' }),
    fetch(`${baseUrl}/api/comments/1`, { method: 'DELETE' }),
    fetch(`${baseUrl}/api/gallery`, { method: 'POST' }),
    fetch(`${baseUrl}/api/gallery/map-1`, { method: 'PATCH' }),
    fetch(`${baseUrl}/api/gallery/map-1`, { method: 'DELETE' }),
    fetch(`${baseUrl}/api/saved-maps`),
    fetch(`${baseUrl}/api/saved-maps`, { method: 'POST' }),
    fetch(`${baseUrl}/api/saved-maps/map-1`, { method: 'PATCH' }),
    fetch(`${baseUrl}/api/saved-maps/map-1`, { method: 'DELETE' }),
    fetch(`${baseUrl}/api/chat/faqs`, { method: 'POST' }),
    fetch(`${baseUrl}/api/chat/faqs/faq-1`, { method: 'PATCH' }),
    fetch(`${baseUrl}/api/chat/faqs/faq-1`, { method: 'DELETE' }),
    fetch(`${baseUrl}/api/chat/sessions/session-1`, { method: 'PUT' }),
    fetch(`${baseUrl}/api/dashboard`)
  ];

  const responses = await Promise.all(requests);
  assert.ok(responses.every((response) => response.status === 401));
});

test('rejects malformed public custom order submissions', async () => {
  const response = await fetch(`${baseUrl}/api/custom-orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'Nguyễn An' })
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /phone/);
});

test('rejects authenticated non-admin users from admin-only APIs', async () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-secret-only';
  let response;
  try {
    const token = jwt.sign({ id: 'user-1', role: 'user' }, process.env.JWT_SECRET);
    response = await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  } finally {
    if (previousSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previousSecret;
    }
  }

  assert.equal(response.status, 403);
});

test('rejects admin tokens on customer-only APIs and validates malformed customer submissions', async () => {
  const adminToken = jwt.sign(
    { id: '507f1f77bcf86cd799439011', role: 'admin' },
    process.env.JWT_SECRET
  );
  const forbiddenResponses = await Promise.all([
    fetch(`${baseUrl}/api/reviews/mine`, { headers: { Authorization: `Bearer ${adminToken}` } }),
    fetch(`${baseUrl}/api/reviews/eligible-orders`, { headers: { Authorization: `Bearer ${adminToken}` } })
  ]);
  assert.ok(forbiddenResponses.every((response) => response.status === 403));

  const customerToken = jwt.sign(
    { id: '507f1f77bcf86cd799439011', role: 'user' },
    process.env.JWT_SECRET
  );
  const invalidCart = await fetch(`${baseUrl}/api/cart/items`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${customerToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ productId: 'sku-1', quantity: 0 })
  });
  const invalidReview = await fetch(`${baseUrl}/api/reviews`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${customerToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ orderId: 'order-1', productId: 'sku-1', rating: 6, content: 'bad' })
  });
  const invalidMediaReview = await fetch(`${baseUrl}/api/reviews`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${customerToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      orderId: 'order-1',
      productId: 'sku-1',
      rating: 5,
      content: '',
      media: [{ type: 'audio', url: '/images/orders/bo-kit.jpeg' }]
    })
  });
  assert.equal(invalidCart.status, 400);
  assert.equal(invalidReview.status, 400);
  assert.equal(invalidMediaReview.status, 400);
});

test('allows an existing admin account to access its own cart', async () => {
  const userId = '507f1f77bcf86cd799439011';
  const token = jwt.sign({ id: userId, role: 'admin' }, process.env.JWT_SECRET);
  const exists = mock.method(User, 'exists', async (query) => {
    assert.deepEqual(query, { _id: userId, role: { $in: ['user', 'admin'] } });
    return true;
  });
  const findCart = mock.method(Cart, 'findOne', () => ({
    lean: async () => ({ userId, items: [] }),
  }));

  try {
    const response = await fetch(`${baseUrl}/api/cart`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).items, []);
  } finally {
    findCart.mock.restore();
    exists.mock.restore();
  }
});

test('returns only available vouchers claimed by the authenticated account', async () => {
  const userId = '507f1f77bcf86cd799439011';
  const token = jwt.sign({ id: userId, role: 'user' }, process.env.JWT_SECRET);
  const claims = [
    { userId, voucherId: 'voucher-owned', isUsed: false },
    { userId, voucherId: 'voucher-bd50', code: 'URIIBD50', isUsed: false },
  ];
  const voucher = {
    id: 'voucher-owned',
    code: 'OWNED10',
    name: 'Voucher của tài khoản',
    type: 'percent',
    discountValue: 10,
    minOrder: 0,
    isActive: true,
    quantity: 10,
    used: 0,
  };
  const birthdayVoucher = {
    id: 'voucher-bd50',
    code: 'URIIBD50',
    name: 'Giảm 50% Tháng Sinh Nhật',
    type: 'percent',
    discountValue: 50,
    minOrder: 150000,
    isActive: true,
    quantity: 10,
    used: 0,
  };
  const findUser = mock.method(User, 'findById', () => ({
    select: () => ({ lean: async () => ({ _id: userId, birth: '' }) }),
  }));
  const findClaims = mock.method(UserVoucher, 'find', (query) => {
    assert.deepEqual(query, { userId, isUsed: false, reservedByPaymentId: null });
    return { sort: () => ({ lean: async () => claims }) };
  });
  const findVouchers = mock.method(Voucher, 'find', () => ({
    lean: async () => [voucher, birthdayVoucher],
  }));

  try {
    const response = await fetch(`${baseUrl}/api/user-vouchers/available-to-use`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.length, 1);
    assert.equal(payload[0].userId, userId);
    assert.equal(payload[0].voucher.code, 'OWNED10');
    assert.ok(payload.every((entry) => entry.voucher.code !== 'URIIBD50'));
  } finally {
    findVouchers.mock.restore();
    findClaims.mock.restore();
    findUser.mock.restore();
  }
});

test('keeps the birthday voucher out of generic voucher lists and claims', async () => {
  const birthdayVoucher = {
    id: 'voucher-bd50',
    code: 'URIIBD50',
    name: 'Giảm 50% Tháng Sinh Nhật',
    type: 'percent',
    discountValue: 50,
    isActive: true,
  };
  const regularVoucher = {
    id: 'voucher-regular',
    code: 'WELCOME10',
    name: 'Voucher phổ thông',
    type: 'fixed',
    discountValue: 10000,
    isActive: true,
  };
  const findVouchers = mock.method(Voucher, 'find', () => ({
    lean: async () => [birthdayVoucher, regularVoucher],
  }));

  try {
    const listResponse = await fetch(`${baseUrl}/api/user-vouchers/available`);
    const list = await listResponse.json();
    assert.equal(listResponse.status, 200);
    assert.deepEqual(list.vouchers.map((voucher) => voucher.code), ['WELCOME10']);
  } finally {
    findVouchers.mock.restore();
  }

  const userId = '507f1f77bcf86cd799439011';
  const token = jwt.sign({ id: userId, role: 'user' }, process.env.JWT_SECRET);
  const findBirthday = mock.method(Voucher, 'findOne', () => ({
    lean: async () => birthdayVoucher,
  }));
  try {
    const claimResponse = await fetch(`${baseUrl}/api/user-vouchers/claim`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ voucherId: 'voucher-bd50' }),
    });
    assert.equal(claimResponse.status, 403);
  } finally {
    findBirthday.mock.restore();
  }
});

test('adds authenticated customer cart items using the product variant name', async () => {
  const userId = '507f1f77bcf86cd799439011';
  const token = jwt.sign({ id: userId, role: 'user' }, process.env.JWT_SECRET);
  const product = {
    id: 'cart-product',
    name: 'Sản phẩm giỏ hàng',
    currentPrice: 100000,
    stock: 5,
    variants: [{ name: 'Blue', price: 120000, stock: 4 }]
  };
  const cart = {
    userId,
    items: [],
    async save() {},
  };
  const exists = mock.method(User, 'exists', async () => true);
  const findOneProduct = mock.method(Product, 'findOne', () => ({ lean: async () => product }));
  const findOrCreateCart = mock.method(Cart, 'findOneAndUpdate', async () => cart);
  const findProducts = mock.method(Product, 'find', () => ({ lean: async () => [product] }));

  try {
    const response = await fetch(`${baseUrl}/api/cart/items`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ productId: 'cart-product', variantName: 'Blue', quantity: 2 })
    });

    assert.equal(response.status, 201);
    assert.equal(cart.items[0].variantIndex, 0);
    assert.equal(cart.items[0].quantity, 2);
    const payload = await response.json();
    assert.equal(payload.items[0].variantName, 'Blue');
    assert.equal(payload.items[0].quantity, 2);
  } finally {
    findProducts.mock.restore();
    findOrCreateCart.mock.restore();
    findOneProduct.mock.restore();
    exists.mock.restore();
  }
});

test('removing an already absent cart item succeeds without changing the cart', async () => {
  const userId = '507f1f77bcf86cd799439011';
  const token = jwt.sign({ id: userId, role: 'user' }, process.env.JWT_SECRET);
  const cart = { userId, items: [], save: mock.fn() };
  const exists = mock.method(User, 'exists', async () => true);
  const findOrCreateCart = mock.method(Cart, 'findOneAndUpdate', async () => cart);
  const findProducts = mock.method(Product, 'find', () => ({ lean: async () => [] }));

  try {
    const response = await fetch(`${baseUrl}/api/cart/items/previously-removed-item`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });

    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).items, []);
    assert.equal(cart.save.mock.callCount(), 0);
  } finally {
    findProducts.mock.restore();
    findOrCreateCart.mock.restore();
    exists.mock.restore();
  }
});

test('creates customer checkout orders as pending and associates them with the authenticated user', async () => {
  const userId = '507f1f77bcf86cd799439011';
  const token = jwt.sign({ id: userId, role: 'user' }, process.env.JWT_SECRET);
  let createdOrder;
  const createOrder = mock.method(Order, 'create', async (data) => {
    createdOrder = data;
    return {
      ...data,
      _id: '507f1f77bcf86cd799439012',
      toObject() {
        return { ...data, _id: this._id };
      }
    };
  });
  const findUsers = mock.method(User, 'find', () => ({
    select: () => ({ lean: async () => [] })
  }));

  try {
    const response = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userId: '507f1f77bcf86cd799439099',
        status: 'Đã duyệt',
        statusId: 'approved',
        statusType: 'approved',
        total: '100000',
        items: [],
        address: { name: 'Nguyễn An', phone: '0900000000', address: 'Địa chỉ' }
      })
    });

    assert.equal(response.status, 201);
    assert.match(createdOrder.id, /^UR-\d{5}$/);
    assert.equal(createdOrder.userId, userId);
    assert.equal(createdOrder.statusId, 'pending');
    assert.equal(createdOrder.status, 'Đang chờ duyệt');
    assert.equal(createdOrder.statusType, 'pending');
    const payload = await response.json();
    assert.equal(payload.userId, userId);
    assert.equal(payload.statusId, 'pending');
  } finally {
    findUsers.mock.restore();
    createOrder.mock.restore();
  }
});

test('associates an admin checkout without a customer ID with the authenticated account', async () => {
  const userId = '507f1f77bcf86cd799439021';
  const token = jwt.sign({ id: userId, role: 'admin' }, process.env.JWT_SECRET);
  let createdOrder;
  const createOrder = mock.method(Order, 'create', async (data) => {
    createdOrder = data;
    return {
      ...data,
      _id: '507f1f77bcf86cd799439022',
      toObject() {
        return { ...data, _id: this._id };
      }
    };
  });
  const findUsers = mock.method(User, 'find', () => ({
    select: () => ({ lean: async () => [] })
  }));

  try {
    const response = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status: 'Đã duyệt',
        statusType: 'approved',
        total: '100000',
        items: [],
        address: { name: 'Nguyễn An', phone: '0900000000', address: 'Địa chỉ' }
      })
    });

    assert.equal(response.status, 201);
    assert.match(createdOrder.id, /^UR-\d{5}$/);
    assert.equal(createdOrder.userId, userId);
    assert.equal(createdOrder.statusId, 'pending');
    const payload = await response.json();
    assert.equal(payload.userId, userId);
    assert.equal(payload.statusId, 'pending');
  } finally {
    findUsers.mock.restore();
    createOrder.mock.restore();
  }
});

test('rejects browser requests from origins outside the allow list', async () => {
  const response = await fetch(`${baseUrl}/`, {
    headers: { Origin: 'https://not-allowed.example' }
  });
  assert.equal(response.status, 403);
});

test('authenticates admin socket clients and broadcasts CRUD changes', async () => {
  const token = jwt.sign({ id: 'admin-1', role: 'admin' }, process.env.JWT_SECRET);
  const socket = await openAdminSocket(token);
  try {
    const event = new Promise((resolve) => socket.once('crud:changed', resolve));
    emitCrudChange('products', 'created', 'product-1');
    assert.deepEqual(await event, {
      resource: 'products',
      action: 'created',
      id: 'product-1'
    });
  } finally {
    socket.close();
  }
});

test('rejects missing and non-admin socket credentials', async () => {
  const userToken = jwt.sign({ id: 'user-1', role: 'user' }, process.env.JWT_SECRET);
  await assert.rejects(openAdminSocket(null), /Unauthorized/);
  await assert.rejects(openAdminSocket(userToken), /Forbidden/);
});

test('rejects socket handshakes from origins outside the allow list', async () => {
  const token = jwt.sign({ id: 'admin-1', role: 'admin' }, process.env.JWT_SECRET);
  await assert.rejects(
    openAdminSocket(token, { extraHeaders: { Origin: 'https://not-allowed.example' } }),
    /websocket error|xhr poll error/i
  );
});

test('rejects malformed registration data before accessing the database', async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'invalid', password: 'short' })
  });
  assert.equal(response.status, 400);
});

// These HTTP tests isolate persistence, never connect to the configured application database.
function reactionQuery(value) {
  return { select() { return this; }, session() { return this; }, lean() { return Promise.resolve(value?.toObject ? value.toObject() : value); },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
}

function openUserSocket(token, headers = {}) {
  return new Promise((resolve, reject) => {
    const socket = connectSocket(`${baseUrl}/user`, { auth: token ? { token } : {}, transports: ['websocket'], reconnection: false, extraHeaders: headers });
    const timer = setTimeout(() => { socket.close(); reject(new Error('Socket timeout')); }, 1500);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('connect_error', error => { clearTimeout(timer); socket.close(); reject(error); });
  });
}

test('merge socket: rejects invalid tokens, unauthorized chat rooms and forged identify', async t => {
  const session = new ChatSession({ sessionId: 'private-room', userName: 'Owner', reactionOwnerId: 'account:507f1f77bcf86cd799439011' });
  t.mock.method(ChatSession, 'findOne', filter => reactionQuery(filter.sessionId === session.sessionId ? session : null));
  await assert.rejects(openUserSocket('invalid'), /Unauthorized/);
  const owner = await openUserSocket(reactionToken()); const stranger = await openUserSocket(reactionToken('507f1f77bcf86cd799439012')); const guest = await openUserSocket();
  t.after(() => { owner.close(); stranger.close(); guest.close(); });
  assert.equal((await owner.timeout(1000).emitWithAck('chat:join', 'private-room')).ok, true);
  assert.equal((await stranger.timeout(1000).emitWithAck('chat:join', 'private-room')).ok, false);
  assert.equal((await guest.timeout(1000).emitWithAck('chat:join', 'private-room')).ok, false);
  stranger.emit('identify', '507f1f77bcf86cd799439011');
  await stranger.timeout(1000).emitWithAck('chat:join', 'missing-room');
  assert.equal(io.of('/user').sockets.get(stranger.id).rooms.has('user:507f1f77bcf86cd799439011'), false);
  let deliveries = 0; let leaks = 0;
  owner.on('chat:message', () => deliveries++); stranger.on('chat:message', () => leaks++); guest.on('chat:message', () => leaks++);
  require('../realtime').emitToSession('private-room', 'chat:message', { sessionId: 'private-room' });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(deliveries, 1); assert.equal(leaks, 0);
});

test('merge socket: guest ownership and private order notifications remain isolated', async t => {
  const secret = 'c'.repeat(64); const hash = require('node:crypto').createHash('sha256').update(secret).digest('hex');
  t.mock.method(ChatSession, 'findOne', () => reactionQuery({ sessionId: 'guest-room', reactionGuestHash: hash }));
  const guest = await openUserSocket('', { Cookie: `urii_reaction_guest=${secret}` });
  const owner = await openUserSocket(reactionToken()); const other = await openUserSocket(reactionToken('507f1f77bcf86cd799439012'));
  t.after(() => { guest.close(); owner.close(); other.close(); });
  assert.equal((await guest.timeout(1000).emitWithAck('join:chat', 'guest-room')).ok, true);
  let received = 0; let leaked = 0;
  owner.on('user:update', () => received++); other.on('user:update', () => leaked++); other.on('crud:changed', () => leaked++);
  emitCrudChange('orders', 'updated', 'private-order', { userId: '507f1f77bcf86cd799439011', address: { name: 'Private' } });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(received, 1); assert.equal(leaked, 0);
});

test('merge chat: request-agent ignores client history and cancels without replacing message records', async t => {
  const session = new ChatSession({ sessionId: 'safe-room', userName: 'Owner', reactionOwnerId: 'account:507f1f77bcf86cd799439011', status: 'ai', messages: [
    { messageId: 'keep', clientRequestId: 'keep-request-111111111', senderId: 'account:507f1f77bcf86cd799439011', sender: 'user', text: 'Retained', recalledAt: 123, reactions: [{ actor: 'account:other', emoji: '👍' }] }
  ] });
  const before = JSON.stringify(session.messages);
  t.mock.method(ChatSession, 'findOne', () => reactionQuery(session));
  t.mock.method(ChatSession, 'findOneAndUpdate', (filter, update) => {
    assert.equal(update.$push, undefined); assert.equal(update.$set.messages, undefined);
    if (filter.status?.$ne === 'waiting' && session.status === 'waiting') return reactionQuery(null);
    if (filter.status === 'waiting' && session.status !== 'waiting') return reactionQuery(null);
    session.status = update.$set.status; return reactionQuery(session);
  });
  const payload = { sessionId: 'safe-room', messages: [{ sender: 'admin', text: 'Overwrite' }] };
  assert.equal((await reactionRequest('/request-agent', payload, reactionToken(), 'POST')).status, 200);
  assert.equal((await reactionRequest('/request-agent', payload, reactionToken(), 'POST')).status, 200);
  assert.equal(JSON.stringify(session.messages), before);
  assert.equal((await reactionRequest('/sessions/safe-room/cancel-agent', {}, reactionToken('507f1f77bcf86cd799439012'), 'POST')).status, 403);
  assert.equal((await reactionRequest('/sessions/safe-room/cancel-agent', {}, reactionToken(), 'POST')).status, 200);
  assert.equal(session.status, 'ai'); assert.equal(JSON.stringify(session.messages), before);
  session.status = 'active';
  assert.equal((await reactionRequest('/sessions/safe-room/cancel-agent', {}, reactionToken(), 'POST')).status, 409);
});

function chatZip(entries) {
  const locals = []; const directory = []; let offset = 0;
  for (const [name, content] of entries) {
    const filename = Buffer.from(name); const data = Buffer.from(content);
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(header, filename, data); directory.push(central, filename); offset += 30 + filename.length + data.length;
  }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(Buffer.concat(directory).length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...directory, end]);
}
function chatOffice(extension, extra = []) {
  const main = extension === 'docx' ? 'word/document.xml' : 'xl/workbook.xml';
  const contentType = extension === 'docx' ? 'wordprocessingml.document.main+xml' : 'spreadsheetml.sheet.main+xml';
  return chatZip([['[Content_Types].xml', `<Types><Override ContentType="application/vnd.openxmlformats-officedocument.${contentType}"/></Types>`], ['_rels/.rels', '<Relationships/>'], [main, '<document/>'], ...extra]);
}
function attachmentFixture(t) {
  const fileSystem = require('node:fs/promises'); const nodePath = require('node:path');
  const session = new ChatSession({ sessionId: 'attachment-room', userName: 'Owner', reactionOwnerId: 'account:507f1f77bcf86cd799439011', messages: [] });
  const written = []; const rename = fileSystem.rename;
  t.mock.method(fileSystem, 'rename', async (from, to) => { written.push(to); return rename(from, to); });
  t.after(async () => { for (const file of written) await fileSystem.unlink(file).catch(() => {}); });
  t.mock.method(ChatSession, 'findOne', filter => reactionQuery(filter.sessionId === session.sessionId ? session : null));
  const update = t.mock.method(ChatSession, 'findOneAndUpdate', (filter, changes) => {
    if (Array.isArray(changes)) {
      const message = session.messages.find(m => m.messageId === filter.messages.$elemMatch.messageId && !m.recalledAt);
      if (!message) return reactionQuery(null);
      message.reactions = changes[0].$set.messages.$map.in.$cond[1].$mergeObjects[1].reactions.$concatArrays[1];
    } else if (changes.$push) {
      const guard = filter.messages.$not.$elemMatch;
      if (session.messages.some(m => m.clientRequestId === guard.clientRequestId && m.senderId === guard.senderId)) return reactionQuery(null);
      session.messages.push(changes.$push.messages);
    } else {
      const message = session.messages.find(m => m.messageId === filter.messages.$elemMatch.messageId);
      message.recalledAt = changes.$set['messages.$.recalledAt']; message.recalledBy = changes.$set['messages.$.recalledBy'];
    }
    return reactionQuery(session);
  });
  return { session, update, written, fileSystem, filePath: message => nodePath.join(__dirname, '..', 'private', 'chat-attachments', message.attachment.storageKey) };
}
function attachmentRequest(name, bytes, options = {}) {
  return fetch(`${baseUrl}/api/chat/sessions/attachment-room/attachments`, { method: 'POST', headers: {
    'Content-Type': 'application/octet-stream', Authorization: `Bearer ${options.token || reactionToken()}`,
    'X-File-Name': encodeURIComponent(name), 'X-File-Kind': options.kind || 'file', 'X-Client-Request-Id': options.key || 'attachment-request-11111111'
  }, body: bytes });
}

test('attachment: supported formats persist privately and reload without leaking storage metadata', async t => {
  const fixture = attachmentFixture(t); const image = require('sharp');
  const png = await image({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
  const jpg = await image(png).jpeg().toBuffer();
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\nxref\nstartxref\n0\n%%EOF');
  const files = [['a.jpg', jpg, 'image'], ['a.jpeg', jpg, 'image'], ['a.png', png, 'image'], ['a.pdf', pdf, 'file'], ['a.docx', chatOffice('docx'), 'file'], ['a.xlsx', chatOffice('xlsx'), 'file'], ['a.txt', Buffer.from('Xin chào'), 'file']];
  for (const [index, [name, bytes, kind]] of files.entries()) {
    const response = await attachmentRequest(name, bytes, { kind, key: `attachment-valid-request-${index}`, ...(index % 2 ? { token: forwardingAdmin() } : {}) });
    assert.equal(response.status, 200, await response.clone().text()); const data = await response.json();
    assert.equal(data.acceptedMessage.type, kind); assert.equal(data.acceptedMessage.attachment.name, name);
    assert.equal(data.acceptedMessage.sender, index % 2 ? 'admin' : 'user');
    assert.equal(data.acceptedMessage.attachment.storageKey, undefined); assert.equal(data.acceptedMessage.attachment.sourceHash, undefined);
    const download = await reactionRequest(`/sessions/attachment-room/messages/${data.acceptedMessage.messageId}/attachment`, undefined);
    assert.equal(download.status, 200); assert.match(download.headers.get('cache-control'), /no-store/);
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
    if (kind === 'file') assert.match(download.headers.get('content-disposition'), /^attachment;/);
    assert.ok((await download.arrayBuffer()).byteLength > 0);
  }
  const history = await (await reactionRequest('/sessions/attachment-room', undefined)).json();
  const polling = await (await reactionRequest('/sessions/attachment-room/reactions', undefined)).json();
  assert.equal(history.messages.length, 7); assert.equal(polling.messages.length, 7);
  assert.ok(!JSON.stringify(history).includes('storageKey')); assert.ok(!JSON.stringify(polling).includes('sourceHash'));
  assert.equal(fixture.session.messages.length, 7);
  const publicPath = await fetch(`${baseUrl}/private/chat-attachments/${fixture.session.messages[0].attachment.storageKey}`);
  const publicBody = Buffer.from(await publicPath.arrayBuffer());
  assert.ok(!publicBody.equals(await fixture.fileSystem.readFile(fixture.filePath(fixture.session.messages[0]))));
});

test('attachment: ownership, content inspection, traversal and received byte limits reject unsafe uploads', async t => {
  const fixture = attachmentFixture(t);
  assert.equal((await attachmentRequest('a.txt', Buffer.from('hello'), { token: reactionToken('507f1f77bcf86cd799439012') })).status, 403);
  assert.equal((await attachmentRequest('a.txt', Buffer.from('hello'), { token: 'invalid' })).status, 401);
  const invalid = [['a.exe', Buffer.from('MZ')], ['../a.txt', Buffer.from('hello')], ['a.txt', Buffer.from([0, 255])], ['a.jpg', Buffer.from('not jpeg'), 'image'], ['a.png', Buffer.from('not png'), 'image'], ['a.pdf', Buffer.from('%PDF fake')], ['a.docx', Buffer.from('PK fake')], ['a.xlsx', chatOffice('docx')], ['a.docx', chatOffice('docx', [['word/vbaProject.bin', 'malware']])], ['a.xlsx', chatOffice('xlsx', [['xl/externalLinks/externalLink1.xml', '<x/>']])], ['a.docx', chatOffice('docx', [['evil.xml', '<!DOCTYPE x><x/>']])], ['a.docx', chatOffice('docx', [['word/a.xml', '<x TargetMode="External"/>']])]];
  for (const [name, bytes, kind] of invalid) {
    const response = await attachmentRequest(name, bytes, { kind });
    assert.equal(response.status, 400, `${name}: ${await response.text()}`);
  }
  const tooLarge = await attachmentRequest('a.txt', Buffer.alloc(10 * 1024 * 1024 + 1, 65));
  assert.equal(tooLarge.status, 413);
  assert.equal(fixture.update.mock.callCount(), 0); assert.equal(fixture.written.length, 0);
});

test('attachment: retry is idempotent and request keys cannot change content, type or name', async t => {
  const fixture = attachmentFixture(t); const body = Buffer.from('Hello');
  const first = await attachmentRequest('a.txt', body); assert.equal(first.status, 200);
  const original = (await first.json()).acceptedMessage;
  const retry = await attachmentRequest('a.txt', body); assert.equal(retry.status, 200);
  assert.equal((await retry.json()).acceptedMessage.messageId, original.messageId);
  for (const [name, bytes, kind] of [['a.txt', Buffer.from('Changed'), 'file'], ['a.txt', body, 'image'], ['b.txt', body, 'file']]) assert.equal((await attachmentRequest(name, bytes, { kind })).status, 409);
  assert.equal(fixture.session.messages.length, 1); assert.equal(fixture.written.length, 1);
});

test('attachment: reaction and sender recall retain the file but deny subsequent reads and redact metadata', async t => {
  const fixture = attachmentFixture(t);
  const upload = await (await attachmentRequest('secret.txt', Buffer.from('Private content'))).json(); const id = upload.acceptedMessage.messageId;
  assert.equal((await reactionRequest(`/sessions/attachment-room/messages/${id}/attachment`, undefined, reactionToken('507f1f77bcf86cd799439012'))).status, 403);
  assert.equal((await reactionRequest(`/sessions/attachment-room/messages/${id}/reaction`, { emoji: '👍' })).status, 200);
  assert.equal((await reactionRequest(`/sessions/attachment-room/messages/${id}/recall`, {}, forwardingAdmin(), 'POST')).status, 403);
  assert.equal((await reactionRequest(`/sessions/attachment-room/messages/${id}/recall`, {}, reactionToken(), 'POST')).status, 200);
  assert.equal((await reactionRequest(`/sessions/attachment-room/messages/${id}/attachment`, undefined)).status, 404);
  assert.equal((await reactionRequest(`/sessions/attachment-room/messages/${id}/reaction`, { emoji: '👍' })).status, 409);
  const poll = await (await reactionRequest('/sessions/attachment-room/reactions', undefined)).json();
  assert.equal(poll.messages[0].attachment, undefined); assert.equal(poll.messages[0].text, 'Tin nhắn đã được thu hồi'); assert.deepEqual(poll.reactions[id], []);
  assert.equal((await fixture.fileSystem.readFile(fixture.filePath(fixture.session.messages[0]))).toString(), 'Private content');
});

test('attachment: database uncertainty keeps the private file for reconciliation, never deletes a possible commit', async t => {
  const fixture = attachmentFixture(t); fixture.update.mock.restore();
  t.mock.method(ChatSession, 'findOneAndUpdate', () => { throw new Error('Simulated connection loss'); });
  const response = await attachmentRequest('a.txt', Buffer.from('Hello')); assert.equal(response.status, 503);
  assert.equal(fixture.written.length, 1); assert.equal((await fixture.fileSystem.readFile(fixture.written[0])).toString(), 'Hello');
  await assert.rejects(fixture.fileSystem.stat(fixture.written[0] + '.part'));
});

test('attachment: concurrent retries leave one message and one physical file', async t => {
  const fixture = attachmentFixture(t);
  const responses = await Promise.all([1, 2].map(() => attachmentRequest('a.txt', Buffer.from('Concurrent'))));
  const data = await Promise.all(responses.map(async response => { assert.equal(response.status, 200); return response.json(); }));
  assert.equal(data[0].acceptedMessage.messageId, data[1].acceptedMessage.messageId);
  assert.equal(fixture.session.messages.length, 1);
  let kept = 0;
  for (const file of fixture.written) { try { await fixture.fileSystem.stat(file); kept++; } catch {} await assert.rejects(fixture.fileSystem.stat(file + '.part')); }
  assert.equal(kept, 1);
});

test('attachment: exact 10 MB is accepted and arbitrary metadata cannot create file messages', async t => {
  const fixture = attachmentFixture(t);
  assert.equal((await attachmentRequest('limit.txt', Buffer.alloc(10 * 1024 * 1024, 65))).status, 200);
  const response = await reactionRequest('/sessions/attachment-room/messages', { type: 'file', text: 'Fake', clientRequestId: 'attachment-forged-1111111', attachment: { storageKey: '../secret', name: 'fake.pdf' } }, reactionToken(), 'POST');
  assert.equal(response.status, 400); assert.equal(fixture.session.messages.length, 1);
  const admin = await attachmentRequest('admin.txt', Buffer.from('Admin'), { token: forwardingAdmin(), key: 'attachment-admin-111111111' });
  const id = (await admin.json()).acceptedMessage.messageId;
  assert.equal((await reactionRequest(`/sessions/attachment-room/messages/${id}/recall`, {}, reactionToken(), 'POST')).status, 403);
  assert.equal((await reactionRequest(`/sessions/attachment-room/messages/${id}/recall`, {}, forwardingAdmin(), 'POST')).status, 200);
  assert.equal((await reactionRequest(`/sessions/attachment-room/messages/${id}/attachment`, undefined, forwardingAdmin())).status, 404);
});

test('attachment: the owning guest cookie works, while anonymous reads fail', async t => {
  const fixture = attachmentFixture(t); const secret = 'a'.repeat(64);
  fixture.session.reactionOwnerId = undefined; fixture.session.reactionGuestHash = require('node:crypto').createHash('sha256').update(secret).digest('hex');
  const response = await fetch(`${baseUrl}/api/chat/sessions/attachment-room/attachments`, { method: 'POST', headers: {
    'Content-Type': 'application/octet-stream', Cookie: `urii_reaction_guest=${secret}`, 'X-File-Name': 'guest.txt', 'X-File-Kind': 'file', 'X-Client-Request-Id': 'attachment-guest-11111111'
  }, body: Buffer.from('Guest file') });
  assert.equal(response.status, 200); const message = (await response.json()).acceptedMessage;
  assert.equal(message.senderId, 'guest:' + fixture.session.reactionGuestHash);
  const route = `/sessions/attachment-room/messages/${message.messageId}/attachment`;
  assert.equal((await reactionRequest(route, undefined, '')).status, 403);
  assert.equal((await reactionRequest(route, undefined, '', 'GET', { Cookie: `urii_reaction_guest=${secret}` })).status, 200);
});
function reactionToken(id = '507f1f77bcf86cd799439011', role = 'user') {
  return jwt.sign({ id, role }, process.env.JWT_SECRET);
}
function reactionRequest(path, body, token = reactionToken(), method = 'PUT', extraHeaders = {}) {
  return fetch(`${baseUrl}/api/chat${path}`, { method: body === undefined ? 'GET' : method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

test('reaction: no ownership is inferred from an email or an old public session ID', async t => {
  const session = new ChatSession({ sessionId: 'legacy', userName: 'Guest', userEmail: 'victim@example.test', messages: [] });
  t.mock.method(ChatSession, 'findOne', () => reactionQuery(session));
  for (const token of ['', reactionToken()]) {
    assert.equal((await reactionRequest('/sessions/legacy/reactions', undefined, token)).status, 403);
    assert.equal((await reactionRequest('/sessions/legacy', undefined, token)).status, 403);
  }
  let updates;
  t.mock.method(ChatSession, 'findOneAndUpdate', (filter, update) => { updates = update; return reactionQuery(session); });
  assert.equal((await reactionRequest('/sessions/legacy/reaction-identity', {}, reactionToken(), 'POST')).status, 403);
  assert.deepEqual(Object.keys(updates), ['$setOnInsert']);
  assert.equal(session.userId, undefined);
});

test('reaction: account ownership is checked and expired JWTs are rejected', async t => {
  const session = new ChatSession({ sessionId: 'private', userName: 'Owner', userId: '507f1f77bcf86cd799439011' });
  t.mock.method(ChatSession, 'findOne', () => reactionQuery(session));
  assert.equal((await reactionRequest('/sessions/private/reactions', undefined, reactionToken('507f1f77bcf86cd799439012'))).status, 403);
  assert.equal((await reactionRequest('/sessions/private/reactions', undefined, jwt.sign({ id: 'x', role: 'user' }, process.env.JWT_SECRET, { expiresIn: -1 }))).status, 401);
  assert.equal((await reactionRequest('/sessions/private/reactions', undefined, '')).status, 403);
});

test('reaction: a private guest cookie survives reload without exposing the secret', async t => {
  let stored;
  t.mock.method(ChatSession, 'findOneAndUpdate', (filter, update) => {
    stored = new ChatSession(update.$setOnInsert); return reactionQuery(stored);
  });
  const response = await reactionRequest('/sessions/new-guest/reaction-identity', { userName: 'Guest' }, '', 'POST');
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  const identity = await response.json();
  assert.equal(identity.actor, `guest:${stored.reactionGuestHash}`);
  const secret = cookie.split(';')[0].split('=')[1];
  assert.notEqual(stored.reactionGuestHash, secret);
  t.mock.method(ChatSession, 'findOne', () => reactionQuery(stored));
  const reloaded = await reactionRequest('/sessions/new-guest/reactions', undefined, '', 'PUT', { Cookie: cookie.split(';')[0] });
  assert.equal(reloaded.status, 200);
  assert.equal((await reloaded.json()).actor, identity.actor);
  assert.equal((await reactionRequest('/sessions/new-guest/reactions', undefined, '')).status, 403);
});

test('reaction: server state contains only server-ID messages and reactions never enter history responses', async t => {
  const session = new ChatSession({ sessionId: 'private', userName: 'Owner', reactionOwnerId: 'account:507f1f77bcf86cd799439011', messages: [
    { text: 'old message', sender: 'user', timestamp: 1 },
    { messageId: 'server-id', text: 'new message', sender: 'admin', timestamp: 2, reactions: [{ actor: 'account:someone', emoji: '❤️' }] }
  ] });
  t.mock.method(ChatSession, 'findOne', () => reactionQuery(session));
  const data = await (await reactionRequest('/sessions/private/reactions', undefined)).json();
  assert.deepEqual(data.reactions['server-id'], [{ actor: 'account:someone', emoji: '❤️' }]);
  assert.equal(data.messages.length, 1); assert.equal(data.messages[0].messageId, 'server-id');
  assert.equal(data.messages[0].reactions, undefined);
  const history = await (await reactionRequest('/sessions/private', undefined)).json();
  assert.equal(history.messages.length, 2);
  assert.equal(history.messages[0].messageId, undefined);
  assert.equal(history.messages[1].reactions, undefined);
  assert.equal(history.reactionOwnerId, undefined);
});

test('reaction: add, change and remove target only the authenticated actor atomically', async t => {
  const session = new ChatSession({ sessionId: 'private', userName: 'Owner', reactionOwnerId: 'account:507f1f77bcf86cd799439011', messages: [
    { messageId: 'message', text: 'hello', sender: 'user', reactions: [{ actor: 'account:other', emoji: '👍' }] }
  ] });
  t.mock.method(ChatSession, 'findOne', () => reactionQuery(session));
  t.mock.method(ChatSession, 'findOneAndUpdate', (filter, pipeline, options) => {
    assert.equal(options.updatePipeline, true);
    assert.equal(filter.messages.$elemMatch.messageId, 'message');
    const arrays = pipeline[0].$set.messages.$map.in.$cond[1].$mergeObjects[1].reactions.$concatArrays;
    assert.equal(arrays[0].$filter.cond.$ne[1], 'account:507f1f77bcf86cd799439011');
    const added = arrays[1];
    session.messages[0].reactions = [{ actor: 'account:other', emoji: '👍' }, ...added];
    return reactionQuery(session);
  });
  for (const emoji of ['❤️', '😂', null]) {
    const response = await reactionRequest('/sessions/private/messages/message/reaction', { emoji, actor: 'account:other', userId: 'other', role: 'admin' });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.reactions[0], { actor: 'account:other', emoji: '👍' });
    assert.equal(data.reactions.length, emoji === null ? 1 : 2);
    if (emoji) assert.equal(data.reactions[1].actor, 'account:507f1f77bcf86cd799439011');
  }
  assert.equal((await reactionRequest('/sessions/private/messages/message/reaction', { emoji: '<script>' })).status, 400);
});

test('reaction: retries and concurrent sends insert a user message and increment unread exactly once', async t => {
  const actor = 'account:507f1f77bcf86cd799439011';
  const session = new ChatSession({ sessionId: 'private', userName: 'Owner', reactionOwnerId: actor, unreadCount: 0, status: 'waiting', messages: [] });
  t.mock.method(ChatSession, 'findOne', () => reactionQuery(session));
  let inserted = 0;
  t.mock.method(ChatSession, 'findOneAndUpdate', (filter, update) => {
    const key = filter.messages.$not.$elemMatch;
    if (session.messages.some(m => m.clientRequestId === key.clientRequestId && m.senderId === key.senderId)) return reactionQuery(null);
    inserted++; session.messages.push(update.$push.messages); session.unreadCount += update.$inc.unreadCount;
    return reactionQuery(session);
  });
  const payload = { text: 'new user message', clientRequestId: '11111111-1111-4111-8111-111111111111', sender: 'user', messageId: 'fake-client-id' };
  const responses = await Promise.all([1, 2, 3].map(() => reactionRequest('/sessions/private/messages', payload, reactionToken(), 'POST')));
  const data = await Promise.all(responses.map(async response => { assert.equal(response.status, 200); return response.json(); }));
  assert.equal(inserted, 1); assert.equal(session.unreadCount, 1); assert.equal(session.status, 'waiting');
  assert.equal(session.messages.length, 1);
  assert.notEqual(data[0].acceptedMessage.messageId, 'fake-client-id');
  assert.equal(new Set(data.map(value => value.acceptedMessage.messageId)).size, 1);
  assert.equal((await reactionRequest('/sessions/private/messages', { ...payload, sender: 'admin' }, reactionToken(), 'POST')).status, 403);
  assert.equal((await reactionRequest('/sessions/private/messages', { ...payload, text: 'different content' }, reactionToken(), 'POST')).status, 409);
});

test('reaction: legacy messages are not assigned IDs when hydrated', () => {
  const session = ChatSession.hydrate({ sessionId: 'old', userName: 'Legacy', messages: [{ sender: 'user', text: 'Keep this', timestamp: 1 }] });
  assert.equal(session.messages[0].messageId, undefined);
  assert.equal(session.messages[0].text, 'Keep this');
});

test('reaction: old messages without a server ID cannot be mutated and admin access stays available', async t => {
  const session = new ChatSession({ sessionId: 'legacy', userName: 'Guest', messages: [{ text: 'Keep history', sender: 'user' }] });
  t.mock.method(ChatSession, 'findOne', () => reactionQuery(session));
  t.mock.method(ChatSession, 'findOneAndUpdate', () => reactionQuery(null));
  const admin = reactionToken('507f1f77bcf86cd799439099', 'admin');
  assert.equal((await reactionRequest('/sessions/legacy/reactions', undefined, admin)).status, 200);
  assert.equal((await reactionRequest('/sessions/legacy/messages/not-a-server-id/reaction', { emoji: '👍' }, admin)).status, 404);
  assert.equal(session.messages[0].messageId, undefined);
  assert.equal(session.messages[0].text, 'Keep history');
});

test('recall: an admin can recall only its own message, without deleting, reordering or changing unread', async t => {
  const id = '507f1f77bcf86cd799439099';
  const actor = 'account:' + id;
  const session = new ChatSession({ sessionId: 'recall-room', userName: 'Guest', unreadCount: 3, lastMessageTime: 100, messages: [
    { messageId: 'mine', sender: 'admin', senderId: actor, text: 'Private admin text', timestamp: 10, reactions: [{ actor: 'guest:someone', emoji: '❤️' }] },
    { messageId: 'other', sender: 'admin', senderId: 'account:other', text: 'Other text', timestamp: 20 }
  ] });
  t.mock.method(ChatSession, 'findOne', () => reactionQuery(session));
  const update = t.mock.method(ChatSession, 'findOneAndUpdate', (filter, changes) => {
    assert.deepEqual(filter.messages.$elemMatch, { messageId: 'mine', senderId: actor, sender: 'admin', isSystemLog: { $ne: true }, recalledAt: null });
    assert.deepEqual(Object.keys(changes), ['$set']);
    assert.deepEqual(Object.keys(changes.$set).sort(), ['messages.$.recalledAt', 'messages.$.recalledBy']);
    session.messages[0].recalledAt = changes.$set['messages.$.recalledAt'];
    session.messages[0].recalledBy = changes.$set['messages.$.recalledBy'];
    return reactionQuery(session);
  });
  const response = await reactionRequest('/sessions/recall-room/messages/mine/recall', { senderId: 'spoofed', role: 'user' }, reactionToken(id, 'admin'), 'POST');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.message.text, 'Tin nhắn đã được thu hồi');
  assert.equal(data.message.reactions, undefined);
  assert.equal(data.message.recalledBy, actor);
  assert.equal(session.messages[0].text, 'Private admin text');
  assert.deepEqual(session.messages.map(m => m.messageId), ['mine', 'other']);
  assert.equal(session.unreadCount, 3); assert.equal(session.lastMessageTime, 100);
  const again = await reactionRequest('/sessions/recall-room/messages/mine/recall', {}, reactionToken(id, 'admin'), 'POST');
  assert.equal(again.status, 200);
  assert.equal((await again.json()).message.recalledAt, data.message.recalledAt);
  assert.equal(update.mock.callCount(), 1);
  assert.equal((await reactionRequest('/sessions/recall-room/messages/other/recall', {}, reactionToken(id, 'admin'), 'POST')).status, 403);
});

test('recall: account users cannot recall another sender, bot, system log or a legacy message', async t => {
  const actor = 'account:507f1f77bcf86cd799439011';
  const session = new ChatSession({ sessionId: 'private', userName: 'Owner', reactionOwnerId: actor, messages: [
    { messageId: 'mine', sender: 'user', senderId: actor, text: 'My message' },
    { messageId: 'admin', sender: 'admin', senderId: 'account:admin', text: 'Admin message' },
    { messageId: 'other', sender: 'user', senderId: 'account:other', text: 'Other user message' },
    { messageId: 'bot', sender: 'bot', senderId: actor, text: 'Bot message' },
    { messageId: 'log', sender: 'user', senderId: actor, text: 'System log', isSystemLog: true },
    { sender: 'user', text: 'Old local history' }
  ] });
  t.mock.method(ChatSession, 'findOne', () => reactionQuery(session));
  const update = t.mock.method(ChatSession, 'findOneAndUpdate', (filter, changes) => {
    assert.equal(filter.messages.$elemMatch.senderId, actor);
    session.messages[0].recalledAt = changes.$set['messages.$.recalledAt'];
    session.messages[0].recalledBy = actor; return reactionQuery(session);
  });
  for (const messageId of ['admin', 'other', 'bot', 'log', 'legacy']) {
    assert.equal((await reactionRequest(`/sessions/private/messages/${messageId}/recall`, { senderId: actor }, reactionToken(), 'POST')).status, 403);
  }
  assert.equal(update.mock.callCount(), 0);
  assert.equal((await reactionRequest('/sessions/private/messages/mine/recall', {}, reactionToken('507f1f77bcf86cd799439012'), 'POST')).status, 403);
  assert.equal((await reactionRequest('/sessions/private/messages/mine/recall', {}, '', 'POST')).status, 403);
  assert.equal((await reactionRequest('/sessions/private/messages/mine/recall', {}, reactionToken(), 'POST')).status, 200);
  assert.equal(session.messages[0].text, 'My message');
  assert.equal(session.messages[5].messageId, undefined);
});

test('recall: guest ownership uses the private cookie, never a submitted account or actor', async t => {
  const secret = 'c'.repeat(64);
  const hash = require('node:crypto').createHash('sha256').update(secret).digest('hex');
  const actor = 'guest:' + hash;
  const session = new ChatSession({ sessionId: 'guest-room', userName: 'Guest', reactionGuestHash: hash, messages: [
    { messageId: 'mine', sender: 'user', senderId: actor, text: 'Guest text' }
  ] });
  t.mock.method(ChatSession, 'findOne', () => reactionQuery(session));
  t.mock.method(ChatSession, 'findOneAndUpdate', (filter, changes) => {
    assert.equal(filter.messages.$elemMatch.senderId, actor);
    session.messages[0].recalledAt = changes.$set['messages.$.recalledAt']; return reactionQuery(session);
  });
  assert.equal((await reactionRequest('/sessions/guest-room/messages/mine/recall', { actor }, '', 'POST', { Cookie: 'urii_reaction_guest=' + 'd'.repeat(64) })).status, 403);
  const response = await reactionRequest('/sessions/guest-room/messages/mine/recall', {}, '', 'POST', { Cookie: 'urii_reaction_guest=' + secret });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).message.text, 'Tin nhắn đã được thu hồi');
});

test('recall: history, polling, admin list and send retries never return recalled text or reactions', async t => {
  const actor = 'account:507f1f77bcf86cd799439011';
  const requestId = '11111111-1111-4111-8111-111111111111';
  const session = new ChatSession({ sessionId: 'private', userName: 'Owner', reactionOwnerId: actor, messages: [
    { messageId: 'hidden', clientRequestId: requestId, sender: 'user', senderId: actor, text: 'DO NOT EXPOSE', recalledAt: 123, recalledBy: actor, reactions: [{ actor: 'account:admin', emoji: '❤️' }] },
    { messageId: 'visible', sender: 'admin', text: 'Still visible', reactions: [{ actor, emoji: '👍' }] }
  ] });
  t.mock.method(ChatSession, 'findOne', () => reactionQuery(session));
  t.mock.method(ChatSession, 'find', () => ({ sort: () => reactionQuery([session.toObject()]) }));
  t.mock.method(ChatSession, 'findOneAndUpdate', () => reactionQuery(null));
  const polling = await (await reactionRequest('/sessions/private/reactions', undefined)).json();
  assert.equal(polling.messages[0].text, 'Tin nhắn đã được thu hồi');
  assert.deepEqual(polling.reactions.hidden, []);
  assert.equal(polling.reactions.visible[0].emoji, '👍');
  for (const response of [
    await reactionRequest('/sessions/private', undefined),
    await reactionRequest('/sessions', undefined, reactionToken('507f1f77bcf86cd799439099', 'admin')),
    await reactionRequest('/sessions/private/messages', { text: 'DO NOT EXPOSE', clientRequestId: requestId, sender: 'user' }, reactionToken(), 'POST')
  ]) {
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.equal(body.includes('DO NOT EXPOSE'), false);
    assert.equal(body.includes('❤️'), false);
    assert.equal(body.includes('Tin nhắn đã được thu hồi'), true);
  }
  assert.equal(session.messages[0].text, 'DO NOT EXPOSE');
});

test('recall: a recall racing ahead of reaction is rejected by the atomic database predicate', async t => {
  const actor = 'account:507f1f77bcf86cd799439011';
  const session = new ChatSession({ sessionId: 'private', userName: 'Owner', reactionOwnerId: actor, messages: [
    { messageId: 'message', sender: 'user', senderId: actor, text: 'Keep internal', reactions: [] },
    { messageId: 'other', sender: 'admin', text: 'Other', reactions: [{ actor, emoji: '👍' }] }
  ] });
  // Ownership check observes an earlier snapshot; the DB commits recall before the update.
  t.mock.method(ChatSession, 'findOne', () => reactionQuery(ChatSession.hydrate(session.toObject())));
  t.mock.method(ChatSession, 'findOneAndUpdate', (filter, pipeline) => {
    session.messages[0].recalledAt = 123;
    assert.equal(filter.messages.$elemMatch.recalledAt, null);
    assert.deepEqual(pipeline[0].$set.messages.$map.in.$cond[0].$and[1], { $eq: [{ $ifNull: ['$$m.recalledAt', null] }, null] });
    return reactionQuery(null);
  });
  assert.equal((await reactionRequest('/sessions/private/messages/message/reaction', { emoji: '❤️' })).status, 409);
  assert.equal(session.messages[0].reactions.length, 0);
  assert.equal(session.messages[1].reactions[0].emoji, '👍');
});

test('recall: reactions committed before recall are hidden afterwards without affecting other messages', async t => {
  const actor = 'account:507f1f77bcf86cd799439011';
  const session = new ChatSession({ sessionId: 'private', userName: 'Owner', reactionOwnerId: actor, messages: [
    { messageId: 'message', sender: 'user', senderId: actor, text: 'Keep internal', reactions: [] },
    { messageId: 'other', sender: 'admin', text: 'Other', reactions: [{ actor, emoji: '👍' }] }
  ] });
  t.mock.method(ChatSession, 'findOne', () => reactionQuery(session));
  t.mock.method(ChatSession, 'findOneAndUpdate', (filter, update) => {
    if (Array.isArray(update)) {
      if (session.messages[0].recalledAt) return reactionQuery(null);
      session.messages[0].reactions = [{ actor, emoji: '❤️' }];
    } else session.messages[0].recalledAt = update.$set['messages.$.recalledAt'];
    return reactionQuery(session);
  });
  assert.equal((await reactionRequest('/sessions/private/messages/message/reaction', { emoji: '❤️' })).status, 200);
  assert.equal((await reactionRequest('/sessions/private/messages/message/recall', {}, reactionToken(), 'POST')).status, 200);
  assert.equal((await reactionRequest('/sessions/private/messages/message/reaction', { emoji: '😂' })).status, 409);
  const state = await (await reactionRequest('/sessions/private/reactions', undefined)).json();
  assert.deepEqual(state.reactions.message, []);
  assert.equal(state.reactions.other[0].emoji, '👍');
});

function forwardingFixture(t, options = {}) {
  let source = new ChatSession({ sessionId: 'source-room', userName: 'PRIVATE SOURCE NAME', userEmail: 'private-source@example.test', unreadCount: 3, status: 'waiting', lastMessageTime: 10, messages: [
    { messageId: 'source-message', sender: 'user', senderId: 'account:original-user', clientRequestId: 'PRIVATE-SOURCE-REQUEST', text: 'Forward this text', timestamp: 10, reactions: [{ actor: 'guest:original', emoji: '❤️' }], ...(options.recalled ? { recalledAt: 100 } : {}) }
  ] });
  let target = new ChatSession({ sessionId: 'target-room', userName: 'Target', reactionOwnerId: 'account:507f1f77bcf86cd799439011', status: 'ai', unreadCount: 4, lastMessageTime: 5, messages: [
    { messageId: 'other-message', sender: 'user', text: 'Other text', timestamp: 5, reactions: [{ actor: 'account:other', emoji: '👍' }] }
  ] });
  const previousDb = mongoose.connection.db;
  mongoose.connection.db = { admin: () => ({ command: async () => options.unsupported
    ? { logicalSessionTimeoutMinutes: 30, maxWireVersion: 25 }
    : { setName: 'isolated-test-replica-set', logicalSessionTimeoutMinutes: 30, maxWireVersion: 25 } }) };
  t.after(() => { mongoose.connection.db = previousDb; });
  let queue = Promise.resolve();
  const start = t.mock.method(mongoose, 'startSession', async () => ({
    withTransaction: async (callback, transactionOptions) => {
      assert.equal(transactionOptions.readConcern.level, 'snapshot');
      assert.equal(transactionOptions.writeConcern.w, 'majority');
      const previous = queue; let release;
      queue = new Promise(resolve => { release = resolve; });
      await previous;
      const beforeSource = source.toObject(); const beforeTarget = target.toObject();
      try { await callback(); if (options.failCommit) throw new Error('Simulated transaction failure'); }
      catch (error) { source = ChatSession.hydrate(beforeSource); target = ChatSession.hydrate(beforeTarget); throw error; }
      finally { release(); }
    }, endSession: async () => {}
  }));
  t.mock.method(ChatSession, 'findOne', filter => reactionQuery(filter.sessionId === 'source-room' ? source : filter.sessionId === 'target-room' ? target : null));
  const update = t.mock.method(ChatSession, 'findOneAndUpdate', (filter, changes, settings) => {
    assert.ok(settings.session);
    if (filter.sessionId === 'source-room') {
      assert.equal(settings.timestamps, false);
      assert.equal(filter.messages.$elemMatch.recalledAt, null);
      assert.deepEqual(filter.messages.$elemMatch.type, { $in: [null, 'text'] });
      const original = source.messages.find(m => m.messageId === filter.messages.$elemMatch.messageId && !m.recalledAt && !m.isSystemLog && (!m.type || m.type === 'text') && ['admin', 'user'].includes(m.sender));
      if (!original) return reactionQuery(null);
      assert.deepEqual(changes, { $inc: { __v: 1 } });
      source.__v = (source.__v || 0) + 1;
      return reactionQuery(source);
    }
    assert.equal(filter.sessionId, 'target-room');
    const key = filter.messages.$not.$elemMatch.forwardRequestKey;
    if (target.messages.some(m => m.forwardRequestKey === key)) return reactionQuery(null);
    target.messages.push(changes.$push.messages);
    target.lastMessageTime = changes.$set.lastMessageTime;
    assert.deepEqual(Object.keys(changes.$set), ['lastMessageTime']);
    return reactionQuery(target);
  });
  return { get source() { return source; }, get target() { return target; }, start, update };
}

const forwardingAdmin = () => reactionToken('507f1f77bcf86cd799439099', 'admin');
const forwardingBody = () => ({ targetSessionId: 'target-room', clientRequestId: '22222222-2222-4222-8222-222222222222' });

test('forward: only a verified administrator can invoke the endpoint', async t => {
  const find = t.mock.method(ChatSession, 'findOne', () => { throw new Error('Must authenticate first'); });
  assert.equal((await reactionRequest('/sessions/source-room/messages/source-message/forward', { ...forwardingBody(), role: 'admin', sender: 'admin' }, reactionToken(), 'POST')).status, 403);
  assert.equal((await reactionRequest('/sessions/source-room/messages/source-message/forward', forwardingBody(), '', 'POST')).status, 401);
  assert.equal(find.mock.callCount(), 0);
});

test('forward: copies verified content under the forwarding admin identity without source metadata', async t => {
  const fixture = forwardingFixture(t);
  const original = JSON.stringify(fixture.source.messages);
  const response = await reactionRequest('/sessions/source-room/messages/source-message/forward', { ...forwardingBody(), text: 'FORGED CONTENT', senderId: 'account:forged', role: 'user' }, forwardingAdmin(), 'POST');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.message.text, 'Forward this text');
  assert.equal(data.message.sender, 'admin');
  assert.equal(data.message.senderId, 'account:507f1f77bcf86cd799439099');
  assert.equal(data.message.forwarded, true);
  assert.notEqual(data.message.messageId, 'source-message');
  assert.equal(data.message.reactions, undefined); assert.equal(data.message.recalledAt, undefined);
  assert.equal(data.message.forwardRequestKey, undefined); assert.equal(data.message.forwardSourceKey, undefined);
  const body = JSON.stringify(data);
  for (const secret of ['PRIVATE SOURCE NAME', 'private-source@example.test', 'account:original-user', 'PRIVATE-SOURCE-REQUEST', 'source-room', 'source-message']) assert.equal(body.includes(secret), false);
  assert.equal(JSON.stringify(fixture.source.messages), original);
  assert.equal(fixture.source.unreadCount, 3); assert.equal(fixture.source.lastMessageTime, 10);
  assert.equal(fixture.target.messages.length, 2);
  assert.equal(fixture.target.status, 'ai'); assert.equal(fixture.target.unreadCount, 4);
});

test('forward: concurrent clicks and a retried request produce exactly one copy', async t => {
  const fixture = forwardingFixture(t);
  const responses = await Promise.all([1, 2, 3].map(() => reactionRequest('/sessions/source-room/messages/source-message/forward', forwardingBody(), forwardingAdmin(), 'POST')));
  const data = await Promise.all(responses.map(async response => { assert.equal(response.status, 200); return response.json(); }));
  assert.equal(fixture.target.messages.length, 2);
  assert.equal(new Set(data.map(value => value.message.messageId)).size, 1);
  assert.equal(data.filter(value => value.duplicate).length, 2);
  const replay = await reactionRequest('/sessions/source-room/messages/source-message/forward', forwardingBody(), forwardingAdmin(), 'POST');
  assert.equal((await replay.json()).message.messageId, data[0].message.messageId);
  assert.equal(fixture.target.messages.length, 2);
  assert.equal(fixture.source.__v, 1);
});

test('forward: rejects a recalled source, missing server ID, bot and system log', async t => {
  const fixture = forwardingFixture(t, { recalled: true });
  const request = () => reactionRequest('/sessions/source-room/messages/source-message/forward', forwardingBody(), forwardingAdmin(), 'POST');
  assert.equal((await request()).status, 409);
  fixture.source.messages[0].recalledAt = undefined; fixture.source.messages[0].isSystemLog = true;
  assert.equal((await request()).status, 409);
  fixture.source.messages[0].isSystemLog = false; fixture.source.messages[0].sender = 'bot';
  assert.equal((await request()).status, 409);
  fixture.source.messages[0].sender = 'user'; fixture.source.messages[0].messageId = undefined;
  assert.equal((await request()).status, 409);
  assert.equal(fixture.target.messages.length, 1);
});

test('forward: rejects the source as destination, unknown destination and request-key reuse for a different source', async t => {
  const fixture = forwardingFixture(t);
  const request = body => reactionRequest('/sessions/source-room/messages/source-message/forward', body, forwardingAdmin(), 'POST');
  assert.equal((await request({ ...forwardingBody(), targetSessionId: 'source-room' })).status, 400);
  assert.equal((await request({ ...forwardingBody(), targetSessionId: 'missing' })).status, 404);
  assert.equal((await request(forwardingBody())).status, 200);
  fixture.source.messages.push({ messageId: 'second-source', sender: 'admin', text: 'Different source' });
  const reused = await reactionRequest('/sessions/source-room/messages/second-source/forward', forwardingBody(), forwardingAdmin(), 'POST');
  assert.equal(reused.status, 409);
  assert.equal(fixture.target.messages.length, 2);
});

test('forward: unsupported topology stops before any transaction or write', async t => {
  const fixture = forwardingFixture(t, { unsupported: true });
  const response = await reactionRequest('/sessions/source-room/messages/source-message/forward', forwardingBody(), forwardingAdmin(), 'POST');
  assert.equal(response.status, 503);
  assert.equal(fixture.start.mock.callCount(), 0); assert.equal(fixture.update.mock.callCount(), 0);
  assert.equal(fixture.target.messages.length, 1);
});

test('forward: a transaction failure rolls back the copy and source lock', async t => {
  const fixture = forwardingFixture(t, { failCommit: true });
  const original = JSON.stringify(fixture.source.toObject());
  const response = await reactionRequest('/sessions/source-room/messages/source-message/forward', forwardingBody(), forwardingAdmin(), 'POST');
  assert.equal(response.status, 503);
  assert.equal(fixture.target.messages.length, 1);
  assert.equal(JSON.stringify(fixture.source.toObject()), original);
});

test('forward: destination polling and reload retain the label and the copy is independent of source recall', async t => {
  const fixture = forwardingFixture(t);
  const response = await reactionRequest('/sessions/source-room/messages/source-message/forward', forwardingBody(), forwardingAdmin(), 'POST');
  const copy = (await response.json()).message;
  fixture.source.messages[0].recalledAt = 123;
  for (const path of ['/sessions/target-room/reactions', '/sessions/target-room']) {
    const read = await reactionRequest(path, undefined);
    assert.equal(read.status, 200);
    const data = await read.json();
    const message = data.messages.find(m => m.messageId === copy.messageId);
    assert.equal(message.forwarded, true); assert.equal(message.text, 'Forward this text');
    assert.equal(message.forwardRequestKey, undefined); assert.equal(message.forwardSourceKey, undefined);
  }
  assert.equal((await reactionRequest('/sessions/target-room/reactions', undefined, reactionToken('507f1f77bcf86cd799439012'))).status, 403);
});

test('forward: the new copy supports existing reaction and only its forwarding admin can recall it', async t => {
  const fixture = forwardingFixture(t);
  const original = JSON.stringify(fixture.source.messages);
  const response = await reactionRequest('/sessions/source-room/messages/source-message/forward', forwardingBody(), forwardingAdmin(), 'POST');
  const copy = fixture.target.messages.at(-1);
  const id = (await response.json()).message.messageId;
  assert.equal(copy.messageId, id);
  t.mock.method(ChatSession, 'findOneAndUpdate', (filter, update) => {
    assert.equal(filter.sessionId, 'target-room');
    if (Array.isArray(update)) copy.reactions = [{ actor: 'account:507f1f77bcf86cd799439099', emoji: '👍' }];
    else {
      assert.equal(filter.messages.$elemMatch.senderId, copy.senderId);
      copy.recalledAt = update.$set['messages.$.recalledAt'];
      copy.recalledBy = update.$set['messages.$.recalledBy'];
    }
    return reactionQuery(fixture.target);
  });
  assert.equal((await reactionRequest(`/sessions/target-room/messages/${id}/reaction`, { emoji: '👍' }, forwardingAdmin())).status, 200);
  assert.equal((await reactionRequest(`/sessions/target-room/messages/${id}/recall`, {}, reactionToken(), 'POST')).status, 403);
  assert.equal((await reactionRequest(`/sessions/target-room/messages/${id}/recall`, {}, reactionToken('507f1f77bcf86cd799439098', 'admin'), 'POST')).status, 403);
  const recalled = await reactionRequest(`/sessions/target-room/messages/${id}/recall`, {}, forwardingAdmin(), 'POST');
  assert.equal(recalled.status, 200);
  assert.equal((await recalled.json()).message.text, 'Tin nhắn đã được thu hồi');
  const destination = await (await reactionRequest('/sessions/target-room/reactions', undefined)).json();
  assert.deepEqual(destination.reactions[id], []);
  assert.equal(JSON.stringify(fixture.source.messages), original);
});

test('sticker: both trusted senders persist exactly the ten approved icons with independent server IDs', async t => {
  const session = new ChatSession({ sessionId: 'stickers', userName: 'Owner', reactionOwnerId: 'account:507f1f77bcf86cd799439011', messages: [] });
  t.mock.method(ChatSession, 'findOne', () => reactionQuery(session));
  t.mock.method(ChatSession, 'findOneAndUpdate', (filter, update) => {
    const key = filter.messages.$not.$elemMatch;
    if (session.messages.some(m => m.clientRequestId === key.clientRequestId && m.senderId === key.senderId)) return reactionQuery(null);
    session.messages.push(update.$push.messages);
    return reactionQuery(session);
  });
  const icons = ['🥰', '🥹', '😭', '😍', '😘', '🫶', '💗', '🎉', '👍', '👋'];
  for (const role of ['user', 'admin']) {
    for (const [index, text] of icons.entries()) {
      const token = role === 'admin' ? forwardingAdmin() : reactionToken();
      const payload = { type: 'sticker', text, clientRequestId: `sticker-${role}-request-${index}` };
      const responses = await Promise.all([1, 2].map(() => reactionRequest('/sessions/stickers/messages', payload, token, 'POST')));
      const values = await Promise.all(responses.map(async response => { assert.equal(response.status, 200); return response.json(); }));
      assert.equal(values[0].acceptedMessage.type, 'sticker');
      assert.equal(values[0].acceptedMessage.text, text);
      assert.equal(values[0].acceptedMessage.sender, role);
      assert.equal(values[0].acceptedMessage.senderId, role === 'admin' ? 'account:507f1f77bcf86cd799439099' : session.reactionOwnerId);
      assert.equal(values[0].acceptedMessage.messageId, values[1].acceptedMessage.messageId);
    }
  }
  assert.equal(session.messages.length, 20);
  assert.equal(new Set(session.messages.map(m => m.messageId)).size, 20);
  const reloaded = await (await reactionRequest('/sessions/stickers/reactions', undefined)).json();
  assert.equal(reloaded.messages.length, 20);
  assert.deepEqual(reloaded.messages.slice(0, 10).map(m => m.text), icons);
  assert.ok(reloaded.messages.every(m => m.type === 'sticker'));
});

test('sticker: rejects arbitrary values and distinguishes text and sticker retries', async t => {
  const session = new ChatSession({ sessionId: 'stickers', userName: 'Owner', reactionOwnerId: 'account:507f1f77bcf86cd799439011', messages: [] });
  t.mock.method(ChatSession, 'findOne', () => reactionQuery(session));
  const update = t.mock.method(ChatSession, 'findOneAndUpdate', (filter, changes) => {
    if (session.messages.some(m => m.clientRequestId === filter.messages.$not.$elemMatch.clientRequestId)) return reactionQuery(null);
    session.messages.push(changes.$push.messages); return reactionQuery(session);
  });
  const payload = { type: 'sticker', text: '👍', clientRequestId: 'sticker-request-11111111' };
  for (const text of ['❤️', 'hello', ' 👍', '👍🏻', '🥰🥰', '<script>']) {
    assert.equal((await reactionRequest('/sessions/stickers/messages', { ...payload, text }, reactionToken(), 'POST')).status, 400);
  }
  assert.equal((await reactionRequest('/sessions/stickers/messages', { ...payload, type: 'image' }, reactionToken(), 'POST')).status, 400);
  assert.equal(update.mock.callCount(), 0);
  assert.equal((await reactionRequest('/sessions/stickers/messages', payload, reactionToken(), 'POST')).status, 200);
  for (const change of [{ type: 'text' }, { text: '👋' }]) {
    assert.equal((await reactionRequest('/sessions/stickers/messages', { ...payload, ...change }, reactionToken(), 'POST')).status, 409);
  }
  const plain = await reactionRequest('/sessions/stickers/messages', { text: '👍', clientRequestId: 'plain-request-111111111' }, reactionToken(), 'POST');
  assert.equal(plain.status, 200); assert.equal((await plain.json()).acceptedMessage.type, 'text');
  assert.equal((await reactionRequest('/sessions/stickers/messages', payload, reactionToken('507f1f77bcf86cd799439012'), 'POST')).status, 403);
  assert.equal(session.messages.length, 2);
  const legacy = ChatSession.hydrate({ sessionId: 'old', messages: [{ sender: 'user', text: '👍' }] });
  assert.equal(legacy.messages[0].type, undefined);
});

test('sticker: backend forwarding rejects sticker sources without modifying either conversation', async t => {
  const fixture = forwardingFixture(t);
  fixture.source.messages[0].type = 'sticker'; fixture.source.messages[0].text = '🥰';
  const original = JSON.stringify(fixture.source.messages);
  const target = JSON.stringify(fixture.target.messages);
  const response = await reactionRequest('/sessions/source-room/messages/source-message/forward', forwardingBody(), forwardingAdmin(), 'POST');
  assert.equal(response.status, 409);
  assert.equal(JSON.stringify(fixture.source.messages), original);
  assert.equal(JSON.stringify(fixture.target.messages), target);
});

test('attachment: forwarding rejects both image and document sources', async t => {
  const fixture = forwardingFixture(t); const target = JSON.stringify(fixture.target.messages);
  for (const type of ['image', 'file']) {
    fixture.source.messages[0].type = type;
    assert.equal((await reactionRequest('/sessions/source-room/messages/source-message/forward', forwardingBody(), forwardingAdmin(), 'POST')).status, 409);
  }
  assert.equal(JSON.stringify(fixture.target.messages), target);
});

test('sticker: reaction, own-sender recall and reload redact the icon and block further reactions', async t => {
  const actor = 'account:507f1f77bcf86cd799439011';
  const session = new ChatSession({ sessionId: 'stickers', userName: 'Owner', reactionOwnerId: actor, messages: [
    { messageId: 'sticker', sender: 'user', senderId: actor, type: 'sticker', text: '🥰' },
    { messageId: 'other', sender: 'admin', senderId: 'account:other', text: 'Keep text', reactions: [{ actor, emoji: '👍' }] }
  ] });
  t.mock.method(ChatSession, 'findOne', () => reactionQuery(session));
  t.mock.method(ChatSession, 'findOneAndUpdate', (filter, update) => {
    assert.equal(filter.messages.$elemMatch.recalledAt, null);
    if (session.messages[0].recalledAt) return reactionQuery(null);
    if (Array.isArray(update)) session.messages[0].reactions = [{ actor, emoji: '❤️' }];
    else { session.messages[0].recalledAt = update.$set['messages.$.recalledAt']; session.messages[0].recalledBy = actor; }
    return reactionQuery(session);
  });
  assert.equal((await reactionRequest('/sessions/stickers/messages/sticker/reaction', { emoji: '❤️' })).status, 200);
  assert.equal((await reactionRequest('/sessions/stickers/messages/sticker/recall', {}, forwardingAdmin(), 'POST')).status, 403);
  const recalled = await reactionRequest('/sessions/stickers/messages/sticker/recall', {}, reactionToken(), 'POST');
  assert.equal(recalled.status, 200);
  assert.equal((await recalled.json()).message.text, 'Tin nhắn đã được thu hồi');
  assert.equal((await reactionRequest('/sessions/stickers/messages/sticker/reaction', { emoji: '👍' })).status, 409);
  for (const path of ['/sessions/stickers/reactions', '/sessions/stickers']) {
    const data = await (await reactionRequest(path, undefined)).json();
    assert.ok(!JSON.stringify(data).includes('🥰'));
    assert.equal(data.messages[0].type, undefined);
    assert.equal(data.messages[0].text, 'Tin nhắn đã được thu hồi');
    assert.equal(data.messages[1].text, 'Keep text');
    if (data.reactions) { assert.deepEqual(data.reactions.sticker, []); assert.equal(data.reactions.other[0].emoji, '👍'); }
  }
  assert.equal(session.messages[0].text, '🥰');
});
