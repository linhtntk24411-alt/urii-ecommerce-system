const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.get('/', productController.getAllProducts);
router.post('/', authenticate, requireAdmin, productController.createProduct);
router.delete('/:id', authenticate, requireAdmin, productController.deleteProduct);

module.exports = router;