const express = require('express');
const Feedback = require('../../models/Feedback');
const { authRequired, requireRole } = require('../../middleware/auth');

const router = express.Router();

// GET /api/admin/feedback/all
router.get(
  '/all',
  authRequired,
  requireRole('admin'),
  async (req, res) => {
    try {
      const feedbacks = await Feedback.find().sort({ createdAt: -1 });
      // Admin sees full details (no phone masking)
      res.json(
        feedbacks.map((f) => ({
          id: f._id,
          userId: f.userId,
          userName: f.userName,
          bookingId: f.bookingId,
          rating: f.rating,
          comment: f.comment,
          phone: f.phone,
          createdAt: f.createdAt,
        }))
      );
    } catch (err) {
      console.error('feedback all error', err);
      res.status(500).json({ message: 'Failed to fetch feedbacks' });
    }
  }
);

// DELETE /api/admin/feedback/:id
router.delete(
  '/:id',
  authRequired,
  requireRole('admin'),
  async (req, res) => {
    try {
      const deleted = await Feedback.findByIdAndDelete(req.params.id);
      if (!deleted) return res.status(404).json({ message: 'Feedback not found' });
      res.json({ message: 'Deleted' });
    } catch (err) {
      console.error('feedback delete error', err);
      res.status(500).json({ message: 'Failed to delete feedback' });
    }
  }
);

module.exports = router;

