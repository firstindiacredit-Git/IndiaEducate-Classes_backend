const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const Payment = require('../model/paymentModel');
const Student = require('../model/studentModel');
const Admin = require('../model/adminModel');

const router = express.Router();

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Program pricing (in paise - Razorpay expects amounts in smallest currency unit)
const PROGRAM_PRICES = {
  '24-session': 100, // ₹1 in paise (for testing)
  '48-session': 100, // ₹1 in paise (for testing)
};

// Create payment order
router.post('/create-order', async (req, res) => {
  try {
    const { studentId, program, studentEmail, studentName } = req.body;

    // Validate required fields
    if (!studentId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Student ID is required' 
      });
    }
    
    if (!program) {
      return res.status(400).json({ 
        success: false, 
        message: 'Program selection is required' 
      });
    }
    
    if (!studentEmail) {
      return res.status(400).json({ 
        success: false, 
        message: 'Student email is required' 
      });
    }
    
    if (!studentName) {
      return res.status(400).json({ 
        success: false, 
        message: 'Student name is required' 
      });
    }

    if (!PROGRAM_PRICES[program]) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid program selected' 
      });
    }

    const amount = PROGRAM_PRICES[program];
    const currency = 'INR';

    // Create Razorpay order with short, compliant receipt (<= 40 chars)
    const shortReceipt = `rcpt_${Date.now().toString(36)}_${studentId.toString().slice(-6)}`;
    const orderOptions = {
      amount: amount,
      currency: currency,
      receipt: shortReceipt,
      notes: {
        studentId: studentId,
        studentEmail: studentEmail,
        program: program
      }
    };

    const order = await razorpay.orders.create(orderOptions);

    // Save payment record in database
    const payment = new Payment({
      studentId: studentId,
      studentEmail: studentEmail,
      studentName: studentName,
      program: program,
      amount: amount,
      currency: currency,
      razorpayOrderId: order.id,
      status: 'pending',
      description: `${program} program enrollment payment`
    });

    await payment.save();

    res.json({
      success: true,
      orderId: order.id,
      amount: amount,
      currency: currency,
      key: process.env.RAZORPAY_KEY_ID,
      paymentId: payment._id
    });

  } catch (error) {
    console.error('Error creating payment order:', error);
    
    // Provide more specific error messages
    let errorMessage = 'Failed to create payment order';
    if (error.error && error.error.description) {
      errorMessage = error.error.description;
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    res.status(500).json({ 
      success: false, 
      message: errorMessage,
      error: error
    });
  }
});

// Verify payment signature
router.post('/verify-payment', async (req, res) => {
  try {
    const { 
      razorpayOrderId, 
      razorpayPaymentId, 
      razorpaySignature,
      paymentId 
    } = req.body;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !paymentId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing payment verification data' 
      });
    }

    // Verify signature
    const body = razorpayOrderId + "|" + razorpayPaymentId;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpaySignature) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid payment signature' 
      });
    }

    // Update payment record
    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({ 
        success: false, 
        message: 'Payment record not found' 
      });
    }

    if (payment.status === 'completed') {
      return res.json({ 
        success: true, 
        message: 'Payment already verified' 
      });
    }

    payment.razorpayPaymentId = razorpayPaymentId;
    payment.razorpaySignature = razorpaySignature;
    payment.status = 'completed';
    payment.completedAt = new Date();
    payment.receipt = `receipt_${razorpayPaymentId}`;

    await payment.save();

    // Update student program if not already set
    const student = await Student.findById(payment.studentId);
    if (student && !student.program) {
      student.program = payment.program;
      await student.save();
    }

    res.json({
      success: true,
      message: 'Payment verified successfully',
      payment: payment.getSummary()
    });

  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to verify payment' 
    });
  }
});

// Get payment status
router.get('/status/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    
    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({ 
        success: false, 
        message: 'Payment not found' 
      });
    }

    res.json({
      success: true,
      payment: payment.getSummary()
    });

  } catch (error) {
    console.error('Error getting payment status:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get payment status' 
    });
  }
});

// Get student payment history
router.get('/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const { page = 1, limit = 10, status } = req.query;

    const query = { studentId };
    if (status) {
      query.status = status;
    }

    const payments = await Payment.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const total = await Payment.countDocuments(query);

    res.json({
      success: true,
      payments: payments.map(payment => payment.getSummary()),
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });

  } catch (error) {
    console.error('Error getting student payments:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get payment history' 
    });
  }
});

