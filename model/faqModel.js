const mongoose = require('mongoose');

const faqSchema = new mongoose.Schema({
  question: {
    type: String,
    required: true,
    trim: true
  },
  answer: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    required: true,
    enum: ['general', 'classes', 'assignments', 'materials', 'progress', 'technical', 'account', 'support'],
    default: 'general'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  priority: {
    type: Number,
    default: 0,
    min: 0,
    max: 10
  },
  addedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  },
  tags: [{
    type: String,
    trim: true
  }],
  viewCount: {
    type: Number,
    default: 0
  },
  helpfulCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Index for better search performance
faqSchema.index({ question: 'text', answer: 'text', tags: 'text' });
faqSchema.index({ category: 1, isActive: 1 });
faqSchema.index({ priority: -1, createdAt: -1 });

// Virtual for formatted category name
faqSchema.virtual('categoryName').get(function() {
  const categoryNames = {
    general: 'General Questions',
    classes: 'Classes & Attendance',
    assignments: 'Assignments & Quizzes',
    materials: 'Study Materials & Files',
    progress: 'Progress & Certificates',
    technical: 'Technical Issues',
    account: 'Account & Profile',
    support: 'Support & Contact'
  };
  return categoryNames[this.category] || this.category;
});

// Ensure virtuals are serialized
faqSchema.set('toJSON', { virtuals: true });
faqSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('FAQ', faqSchema);
