const express = require('express');

const authRoutes = require('./authRoutes');
const bookingRoutes = require('./bookingRoutes');
const uploadRoutes = require('./uploadRoutes');
const feedbackRoutes = require('./feedbackRoutes');
const accountRoutes = require('./accountRoutes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/booking', bookingRoutes);
router.use('/upload', uploadRoutes);
router.use('/feedback', feedbackRoutes);
router.use('/account', accountRoutes);

module.exports = router;

