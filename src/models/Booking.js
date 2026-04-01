const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: function() { return !this.isAdminCreated; } },

    // Journey
    fromStation: { type: String, required: true },
    toStation: { type: String, required: true },
    journeyDate: { type: Date, required: true },

    // Frontend stores exactly one passenger worth of details in forms,
    // and may optionally store full passenger list for multi-person bookings.
    passengerName: { type: String, required: true },
    dateOfBirth: { type: String, required: true },
    bookingType: {
      type: String,
      enum: ['tatkal', 'reservation'],
      required: true,
      default: 'reservation',
    },
    age: { type: Number, required: true },
    phone: {
      type: String,
      required: true,
      validate: {
        validator: (v) => /^\d{10}$/.test(v),
        message: 'Phone must be 10 digits',
      },
    },
    passengers: { type: Number, default: 1 }, // for admin UI "X passenger(s)"
    passengerDetails: {
      type: [
        {
          name: { type: String, required: true },
          dateOfBirth: { type: String, required: true },
          age: { type: Number, required: true },
        },
      ],
      default: [],
    },

    // For admin-created bookings, userId is null, and we store customer info directly
    isAdminCreated: { type: Boolean, default: false },

    // Customer info (customerName/email) used by admin dashboard
    customerName: { type: String, required: true },
    email: { type: String, required: true, lowercase: true },

    // Status flow
    statusPhase1: {
      type: String,
      enum: ['waiting', 'approved', 'cancelled'],
      default: 'waiting',
    },
    statusPhase2: {
      type: String,
      enum: [
        'advance pending',
        'advance paid',
        'booking pending',
        'booking done',
        'not booked',
      ],
      default: 'advance pending',
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'advance pending', 'advance paid', 'completed', 'cancelled'],
      default: 'pending',
    },

    advanceAmount: { type: Number, default: 0 },
    remainingAmount: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    advanceUserMarkedPaid: { type: Boolean, default: false },
    finalUserMarkedPaid: { type: Boolean, default: false },

    // Frontend expects QR codes but may be empty until later.
    advanceQR: { type: String, default: null },
    finalQR: { type: String, default: null },
    advanceQROwner: { type: String, enum: ['suman', 'debjit', 'arindam', null], default: null },
    finalQROwner: { type: String, enum: ['suman', 'debjit', 'arindam', null], default: null },

    ticketPDF: { type: String, default: null }, // user/admin BookingCard downloads
    billPDF: { type: String, default: null },

    // If booking is cancelled, user can upload refund/payment QR proof (image).
    refundQRProof: { type: String, default: null },

    currentStep: { type: Number, min: 1, max: 10, default: 3 },

    paymentDeadline: { type: Date, default: null },

    // Simple idempotency for EmailJS notifications per booking.
    emailEventsSent: {
      type: Map,
      of: { type: Date },
      default: {},
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        ret.id = ret._id?.toString?.() || ret.id;
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

// Admin UI aliases
bookingSchema.virtual('from').get(function () {
  return this.fromStation;
});

bookingSchema.virtual('to').get(function () {
  return this.toStation;
});

bookingSchema.virtual('date').get(function () {
  // Stable "YYYY-MM-DD" matching admin filter input.
  if (!this.journeyDate) return null;
  return this.journeyDate.toISOString().split('T')[0];
});

bookingSchema.virtual('ticketUrl').get(function () {
  return this.ticketPDF;
});

bookingSchema.virtual('billUrl').get(function () {
  return this.billPDF;
});

bookingSchema.index({ userId: 1, journeyDate: 1 });

module.exports = mongoose.model('Booking', bookingSchema);

