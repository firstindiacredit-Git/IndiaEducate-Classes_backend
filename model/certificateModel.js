const mongoose = require('mongoose');

const certificateSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  studentName: {
    type: String,
    required: true
  },
  program: {
    type: String,
    enum: ['24-session', '48-session'],
    required: true
  },
  certificateNumber: {
    type: String,
    required: true,
    unique: true
  },
  issueDate: {
    type: Date,
    default: Date.now
  },
  completionDate: {
    type: Date,
    required: true
  },
  isGenerated: {
    type: Boolean,
    default: false
  },
  isAllowedByAdmin: {
    type: Boolean,
    default: false
  },
  certificateUrl: {
    type: String
  },
  s3Url: {
    type: String
  },
  adminApprovalDate: {
    type: Date
  },
  adminApprovedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, { timestamps: true });

// Generate certificate number
certificateSchema.pre('save', function(next) {
  if (!this.certificateNumber || this.certificateNumber === '') {
    const year = new Date().getFullYear();
    const randomNum = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    this.certificateNumber = `CERT-${year}-${randomNum}`;
  }
  next();
});

module.exports = mongoose.model('Certificate', certificateSchema);
