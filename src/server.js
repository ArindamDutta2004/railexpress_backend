require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const Booking = require('./models/Booking');

const app = express();

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
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ======================
// Static Files
// ======================
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

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
  .then(() => {
    console.log('✅ MongoDB connected');

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