// Admin: Get all payments
router.get('/admin/all', async (req, res) => {
  try {
    const { page = 1, limit = 20, status, program, search } = req.query;

    const query = {};
    if (status) query.status = status;
    if (program) query.program = program;
    if (search) {
      query.$or = [
        { studentName: { $regex: search, $options: 'i' } },
        { studentEmail: { $regex: search, $options: 'i' } },
        { razorpayOrderId: { $regex: search, $options: 'i' } },
        { razorpayPaymentId: { $regex: search, $options: 'i' } }
      ];
    }

    const payments = await Payment.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('studentId', 'fullName email phone')
      .exec();

    const total = await Payment.countDocuments(query);

    // Calculate summary statistics
    const stats = await Payment.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$amount' },
          completedAmount: { 
            $sum: { 
              $cond: [{ $eq: ['$status', 'completed'] }, '$amount', 0] 
            } 
          },
          pendingAmount: { 
            $sum: { 
              $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] 
            } 
          },
          failedAmount: { 
            $sum: { 
              $cond: [{ $eq: ['$status', 'failed'] }, '$amount', 0] 
            } 
          },
          refundedAmount: { 
            $sum: { 
              $cond: [{ $eq: ['$status', 'refunded'] }, '$amount', 0] 
            } 
          }
        }
      }
    ]);

    res.json({
      success: true,
      payments: payments.map(payment => ({
        ...payment.getSummary(),
        student: payment.studentId
      })),
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total,
      stats: stats[0] || {
        totalAmount: 0,
        completedAmount: 0,
        pendingAmount: 0,
        failedAmount: 0,
        refundedAmount: 0
      }
    });

  } catch (error) {
    console.error('Error getting all payments:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get payments' 
    });
  }
});

// Admin: Get payment details
router.get('/admin/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    
    // Validate paymentId
    if (!paymentId || paymentId === 'undefined') {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid payment ID' 
      });
    }
    
    const payment = await Payment.findById(paymentId)
      .populate('studentId', 'fullName email phone country enrollmentId')
      .populate('refundedBy', 'fullName email');

    if (!payment) {
      return res.status(404).json({ 
        success: false, 
        message: 'Payment not found' 
      });
    }

    res.json({
      success: true,
      payment: {
        ...payment.toObject(),
        formattedAmount: payment.formattedAmount,
        statusColor: payment.statusColor,
        isRecent: payment.isRecent()
      }
    });

  } catch (error) {
    console.error('Error getting payment details:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get payment details' 
    });
  }
});

// Admin: Update payment notes
router.put('/admin/:paymentId/notes', async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { adminNotes } = req.body;
    const adminId = req.body.adminId; // You'll need to get this from auth middleware

    if (!adminId) {
      return res.status(401).json({ 
        success: false, 
        message: 'Admin authentication required' 
      });
    }

    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({ 
        success: false, 
        message: 'Payment not found' 
      });
    }

    payment.adminNotes = adminNotes;
    await payment.save();

    res.json({
      success: true,
      message: 'Payment notes updated successfully',
      payment: payment.getSummary()
    });

  } catch (error) {
    console.error('Error updating payment notes:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update payment notes' 
    });
  }
});

// Admin: Process refund
router.post('/admin/:paymentId/refund', async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { refundAmount, refundReason, adminId } = req.body;

    if (!adminId) {
      return res.status(401).json({ 
        success: false, 
        message: 'Admin authentication required' 
      });
    }

    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({ 
        success: false, 
        message: 'Payment not found' 
      });
    }

    if (payment.status !== 'completed') {
      return res.status(400).json({ 
        success: false, 
        message: 'Only completed payments can be refunded' 
      });
    }

    if (payment.isRefunded) {
      return res.status(400).json({ 
        success: false, 
        message: 'Payment already refunded' 
      });
    }

    const refundAmountNum = parseInt(refundAmount);
    if (refundAmountNum > payment.amount) {
      return res.status(400).json({ 
        success: false, 
        message: 'Refund amount cannot exceed payment amount' 
      });
    }

    // Process refund through Razorpay
    const refund = await razorpay.payments.refund(payment.razorpayPaymentId, {
      amount: refundAmountNum,
      notes: {
        reason: refundReason,
        adminId: adminId
      }
    });

    // Update payment record
    payment.status = 'refunded';
    payment.refundAmount = refundAmountNum;
    payment.refundReason = refundReason;
    payment.refundedAt = new Date();
    payment.refundedBy = adminId;
    payment.isRefunded = true;

    await payment.save();

    res.json({
      success: true,
      message: 'Refund processed successfully',
      refund: {
        id: refund.id,
        amount: refund.amount,
        status: refund.status
      },
      payment: payment.getSummary()
    });

  } catch (error) {
    console.error('Error processing refund:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process refund' 
    });
  }
});

// Get payment statistics for dashboard
router.get('/stats', async (req, res) => {
  try {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const stats = await Payment.aggregate([
      {
        $facet: {
          total: [
            { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } }
          ],
          today: [
            { $match: { createdAt: { $gte: startOfDay } } },
            { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } }
          ],
          thisMonth: [
            { $match: { createdAt: { $gte: startOfMonth } } },
            { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } }
          ],
          byStatus: [
            { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } }
          ],
          byProgram: [
            { $group: { _id: '$program', count: { $sum: 1 }, amount: { $sum: '$amount' } } }
          ]
        }
      }
    ]);

    const result = {
      total: stats[0].total[0] || { count: 0, amount: 0 },
      today: stats[0].today[0] || { count: 0, amount: 0 },
      thisMonth: stats[0].thisMonth[0] || { count: 0, amount: 0 },
      byStatus: stats[0].byStatus,
      byProgram: stats[0].byProgram
    };

    res.json({
      success: true,
      stats: result
    });

  } catch (error) {
    console.error('Error getting payment stats:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get payment statistics' 
    });
  }
});

module.exports = router;

