const express = require('express');
const router = express.Router();
const c = require('../controllers/orderController');
const { authenticate, requireAdmin, requireCustomer } = require('../middleware/auth');

router.get('/mine', authenticate, requireCustomer, c.getMyOrders);
router.get('/mine/:slug', authenticate, requireCustomer, c.getMyOrderBySlug);

router.use(authenticate, requireAdmin);
router.get('/', c.getAllOrders);
router.get('/:id', c.getOrderById);
router.post('/', c.createOrder);
router.put('/:id', c.updateOrder);
router.patch('/:id', c.updateOrder);
router.delete('/:id', c.deleteOrder);
module.exports = router;