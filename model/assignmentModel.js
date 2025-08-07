const mongoose = require('mongoose');

const assignmentSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  paragraph: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['audio', 'video'],
    required: true
  },
  subject: {
    type: String,
    required: true,
    enum: ['english', 'hindi', 'mathematics', 'science', 'social_studies', 'general_knowledge']
  },
  language: {
    type: String,
    required: true,
    enum: ['english', 'hindi', 'both']
  },
  duration: {
    type: Number, // in minutes
    required: true,
    min: 1,
    max: 60
  },
  maxFileSize: {
    type: Number, // in MB
    required: true,
    default: 100
  },
  allowedFormats: {
    type: [String],
    required: true,
    default: function() {
      return this.type === 'audio' ? ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'webm'] : ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm'];
    }
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isPublished: {
    type: Boolean,
    default: false
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  },
  assignedTo: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student'
  }],
  // For weekly assignments - specific week
  weekNumber: {
    type: Number,
    min: 1,
    max: 52
  },
  year: {
    type: Number,
    default: () => new Date().getFullYear()
  },
  instructions: {
    type: String,
    trim: true
  },
  rubric: {
    pronunciation: {
      type: Number,
      min: 0,
      max: 25,
      default: 25
    },
    fluency: {
      type: Number,
      min: 0,
      max: 25,
      default: 25
    },
    clarity: {
      type: Number,
      min: 0,
      max: 25,
      default: 25
    },
    expression: {
      type: Number,
      min: 0,
      max: 25,
      default: 25
    }
  },
  totalMarks: {
    type: Number,
    required: true,
    default: 100
  },
  passingMarks: {
    type: Number,
    required: true,
    default: 40
  }
}, { 
  timestamps: true 
});

// Index for efficient queries
assignmentSchema.index({ type: 1, subject: 1, isActive: 1, isPublished: 1 });
assignmentSchema.index({ startDate: 1, endDate: 1 });
assignmentSchema.index({ weekNumber: 1, year: 1 });

module.exports = mongoose.model('Assignment', assignmentSchema); 