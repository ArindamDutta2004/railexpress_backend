const express = require('express');
const Booking = require('../../models/Booking');
const { authRequired, requireRole } = require('../../middleware/auth');
const { generateUpiQrDataUri } = require('../../services/qrService');

const router = express.Router();

// GET /api/admin/booking/all
router.get(
  '/all',
  authRequired,
  requireRole('admin'),
  async (req, res) => {
    try {
      const bookings = await Booking.find().sort({ createdAt: -1 });
      res.json(bookings);
    } catch (err) {
      console.error('booking all error', err);
      res.status(500).json({ message: 'Failed to fetch bookings' });
    }
  }
);

// GET /api/admin/booking/:id  (admin booking detail page)
router.get(
  '/:id',
  authRequired,
  requireRole('admin'),
  async (req, res) => {
    try {
      const booking = await Booking.findById(req.params.id);
      if (!booking) return res.status(404).json({ message: 'Booking not found' });
      res.json(booking);
    } catch (err) {
      console.error('booking detail fetch error', err);
      res.status(500).json({ message: 'Failed to fetch booking' });
    }
  }
);

// Frontend admin actions:
// PUT /api/admin/booking/:id/approve
router.put(
  '/:id/approve',
  authRequired,
  requireRole('admin'),
  async (req, res) => {
    try {
      const updated = await Booking.findOneAndUpdate(
        { _id: req.params.id, currentStep: 3, statusPhase1: 'waiting' },
        {
          $set: {
            statusPhase1: 'approved',
            statusPhase2: 'advance pending',
            paymentStatus: 'advance pending',
            currentStep: 4,
            paymentDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        },
        { new: true }
      );

      if (!updated) return res.status(409).json({ message: 'Step mismatch or booking not found' });

      res.json(updated);
    } catch (err) {
      console.error('approve error', err);
      res.status(500).json({ message: 'Approve booking failed' });
    }
  }
);

// PUT /api/admin/booking/:id/cancel
router.put(
  '/:id/cancel',
  authRequired,
  requireRole('admin'),
  async (req, res) => {
    try {
      const updated = await Booking.findOneAndUpdate(
        { _id: req.params.id, currentStep: 3, statusPhase1: 'waiting' },
        {
          $set: {
            statusPhase1: 'cancelled',
            statusPhase2: 'not booked',
            paymentStatus: 'cancelled',
            currentStep: 10,
          },
        },
        { new: true }
      );

      if (!updated) return res.status(409).json({ message: 'Step mismatch or booking not found' });

      res.json(updated);
    } catch (err) {
      console.error('cancel error', err);
      res.status(500).json({ message: 'Cancel booking failed' });
    }
  }
);

// PUT /api/admin/booking/:id/advance
// Body: { advanceAmount, remainingAmount?, qrOwner? }
router.put(
  '/:id/advance',
  authRequired,
  requireRole('admin'),
  async (req, res) => {
    try {
      const { advanceAmount, remainingAmount, qrOwner } = req.body;
      const advance = Number(advanceAmount);
      const remaining = remainingAmount === undefined ? undefined : Number(remainingAmount);
      const owner = qrOwner ? String(qrOwner).toLowerCase() : null;
      const allowedOwners = new Set(['suman', 'debjit', 'arindam']);

      if (!Number.isFinite(advance) || advance <= 0) {
        return res.status(400).json({ message: 'advanceAmount must be a positive number' });
      }
      if (remaining !== undefined && (!Number.isFinite(remaining) || remaining < 0)) {
        return res.status(400).json({ message: 'remainingAmount must be a non-negative number' });
      }
      if (owner && !allowedOwners.has(owner)) {
        return res.status(400).json({ message: 'qrOwner must be one of: suman, debjit, arindam' });
      }

      if (!owner) {
        return res.status(400).json({ message: 'Please select QR owner: suman, arindam, or debjit' });
      }

      // Generate QR codes at the moment admin sets amounts (payment is now needed).
      const [advanceQR, finalQR] = await Promise.all([
        generateUpiQrDataUri({
          bookingId: req.params.id,
          amount: advance,
          title: 'Advance Payment',
        }),
        remaining !== undefined && remaining > 0
          ? generateUpiQrDataUri({
              bookingId: req.params.id,
              amount: remaining,
              title: 'Final Payment',
            })
          : Promise.resolve(null),
      ]);

      const updated = await Booking.findOneAndUpdate(
        {
          _id: req.params.id,
          currentStep: 4,
        },
        {
          $set: {
            advanceAmount: advance,
            remainingAmount: remaining ?? 0,
            totalAmount: advance + (remaining ?? 0),
            paymentStatus: 'advance pending',
            statusPhase2: 'advance pending',
            currentStep: 5,
            paymentDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
            advanceQR,
            finalQR,
            advanceQROwner: owner,
            finalQROwner: owner,
            advanceUserMarkedPaid: false,
            finalUserMarkedPaid: false,
          },
        },
        { new: true }
      );

      if (!updated) return res.status(409).json({ message: 'Step mismatch or booking not found' });

      res.json(updated);
    } catch (err) {
      console.error('advance error', err);
      res.status(500).json({ message: 'Set advance failed' });
    }
  }
);

// PUT /api/admin/booking/:id/qr-owner
// Allow correcting owner during payment steps if older data has no owner.
router.put(
  '/:id/qr-owner',
  authRequired,
  requireRole('admin'),
  async (req, res) => {
    try {
      const owner = String(req.body?.qrOwner || '').toLowerCase();
      if (!['suman', 'arindam', 'debjit'].includes(owner)) {
        return res.status(400).json({ message: 'qrOwner must be one of: suman, arindam, debjit' });
      }

      const booking = await Booking.findById(req.params.id);
      if (!booking) return res.status(404).json({ message: 'Booking not found' });
      if (![5, 7].includes(booking.currentStep)) {
        return res.status(400).json({ message: 'QR owner update allowed only at payment steps' });
      }

      if (booking.currentStep === 5) {
        booking.advanceQROwner = owner;
      } else {
        booking.finalQROwner = owner;
      }
      await booking.save({ validateBeforeSave: false });
      res.json(booking);
    } catch (err) {
      console.error('qr-owner update error', err);
      res.status(500).json({ message: 'Failed to update QR owner' });
    }
  }
);

// PUT /api/admin/booking/:id/confirm-advance-payment
router.put(
  '/:id/confirm-advance-payment',
  authRequired,
  requireRole('admin'),
  async (req, res) => {
    try {
      const updated = await Booking.findOneAndUpdate(
        {
          _id: req.params.id,
          currentStep: 5,
          advanceUserMarkedPaid: true,
        },
        {
          $set: {
            paymentStatus: 'advance paid',
            statusPhase2: 'booking pending',
            currentStep: 6,
          },
        },
        { new: true }
      );

      if (!updated) {
        return res
          .status(409)
          .json({ message: 'User has not marked advance payment done or step mismatch' });
      }

      res.json(updated);
    } catch (err) {
      console.error('confirm advance payment error', err);
      res.status(500).json({ message: 'Failed to confirm advance payment' });
    }
  }
);

// PUT /api/admin/booking/:id/booking-done
router.put(
  '/:id/booking-done',
  authRequired,
  requireRole('admin'),
  async (req, res) => {
    try {
      // Ensure finalQROwner exists before final payment step becomes active.
      // Avoid update-pipeline here for maximum compatibility.
      const current = await Booking.findOne({ _id: req.params.id, currentStep: 6 });
      if (!current) return res.status(409).json({ message: 'Step mismatch or booking not found' });

      const finalOwner = current.finalQROwner || current.advanceQROwner || null;

      const updated = await Booking.findOneAndUpdate(
        { _id: req.params.id, currentStep: 6 },
        {
          $set: {
            statusPhase2: 'booking done',
            currentStep: 7,
            paymentStatus: 'advance paid',
            ...(finalOwner ? { finalQROwner: finalOwner } : {}),
          },
        },
        { new: true }
      );

      if (!updated) return res.status(409).json({ message: 'Step mismatch or booking not found' });

      res.json(updated);
    } catch (err) {
      console.error('booking-done error', err);
      res.status(500).json({ message: 'Mark booking done failed' });
    }
  }
);

// PUT /api/admin/booking/:id/confirm-final-payment
router.put(
  '/:id/confirm-final-payment',
  authRequired,
  requireRole('admin'),
  async (req, res) => {
    try {
      const updated = await Booking.findOneAndUpdate(
        {
          _id: req.params.id,
          currentStep: 7,
          finalUserMarkedPaid: true,
          statusPhase2: 'booking done',
        },
        {
          $set: {
            paymentStatus: 'completed',
            currentStep: 8,
          },
        },
        { new: true }
      );

      if (!updated) {
        return res
          .status(409)
          .json({ message: 'User has not marked final payment done or step mismatch' });
      }

      res.json(updated);
    } catch (err) {
      console.error('confirm final payment error', err);
      res.status(500).json({ message: 'Failed to confirm final payment' });
    }
  }
);

// PUT /api/admin/booking/:id/booking-not-done
router.put(
  '/:id/booking-not-done',
  authRequired,
  requireRole('admin'),
  async (req, res) => {
    try {
      const updated = await Booking.findOneAndUpdate(
        { _id: req.params.id, currentStep: 6 },
        {
          $set: {
            statusPhase2: 'not booked',
            paymentStatus: 'cancelled',
            currentStep: 10,
          },
        },
        { new: true }
      );

      if (!updated) return res.status(409).json({ message: 'Step mismatch or booking not found' });

      res.json(updated);
    } catch (err) {
      console.error('booking-not-done error', err);
      res.status(500).json({ message: 'Mark booking not done failed' });
    }
  }
);

// PUT /api/admin/booking/update/:id
// Uses step-lock: expects fromStep in body, no backward steps
router.put(
  '/update/:id',
  authRequired,
  requireRole('admin'),
  async (req, res) => {
    try {
      const { fromStep, nextStep, statusPhase1, statusPhase2, paymentStatus } = req.body;
      if (typeof fromStep !== 'number' || typeof nextStep !== 'number') {
        return res.status(400).json({ message: 'fromStep and nextStep (numbers) are required' });
      }
      if (nextStep <= fromStep) {
        return res.status(400).json({ message: 'Cannot move backwards or stay on same step' });
      }

      const filter = {
        _id: req.params.id,
        currentStep: fromStep,
      };

      const previous = await Booking.findOne(filter);
      if (!previous) {
        return res.status(409).json({ message: 'Step mismatch or booking not found' });
      }

      const update = {
        currentStep: nextStep,
      };
      if (statusPhase1) update.statusPhase1 = statusPhase1;
      if (statusPhase2) update.statusPhase2 = statusPhase2;
      if (paymentStatus) update.paymentStatus = paymentStatus;

      const updated = await Booking.findOneAndUpdate(filter, update, {
        new: true,
      });
      if (!updated) {
        return res.status(409).json({ message: 'Concurrent update detected, please retry' });
      }

      res.json(updated);
    } catch (err) {
      console.error('booking update error', err);
      res.status(500).json({ message: 'Booking update failed' });
    }
  }
);

// PUT /api/admin/booking/payment-update/:id
router.put(
  '/payment-update/:id',
  authRequired,
  requireRole('admin'),
  async (req, res) => {
    try {
      const { fromStep, nextStep, advanceAmount, remainingAmount, confirmPayment } = req.body;
      if (typeof fromStep !== 'number' || typeof nextStep !== 'number') {
        return res.status(400).json({ message: 'fromStep and nextStep (numbers) are required' });
      }
      if (nextStep <= fromStep) {
        return res.status(400).json({ message: 'Cannot move backwards or stay on same step' });
      }

      const filter = {
        _id: req.params.id,
        currentStep: fromStep,
        paymentStatus: { $ne: 'advance paid' }, // prevent double payment
      };

      const previous = await Booking.findOne(filter);
      if (!previous) {
        return res.status(409).json({ message: 'Payment already confirmed or step mismatch' });
      }

      const update = {
        currentStep: nextStep,
        advanceAmount:
          typeof advanceAmount === 'number' ? advanceAmount : previous.advanceAmount,
        remainingAmount:
          typeof remainingAmount === 'number' ? remainingAmount : previous.remainingAmount,
      };

      if (confirmPayment) {
        update.paymentStatus = 'advance paid';
        update.statusPhase2 = 'booking pending';
      }

      const updated = await Booking.findOneAndUpdate(filter, update, { new: true });
      if (!updated) {
        return res.status(409).json({ message: 'Concurrent payment update, please retry' });
      }

      res.json(updated);
    } catch (err) {
      console.error('payment update error', err);
      res.status(500).json({ message: 'Payment update failed' });
    }
  }
);

module.exports = router;

