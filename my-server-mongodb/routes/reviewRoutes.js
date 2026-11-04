const express = require('express');
const controller = require('../controllers/reviewController');
const { authenticate, requireCustomer } = require('../middleware/auth');

const router = express.Router();
router.get('/product/:productId', controller.getProductReviews);
router.use(authenticate, requireCustomer);
router.get('/mine', controller.getMyReviews);
router.get('/eligible-orders', controller.getEligibleOrders);
router.post('/', controller.createReview);

module.exports = router;
