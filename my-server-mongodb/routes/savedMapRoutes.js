const express = require('express');
const controller = require('../controllers/savedMapController');
const { authenticate, requireAdmin, requireCustomer } = require('../middleware/auth');

const router = express.Router();

router.get('/mine', authenticate, requireCustomer, controller.getMySavedMaps);
router.post('/mine', authenticate, requireCustomer, controller.saveMyMap);
router.put('/mine/:mapId', authenticate, requireCustomer, controller.updateMySavedMap);
router.patch('/mine/:mapId', authenticate, requireCustomer, controller.updateMySavedMap);
router.delete('/mine/:mapId', authenticate, requireCustomer, controller.removeMySavedMap);

router.use(authenticate, requireAdmin);
router.get('/', controller.getAllSavedMaps);
router.get('/:id', controller.getSavedMapById);
router.post('/', controller.createSavedMap);
router.put('/:id', controller.updateSavedMap);
router.patch('/:id', controller.updateSavedMap);
router.delete('/:id', controller.deleteSavedMap);

module.exports = router;
