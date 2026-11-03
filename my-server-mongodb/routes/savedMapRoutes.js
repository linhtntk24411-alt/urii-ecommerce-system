const express = require('express');
const controller = require('../controllers/savedMapController');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate, requireAdmin);
router.get('/', controller.getAllSavedMaps);
router.get('/:id', controller.getSavedMapById);
router.post('/', controller.createSavedMap);
router.put('/:id', controller.updateSavedMap);
router.patch('/:id', controller.updateSavedMap);
router.delete('/:id', controller.deleteSavedMap);

module.exports = router;
