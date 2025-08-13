const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  studentEmail: {
    type: String,
    required: true
  },
  studentName: {
    type: String,
    required: true
  },
  program: {
    type: String,
    enum: ['24-session', '48-session'],
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'INR'
  },
  razorpayOrderId: {
    type: String,
    required: true,
    unique: true
  },
  razorpayPaymentId: {
    type: String,
    sparse: true
  },
  razorpaySignature: {
    type: String,
    sparse: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    default: 'razorpay'
  },
  description: {
    type: String,
    default: 'Course enrollment payment'
  },
  receipt: {
    type: String
  },
  notes: {
    type: String
  },
  adminNotes: {
    type: String
  },
  refundAmount: {
    type: Number,
    default: 0
  },
  refundReason: {
    type: String
  },
  refundedAt: {
    type: Date
  },
  refundedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  isRefunded: {
    type: Boolean,
    default: false
  },
  paymentDate: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date
  },
  failedAt: {
    type: Date
  },
  failureReason: {
    type: String
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true
});

// Index for better query performance
paymentSchema.index({ studentId: 1, status: 1 });
paymentSchema.index({ razorpayOrderId: 1 });
paymentSchema.index({ razorpayPaymentId: 1 });
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ studentEmail: 1 });

// Virtual for formatted amount
paymentSchema.virtual('formattedAmount').get(function() {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: this.currency
  }).format(this.amount / 100); // Razorpay amounts are in paise
});

// Virtual for payment status with color
paymentSchema.virtual('statusColor').get(function() {
  switch (this.status) {
    case 'completed': return 'green';
    case 'pending': return 'orange';
    case 'failed': return 'red';
    case 'refunded': return 'blue';
    default: return 'gray';
  }
});

// Method to check if payment is recent (within 24 hours)
paymentSchema.methods.isRecent = function() {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return this.createdAt > twentyFourHoursAgo;
};

// Method to get payment summary
paymentSchema.methods.getSummary = function() {
  return {
    _id: this._id,
    id: this._id,
    studentName: this.studentName,
    studentEmail: this.studentEmail,
    program: this.program,
    amount: this.amount,
    currency: this.currency,
    status: this.status,
    paymentDate: this.paymentDate,
    razorpayOrderId: this.razorpayOrderId,
    razorpayPaymentId: this.razorpayPaymentId
  };
};

module.exports = mongoose.model('Payment', paymentSchema);

