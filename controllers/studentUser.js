const express = require('express');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const Student = require('../model/studentModel');
const { sendOTPEmail } = require('../utils/emailService');
const { uploadMiddleware, deleteFileFromS3 } = require('../utils/multerConfig');

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
    const existing = await Student.findOne({ $or: [{ email }, { phone }] });
    if (existing) {
      return res.status(400).json({ message: 'Email or phone already registered' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 min
    const student = await Student.create({
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
    const student = await Student.findOne({
      $or: [{ email: emailOrPhone }, { phone: emailOrPhone }],
    });
    if (!student) {
      return res.status(400).json({ message: 'User not found. Please signup first.' });
    }
    const isMatch = await bcrypt.compare(password, student.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    // Generate and send OTP
    const otp = generateOTP();
    student.otp = otp;
    student.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await student.save();
    await sendOTPEmail(student.email, otp);
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
    const student = await Student.findOne({
      $or: [{ email: emailOrPhone }, { phone: emailOrPhone }],
    });
    if (!student) {
      return res.status(400).json({ message: 'User not found. Please signup first.' });
    }
    if (
      String(student.otp).trim() !== String(otp).trim() ||
      !student.otpExpires ||
      student.otpExpires < new Date()
    ) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }
    student.isVerified = true;
    student.otp = undefined;
    student.otpExpires = undefined;
    await student.save();
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
    const student = await Student.findOne({ email });
    if (!student) {
      return res.status(400).json({ message: 'User not found. Please signup first.' });
    }
    const otp = generateOTP();
    student.otp = otp;
    student.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await student.save();
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
    const student = await Student.findOne({ email });
    if (!student) {
      return res.status(400).json({ message: 'User not found. Please signup first.' });
    }
    if (
      String(student.otp).trim() !== String(otp).trim() ||
      !student.otpExpires ||
      student.otpExpires < new Date()
    ) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }
    student.password = await bcrypt.hash(newPassword, 10);
    student.otp = undefined;
    student.otpExpires = undefined;
    await student.save();
    res.json({ message: 'Password reset successful' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get Student Profile
router.post('/profile', async (req, res) => {
  try {
    const { emailOrPhone } = req.body;
    if (!emailOrPhone) {
      return res.status(400).json({ message: 'Email or phone is required' });
    }
    const student = await Student.findOne({
      $or: [{ email: emailOrPhone }, { phone: emailOrPhone }],
    }).select('-password -otp -otpExpires');
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }
    res.json(student);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update Student Profile with file upload
router.put('/profile', uploadMiddleware, async (req, res) => {
  try {
    const { emailOrPhone, fullName, country, enrollmentId, program } = req.body;
    if (!emailOrPhone) {
      return res.status(400).json({ message: 'Email or phone is required' });
    }
    
    const student = await Student.findOne({
      $or: [{ email: emailOrPhone }, { phone: emailOrPhone }],
    });
    
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // If new file uploaded, delete old profile picture and update with new URL
    if (req.file) {
      await deleteFileFromS3(student.profilePicture);
      student.profilePicture = req.file.location; // S3 URL of uploaded file
    }

    if (fullName !== undefined) student.fullName = fullName;
    if (country !== undefined) student.country = country;
    if (enrollmentId !== undefined) {
      // If enrollmentId is empty string or only whitespace, set to null
      student.enrollmentId = enrollmentId.trim() === '' ? null : enrollmentId;
    }
    if (program !== undefined) student.program = program;

    await student.save();
    
    // Return updated profile data
    const updatedProfile = await Student.findById(student._id)
      .select('-password -otp -otpExpires');
    
    res.json({
      message: 'Profile updated successfully',
      profile: updatedProfile
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
