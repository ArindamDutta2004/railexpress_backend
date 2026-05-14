const express = require('express');
const Notification = require('../../models/Notification');
const FcmToken = require('../../models/FcmToken');
const { authRequired, requireRole } = require('../../middleware/auth');

const router = express.Router();

router.use(authRequired, requireRole('user'));

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const notifications = await Notification.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(limit);
    const unreadCount = await Notification.countDocuments({
      userId: req.user.id,
      readAt: null,
    });
    res.json({ notifications, unreadCount });
  } catch (err) {
    console.error('notification list error', err);
    res.status(500).json({ message: 'Failed to fetch notifications' });
  }
});

router.get('/unread-count', async (req, res) => {
  try {
    const unreadCount = await Notification.countDocuments({
      userId: req.user.id,
      readAt: null,
    });
    res.json({ unreadCount });
  } catch (err) {
    console.error('notification unread count error', err);
    res.status(500).json({ message: 'Failed to fetch unread count' });
  }
});

router.post('/token', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token) return res.status(400).json({ message: 'FCM token is required' });

    const tokenDoc = await FcmToken.findOneAndUpdate(
      { token },
      {
        $set: {
          userId: req.user.id,
          platform: req.body?.platform || 'web',
          userAgent: String(req.get('user-agent') || '').slice(0, 500),
          lastSeenAt: new Date(),
          disabledAt: null,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({ message: 'Notification device registered', id: tokenDoc._id });
  } catch (err) {
    console.error('notification token register error', err);
    res.status(500).json({ message: 'Failed to register notification device' });
  }
});

router.delete('/token', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token) return res.status(400).json({ message: 'FCM token is required' });

    await FcmToken.updateOne(
      { userId: req.user.id, token },
      { $set: { disabledAt: new Date() } }
    );
    res.json({ message: 'Notification device removed' });
  } catch (err) {
    console.error('notification token delete error', err);
    res.status(500).json({ message: 'Failed to remove notification device' });
  }
});

router.patch('/:id/read', async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { $set: { readAt: new Date() } },
      { new: true }
    );
    if (!notification) return res.status(404).json({ message: 'Notification not found' });
    res.json(notification);
  } catch (err) {
    console.error('notification mark read error', err);
    res.status(500).json({ message: 'Failed to mark notification read' });
  }
});

router.patch('/:id/unread', async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { $set: { readAt: null } },
      { new: true }
    );
    if (!notification) return res.status(404).json({ message: 'Notification not found' });
    res.json(notification);
  } catch (err) {
    console.error('notification mark unread error', err);
    res.status(500).json({ message: 'Failed to mark notification unread' });
  }
});

router.patch('/mark-all-read', async (req, res) => {
  try {
    await Notification.updateMany(
      { userId: req.user.id, readAt: null },
      { $set: { readAt: new Date() } }
    );
    res.json({ message: 'Notifications marked as read' });
  } catch (err) {
    console.error('notification mark all read error', err);
    res.status(500).json({ message: 'Failed to mark notifications read' });
  }
});

module.exports = router;
