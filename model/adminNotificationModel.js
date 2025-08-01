const mongoose = require('mongoose');

const adminNotificationSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['upcoming_class_warning', 'class_expired', 'class_started', 'test'],
    required: true
  },
  relatedClassId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ClassSchedule'
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  isRead: {
    type: Boolean,
    default: false
  },
  readAt: {
    type: Date
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('AdminNotification', adminNotificationSchema); 