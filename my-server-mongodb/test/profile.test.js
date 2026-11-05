const assert = require('node:assert/strict');
const { test } = require('node:test');
const User = require('../models/User');
const authController = require('../controllers/authController');

test('self profile updates require valid phone and birth while supporting optional interests and gender', async () => {
  const userId = '6ade4310c044b23d6c6a8681';
  const user = { _id: userId, name: 'Urii Member', email: 'member@example.com' };
  const origFindByIdAndUpdate = User.findByIdAndUpdate;
  let updateCalls = 0;
  let savedUpdates = null;
  User.findByIdAndUpdate = (id, updates, options) => {
    updateCalls += 1;
    savedUpdates = updates;
    assert.equal(id, userId);
    assert.deepEqual(options, { new: true, runValidators: true });
    return {
      select(selection) {
        assert.equal(selection, '-password');
        return {
          lean: async () => ({ ...user, ...updates })
        };
      }
    };
  };

  const callUpdate = async (body) => {
    let statusCode = 200;
    let responseBody = null;
    await authController.updateMe(
      { auth: { id: userId }, body },
      {
        status(code) {
          statusCode = code;
          return this;
        },
        json(payload) {
          responseBody = payload;
        }
      }
    );
    return { statusCode, responseBody };
  };

  try {
    const result = await callUpdate({
      phone: '0901234567',
      birth: '12/08/1998',
      interests: 'Đồ handmade',
      gender: 'female'
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.responseBody.phone, '0901234567');
    assert.equal(result.responseBody.birth, '12/08/1998');
    assert.equal(result.responseBody.interests, 'Đồ handmade');
    assert.equal(result.responseBody.gender, 'female');
    assert.equal(savedUpdates.interests, 'Đồ handmade');
    assert.equal(savedUpdates.gender, 'female');

    assert.equal((await callUpdate({ phone: '' })).statusCode, 400);
    assert.equal((await callUpdate({ birth: '31/02/2000' })).statusCode, 400);
    assert.equal((await callUpdate({ gender: 'unknown' })).statusCode, 400);
    assert.equal(updateCalls, 1);
  } finally {
    User.findByIdAndUpdate = origFindByIdAndUpdate;
  }
});

test('auth profile formatting returns optional interest and gender values', () => {
  const formatted = authController.formatAuthUser({
    _id: '6ade4310c044b23d6c6a8681',
    name: 'Urii Member',
    email: 'member@example.com',
    interests: 'Đồ handmade',
    gender: 'female'
  });

  assert.equal(formatted.interests, 'Đồ handmade');
  assert.equal(formatted.gender, 'female');
});
