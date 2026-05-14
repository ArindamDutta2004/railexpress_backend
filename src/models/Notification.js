const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null, index: true },
    eventType: { type: String, required: true, index: true },
    eventKey: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    url: { type: String, default: '/dashboard' },
    data: { type: Map, of: String, default: {} },
    readAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    delivery: {
      successCount: { type: Number, default: 0 },
      failureCount: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, bookingId: 1, eventKey: 1 }, { unique: true });

module.exports = mongoose.model('Notification', notificationSchema);
