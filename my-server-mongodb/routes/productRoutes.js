const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const reviewController = require('../controllers/reviewController');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.get('/', productController.getAllProducts);
router.get('/:productId/reviews', reviewController.getProductReviews);
router.get('/:id', productController.getProductById);
router.post('/', authenticate, requireAdmin, productController.createProduct);
router.put('/:id', authenticate, requireAdmin, productController.updateProduct);
router.patch('/:id', authenticate, requireAdmin, productController.updateProduct);
router.patch('/:id/stock', authenticate, requireAdmin, productController.updateStock);
router.delete('/:id', authenticate, requireAdmin, productController.deleteProduct);

module.exports = router;
