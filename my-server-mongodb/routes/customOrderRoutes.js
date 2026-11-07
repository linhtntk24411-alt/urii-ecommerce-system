const express = require('express');
const controller = require('../controllers/customOrderController');
const { authenticate, optionalAuthenticate, requireAdmin, requireCustomer } = require('../middleware/auth');
const { handleImageUpload } = require('./uploadRoutes');

const router = express.Router();

router.post('/upload', optionalAuthenticate, handleImageUpload);
router.post('/', optionalAuthenticate, controller.createCustomOrder);
router.get('/mine', authenticate, requireCustomer, controller.getMyCustomOrders);
router.get('/mine/:id', authenticate, requireCustomer, controller.getMyCustomOrderById);
router.get('/', authenticate, requireAdmin, controller.getAllCustomOrders);
router.get('/:id', authenticate, requireAdmin, controller.getCustomOrderById);
router.put('/:id', authenticate, requireAdmin, controller.updateCustomOrder);
router.patch('/:id', authenticate, requireAdmin, controller.updateCustomOrder);
router.delete('/:id', authenticate, requireAdmin, controller.deleteCustomOrder);

module.exports = router;
