const express = require('express');
const controller = require('../controllers/customOrderController');
const { authenticate, optionalAuthenticate, requireAdmin } = require('../middleware/auth');
const { handleImageUpload } = require('./uploadRoutes');

const router = express.Router();

router.post('/upload', optionalAuthenticate, handleImageUpload);
router.post('/', optionalAuthenticate, controller.createCustomOrder);
router.get('/', authenticate, requireAdmin, controller.getAllCustomOrders);
router.get('/:id', authenticate, requireAdmin, controller.getCustomOrderById);
router.put('/:id', authenticate, requireAdmin, controller.updateCustomOrder);
router.patch('/:id', authenticate, requireAdmin, controller.updateCustomOrder);
router.delete('/:id', authenticate, requireAdmin, controller.deleteCustomOrder);

module.exports = router;
