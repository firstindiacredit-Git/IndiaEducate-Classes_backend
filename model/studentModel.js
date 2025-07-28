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

module.exports = mongoose.model('Student', studentSchema);
