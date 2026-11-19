const mongoose = require('mongoose');
const { isValidImageUrl } = require('../utils/imageUrl');
const Order = require('./Order');

const quoteNoteLimit = 1000;
const quoteDecisions = ['pending', 'accepted', 'rejected', 'negotiating'];
const negotiationSchema = new mongoose.Schema({
  quoteVersion: Number,
  proposedPrice: { type: Number, validate: value => Number.isFinite(value) && value > 0 },
  note: { type: String, maxlength: quoteNoteLimit },
  requestedAt: Date,
  respondedAt: Date
}, { _id: false });
const quoteFields = {
  quotedPrice: { type: Number, validate: value => Number.isFinite(value) && value > 0 },
  quoteDate: String,
  quoteNote: { type: String, maxlength: quoteNoteLimit },
  quoteVersion: { type: Number, min: 1, validate: Number.isSafeInteger },
  quoteDecision: { type: String, enum: quoteDecisions },
  quoteSentAt: Date,
  quoteRespondedAt: Date,
  quoteNegotiation: negotiationSchema
};
const quoteHistorySchema = new mongoose.Schema({
  ...quoteFields,
  supersededAt: Date
}, { _id: false });

const customOrderSchema = new mongoose.Schema({
  ...Order.returnRequestFields(),
  returnReasonId: String,
  returnNote: String,
  returnStatusId: { type: String, enum: require('../data/order_statuses.json').requestStatuses.map(({ id }) => id) },
  returnRequestedAt: Date,
  returnDeadlineAt: Date,
  returnResolvedAt: Date,
  returnEvidence: { type: [Order.schema.path('returnEvidence').schema], default: [] },
  id: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  mapId: { type: String, trim: true },
  fullName: { type: String, trim: true },
  phone: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  requestName: { type: String, required: true, trim: true },
  size: { type: String, required: true, trim: true },
  beadType: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  imageNote: { type: String, default: '' },
  imageUrl: {
    type: String,
    default: '',
    validate: {
      validator: (value) => !value || isValidImageUrl(value),
      message: 'imageUrl phải là đường dẫn /images/... hoặc URL http/https hợp lệ.'
    }
  },
  ...quoteFields,
  quoteHistory: { type: [quoteHistorySchema], default: undefined },
  status: {
    type: String,
    enum: ['pending', 'quoted', 'processing', 'completed', 'cancelled'],
    default: 'pending'
  }
}, { timestamps: true });

customOrderSchema.pre('validate', function () {
  const hasCustomerRef = Boolean(this.userId);
  const hasCustomerInfo = Boolean(this.fullName && this.phone && this.email);
  if (!hasCustomerRef && !hasCustomerInfo) {
    this.invalidate('userId', 'Phải có userId hoặc đầy đủ fullName, phone, email.');
  }
});

Order.protectReturnWorkflow(customOrderSchema);
customOrderSchema.pre('save', function () {
  // Public Custom creation accepts a broad payload; request data must come from the workflow.
  if (this.isNew && (this.returnStatusId || this.requestType || this.returnCod?.confirmedAt || this.returnRefund?.refundedAt || this.returnHistory?.length)) {
    const error = new Error('Không được khởi tạo trạng thái hoàn trả qua API tạo Custom.');
    error.name = 'ValidationError';
    throw error;
  }
});
module.exports = mongoose.model('CustomOrder', customOrderSchema, 'custom_orders');
