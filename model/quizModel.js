const mongoose = require('mongoose');

const quizSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['weekly_test', 'assignment', 'practice_quiz'],
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
    min: 5,
    max: 180
  },
  totalMarks: {
    type: Number,
    required: true,
    min: 1
  },
  passingMarks: {
    type: Number,
    required: true,
    min: 1
  },
  questions: [{
    question: {
      type: String,
      required: true
    },
    type: {
      type: String,
      enum: ['multiple_choice', 'true_false', 'fill_blank', 'short_answer'],
      required: true
    },
    options: [{
      type: String
    }],
    correctAnswer: {
      type: String,
      required: true
    },
    marks: {
      type: Number,
      required: true,
      min: 1
    },
    explanation: {
      type: String
    }
  }],
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
  // For weekly tests - specific week
  weekNumber: {
    type: Number,
    min: 1,
    max: 52
  },
  year: {
    type: Number,
    default: () => new Date().getFullYear()
  }
}, { 
  timestamps: true 
});

// Index for efficient queries
quizSchema.index({ type: 1, subject: 1, isActive: 1, isPublished: 1 });
quizSchema.index({ startDate: 1, endDate: 1 });
quizSchema.index({ weekNumber: 1, year: 1 });

module.exports = mongoose.model('Quiz', quizSchema); 