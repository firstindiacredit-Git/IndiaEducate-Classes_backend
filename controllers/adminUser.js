const express = require('express');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const Admin = require('../model/adminModel');
const Student = require('../model/studentModel');
const { sendOTPEmail, sendCredentialsEmail, sendProfileUpdateEmail } = require('../utils/emailService');
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

// Get All Students
router.get('/students', async (req, res) => {
  try {
    const students = await Student.find()
      .select('-password -otp -otpExpires')
      .sort({ createdAt: -1 });
    res.json(students);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete Student
router.delete('/students/:id', async (req, res) => {
  try {
    const student = await Student.findByIdAndDelete(req.params.id);
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }
    
    // Emit force logout event to the deleted student
    if (global.io && student.email) {
      // console.log(`Emitting force-logout event for deleted student: ${student.email}`);
      global.io.to(`force-logout-${student.email}`).emit('force-logout', {
        message: 'Your account has been deleted by an administrator',
        reason: 'account_deleted'
      });
    }
    
    res.json({ message: 'Student deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Add Student Directly (Without OTP)
router.post('/add-student', async (req, res) => {
  try {
    const { email, phone, password, fullName, country, enrollmentId, program } = req.body;
    
    // Check required fields
    if (!email || !phone || !password) {
      return res.status(400).json({ message: 'Email, phone and password are required' });
    }

    // Check if student already exists
    const existing = await Student.findOne({ $or: [{ email }, { phone }] });
    if (existing) {
      return res.status(400).json({ message: 'Email or phone already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create student with verified status
    const student = await Student.create({
      email,
      phone,
      password: hashedPassword,
      fullName,
      country,
      enrollmentId,
      program,
      isVerified: true // Auto verify since admin is creating
    });

    // Send credentials to student's email
    try {
      await sendCredentialsEmail(email, email, password);
    } catch (emailError) {
      console.error('Failed to send credentials email:', emailError);
      // Don't return error to admin, just log it
    }

    // Return student without sensitive info
    const studentData = await Student.findById(student._id)
      .select('-password -otp -otpExpires');

    res.status(201).json({ 
      message: 'Student added successfully and credentials sent to email',
      student: studentData
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update Student by Admin
router.put('/update-student/:id', async (req, res) => {
  try {
    const { 
      email, 
      phone, 
      fullName, 
      country, 
      enrollmentId, 
      program,
      password // Optional: only if admin wants to update password
    } = req.body;

    // Find student
    const student = await Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Check if new email or phone already exists for other students
    if (email !== student.email || phone !== student.phone) {
      const existing = await Student.findOne({
        $and: [
          { _id: { $ne: student._id } }, // Exclude current student
          { $or: [{ email }, { phone }] }
        ]
      });

      if (existing) {
        return res.status(400).json({ 
          message: 'Email or phone number already registered with another student' 
        });
      }
    }

    // Update basic fields
    student.email = email;
    student.phone = phone;
    student.fullName = fullName;
    student.country = country;
    student.enrollmentId = enrollmentId;
    student.program = program;

    // Update password if provided
    let newPassword = null;
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      student.password = hashedPassword;
      newPassword = password; // Store for email notification
    }

    await student.save();

    // Send email notification
    try {
      await sendProfileUpdateEmail(email, student, newPassword);
    } catch (emailError) {
      console.error('Failed to send update email:', emailError);
    }

    // Return updated student without sensitive info
    const updatedStudent = await Student.findById(student._id)
      .select('-password -otp -otpExpires');

    // Emit real-time profile update to the student
    if (global.io) {
      global.io.to(`profile-${email}`).emit('profile-updated', {
        profile: updatedStudent
      });
      
      // If email was changed, force logout the student from old email
      if (student.email !== email) {
        // console.log(`Emitting force-logout event for email change: ${student.email} -> ${email}`);
        global.io.to(`force-logout-${student.email}`).emit('force-logout', {
          message: 'Your account email has been updated by an administrator. Please login again.',
          reason: 'email_changed'
        });
      }
    }

    res.json({ 
      message: 'Student updated successfully and notification email sent',
      student: updatedStudent 
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get Dashboard Stats
router.get('/dashboard-stats', async (req, res) => {
  try {
    // Get total number of students
    const totalStudents = await Student.countDocuments();

    // For now, setting static values for other stats
    // You can modify these based on your actual data models
    const stats = {
      totalStudents,
      activeCourses: 8,
      completedSessions: 48,
      upcomingSessions: 12
    };

    res.json(stats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
