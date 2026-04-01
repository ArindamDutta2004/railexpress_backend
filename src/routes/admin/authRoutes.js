const express = require('express');
const User = require('../../models/User');
const { signToken } = require('../../middleware/auth');

const router = express.Router();

// POST /api/admin/auth/signup
// Create a new admin account (plain-text password, role = 'admin')
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    if (!name || !email || !password || !phone) {
      return res.status(400).json({ message: 'Name, email, password and phone are required' });
    }

    if (!/^\d{10}$/.test(String(phone))) {
      return res.status(400).json({ message: 'Phone must be 10 digits' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    const admin = await User.create({
      name,
      email: email.toLowerCase(),
      password, // plain-text as per requirements
      phone: String(phone),
      role: 'admin',
    });

    res.status(201).json({
      user: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        phone: admin.phone,
        role: admin.role,
      },
    });
  } catch (err) {
    console.error('admin signup error', err);
    res.status(500).json({ message: 'Admin signup failed' });
  }
});

// POST /api/admin/auth/login
// Admin login only; no signup, no hashing, direct comparison
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }

    const admin = await User.findOne({ email: email.toLowerCase(), role: 'admin' });
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    // Direct plain-text comparison (per requirements)
    if (admin.password !== password) {
      return res.status(400).json({ message: 'Invalid password' });
    }

    const token = signToken(admin);
    res.json({
      token,
      user: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (err) {
    console.error('admin login error', err);
    res.status(500).json({ message: 'Admin login failed' });
  }
});

module.exports = router;

