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

const waitingInfoSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: [
      'awaiting_payment',
      'awaiting_confirmation',
      'awaiting_pickup',
      'awaiting_delivery',
      'awaiting_cancel_approval',
      'awaiting_return_approval',
      'awaiting_return_pickup',
      'awaiting_refund'
    ]
  },
  startedAt: Date,
  deadlineAt: Date,
  slaHours: Number,
  expectedHours: Number,
  actor: { type: String, enum: ['customer', 'admin', 'carrier'] },
  note: String
}, { _id: false });

const orderTypeEnum = (orderStatuses.orderTypes || []).map(({ id }) => id);
const requestStatusEnum = (orderStatuses.requestStatuses || []).map(({ id }) => id);

const orderSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  orderType: { type: String, enum: orderTypeEnum, default: 'normal' },
  customOrderId: { type: String, trim: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  userName: String,
  date: String,
  status: String,
  statusId: { type: String, enum: orderStatuses.orderStatuses.map(({ id }) => id) },
  statusType: String,
  note: String,
  waitingInfo: { type: waitingInfoSchema, default: undefined },
  cancellationReasonId: String,
  cancellationNote: String,
  cancellationStatusId: { type: String, enum: requestStatusEnum },
  cancellationRequestedAt: Date,
  cancellationDeadlineAt: Date,
  cancellationResolvedAt: Date,
  returnReasonId: String,
  returnNote: String,
  returnStatusId: { type: String, enum: requestStatusEnum },
  returnRequestedAt: Date,
  returnDeadlineAt: Date,
  returnResolvedAt: Date,
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
    time: Date,
    note: String
  }],
  shippingTimeline: [{
    status: String,
    statusId: { type: String, enum: orderStatuses.shippingStatuses.map(({ id }) => id) },
    location: String,
    time: Date
  }]
}, { timestamps: true });

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ userId: 1, statusId: 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
