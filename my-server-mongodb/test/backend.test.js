const assert = require('node:assert/strict');
const http = require('node:http');
const { after, before, test } = require('node:test');
const jwt = require('jsonwebtoken');
const { io: connectSocket } = require('socket.io-client');
const app = require('../app');
const { emitCrudChange, initializeRealtime } = require('../realtime');

let server;
let io;
let baseUrl;
const previousJwtSecret = process.env.JWT_SECRET;

before(async () => {
  process.env.JWT_SECRET = 'test-secret-only';
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
    fetch(`${baseUrl}/api/cart`, { headers: { Authorization: `Bearer ${adminToken}` } }),
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
