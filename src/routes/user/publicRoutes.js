const express = require('express');

const Feedback = require('../../models/Feedback');

const router = express.Router();

function maskPhone(phone) {
  if (!phone || phone.length < 10) return '**********';
  return `${phone.slice(0, 3)}****${phone.slice(-3)}`;
}

// GET /api/user/public/feedback
router.get('/feedback', async (req, res) => {
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

module.exports = router;

