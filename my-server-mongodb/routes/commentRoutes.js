const express = require('express');
const router = express.Router();
const c = require('../controllers/commentController');
router.get('/', c.getAllComments);
module.exports = router;