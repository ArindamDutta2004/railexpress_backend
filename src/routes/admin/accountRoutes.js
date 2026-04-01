const express = require('express');
const User = require('../../models/User');
const { authRequired, requireRole } = require('../../middleware/auth');

const router = express.Router();

// PUT /api/admin/account/change-password
router.put('/change-password', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: 'oldPassword and newPassword are required' });
    }
    if (String(newPassword).length < 4) {
      return res.status(400).json({ message: 'New password must be at least 4 characters' });
    }

    const admin = await User.findById(req.user.id);
    if (!admin) return res.status(404).json({ message: 'Admin not found' });
    if (admin.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });

    if (admin.password !== oldPassword) {
      return res.status(400).json({ message: 'Old password is incorrect' });
    }

    admin.password = String(newPassword);
    await admin.save();
    res.json({ message: 'Password updated' });
  } catch (err) {
    console.error('admin change-password error', err);
    res.status(500).json({ message: 'Failed to change password' });
  }
});

module.exports = router;

