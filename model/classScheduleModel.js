const mongoose = require('mongoose');

const classScheduleSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  description: String,
  startTime: {
    type: Date,
    required: true,
  },
  duration: {
    type: Number, // in minutes
    required: true,
    default: 60
  },
  meetingLink: String,
  meetingId: String,
  program: {
    type: String,
    enum: ['24-session', '48-session'],
    required: true
  },
  status: {
    type: String,
    enum: ['scheduled', 'ongoing', 'completed', 'cancelled'],
    default: 'scheduled'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  }
}, { timestamps: true });

module.exports = mongoose.model('ClassSchedule', classScheduleSchema); 