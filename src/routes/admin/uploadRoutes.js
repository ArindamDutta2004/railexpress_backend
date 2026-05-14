const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const Booking = require('../../models/Booking');
const { authRequired, requireRole } = require('../../middleware/auth');
const { UPLOADS_DIR, ensureUploadsDir } = require('../../config/uploadPaths');
const { deleteUploadFileIfExists } = require('../../utils/documentFile');

const router = express.Router();

ensureUploadsDir();
const uploadDir = UPLOADS_DIR;
const PDF_UPLOAD_MAX_BYTES =
  Number(process.env.PDF_UPLOAD_MAX_MB || 10) * 1024 * 1024;

const pdfStorage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, ensureUploadsDir());
  },
  filename: function (req, file, cb) {
    const bookingId = String(req.body?.bookingId || req.params?.bookingId || 'pending')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 64);
    const random = crypto.randomBytes(8).toString('hex');
    cb(null, `${file.fieldname}-${bookingId}-${Date.now()}-${random}.pdf`);
  },
});

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
  const looksLikePdf = mime === 'application/pdf' || name.endsWith('.pdf');
  if (!looksLikePdf) return cb(new Error('Only PDF files are allowed'));
  cb(null, true);
}

const upload = multer({
  storage: pdfStorage,
  fileFilter,
  limits: {
    fileSize: PDF_UPLOAD_MAX_BYTES,
    files: 1,
    fields: 4,
    parts: 6,
  },
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
  limits: { fileSize: 3 * 1024 * 1024, files: 1, fields: 4, parts: 6 },
});

function uploadLogContext(req) {
  return {
    method: req.method,
    path: req.originalUrl,
    contentLength: req.get('content-length') || null,
    contentType: req.get('content-type') || null,
    bookingId: req.body?.bookingId || req.params?.bookingId || null,
    userId: req.user?.id || null,
  };
}

function deleteUploadedRequestFile(req) {
  if (req.file?.path) {
    fs.unlink(req.file.path, (err) => {
      if (err && err.code !== 'ENOENT') {
        console.error('[upload] failed to delete rejected PDF', err);
      }
    });
  }
}

function isPdfSignature(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(5);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return bytesRead === 5 && buffer.toString('ascii') === '%PDF-';
  } finally {
    fs.closeSync(fd);
  }
}

function assertUploadedPdf(req) {
  if (!req.file) {
    const err = new Error('PDF file is required');
    err.statusCode = 400;
    throw err;
  }

  if (!isPdfSignature(req.file.path)) {
    const err = new Error('Invalid PDF file signature');
    err.statusCode = 400;
    throw err;
  }

  return `/uploads/${req.file.filename}`;
}

function uploadErrorResponse(err) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return {
        status: 413,
        message: `PDF is too large. Maximum size is ${Math.round(PDF_UPLOAD_MAX_BYTES / 1024 / 1024)}MB`,
      };
    }
    return { status: 400, message: err.message || 'Upload failed' };
  }
  return { status: err?.statusCode || 400, message: err?.message || 'Upload failed' };
}

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
        const response = uploadErrorResponse(err);
        console.error('[upload] PDF multer error', {
          ...uploadLogContext(req),
          field,
          code: err.code,
          message: err.message,
        });
        return res.status(response.status).json({ message: response.message });
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
        deleteUploadedRequestFile(req);
        return res.status(400).json({ message: 'bookingId is required' });
      }
      const storedPath = assertUploadedPdf(req);

      const booking = await ensureBookingDone(bookingId);

      deleteUploadFileIfExists(booking.ticketPDF);
      booking.ticketPDF = storedPath;
      if (booking.currentStep < 8) booking.currentStep = 8;
      await booking.save({ validateBeforeSave: false });

      console.log('[upload] ticket PDF stored', {
        bookingId: String(booking._id),
        file: req.file.filename,
        size: req.file.size,
      });
      res.json({ message: 'Ticket PDF uploaded successfully', booking });
    } catch (err) {
      deleteUploadedRequestFile(req);
      console.error('[upload] ticket upload error', { ...uploadLogContext(req), error: err });
      res.status(err.statusCode || 400).json({ message: err.message || 'Ticket upload failed' });
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
        deleteUploadedRequestFile(req);
        return res.status(400).json({ message: 'bookingId is required' });
      }
      const storedPath = assertUploadedPdf(req);

      const booking = await ensureBookingDone(bookingId);

      deleteUploadFileIfExists(booking.billPDF);
      booking.billPDF = storedPath;
      // Keep step < 9 so user UI can still show downloads.
      if (booking.currentStep < 9) booking.currentStep = 9;
      booking.paymentStatus = 'completed';
      await booking.save({ validateBeforeSave: false });

      console.log('[upload] bill PDF stored', {
        bookingId: String(booking._id),
        file: req.file.filename,
        size: req.file.size,
      });
      res.json({ message: 'Bill PDF uploaded successfully', booking });
    } catch (err) {
      deleteUploadedRequestFile(req);
      console.error('[upload] bill upload error', { ...uploadLogContext(req), error: err });
      res.status(err.statusCode || 400).json({ message: err.message || 'Bill upload failed' });
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
