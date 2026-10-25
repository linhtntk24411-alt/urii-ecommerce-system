const express = require('express');
const mapController = require('../controllers/mapController');

const router = express.Router();

router.get('/', mapController.getAllMaps);
router.get('/:mapId', mapController.getMapById);

module.exports = router;
