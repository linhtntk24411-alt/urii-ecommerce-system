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

// Shared embedded fields; no separate return collection or duplicate workflow.
function returnRequestFields() {
  return {
    requestType: { type: String, enum: ['return_only', 'refund_only', 'return_and_refund'] },
    returnRevision: { type: Number, default: 0 },
    returnApprovedBy: String,
    returnApprovedAt: Date,
    returnRejectionReason: String,
    returnReceivedAt: Date,
    returnPreviousStatus: { statusId: String, status: String, statusType: String },
    returnCod: { amount: { type: Number, min: 1, validate: Number.isSafeInteger }, confirmedAt: Date, confirmedBy: String },
    returnInspection: { result: { type: String, enum: ['passed', 'failed'] }, note: String, inspectedAt: Date, inspectedBy: String },
    returnRefund: { amount: { type: Number, min: 1, validate: Number.isSafeInteger }, method: String, reference: String, evidence: String, refundedAt: Date, confirmedBy: String },
    returnHistory: [{ action: String, fromStatus: String, toStatus: String, actorId: String, at: Date, note: String }]
  };
}

function protectReturnWorkflow(schema) {
  schema.pre(['findOneAndUpdate', 'updateOne', 'updateMany', 'replaceOne', 'findOneAndReplace', 'findOneAndDelete', 'deleteOne', 'deleteMany'], function () {
    if (this.getOptions().returnWorkflow === true) return;
    const update = this.getUpdate();
    const guarded = key => /^(return|requestType$)/.test(key.split('.')[0]);
    const containsProtected = value => value && typeof value === 'object' && Object.entries(value).some(([key, child]) =>
      guarded(key) || (key.startsWith('$') && containsProtected(child)) || (key === '$rename' && Object.values(child).some(guarded)));
    if (Array.isArray(update) || containsProtected(update) || /replace/i.test(this.op)) {
      const error = new Error('Các trường hoàn trả chỉ được cập nhật qua API xử lý yêu cầu.');
      error.status = 409;
      throw error;
    }
    const changesStatus = update && ['status', 'statusId', 'statusType', 'payment', 'total', 'totalAmount', 'items', 'shipping', 'voucher'].some(key =>
      Object.keys(update).some(k => k === key || k.startsWith(key + '.')) ||
      Object.keys(update.$set || {}).some(k => k === key || k.startsWith(key + '.')) ||
      Object.keys(update.$unset || {}).some(k => k === key || k.startsWith(key + '.')));
    if (/delete/i.test(this.op)) {
      this.setQuery({ $and: [this.getFilter(), { returnStatusId: { $exists: false } }] });
    } else if (changesStatus) {
      this.setQuery({ $and: [this.getFilter(), {
        returnStatusId: { $nin: ['pending_approval', 'approved', 'awaiting_return_pickup', 'inspecting', 'refund_pending', 'refunded'] },
        'returnCod.confirmedAt': { $exists: false }
      }] });
    }
  });
}

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
  ...returnRequestFields(),
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
protectReturnWorkflow(orderSchema);

module.exports = mongoose.model('Order', orderSchema);
module.exports.returnRequestFields = returnRequestFields;
module.exports.protectReturnWorkflow = protectReturnWorkflow;
