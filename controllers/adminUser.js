const express = require('express');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const Admin = require('../model/adminModel');
const { sendOTPEmail } = require('../utils/emailService');
const { uploadMiddleware } = require('../utils/multerConfig');
const { s3Upload } = require('../utils/s3Config');

const router = express.Router();

// Helper: Generate 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Signup Route
router.post('/signup', async (req, res) => {
  try {
    const { email, phone, password } = req.body;
    if (!email || !phone || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    const existing = await Admin.findOne({ $or: [{ email }, { phone }] });
    if (existing) {
      return res.status(400).json({ message: 'Email or phone already registered' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 min
    const admin = await Admin.create({
      email,
      phone,
      password: hashedPassword,
      otp,
      otpExpires,
      isVerified: false,
    });
    // Send OTP email
    await sendOTPEmail(email, otp);
    res.status(201).json({ message: 'Signup successful, OTP sent to email' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Login Route
router.post('/login', async (req, res) => {
  try {
    const { emailOrPhone, password } = req.body;
    if (!emailOrPhone || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    const admin = await Admin.findOne({
      $or: [{ email: emailOrPhone }, { phone: emailOrPhone }],
    });
    if (!admin) {
      return res.status(400).json({ message: 'User not found. Please signup first.' });
    }
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    // Generate and send OTP
    const otp = generateOTP();
    admin.otp = otp;
    admin.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await admin.save();
    await sendOTPEmail(admin.email, otp);
    res.json({ message: 'OTP sent to email' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// OTP Verification Route
router.post('/verify-otp', async (req, res) => {
  try {
    const { emailOrPhone, otp } = req.body;
    if (!emailOrPhone || !otp) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    const admin = await Admin.findOne({
      $or: [{ email: emailOrPhone }, { phone: emailOrPhone }],
    });
    if (!admin) {
      return res.status(400).json({ message: 'User not found. Please signup first.' });
    }
    if (
      String(admin.otp).trim() !== String(otp).trim() ||
      !admin.otpExpires ||
      admin.otpExpires < new Date()
    ) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }
    admin.isVerified = true;
    admin.otp = undefined;
    admin.otpExpires = undefined;
    await admin.save();
    res.json({ message: 'OTP verified, user authenticated' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Forgot Password - Send OTP
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }
    const admin = await Admin.findOne({ email });
    if (!admin) {
      return res.status(400).json({ message: 'User not found. Please signup first.' });
    }
    const otp = generateOTP();
    admin.otp = otp;
    admin.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await admin.save();
    await sendOTPEmail(email, otp);
    res.json({ message: 'OTP sent to email' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Reset Password - Verify OTP and set new password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    const admin = await Admin.findOne({ email });
    if (!admin) {
      return res.status(400).json({ message: 'User not found. Please signup first.' });
    }
    if (
      String(admin.otp).trim() !== String(otp).trim() ||
      !admin.otpExpires ||
      admin.otpExpires < new Date()
    ) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }
    admin.password = await bcrypt.hash(newPassword, 10);
    admin.otp = undefined;
    admin.otpExpires = undefined;
    await admin.save();
    res.json({ message: 'Password reset successful' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get Admin Profile
router.post('/profile', async (req, res) => {
  try {
    const { emailOrPhone } = req.body;
    if (!emailOrPhone) {
      return res.status(400).json({ message: 'Email or phone required' });
    }

    const admin = await Admin.findOne({
      $or: [{ email: emailOrPhone }, { phone: emailOrPhone }],
    }).select('-password -otp -otpExpires');

    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    res.json(admin);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update Admin Profile
router.put('/profile', uploadMiddleware, async (req, res) => {
  try {
    const { emailOrPhone, fullName } = req.body;
    if (!emailOrPhone) {
      return res.status(400).json({ message: 'Email or phone required' });
    }

    const admin = await Admin.findOne({
      $or: [{ email: emailOrPhone }, { phone: emailOrPhone }],
    });

    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    // Update profile picture if provided
    if (req.file) {
      admin.profilePicture = req.file.location;
    }

    // Update other fields
    if (fullName) admin.fullName = fullName;

    await admin.save();
    
    // Return updated profile without sensitive information
    const updatedProfile = await Admin.findById(admin._id).select('-password -otp -otpExpires');
    res.json({ message: 'Profile updated successfully', profile: updatedProfile });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
