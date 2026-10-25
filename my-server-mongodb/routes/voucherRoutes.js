const express = require('express');
const voucherController = require('../controllers/voucherController');

const router = express.Router();

router.get('/', voucherController.getActiveVouchers);

module.exports = router;
