const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Booking = require('../../models/Booking');
const { authRequired, requireRole } = require('../../middleware/auth');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
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
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
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

      booking.ticketPDF = `/uploads/${req.file.filename}`;
      if (booking.currentStep < 8) booking.currentStep = 8;
      await booking.save({ validateBeforeSave: false });

      res.json({ message: 'Ticket PDF uploaded', booking });
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

      booking.billPDF = `/uploads/${req.file.filename}`;
      // Keep step < 9 so user UI can still show downloads.
      if (booking.currentStep < 9) booking.currentStep = 9;
      booking.paymentStatus = 'completed';
      await booking.save({ validateBeforeSave: false });

      res.json({ message: 'Bill PDF uploaded', booking });
    } catch (err) {
      console.error('bill upload error', err);
      res.status(400).json({ message: err.message || 'Bill upload failed' });
    }
  }
);

module.exports = router;

