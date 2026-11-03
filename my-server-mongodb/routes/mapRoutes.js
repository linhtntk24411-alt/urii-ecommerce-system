const express = require('express');
const mapController = require('../controllers/mapController');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', mapController.getAllMaps);
router.get('/:mapId', mapController.getMapById);
router.post('/', authenticate, requireAdmin, mapController.createMap);
router.put('/:mapId', authenticate, requireAdmin, mapController.updateMap);
router.patch('/:mapId', authenticate, requireAdmin, mapController.updateMap);
router.delete('/:mapId', authenticate, requireAdmin, mapController.deleteMap);

module.exports = router;
