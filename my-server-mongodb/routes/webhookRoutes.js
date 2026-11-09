const express = require('express');
const paymentController = require('../controllers/paymentController');

const router = express.Router();

const webhookRawBodyParser = express.raw({
  type: () => true,
  limit: '64kb'
});

function attachRawBody(req, _res, next) {
  if (Buffer.isBuffer(req.body)) {
    req.rawBody = req.body;
  }
  next();
}

router.post(
  '/sepay',
  webhookRawBodyParser,
  attachRawBody,
  paymentController.handleSepayWebhook
);

module.exports = router;
