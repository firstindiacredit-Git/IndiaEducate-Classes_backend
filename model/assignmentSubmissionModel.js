const mongoose = require('mongoose');

const assignmentSubmissionSchema = new mongoose.Schema({
  assignment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Assignment',
    required: true
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  submissionFile: {
    fileName: { type: String },
    originalName: { type: String },
    fileType: { type: String, enum: ['audio', 'video'] },
    fileSize: { type: Number },
    mimeType: { type: String },
    s3Key: { type: String },
    s3Url: { type: String }
  },
  submissionText: {
    type: String,
    trim: true
  },
  duration: {
    type: Number, // in seconds
    default: 0
  },
  status: {
    type: String,
    enum: ['draft', 'submitted', 'under_review', 'reviewed', 'approved', 'rejected'],
    default: 'draft'
  },
  submittedAt: {
    type: Date,
    default: Date.now
  },
  reviewedAt: {
    type: Date
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  // Admin evaluation scores
  scores: {
    pronunciation: {
      type: Number,
      min: 0,
      max: 25,
      default: 0
    },
    fluency: {
      type: Number,
      min: 0,
      max: 25,
      default: 0
    },
    clarity: {
      type: Number,
      min: 0,
      max: 25,
      default: 0
    },
    expression: {
      type: Number,
      min: 0,
      max: 25,
      default: 0
    }
  },
  totalScore: {
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
  adminFeedback: {
    type: String,
    trim: true
  },
  adminComments: {
    type: String,
    trim: true
  },
  attempts: {
    type: Number,
    default: 1
  },
  maxAttempts: {
    type: Number,
    default: 3
  },
  canResubmit: {
    type: Boolean,
    default: false
  },
  // For tracking submission time vs assignment deadline
  submittedBeforeDeadline: {
    type: Boolean,
    default: true
  },
  lateSubmissionMinutes: {
    type: Number,
    default: 0
  }
}, { 
  timestamps: true 
});

// Index for efficient queries
assignmentSubmissionSchema.index({ assignment: 1, student: 1 });
assignmentSubmissionSchema.index({ status: 1, isPassed: 1 });
assignmentSubmissionSchema.index({ submittedAt: 1, reviewedAt: 1 });

// Compound index for unique submissions per student per assignment
assignmentSubmissionSchema.index({ assignment: 1, student: 1, attempts: 1 }, { unique: true });

// Pre-save middleware to calculate total score and percentage
assignmentSubmissionSchema.pre('save', function(next) {
  if (this.isModified('scores')) {
    const scores = this.scores;
    this.totalScore = (scores.pronunciation || 0) + (scores.fluency || 0) + (scores.clarity || 0) + (scores.expression || 0);
    
    // Get assignment to calculate percentage
    if (this.assignment) {
      this.populate('assignment').then(() => {
        if (this.assignment && this.assignment.totalMarks) {
          this.percentage = (this.totalScore / this.assignment.totalMarks) * 100;
          this.isPassed = this.percentage >= (this.assignment.passingMarks || 40);
        }
        next();
      }).catch(next);
    } else {
      this.percentage = 0;
      this.isPassed = false;
      next();
    }
  } else {
    next();
  }
});

module.exports = mongoose.model('AssignmentSubmission', assignmentSubmissionSchema); 