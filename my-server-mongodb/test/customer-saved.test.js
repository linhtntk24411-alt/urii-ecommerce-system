const assert = require('node:assert/strict');
const { test } = require('node:test');
const SavedMap = require('../models/SavedMap');
const User = require('../models/User');
const Gallery = require('../models/Gallery');
const savedMapRoutes = require('../routes/savedMapRoutes');
const { authenticate, requireAdmin, requireCustomer } = require('../middleware/auth');
const controller = require('../controllers/savedMapController');

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

test('customer saved-map routes are authenticated before admin-only routes', () => {
  const customerRoutes = savedMapRoutes.stack.filter((layer) => layer.route);
  const mineRoutes = customerRoutes.filter((layer) => layer.route.path.startsWith('/mine'));
  const adminListRoute = customerRoutes.find(
    (layer) => layer.route.path === '/' && layer.route.methods.get
  );
  const adminGate = savedMapRoutes.stack.find((layer) => layer.handle === requireAdmin);

  assert.equal(mineRoutes.length, 3);
  mineRoutes.forEach((layer) => {
    assert.equal(layer.route.stack[0].handle, authenticate);
    assert.equal(layer.route.stack[1].handle, requireCustomer);
  });
  assert.ok(adminListRoute);
  assert.ok(adminGate);
  assert.ok(savedMapRoutes.stack.indexOf(adminGate) < savedMapRoutes.stack.indexOf(adminListRoute));
  mineRoutes.forEach((layer) => {
    assert.ok(savedMapRoutes.stack.indexOf(layer) < savedMapRoutes.stack.indexOf(adminGate));
  });
});

test('customer saved-map list is scoped to the authenticated user', async () => {
  const originalFind = SavedMap.find;
  const originalExists = User.exists;
  const records = [{ id: 'saved-1', userId, mapId: 'map-1' }];
  let filter;
  try {
    User.exists = async (query) => query._id === userId && query.role === 'user';
    SavedMap.find = (query) => {
      filter = query;
      return {
        sort() { return this; },
        skip() { return this; },
        limit() { return this; },
        lean: async () => records
      };
    };

    const response = responseRecorder();
    await controller.getMySavedMaps({ auth: { id: userId }, query: {} }, response);

    assert.deepEqual(filter, { userId });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, records);
  } finally {
    SavedMap.find = originalFind;
    User.exists = originalExists;
  }
});

test('saving a map uses customer identity and map details from MongoDB', async () => {
  const originalExists = User.exists;
  const originalFindOne = Gallery.findOne;
  const originalCreate = SavedMap.create;
  let created;
  try {
    User.exists = async () => true;
    Gallery.findOne = (filter) => ({
      select: () => ({
        lean: async () => filter.map_id === 'map-1'
          ? { map_id: 'map-1', map_name: 'Map từ Mongo', author: 'Tác giả', main_image: '/images/map.png' }
          : null
      })
    });
    SavedMap.create = async (record) => {
      created = record;
      return { ...record, id: 'saved-map-1' };
    };

    const response = responseRecorder();
    await controller.saveMyMap({
      auth: { id: userId },
      body: { mapId: 'map-1', userId: 'attacker-id', title: 'Dữ liệu giả' }
    }, response);

    assert.equal(response.statusCode, 201);
    assert.equal(created.userId, userId);
    assert.equal(created.mapId, 'map-1');
    assert.equal(created.title, 'Map từ Mongo');
    assert.equal(created.author, 'Tác giả');
    assert.equal(created.image, '/images/map.png');
  } finally {
    User.exists = originalExists;
    Gallery.findOne = originalFindOne;
    SavedMap.create = originalCreate;
  }
});

test('removing a saved map is scoped to the authenticated customer', async () => {
  const originalExists = User.exists;
  const originalFindOneAndDelete = SavedMap.findOneAndDelete;
  let filter;
  try {
    User.exists = async () => true;
    SavedMap.findOneAndDelete = async (query) => {
      filter = query;
      return { id: 'saved-map-1' };
    };

    const response = responseRecorder();
    await controller.removeMySavedMap({
      auth: { id: userId },
      params: { mapId: 'map-1' }
    }, response);

    assert.deepEqual(filter, { userId, mapId: 'map-1' });
    assert.equal(response.statusCode, 200);
  } finally {
    User.exists = originalExists;
    SavedMap.findOneAndDelete = originalFindOneAndDelete;
  }
});
