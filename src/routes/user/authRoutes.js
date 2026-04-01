const express = require('express');
const User = require('../../models/User');
const { signToken } = require('../../middleware/auth');

const router = express.Router();

// POST /api/user/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { name, phone, email, password } = req.body;

    if (!name || !phone || !email || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // No hashing per requirements (plain text)
    const user = await User.create({
      name,
      phone,
      email: email.toLowerCase(),
      password,
      role: 'user',
    });

    const token = signToken(user);

    res.status(201).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('signup error', err);
    res.status(500).json({ message: 'Signup failed' });
  }
});

// POST /api/user/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || user.role !== 'user') {
      return res.status(404).json({ message: 'User not found' });
    }

    // Plain text comparison
    if (user.password !== password) {
      return res.status(400).json({ message: 'Invalid password' });
    }

    const token = signToken(user);
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('user login error', err);
    res.status(500).json({ message: 'Login failed' });
  }
});

module.exports = router;

