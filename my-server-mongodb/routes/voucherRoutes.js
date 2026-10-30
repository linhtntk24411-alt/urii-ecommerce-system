const express = require('express');
const voucherController = require('../controllers/voucherController');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', voucherController.getActiveVouchers);
router.get('/manage', authenticate, requireAdmin, voucherController.getAllVouchers);
router.post('/', authenticate, requireAdmin, voucherController.createVoucher);
router.get('/:id', authenticate, requireAdmin, voucherController.getVoucherById);
router.put('/:id', authenticate, requireAdmin, voucherController.updateVoucher);
router.patch('/:id', authenticate, requireAdmin, voucherController.updateVoucher);
router.delete('/:id', authenticate, requireAdmin, voucherController.deleteVoucher);

module.exports = router;
