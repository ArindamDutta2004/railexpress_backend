const express = require('express');
const path = require('path');
const multer = require('multer');
const Booking = require('../../models/Booking');
const { authRequired, requireRole } = require('../../middleware/auth');
const { UPLOADS_DIR, ensureUploadsDir } = require('../../config/uploadPaths');

const router = express.Router();

ensureUploadsDir();
const uploadDir = UPLOADS_DIR;

const pdfMemoryStorage = multer.memoryStorage();

const imageStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || '.pdf';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  const name = String(file.originalname || '').toLowerCase();
  const mime = String(file.mimetype || '').toLowerCase();
  const looksLikePdf = mime.includes('pdf') || name.endsWith('.pdf');
  if (!looksLikePdf) return cb(new Error('Only PDF files are allowed'));
  cb(null, true);
}

const upload = multer({
  storage: pdfMemoryStorage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
});

function imageFileFilter(req, file, cb) {
  const name = String(file.originalname || '').toLowerCase();
  const mime = String(file.mimetype || '').toLowerCase();
  const looksLikeImage = mime.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(name);
  if (!looksLikeImage) return cb(new Error('Only image files are allowed (png/jpg/webp)'));
  cb(null, true);
}

const imageUpload = multer({
  storage: imageStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB
});

async function ensureBookingDone(bookingId) {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw new Error('Booking not found');
  }
  if (booking.statusPhase2 !== 'booking done') {
    throw new Error('File upload allowed only when booking is done');
  }
  if (booking.currentStep < 8 || booking.paymentStatus !== 'completed') {
    throw new Error(
      `Final payment must be verified before PDF upload (step=${booking.currentStep}, paymentStatus=${booking.paymentStatus})`
    );
  }
  return booking;
}

function multerSingle(field) {
  const single = upload.single(field);
  return (req, res, next) => {
    single(req, res, (err) => {
      if (err) {
        const msg = err?.message || 'Upload failed';
        return res.status(400).json({ message: msg });
      }
      next();
    });
  };
}

function multerImageSingle(field) {
  const single = imageUpload.single(field);
  return (req, res, next) => {
    single(req, res, (err) => {
      if (err) {
        const msg = err?.message || 'Upload failed';
        return res.status(400).json({ message: msg });
      }
      next();
    });
  };
}

// POST /api/admin/upload/ticket
router.post(
  '/ticket',
  authRequired,
  requireRole('admin'),
  multerSingle('ticket'),
  async (req, res) => {
    try {
      const { bookingId } = req.body;
      if (!bookingId) {
        return res.status(400).json({ message: 'bookingId is required' });
      }
      if (!req.file) {
        return res.status(400).json({ message: 'PDF file is required' });
      }

      const booking = await ensureBookingDone(bookingId);

      booking.ticketPDF = `generated:${booking._id}:ticket`;
      if (booking.currentStep < 8) booking.currentStep = 8;
      await booking.save({ validateBeforeSave: false });

      console.log(`[pdf] ticket marked for generated streaming: booking ${booking._id}`);
      res.json({ message: 'Ticket PDF marked available for generated download', booking });
    } catch (err) {
      console.error('ticket upload error', err);
      res.status(400).json({ message: err.message || 'Ticket upload failed' });
    }
  }
);

// POST /api/admin/upload/bill
router.post(
  '/bill',
  authRequired,
  requireRole('admin'),
  multerSingle('bill'),
  async (req, res) => {
    try {
      const { bookingId } = req.body;
      if (!bookingId) {
        return res.status(400).json({ message: 'bookingId is required' });
      }
      if (!req.file) {
        return res.status(400).json({ message: 'PDF file is required' });
      }

      const booking = await ensureBookingDone(bookingId);

      booking.billPDF = `generated:${booking._id}:bill`;
      // Keep step < 9 so user UI can still show downloads.
      if (booking.currentStep < 9) booking.currentStep = 9;
      booking.paymentStatus = 'completed';
      await booking.save({ validateBeforeSave: false });

      console.log(`[pdf] bill marked for generated streaming: booking ${booking._id}`);
      res.json({ message: 'Bill PDF marked available for generated download', booking });
    } catch (err) {
      console.error('bill upload error', err);
      res.status(400).json({ message: err.message || 'Bill upload failed' });
    }
  }
);

// POST /api/admin/upload/refund-proof
router.post(
  '/refund-proof',
  authRequired,
  requireRole('admin'),
  multerImageSingle('refundProof'),
  async (req, res) => {
    try {
      const { bookingId } = req.body;
      if (!bookingId) {
        return res.status(400).json({ message: 'bookingId is required' });
      }
      if (!req.file) {
        return res.status(400).json({ message: 'Refund proof image is required' });
      }

      const booking = await Booking.findById(bookingId);
      if (!booking) return res.status(404).json({ message: 'Booking not found' });

      const isCancelled = booking.statusPhase1 === 'cancelled' || booking.paymentStatus === 'cancelled';
      if (!isCancelled) {
        return res.status(400).json({ message: 'Refund proof upload allowed only for cancelled bookings' });
      }

      booking.refundProofScreenshot = `/uploads/${req.file.filename}`;
      booking.refundVerificationStatus = 'processed';
      booking.refundProcessedAt = new Date();
      if (!booking.refundVerifiedAt) booking.refundVerifiedAt = new Date();
      await booking.save({ validateBeforeSave: false });

      return res.json({ message: 'Refund proof uploaded and marked as processed', booking });
    } catch (err) {
      console.error('refund proof upload error', err);
      return res.status(400).json({ message: err.message || 'Refund proof upload failed' });
    }
  }
);

// POST /api/admin/upload/refund-proof/:bookingId
// Compatibility alias for clients that pass bookingId in URL.
router.post(
  '/refund-proof/:bookingId',
  authRequired,
  requireRole('admin'),
  multerImageSingle('refundProof'),
  async (req, res) => {
    try {
      const bookingId = req.params.bookingId || req.body?.bookingId;
      if (!bookingId) {
        return res.status(400).json({ message: 'bookingId is required' });
      }
      if (!req.file) {
        return res.status(400).json({ message: 'Refund proof image is required' });
      }

      const booking = await Booking.findById(bookingId);
      if (!booking) return res.status(404).json({ message: 'Booking not found' });

      const isCancelled = booking.statusPhase1 === 'cancelled' || booking.paymentStatus === 'cancelled';
      if (!isCancelled) {
        return res.status(400).json({ message: 'Refund proof upload allowed only for cancelled bookings' });
      }
      if (!booking.refundQRProof) {
        return res.status(400).json({ message: 'User refund QR/proof not uploaded yet' });
      }

      booking.refundProofScreenshot = `/uploads/${req.file.filename}`;
      booking.refundVerificationStatus = 'processed';
      booking.refundProcessedAt = new Date();
      if (!booking.refundVerifiedAt) booking.refundVerifiedAt = new Date();
      await booking.save({ validateBeforeSave: false });

      return res.json({ message: 'Refund proof uploaded and marked as processed', booking });
    } catch (err) {
      console.error('refund proof alias upload error', err);
      return res.status(400).json({ message: err.message || 'Refund proof upload failed' });
    }
  }
);

module.exports = router;
