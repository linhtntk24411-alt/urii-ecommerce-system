const express = require('express');
const router = express.Router();
const c = require('../controllers/orderController');
const paymentController = require('../controllers/paymentController');
const { authenticate, requireAdmin, requireCustomer } = require('../middleware/auth');

router.get('/mine', authenticate, requireCustomer, c.getMyOrders);
router.get('/mine/:slug', authenticate, requireCustomer, c.getMyOrderBySlug);
router.post('/:id/payment', authenticate, requireCustomer, paymentController.createOrderPayment);
router.get('/:id/payment', authenticate, requireCustomer, paymentController.getOrderPaymentStatus);

router.get('/metadata', c.getOrderMetadata);
router.get('/mine', authenticate, c.getMyOrders);
router.post('/:id/cancel-request', authenticate, c.requestCancelOrder);
router.post('/:id/return-request', authenticate, c.requestReturnOrder);

router.post('/', authenticate, requireCustomer, c.createOrder);
router.use(authenticate, requireAdmin);
router.get('/', c.getAllOrders);
router.get('/:id', c.getOrderById);
router.put('/:id', c.updateOrder);
router.patch('/:id', c.updateOrder);
router.delete('/:id', c.deleteOrder);
module.exports = router;
