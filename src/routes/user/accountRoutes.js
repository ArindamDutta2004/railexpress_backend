const express = require('express');
const User = require('../../models/User');
const { authRequired, requireRole } = require('../../middleware/auth');

const router = express.Router();

// PUT /api/user/account/change-password
router.put('/change-password', authRequired, requireRole('user'), async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: 'oldPassword and newPassword are required' });
    }
    if (String(newPassword).length < 4) {
      return res.status(400).json({ message: 'New password must be at least 4 characters' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.password !== oldPassword) {
      return res.status(400).json({ message: 'Old password is incorrect' });
    }

    user.password = String(newPassword);
    await user.save();
    res.json({ message: 'Password updated' });
  } catch (err) {
    console.error('user change-password error', err);
    res.status(500).json({ message: 'Failed to change password' });
  }
});

module.exports = router;

