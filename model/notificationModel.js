const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  studentEmail: {
    type: String,
    required: true,
    lowercase: true,
  },
  type: {
    type: String,
    required: true,
    enum: [
      'class_scheduled', 
      'class_updated', 
      'class_cancelled', 
      'class_started', 
      'general',
      'study_material_uploaded',
      'quiz_created',
      'weekly_test_created',
      'assignment_created',
      'assignment_reviewed',
      'quiz_reviewed'
    ]
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  isRead: {
    type: Boolean,
    default: false
  },
  relatedClassId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ClassSchedule'
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { 
  timestamps: true 
});

// Index for efficient queries
notificationSchema.index({ studentEmail: 1, createdAt: -1 });
notificationSchema.index({ studentEmail: 1, isRead: 1 });

module.exports = mongoose.model('Notification', notificationSchema); 