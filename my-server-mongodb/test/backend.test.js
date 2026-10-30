const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const jwt = require('jsonwebtoken');
const app = require('../app');

let server;
let baseUrl;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test('health endpoint responds without a database connection', async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'OK');
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
    fetch(`${baseUrl}/api/vouchers/manage`),
    fetch(`${baseUrl}/api/vouchers`, { method: 'POST' }),
    fetch(`${baseUrl}/api/vouchers/WELCOME10`, { method: 'PATCH' }),
    fetch(`${baseUrl}/api/vouchers/WELCOME10`, { method: 'DELETE' }),
    fetch(`${baseUrl}/api/dashboard`)
  ];

  const responses = await Promise.all(requests);
  assert.ok(responses.every((response) => response.status === 401));
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

test('rejects browser requests from origins outside the allow list', async () => {
  const response = await fetch(`${baseUrl}/`, {
    headers: { Origin: 'https://not-allowed.example' }
  });
  assert.equal(response.status, 403);
});

test('rejects malformed registration data before accessing the database', async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'invalid', password: 'short' })
  });
  assert.equal(response.status, 400);
});
