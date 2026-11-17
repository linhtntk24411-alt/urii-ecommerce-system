const express = require('express');
const controller = require('../controllers/reviewController');
const { authenticate, requireCustomerOnly } = require('../middleware/auth');

const router = express.Router();

router.get('/', controller.getAllReviews);
router.get('/product/:productId', controller.getProductReviews);
router.get('/products/:productId', controller.getProductReviews);

router.get('/mine', authenticate, requireCustomerOnly, controller.getMyReviews);
router.get('/eligible-orders', authenticate, requireCustomerOnly, controller.getEligibleOrders);
router.post('/', authenticate, requireCustomerOnly, controller.createReview);
router.post('/:id/replies', authenticate, controller.createReviewReply);

router.get('/:productId', controller.getProductReviews);

module.exports = router;
