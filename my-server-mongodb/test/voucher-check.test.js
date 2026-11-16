const assert = require('node:assert/strict');
const { test, describe, beforeEach, afterEach } = require('node:test');
const Voucher = require('../models/Voucher');
const voucherController = require('../controllers/voucherController');

describe('Voucher Check Controller', () => {
  let originalFindOne;

  beforeEach(() => {
    originalFindOne = Voucher.findOne;
  });

  afterEach(() => {
    Voucher.findOne = originalFindOne;
  });

  function createMockRes() {
    return {
      statusCode: 200,
      jsonResult: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.jsonResult = data;
        return this;
      }
    };
  }

  test('returns 400 when code is empty', async () => {
    const req = { params: {}, body: {}, query: {} };
    const res = createMockRes();

    await voucherController.checkVoucher(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.jsonResult.valid, false);
  });

  test('returns NOT_FOUND when voucher does not exist in MongoDB', async () => {
    Voucher.findOne = () => ({
      lean: async () => null
    });

    const req = { params: { code: 'NOT_EXIST_CODE' }, body: {}, query: {} };
    const res = createMockRes();

    await voucherController.checkVoucher(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonResult.valid, false);
    assert.equal(res.jsonResult.reason, 'NOT_FOUND');
    assert.match(res.jsonResult.message, /Tiếc quá, chúng tớ không tìm thấy/i);
  });

  test('returns INACTIVE when voucher is disabled in MongoDB', async () => {
    Voucher.findOne = () => ({
      lean: async () => ({
        code: 'INACTIVE10',
        name: 'Voucher tạm ngưng',
        isActive: false
      })
    });

    const req = { params: { code: 'INACTIVE10' }, body: {}, query: {} };
    const res = createMockRes();

    await voucherController.checkVoucher(req, res);
    assert.equal(res.jsonResult.valid, false);
    assert.equal(res.jsonResult.reason, 'INACTIVE');
  });

  test('returns EXPIRED when voucher end date has passed', async () => {
    Voucher.findOne = () => ({
      lean: async () => ({
        code: 'EXPIRED20',
        name: 'Voucher hết hạn',
        isActive: true,
        startDate: '01/01/2020',
        endDate: '01/01/2021'
      })
    });

    const req = { params: { code: 'EXPIRED20' }, body: {}, query: {} };
    const res = createMockRes();

    await voucherController.checkVoucher(req, res);
    assert.equal(res.jsonResult.valid, false);
    assert.equal(res.jsonResult.reason, 'EXPIRED');
  });

  test('returns OUT_OF_STOCK when voucher quantity limit is reached', async () => {
    Voucher.findOne = () => ({
      lean: async () => ({
        code: 'SOLDOUT',
        name: 'Voucher hết lượt',
        isActive: true,
        startDate: '01/01/2024',
        endDate: '31/12/2026',
        quantity: 50,
        used: 50
      })
    });

    const req = { params: { code: 'SOLDOUT' }, body: {}, query: {} };
    const res = createMockRes();

    await voucherController.checkVoucher(req, res);
    assert.equal(res.jsonResult.valid, false);
    assert.equal(res.jsonResult.reason, 'OUT_OF_STOCK');
  });

  test('returns valid: true when voucher is active and valid in MongoDB', async () => {
    const mockVoucher = {
      code: 'FREESHIP',
      name: 'Miễn phí vận chuyển',
      type: 'shipping',
      discountValue: 30000,
      minOrder: 100000,
      maxDiscount: 30000,
      startDate: '01/01/2024',
      endDate: '31/12/2026',
      quantity: 500,
      used: 120,
      isActive: true
    };

    Voucher.findOne = () => ({
      lean: async () => mockVoucher
    });

    const req = { params: { code: 'FREESHIP' }, body: {}, query: {} };
    const res = createMockRes();

    await voucherController.checkVoucher(req, res);
    assert.equal(res.jsonResult.valid, true);
    assert.equal(res.jsonResult.code, 'FREESHIP');
    assert.deepEqual(res.jsonResult.voucher, mockVoucher);
  });
});
