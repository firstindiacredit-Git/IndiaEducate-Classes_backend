const mongoose = require('mongoose');

const fileUploadSchema = new mongoose.Schema({
  fileName: {
    type: String,
    required: true,
    trim: true
  },
  originalName: {
    type: String,
    required: true
  },
  fileType: {
    type: String,
    required: true,
    enum: ['pdf', 'video', 'audio', 'image']
  },
  fileSize: {
    type: Number,
    required: true
  },
  mimeType: {
    type: String,
    required: true
  },
  s3Key: {
    type: String,
    required: true
  },
  s3Url: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true,
    enum: ['study_material', 'recorded_class', 'pronunciation_practice', 'assignment', 'other']
  },
  description: {
    type: String,
    trim: true
  },
  tags: [{
    type: String,
    trim: true
  }],
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  },
  isPublic: {
    type: Boolean,
    default: true
  },
  downloadCount: {
    type: Number,
    default: 0
  },
  viewCount: {
    type: Number,
    default: 0
  },
  // Track unique student interactions
  viewedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student'
  }],
  downloadedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student'
  }],
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Index for better query performance
fileUploadSchema.index({ fileType: 1, category: 1, isActive: 1 });
fileUploadSchema.index({ uploadedBy: 1 });
fileUploadSchema.index({ tags: 1 });

module.exports = mongoose.model('FileUpload', fileUploadSchema); 