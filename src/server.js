require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const Booking = require('./models/Booking');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Static for uploaded PDFs
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Routes
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Railway booking backend running' });
});

// MongoDB connection
const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb+srv://ownerkissanhelper385_db_user:fdQc6QG4IOuPoPuC@cluster0.lzizxt6.mongodb.net/?appName=Cluster0';

mongoose
  .connect(MONGODB_URI, {
    dbName: process.env.MONGODB_DB_NAME || 'railway_booking',
  })
  .then(() => {
    console.log('MongoDB connected');

    // Timeout rule: auto-cancel bookings if payment not done in time
    const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    const job = async () => {
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
          console.log('Auto-cancelled bookings count:', resUpdate.modifiedCount);
        }
      } catch (err) {
        console.error('Auto-cancel job error', err);
      }
    };
    setInterval(job, CHECK_INTERVAL_MS);

    // Promote completed bookings so feedback becomes visible.
    // Bill upload keeps step < 9 briefly so the UI can still show downloads.
    const PROMOTE_INTERVAL_MS = 60 * 1000; // 1 minute
    const promoteCompleted = async () => {
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
        console.error('promoteCompleted job error', err);
      }
    };
    setInterval(promoteCompleted, PROMOTE_INTERVAL_MS);

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error', err);
    process.exit(1);
  });

module.exports = app;

