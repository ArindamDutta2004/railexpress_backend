require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { UPLOADS_DIR, ensureUploadsDir } = require('./config/uploadPaths');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const Booking = require('./models/Booking');

const app = express();

async function dropDuplicateBookingIndexes() {
  try {
    const indexes = await Booking.collection.indexes();
    const duplicateConstraintIndexes = indexes.filter((index) => {
      const keys = Object.keys(index.key || {});
      return (
        index.unique === true &&
        keys.includes('userId') &&
        keys.includes('fromStation') &&
        keys.includes('toStation') &&
        keys.includes('journeyDate')
      );
    });

    for (const index of duplicateConstraintIndexes) {
      if (!index.name || index.name === '_id_') continue;
      await Booking.collection.dropIndex(index.name);
      console.log('Dropped duplicate-booking unique index:', index.name);
    }
  } catch (err) {
    console.error('Duplicate booking index cleanup error:', err);
  }
}

// ======================
// 🔍 ENV CHECK (Debug)
// ======================
console.log("ENV CHECK:");
console.log("PORT:", process.env.PORT || "Not set");
console.log("MONGODB_URI:", process.env.MONGODB_URI ? "Loaded ✅" : "Missing ❌");

// ======================
// ❌ STOP if no DB URI
// ======================
if (!process.env.MONGODB_URI) {
  console.error("❌ MONGODB_URI is missing in environment variables");
  process.exit(1);
}

// ======================
// Middleware
// ======================
const envAllowedOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URLS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = [
  ...new Set([
    "https://railexpress-user.onrender.com",
    "https://railexpress-admin.onrender.com",
    ...envAllowedOrigins,
  ]),
];

app.use(cors({
  origin: [
    "https://railexpress-user.onrender.com",
    "https://railexpress-admin.onrender.com",
    ...envAllowedOrigins,
  ],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["Content-Disposition", "Content-Type"],
  credentials: true
}));
app.use(express.json({ limit: '5mb' }));

// ======================
// Uploaded files (PDFs, refund QR images) — same folder as multer (uploadPaths)
// ======================
ensureUploadsDir();
console.log('📁 Serving uploads from:', UPLOADS_DIR);
const LEGACY_UPLOADS_DIR = path.resolve(__dirname, '..', 'uploads');
const hasLegacyUploadsDir =
  LEGACY_UPLOADS_DIR !== UPLOADS_DIR && fs.existsSync(LEGACY_UPLOADS_DIR);
if (hasLegacyUploadsDir) {
  console.log('📁 Serving legacy uploads fallback from:', LEGACY_UPLOADS_DIR);
}

// Use express.static — not app.get('/uploads/:filename'). In Express 5, :filename
// does not match many real filenames (e.g. *.jpeg), which produced HTML "Cannot GET"
// while *.txt worked. Static serving uses the path on disk, not path-to-regexp.
app.use(
  '/uploads',
  express.static(UPLOADS_DIR, { index: false, etag: true, fallthrough: true })
);
if (hasLegacyUploadsDir) {
  app.use(
    '/uploads',
    express.static(LEGACY_UPLOADS_DIR, { index: false, etag: true, fallthrough: true })
  );
}
app.use('/uploads', (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  const rel = String(req.path || '').replace(/^\/+/, '');
  if (!rel || rel.includes('..')) {
    return res.status(400).json({ message: 'Invalid path' });
  }
  res.status(404).json({
    message: 'File not found',
    hint: 'On Render/cloud, use a persistent disk and set UPLOAD_ROOT, or files disappear after redeploy.',
  });
});

// ======================
// Routes
// ======================
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Railway booking backend running' });
});

// ======================
// MongoDB Connection
// ======================
mongoose
  .connect(process.env.MONGODB_URI, {
    dbName: process.env.MONGODB_DB_NAME || 'railway_booking',
  })
  .then(async () => {
    console.log('✅ MongoDB connected');

    await dropDuplicateBookingIndexes();

    // ======================
    // ⏱ Auto-cancel Job
    // ======================
    const CHECK_INTERVAL_MS = 5 * 60 * 1000;

    setInterval(async () => {
      try {
        const now = new Date();

        const resUpdate = await Booking.updateMany(
          {
            paymentDeadline: { $lte: now },
            paymentStatus: { $in: ['pending', 'advance pending'] },
            statusPhase1: { $ne: 'cancelled' },
          },
          {
            $set: {
              statusPhase1: 'cancelled',
              statusPhase2: 'not booked',
              paymentStatus: 'cancelled',
              currentStep: 10,
            },
          }
        );

        if (resUpdate.modifiedCount) {
          console.log('Auto-cancelled:', resUpdate.modifiedCount);
        }
      } catch (err) {
        console.error('Auto-cancel job error:', err);
      }
    }, CHECK_INTERVAL_MS);

    // ======================
    // 📈 Promote Completed
    // ======================
    const PROMOTE_INTERVAL_MS = 60 * 1000;

    setInterval(async () => {
      try {
        await Booking.updateMany(
          {
            paymentStatus: 'completed',
            currentStep: { $lt: 9 },
            statusPhase2: 'booking done',
            ticketPDF: { $ne: null },
            billPDF: { $ne: null },
          },
          { $set: { currentStep: 9 } }
        );
      } catch (err) {
        console.error('Promote job error:', err);
      }
    }, PROMOTE_INTERVAL_MS);

    // ======================
    // 🚀 Start Server
    // ======================
    const PORT = process.env.PORT || 5000;

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// ======================
// Global Error Handling
// ======================
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled Rejection:", err);
});

module.exports = app;
