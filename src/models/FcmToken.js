const mongoose = require('mongoose');

const fcmTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    token: { type: String, required: true, unique: true },
    platform: { type: String, default: 'web' },
    userAgent: { type: String, default: '' },
    lastSeenAt: { type: Date, default: Date.now },
    disabledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

fcmTokenSchema.index({ userId: 1, disabledAt: 1 });

module.exports = mongoose.model('FcmToken', fcmTokenSchema);
