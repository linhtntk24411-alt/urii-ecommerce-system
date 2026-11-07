const express = require('express');
const router = express.Router();
const userVoucherController = require('../controllers/userVoucherController');
const { authenticate, optionalAuthenticate } = require('../middleware/auth');

router.get('/available', optionalAuthenticate, userVoucherController.getUnclaimedVouchers);
router.post('/claim', authenticate, userVoucherController.claimVoucher);
router.post('/claim-all', authenticate, userVoucherController.claimAllVouchers);
router.post('/claim-birthday', authenticate, userVoucherController.claimBirthdayVoucher);
router.get('/mine', authenticate, userVoucherController.getMyVouchers);

module.exports = router;
