const express = require('express');
const galleryController = require('../controllers/galleryController');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', galleryController.getAllGallery);
router.get('/:mapId', galleryController.getGalleryById);
router.post('/', authenticate, requireAdmin, galleryController.createGallery);
router.put('/:mapId', authenticate, requireAdmin, galleryController.updateGallery);
router.patch('/:mapId', authenticate, requireAdmin, galleryController.updateGallery);
router.delete('/:mapId', authenticate, requireAdmin, galleryController.deleteGallery);

module.exports = router;
