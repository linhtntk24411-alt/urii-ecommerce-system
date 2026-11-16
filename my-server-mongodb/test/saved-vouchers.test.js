const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const UserVoucher = require('../models/UserVoucher');
const SavedVoucher = require('../models/SavedVoucher');
const Voucher = require('../models/Voucher');
const User = require('../models/User');
const { prepareSavedVouchers } = require('../utils/savedVouchers');
const userVoucherController = require('../controllers/userVoucherController');
const savedVoucherRoutes = require('../routes/savedVoucherRoutes');
const userVoucherRoutes = require('../routes/userVoucherRoutes');

function readJSON(fileName) {
  const filePath = path.join(__dirname, '..', 'data', fileName);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('saved voucher fixtures link existing customers and vouchers by ID', async () => {
  const savedVoucherData = readJSON('saved_vouchers.json');
  const singularData = readJSON('saved_voucher.json');
  assert.ok(savedVoucherData, 'saved_vouchers.json must exist');
  assert.ok(singularData, 'saved_voucher.json must exist');

  const users = readJSON('users.json').users;
  const customers = users.filter((u) => u.role === 'user');
  const customerById = new Map(customers.map((u) => [String(u._id), u]));
  const vouchers = readJSON('vouchers.json').vouchers;
  const voucherIds = new Set(vouchers.map((v) => v.id));

  assert.equal(UserVoucher.modelName, 'UserVoucher');
  assert.equal(UserVoucher.collection.collectionName, 'user_vouchers');
  assert.equal(SavedVoucher, UserVoucher, 'SavedVoucher should alias UserVoucher');

  // Kiểm tra chuẩn hóa userIds và voucherIds
  assert.ok(savedVoucherData.users.every((u) => customerById.has(u.userId)));
  assert.ok(savedVoucherData.users.every((u) => /^[a-f\d]{24}$/i.test(u.userId)));
  assert.ok(savedVoucherData.users.every((u) => u.voucherIds.every((vid) => voucherIds.has(vid))));

  const prepared = prepareSavedVouchers(savedVoucherData, customers, vouchers);
  assert.ok(prepared.length > 0);

  // Mỗi record chuẩn hóa theo userId và voucherId
  for (const record of prepared) {
    assert.ok(customerById.has(String(record.userId)));
    assert.ok(voucherIds.has(record.voucherId));
    assert.ok(record.code);
    assert.equal(typeof record.isUsed, 'boolean');
  }

  // Đảm bảo không trùng cặp userId và voucherId
  const uniqueKeys = new Set(prepared.map((r) => `${String(r.userId)}:${r.voucherId}`));
  assert.equal(uniqueKeys.size, prepared.length, 'Mỗi user chỉ nhận 1 voucher tối đa 1 lần (chuẩn hóa theo id user và id voucher)');

  // Kiểm tra validate mongoose schema
  for (const record of prepared) {
    const doc = new UserVoucher(record);
    await doc.validate();
  }
});

test('prepareSavedVouchers rejects duplicate voucher for same user', () => {
  const customers = [{ _id: '6ade4310c044b23d6c6a8681', role: 'user' }];
  const vouchers = [{ id: 'FREESHIP', code: 'FREESHIP' }];
  const badData = {
    users: [
      {
        userId: '6ade4310c044b23d6c6a8681',
        voucherIds: ['FREESHIP', 'FREESHIP']
      }
    ]
  };

  assert.throws(
    () => prepareSavedVouchers(badData, customers, vouchers),
    /duplicate saved voucher/
  );
});

test('saved voucher routes export user voucher handlers', () => {
  assert.equal(savedVoucherRoutes, userVoucherRoutes);
  assert.ok(typeof userVoucherController.getMyVouchers === 'function');
  assert.ok(typeof userVoucherController.getUnclaimedVouchers === 'function');
  assert.ok(typeof userVoucherController.claimVoucher === 'function');
});
