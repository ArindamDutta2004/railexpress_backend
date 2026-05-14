const express = require('express');
const Booking = require('../../models/Booking');
const Feedback = require('../../models/Feedback');
const { authRequired, requireRole } = require('../../middleware/auth');
const stations = require('../../data/stations.json');
const multer = require('multer');
const path = require('path');

const { ensureUploadsDir } = require('../../config/uploadPaths');
const { streamBookingPdf } = require('../../services/pdfService');

const router = express.Router();

// Helper: basic validations
function normalizePreferredTrains(raw) {
  if (raw === undefined || raw === null) return [];

  const asArray = Array.isArray(raw)
    ? raw
    : String(raw)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

  const normalized = asArray
    .map((item) => String(item || '').trim())
    .filter(Boolean);

  if (normalized.length > 6) {
    throw new Error('You can add at most 6 preferred trains');
  }

  for (const entry of normalized) {
    if (entry.length > 120) {
      throw new Error('Each preferred train entry must be 120 characters or less');
    }
  }

  return normalized;
}

function isSameDay(d1, d2) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

const refundStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, ensureUploadsDir());
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
    cb(null, `refund-qr-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
  },
});

const refundFileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mimetype = String(file.mimetype || '').toLowerCase();
  const ok =
    mimetype.startsWith('image/') ||
    ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);
  cb(ok ? null : new Error('Only image files are allowed (png/jpg/webp)'), ok);
};

const uploadRefund = multer({
  storage: refundStorage,
  fileFilter: refundFileFilter,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB
});

const multerSingle = (field) => (req, res, next) => {
  const handler = uploadRefund.single(field);
  handler(req, res, (err) => {
    if (!err) return next();
    const msg = err.message || 'Upload failed';
    return res.status(400).json({ message: msg });
  });
};

// GET /api/user/booking/stations
router.get('/stations', async (req, res) => {
  res.json({ count: stations.length, stations });
});

// POST /api/user/booking/create
router.post(
  '/create',
  authRequired,
  requireRole('user'),
  async (req, res) => {
    try {
      const {
        fromStation,
        toStation,
        journeyDate,
        passengerName,
        age,
        phone,
        dateOfBirth,
        bookingType,
        passengers,
        passengerDetails,
        preferredTrains,
      } = req.body;

      if (!fromStation) return res.status(400).json({ message: 'fromStation is required' });
      if (!toStation) return res.status(400).json({ message: 'toStation is required' });
      if (!journeyDate) return res.status(400).json({ message: 'journeyDate is required' });
      if (!phone) return res.status(400).json({ message: 'phone is required' });
      if (!bookingType) return res.status(400).json({ message: 'bookingType is required' });

      const passengerCount = passengers ? Number(passengers) : 1;
      if (!Number.isFinite(passengerCount) || passengerCount < 1 || passengerCount > 6) {
        return res.status(400).json({ message: 'passengers must be between 1 and 6' });
      }

      const calcAgeFromDob = (dobStr) => {
        const dob = new Date(dobStr);
        if (Number.isNaN(dob.getTime())) return null;
        const now = new Date();
        let years = now.getFullYear() - dob.getFullYear();
        const m = now.getMonth() - dob.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) years--;
        return years;
      };

      // Preferred: accept array passengerDetails (future-proof), otherwise accept single passenger fields (current UI).
      const normalizedDetails = Array.isArray(passengerDetails) ? passengerDetails : null;
      let firstPassenger = null;

      if (normalizedDetails && normalizedDetails.length) {
        if (normalizedDetails.length !== passengerCount) {
          return res.status(400).json({ message: `passengerDetails length must be ${passengerCount}` });
        }
        const bad = normalizedDetails.find((p) => !p?.name || !p?.dateOfBirth);
        if (bad) {
          return res
            .status(400)
            .json({ message: 'Each passenger must include name and dateOfBirth' });
        }

        // Ensure each passenger has valid age; compute if missing.
        const fixed = normalizedDetails.map((p) => {
          let a = Number(p.age);
          if (!Number.isFinite(a) || a <= 0) {
            const computed = calcAgeFromDob(String(p.dateOfBirth));
            a = computed ?? a;
          }
          return { ...p, age: a };
        });
        const invalidAge = fixed.find((p) => !Number.isFinite(Number(p.age)) || Number(p.age) < 1);
        if (invalidAge) {
          return res.status(400).json({ message: 'Each passenger age must be at least 1' });
        }
        firstPassenger = fixed[0];
      } else {
        if (!passengerName) return res.status(400).json({ message: 'passengerName is required' });
        if (!dateOfBirth) return res.status(400).json({ message: 'dateOfBirth is required' });
        let ageNum = Number(age);
        if (!Number.isFinite(ageNum) || ageNum <= 0) {
          const computed = calcAgeFromDob(String(dateOfBirth));
          if (computed === null) {
            return res
              .status(400)
              .json({ message: 'age is invalid and could not be computed from dateOfBirth' });
          }
          ageNum = computed;
        }
        if (!Number.isFinite(ageNum) || ageNum < 1) {
          return res.status(400).json({ message: 'Age must be at least 1' });
        }
        firstPassenger = { name: passengerName, dateOfBirth, age: ageNum };
      }

      if (fromStation === toStation) {
        return res.status(400).json({ message: 'fromStation and toStation cannot be same' });
      }

      const jDate = new Date(journeyDate);
      if (Number.isNaN(jDate.getTime())) {
        return res.status(400).json({ message: 'Invalid journey date' });
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (jDate < today) {
        return res.status(400).json({ message: 'Journey date cannot be in the past' });
      }

      if (!['tatkal', 'reservation', 'vip'].includes(String(bookingType).toLowerCase())) {
        return res.status(400).json({ message: 'bookingType must be tatkal, reservation, or vip' });
      }

      const normalizedBookingType = String(bookingType).toLowerCase();
      if (normalizedBookingType === 'tatkal') {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const isToday = isSameDay(jDate, today);
        const isTomorrow = isSameDay(jDate, tomorrow);
        if (!isToday && !isTomorrow) {
          return res
            .status(400)
            .json({ message: 'Tatkal booking allowed only for today or tomorrow' });
        }
      }

      if (!/^\d{10}$/.test(String(phone))) {
        return res.status(400).json({ message: 'Phone must be 10 digits' });
      }

      let normalizedPreferredTrains = [];
      try {
        normalizedPreferredTrains = normalizePreferredTrains(preferredTrains);
      } catch (prefErr) {
        return res.status(400).json({ message: prefErr.message || 'Invalid preferred trains format' });
      }

      // Prevent duplicates (same from/to/date) for this user
      const existingSameDay = await Booking.find({
        userId: req.user.id,
        journeyDate: {
          $gte: new Date(jDate.getFullYear(), jDate.getMonth(), jDate.getDate()),
          $lt: new Date(jDate.getFullYear(), jDate.getMonth(), jDate.getDate() + 1),
        },
      });
      const duplicate = existingSameDay.find(
        (b) => b.fromStation === fromStation && b.toStation === toStation
      );
      if (duplicate) {
        return res.status(400).json({ message: 'Duplicate booking for same route and date' });
      }

      const paymentDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h timeout

      const booking = await Booking.create({
        userId: req.user.id,
        fromStation,
        toStation,
        journeyDate: jDate,
        passengerName: firstPassenger.name,
        dateOfBirth: firstPassenger.dateOfBirth,
        bookingType: normalizedBookingType,
        age: Number(firstPassenger.age),
        phone: String(phone),
        passengers: passengerCount,
        passengerDetails: Array.isArray(passengerDetails) ? passengerDetails : undefined,
        preferredTrains: normalizedPreferredTrains,

        customerName: req.user.name,
        email: req.user.email,

        statusPhase1: 'waiting',
        statusPhase2: 'advance pending',
        paymentStatus: 'pending',
        currentStep: 3, // frontend expects admin approval actions at step 3
        paymentDeadline,
      });

      res.status(201).json(booking);
    } catch (err) {
      console.error('booking create error', err);
      res.status(500).json({ message: 'Booking creation failed' });
    }
  }
);

// GET /api/user/booking/user/:id   (id = userId) - user can only see their own
router.get(
  '/user/:id',
  authRequired,
  requireRole('user'),
  async (req, res) => {
    try {
      if (req.user.id !== req.params.id) {
        return res.status(403).json({ message: 'Cannot view other user bookings' });
      }
      const bookings = await Booking.find({ userId: req.user.id }).sort({ createdAt: -1 });
      const bookingIds = bookings.map((b) => b._id);
      const feedbackRows = await Feedback.find({ bookingId: { $in: bookingIds } }).select('bookingId');
      const feedbackSet = new Set(feedbackRows.map((f) => String(f.bookingId)));
      const response = bookings.map((b) => {
        const doc = b.toJSON();
        doc.feedbackSubmitted = feedbackSet.has(String(b._id));
        return doc;
      });
      res.json(response);
    } catch (err) {
      console.error('booking user list error', err);
      res.status(500).json({ message: 'Failed to fetch user bookings' });
    }
  }
);

// GET /api/user/booking/:id/download/:type
// Secure download path: user must own booking and submit feedback first.
router.get(
  '/:id/download/:type',
  authRequired,
  requireRole('user'),
  async (req, res) => {
    try {
      const type = String(req.params.type || '').toLowerCase();
      if (!['ticket', 'bill'].includes(type)) {
        return res.status(400).json({ message: 'type must be ticket or bill' });
      }

      const booking = await Booking.findById(req.params.id);
      if (!booking) return res.status(404).json({ message: 'Booking not found' });
      if (String(booking.userId) !== req.user.id) {
        return res.status(403).json({ message: 'Cannot download documents for other user booking' });
      }

      const feedback = await Feedback.findOne({ bookingId: booking._id }).select('_id');
      if (!feedback) {
        return res.status(403).json({
          message: 'Please submit feedback before downloading ticket/bill PDF',
        });
      }

      const documentAvailable = type === 'ticket' ? booking.ticketPDF : booking.billPDF;
      if (!documentAvailable) {
        return res.status(404).json({ message: `${type} PDF not available yet` });
      }

      console.log(`[pdf] streaming ${type} for booking ${booking._id} to user ${req.user.id}`);
      return streamBookingPdf({ booking, type, res });
    } catch (err) {
      console.error('secure download error', err);
      if (!res.headersSent) {
        return res.status(500).json({ message: 'Failed to download document' });
      }
      return res.destroy(err);
    }
  }
);

// PUT /api/user/booking/:id/payment-done
// User marks payment as done; admin must verify and move next step.
router.put(
  '/:id/payment-done',
  authRequired,
  requireRole('user'),
  async (req, res) => {
    try {
      const { type } = req.body;
      if (!['advance', 'final'].includes(type)) {
        return res.status(400).json({ message: 'type must be advance or final' });
      }

      const booking = await Booking.findById(req.params.id);
      if (!booking) return res.status(404).json({ message: 'Booking not found' });
      if (booking.userId.toString() !== req.user.id) {
        return res.status(403).json({ message: 'Cannot update other user booking payment' });
      }

      if (type === 'advance') {
        if (booking.advanceUserMarkedPaid) {
          return res.status(400).json({ message: 'Advance payment already marked done' });
        }
        if (booking.currentStep !== 5) {
          return res.status(400).json({ message: 'Advance payment step is not active' });
        }
        booking.advanceUserMarkedPaid = true;
      } else {
        if (booking.finalUserMarkedPaid) {
          return res.status(400).json({ message: 'Final payment already marked done' });
        }
        if (booking.currentStep !== 7) {
          return res.status(400).json({ message: 'Final payment step is not active' });
        }
        booking.finalUserMarkedPaid = true;
      }

      await booking.save({ validateBeforeSave: false });
      res.json(booking);
    } catch (err) {
      console.error('payment-done error', err);
      res.status(500).json({ message: 'Failed to mark payment as done' });
    }
  }
);

// POST /api/user/booking/:id/refund-qr
// If booking is cancelled, user uploads refund/payment QR proof (image).
router.post(
  '/:id/refund-qr',
  authRequired,
  requireRole('user'),
  multerSingle('refundQR'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'refundQR file is required' });

      const booking = await Booking.findById(req.params.id);
      if (!booking) return res.status(404).json({ message: 'Booking not found' });
      if (booking.userId.toString() !== req.user.id) {
        return res.status(403).json({ message: 'Cannot upload for other user booking' });
      }

      if (booking.statusPhase1 !== 'cancelled' && booking.paymentStatus !== 'cancelled') {
        return res.status(400).json({ message: 'Refund QR can be uploaded only for cancelled bookings' });
      }

      booking.refundQRProof = `/uploads/${req.file.filename}`;
      booking.refundVerificationStatus = 'pending';
      booking.refundVerifiedAt = null;
      booking.refundVerifiedBy = null;
      booking.refundProofScreenshot = null;
      booking.refundProcessedAt = null;
      await booking.save({ validateBeforeSave: false });
      res.json({ message: 'Refund QR uploaded successfully', booking });
    } catch (err) {
      console.error('refund-qr upload error', err);
      res.status(500).json({ message: 'Failed to upload refund QR' });
    }
  }
);

module.exports = router;
