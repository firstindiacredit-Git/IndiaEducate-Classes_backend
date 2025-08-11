const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
  },
  phone: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  otp: {
    type: String,
  },
  otpExpires: {
    type: Date,
  },
  isVerified: {
    type: Boolean,
    default: false,
  },
  // Profile fields
  fullName: {
    type: String,
  },
  country: {
    type: String,
  },
  enrollmentId: {
    type: String,
  },
  program: {
    type: String,
    enum: ['24-session', '48-session'],
  },
  profilePicture: {
    type: String, // URL or file path
  },
}, { timestamps: true });

// Schema for pending student registrations (before OTP verification)
const pendingStudentSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
  },
  phone: {
    type: String,
    required: true,
  },
  password: {
    type: String,
    required: true,
  },
  otp: {
    type: String,
    required: true,
  },
  otpExpires: {
    type: Date,
    required: true,
  },
}, { timestamps: true });

// Add index to automatically delete expired pending registrations
pendingStudentSchema.index({ otpExpires: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Student', studentSchema);
module.exports.PendingStudent = mongoose.model('PendingStudent', pendingStudentSchema);
