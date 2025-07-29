const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ClassSchedule',
    required: true
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  joinTime: {
    type: Date,
    required: true
  },
  leaveTime: {
    type: Date
  },
  duration: {
    type: Number, // in minutes
    default: 0
  },
  status: {
    type: String,
    enum: ['present', 'absent', 'partial'],
    default: 'partial'
  },
  isAttendanceMarked: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

// Create a compound index to ensure a student can only have one attendance record per class
attendanceSchema.index({ classId: 1, studentId: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema); 