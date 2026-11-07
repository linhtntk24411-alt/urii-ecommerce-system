const express = require('express');
const controller = require('../controllers/reviewController');
const { authenticate, requireCustomer } = require('../middleware/auth');

const router = express.Router();

router.get('/', controller.getAllReviews);
router.get('/product/:productId', controller.getProductReviews);
router.get('/products/:productId', controller.getProductReviews);

router.get('/mine', authenticate, requireCustomer, controller.getMyReviews);
router.get('/eligible-orders', authenticate, requireCustomer, controller.getEligibleOrders);
router.post('/', authenticate, requireCustomer, controller.createReview);
router.post('/:id/replies', authenticate, controller.createReviewReply);

router.get('/:productId', controller.getProductReviews);

module.exports = router;
