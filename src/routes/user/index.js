const express = require('express');

const authRoutes = require('./authRoutes');
const bookingRoutes = require('./bookingRoutes');
const feedbackRoutes = require('./feedbackRoutes');
const publicRoutes = require('./publicRoutes');
const accountRoutes = require('./accountRoutes');
const notificationRoutes = require('./notificationRoutes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/booking', bookingRoutes);
router.use('/feedback', feedbackRoutes);
router.use('/public', publicRoutes);
router.use('/account', accountRoutes);
router.use('/notifications', notificationRoutes);

module.exports = router;
