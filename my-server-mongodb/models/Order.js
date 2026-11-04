const mongoose = require('mongoose');
const { isValidImageUrl } = require('../utils/imageUrl');
const orderStatuses = require('../data/order_statuses.json');

const orderEvidenceSchema = new mongoose.Schema({
  type: { type: String, enum: ['image', 'video'], required: true },
  url: {
    type: String,
    required: true,
    validate: { validator: isValidImageUrl, message: 'URL minh chứng không hợp lệ.' }
  }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  userName: String,
  date: String,
  status: String,
  statusId: { type: String, enum: orderStatuses.orderStatuses.map(({ id }) => id) },
  statusType: String,
  cancellationReasonId: String,
  cancellationNote: String,
  returnReasonId: String,
  returnNote: String,
  returnEvidence: { type: [orderEvidenceSchema], default: [] },
  showReview: { type: Boolean, default: false },
  deliveredAt: Date,
  total: String,
  totalAmount: Number,
  icon: String,
  items: [{
    productId: String,
    name: String,
    price: Number,
    unitPrice: Number,
    quantity: Number,
    image: String,
    variantIndex: { type: Number, min: 0, validate: (value) => value === null || Number.isInteger(value) },
    variantName: String
  }],
  voucher: { voucherId: String, discountAmount: Number },
  payment: {
    methodId: { type: String, enum: orderStatuses.paymentMethods.map(({ id }) => id) },
    method: String,
    status: String,
    statusId: { type: String, enum: orderStatuses.paymentStatuses.map(({ id }) => id) }
  },
  shipping: {
    methodId: { type: String, enum: orderStatuses.shippingMethods.map(({ id }) => id) },
    carrier: String,
    method: String,
    trackingNumber: String,
    fee: Number,
    estimatedDelivery: Date
  },
  address: { name: String, phone: String, address: String },
  timeline: [{
    status: String,
    statusId: { type: String, enum: orderStatuses.timelineStatuses.map(({ id }) => id) },
    time: Date
  }],
  shippingTimeline: [{
    status: String,
    statusId: { type: String, enum: orderStatuses.shippingStatuses.map(({ id }) => id) },
    location: String,
    time: Date
  }]
}, { timestamps: true });
module.exports = mongoose.model('Order', orderSchema);
