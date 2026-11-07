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
    assert.deepEqual(query, { userId, isUsed: false });
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
