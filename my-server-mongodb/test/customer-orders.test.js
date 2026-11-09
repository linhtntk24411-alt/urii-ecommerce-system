const assert = require('node:assert/strict');
const { test } = require('node:test');
const Order = require('../models/Order');
const User = require('../models/User');
const orderRoutes = require('../routes/orderRoutes');
const { authenticate, requireAdmin, requireCustomer } = require('../middleware/auth');
const orderController = require('../controllers/orderController');

const userId = '6ade4310c044b23d6c6a8681';

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

test('customer order routes authenticate customers before the admin-only order routes', () => {
  const listRoute = orderRoutes.stack.find(
    (layer) => layer.route?.path === '/mine' && layer.route.methods.get
  );
  const detailRoute = orderRoutes.stack.find(
    (layer) => layer.route?.path === '/mine/:slug' && layer.route.methods.get
  );
  const createPaymentRoute = orderRoutes.stack.find(
    (layer) => layer.route?.path === '/:id/payment' && layer.route.methods.post
  );
  const getPaymentRoute = orderRoutes.stack.find(
    (layer) => layer.route?.path === '/:id/payment' && layer.route.methods.get
  );
  const adminOnlyLayer = orderRoutes.stack.findIndex(
    (layer) => !layer.route && layer.handle === requireAdmin
  );

  assert.ok(listRoute);
  assert.ok(detailRoute);
  assert.ok(createPaymentRoute);
  assert.ok(getPaymentRoute);
  assert.equal(listRoute.route.stack[0].handle, authenticate);
  assert.equal(listRoute.route.stack[1].handle, requireCustomer);
  assert.equal(detailRoute.route.stack[0].handle, authenticate);
  assert.equal(detailRoute.route.stack[1].handle, requireCustomer);
  assert.equal(createPaymentRoute.route.stack[0].handle, authenticate);
  assert.equal(createPaymentRoute.route.stack[1].handle, requireCustomer);
  assert.equal(getPaymentRoute.route.stack[0].handle, authenticate);
  assert.equal(getPaymentRoute.route.stack[1].handle, requireCustomer);
  assert.equal(requireAdmin.name, 'requireAdmin');
  assert.ok(orderRoutes.stack.indexOf(listRoute) < adminOnlyLayer);
  assert.ok(orderRoutes.stack.indexOf(detailRoute) < adminOnlyLayer);
  assert.ok(orderRoutes.stack.indexOf(createPaymentRoute) < adminOnlyLayer);
  assert.ok(orderRoutes.stack.indexOf(getPaymentRoute) < adminOnlyLayer);
});

test('customer order list is filtered by authenticated user and stored status', async () => {
  const originalFind = Order.find;
  const originalCountDocuments = Order.countDocuments;
  const originalUserFind = User.find;
  let listFilter;
  let countFilter;

  Order.find = (filter) => {
    listFilter = filter;
    return {
      sort() {
        return this;
      },
      skip(value) {
        assert.equal(value, 5);
        return this;
      },
      limit(value) {
        assert.equal(value, 5);
        return this;
      },
      lean: async () => []
    };
  };
  Order.countDocuments = async (filter) => {
    countFilter = filter;
    return 0;
  };
  User.find = () => ({
    select() {
      return { lean: async () => [] };
    }
  });

  try {
    const response = responseRecorder();
    await orderController.getMyOrders(
      { auth: { id: userId }, query: { page: '2', limit: '5', statusId: 'completed' } },
      response
    );

    assert.equal(response.statusCode, 200);
    assert.deepEqual(listFilter, { userId, statusId: 'completed' });
    assert.deepEqual(countFilter, listFilter);
    assert.deepEqual(response.body, {
      orders: [],
      total: 0,
      page: 2,
      limit: 5,
      totalPages: 0
    });
  } finally {
    Order.find = originalFind;
    Order.countDocuments = originalCountDocuments;
    User.find = originalUserFind;
  }
});

test('customer order detail lookup scopes the database query to the authenticated user', async () => {
  const originalFindOne = Order.findOne;
  let detailFilter;
  Order.findOne = (filter) => {
    detailFilter = filter;
    return { lean: async () => null };
  };

  try {
    const response = responseRecorder();
    await orderController.getMyOrderBySlug(
      { auth: { id: userId }, params: { slug: 'UR-82901' } },
      response
    );

    assert.deepEqual(detailFilter, { userId, id: 'UR-82901' });
    assert.equal(response.statusCode, 404);
    assert.equal(response.body.message, 'Không tìm thấy đơn hàng.');
  } finally {
    Order.findOne = originalFindOne;
  }
});

test('customer endpoints reject invalid status and invalid customer identity', async () => {
  const invalidStatusResponse = responseRecorder();
  await orderController.getMyOrders(
    { auth: { id: userId }, query: { statusId: 'unrecognized' } },
    invalidStatusResponse
  );
  assert.equal(invalidStatusResponse.statusCode, 400);

  const invalidUserResponse = responseRecorder();
  await orderController.getMyOrders(
    { auth: { id: 'not-an-object-id' }, query: {} },
    invalidUserResponse
  );
  assert.equal(invalidUserResponse.statusCode, 401);
});
