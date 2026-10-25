const mongoose = require('mongoose');
const orderSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  userName: String,
  date: String,
  status: String,
  statusType: String,
  total: String,
  icon: String,
  items: [{ productId: String, name: String, price: Number, quantity: Number, image: String }],
  payment: { method: String, status: String },
  shipping: { carrier: String, method: String, trackingNumber: String, fee: Number, estimatedDelivery: Date },
  address: { name: String, phone: String, address: String },
  timeline: [{ status: String, time: Date }],
  shippingTimeline: [{ status: String, location: String, time: Date }]
}, { timestamps: true });
module.exports = mongoose.model('Order', orderSchema);