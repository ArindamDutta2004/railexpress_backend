const express = require('express');
const Feedback = require('../../models/Feedback');
const Booking = require('../../models/Booking');
const { authRequired } = require('../../middleware/auth');

const router = express.Router();

function maskPhone(phone) {
  if (!phone || phone.length < 10) return '**********';
  return `${phone.slice(0, 3)}****${phone.slice(-3)}`;
}

// GET /api/user/feedback/public  (no auth)
router.get('/public', async (req, res) => {
  try {
    const feedbacks = await Feedback.find().sort({ createdAt: -1 }).limit(100);
    res.json(
      feedbacks.map((f) => ({
        id: f._id,
        userName: f.userName,
        rating: f.rating,
        comment: f.comment,
        phone: maskPhone(f.phone),
        createdAt: f.createdAt,
      }))
    );
  } catch (err) {
    console.error('public feedback error', err);
    res.status(500).json({ message: 'Failed to fetch public feedbacks' });
  }
});

// POST /api/user/feedback/create
router.post(
  '/create',
  authRequired,
  async (req, res) => {
    try {
      const { bookingId, rating, comment, phone } = req.body;
      if (!bookingId || !rating || !comment || !phone) {
        return res.status(400).json({ message: 'bookingId, phone, rating, comment required' });
      }
      if (Number(rating) < 1 || Number(rating) > 5) {
        return res.status(400).json({ message: 'Rating must be between 1 and 5' });
      }
      if (!/^\d{10}$/.test(String(phone))) {
        return res.status(400).json({ message: 'Phone must be 10 digits' });
      }

      const booking = await Booking.findById(bookingId);
      if (!booking) {
        return res.status(404).json({ message: 'Booking not found' });
      }

      // Role-based access:
      // - user can feedback only their own booking
      // - admin can feedback any booking (frontend uses this)
      if (req.user.role === 'user' && booking.userId.toString() !== req.user.id) {
        return res.status(403).json({ message: 'Cannot give feedback for others booking' });
      }
      if (req.user.role !== 'user' && req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Forbidden' });
      }

      const existing = await Feedback.findOne({ bookingId });
      if (existing) {
        return res.status(400).json({ message: 'Feedback already submitted for this booking' });
      }

      // Prevent fake phone submissions: must match booking phone for users.
      if (req.user.role === 'user' && String(phone) !== String(booking.phone)) {
        return res.status(400).json({ message: 'Phone number does not match booking phone' });
      }

      const feedback = await Feedback.create({
        userId: req.user.id,
        userName: req.user.name,
        bookingId,
        rating: Number(rating),
        comment: String(comment).trim(),
        phone: String(phone),
      });

      // Return masked phone to user response (public exposure)
      res.status(201).json({ ...feedback.toObject(), phone: maskPhone(feedback.phone) });
    } catch (err) {
      console.error('feedback create error', err);
      res.status(500).json({ message: 'Feedback creation failed' });
    }
  }
);

module.exports = router;

