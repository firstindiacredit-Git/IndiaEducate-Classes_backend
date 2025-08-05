const mongoose = require('mongoose');

const quizSubmissionSchema = new mongoose.Schema({
  quiz: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz',
    required: true
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  answers: [{
    questionIndex: {
      type: Number,
      required: true
    },
    answer: {
      type: String,
      required: true
    },
    isCorrect: {
      type: Boolean,
      default: false
    },
    marksObtained: {
      type: Number,
      default: 0
    },
    timeSpent: {
      type: Number, // in seconds
      default: 0
    }
  }],
  totalMarksObtained: {
    type: Number,
    required: true,
    default: 0
  },
  percentage: {
    type: Number,
    required: true,
    default: 0
  },
  isPassed: {
    type: Boolean,
    required: true,
    default: false
  },
  startTime: {
    type: Date,
    required: true
  },
  endTime: {
    type: Date
  },
  duration: {
    type: Number, // in minutes
    default: 0
  },
  status: {
    type: String,
    enum: ['in_progress', 'completed', 'abandoned', 'timeout'],
    default: 'in_progress'
  },
  attempts: {
    type: Number,
    default: 1
  },
  // For tracking if student can retake
  canRetake: {
    type: Boolean,
    default: false
  },
  maxAttempts: {
    type: Number,
    default: 1
  },
  // Feedback from admin (optional)
  adminFeedback: {
    type: String
  },
  adminScore: {
    type: Number
  },
  isReviewed: {
    type: Boolean,
    default: false
  }
}, { 
  timestamps: true 
});

// Index for efficient queries
quizSubmissionSchema.index({ quiz: 1, student: 1 });
quizSubmissionSchema.index({ status: 1, isPassed: 1 });
quizSubmissionSchema.index({ startTime: 1, endTime: 1 });

// Compound index for unique submissions per student per quiz
quizSubmissionSchema.index({ quiz: 1, student: 1, attempts: 1 }, { unique: true });

module.exports = mongoose.model('QuizSubmission', quizSubmissionSchema); 