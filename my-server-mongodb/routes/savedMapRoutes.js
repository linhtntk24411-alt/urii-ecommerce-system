const express = require('express');
const controller = require('../controllers/savedMapController');
const { authenticate, requireAdmin, requireCustomer } = require('../middleware/auth');

const router = express.Router();

router.get('/mine', authenticate, requireCustomer, controller.getMySavedMaps);
router.post('/mine', authenticate, requireCustomer, controller.saveMyMap);
router.route('/mine/:mapId')
  .all(authenticate, requireCustomer)
  .delete(controller.removeMySavedMap)
  .patch(controller.updateMySavedMap)
  .put(controller.updateMySavedMap);

router.use(authenticate, requireAdmin);
router.get('/', controller.getAllSavedMaps);
router.get('/:id', controller.getSavedMapById);
router.post('/', controller.createSavedMap);
router.put('/:id', controller.updateSavedMap);
router.patch('/:id', controller.updateSavedMap);
router.delete('/:id', controller.deleteSavedMap);

module.exports = router;
