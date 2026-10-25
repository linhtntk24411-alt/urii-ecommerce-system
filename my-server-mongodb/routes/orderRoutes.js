const express = require('express');
const router = express.Router();
const c = require('../controllers/orderController');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.use(authenticate, requireAdmin);
router.get('/', c.getAllOrders);
module.exports = router;