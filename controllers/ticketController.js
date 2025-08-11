const express = require('express');
const Ticket = require('../model/ticketModel');
const Student = require('../model/studentModel');
const Admin = require('../model/adminModel');
const { ticketUploadMiddleware } = require('../utils/multerConfig');

const router = express.Router();

// Student: Create a new ticket
router.post('/create', ticketUploadMiddleware, async (req, res) => {
  try {
    // console.log('Ticket creation request received');
    // console.log('Request body:', req.body);
    // console.log('Request file:', req.file);
    
    const { emailOrPhone, subject, description, category, priority } = req.body;
    
    if (!emailOrPhone || !subject || !description || !category) {
      // console.log('Missing required fields:', { emailOrPhone, subject, description, category });
      return res.status(400).json({ message: 'All required fields must be provided' });
    }

    // Find student
    const student = await Student.findOne({
      $or: [{ email: emailOrPhone }, { phone: emailOrPhone }]
    });

    // console.log('Student search result:', student);

    if (!student) {
      // console.log('Student not found for:', emailOrPhone);
      return res.status(404).json({ message: 'Student not found' });
    }

    // Generate ticket ID
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    let ticketId = `TKT-${timestamp}-${random}`;

    // Check if ticket ID already exists
    const existingTicket = await Ticket.findOne({ ticketId });
    if (existingTicket) {
      // console.log('Ticket ID already exists, generating new one');
      const newRandom = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      ticketId = `TKT-${timestamp}-${newRandom}`;
    }

    // console.log('Creating ticket with ID:', ticketId);
    // console.log('Student ID:', student._id);
    // console.log('Subject:', subject);
    // console.log('Category:', category);
    // console.log('Priority:', priority || 'medium');

    // Create ticket
    const ticket = new Ticket({
      ticketId,
      studentId: student._id,
      subject,
      description,
      category,
      priority: priority || 'medium',
      attachments: req.file ? [{
        filename: req.file.originalname,
        url: req.file.location
      }] : []
    });

    // console.log('Ticket object before save:', ticket);
    await ticket.save();
    // console.log('Ticket saved successfully');

    // Populate student details for response
    await ticket.populate('studentId', 'fullName email phone enrollmentId program');

    res.status(201).json({
      message: 'Ticket created successfully',
      ticket: {
        ...ticket.toObject(),
        student: ticket.studentId
      }
    });

  } catch (err) {
    console.error('Error creating ticket:', err);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ 
        message: 'Validation error', 
        details: Object.values(err.errors).map(e => e.message).join(', ')
      });
    }
    res.status(500).json({ message: 'Failed to create ticket' });
  }
});

// Student: Get all tickets for a student
router.post('/student-tickets', async (req, res) => {
  try {
    const { emailOrPhone } = req.body;
    
    if (!emailOrPhone) {
      return res.status(400).json({ message: 'Email or phone is required' });
    }

    const student = await Student.findOne({
      $or: [{ email: emailOrPhone }, { phone: emailOrPhone }]
    });

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const tickets = await Ticket.find({ studentId: student._id })
      .sort({ createdAt: -1 });

    res.json({ tickets });

  } catch (err) {
    console.error('Error fetching student tickets:', err);
    res.status(500).json({ message: 'Failed to fetch tickets' });
  }
});

// Student: Get specific ticket details
router.get('/ticket/:ticketId', async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { emailOrPhone } = req.query;

    if (!emailOrPhone) {
      return res.status(400).json({ message: 'Email or phone is required' });
    }

    const student = await Student.findOne({
      $or: [{ email: emailOrPhone }, { phone: emailOrPhone }]
    });

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const ticket = await Ticket.findOne({ 
      ticketId, 
      studentId: student._id 
    }).populate('studentId', 'fullName email phone enrollmentId program');

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    res.json({ ticket });

  } catch (err) {
    console.error('Error fetching ticket details:', err);
    res.status(500).json({ message: 'Failed to fetch ticket details' });
  }
});

// Admin: Get all tickets (with filters)
router.get('/admin/tickets', async (req, res) => {
  try {
    const { status, category, priority, page = 1, limit = 20 } = req.query;
    
    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (priority) filter.priority = priority;

    const skip = (page - 1) * limit;

    const tickets = await Ticket.find(filter)
      .populate('studentId', 'fullName email phone enrollmentId program country')
      .populate('adminResponse.respondedBy', 'fullName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Ticket.countDocuments(filter);

    res.json({
      tickets,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        totalTickets: total
      }
    });

  } catch (err) {
    console.error('Error fetching admin tickets:', err);
    res.status(500).json({ message: 'Failed to fetch tickets' });
  }
});

// Admin: Get ticket statistics
router.get('/admin/stats', async (req, res) => {
  try {
    const stats = await Ticket.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const categoryStats = await Ticket.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      }
    ]);

    const priorityStats = await Ticket.aggregate([
      {
        $group: {
          _id: '$priority',
          count: { $sum: 1 }
        }
      }
    ]);

    const totalTickets = await Ticket.countDocuments();
    const openTickets = await Ticket.countDocuments({ status: 'open' });
    const urgentTickets = await Ticket.countDocuments({ priority: 'urgent', status: { $ne: 'closed' } });

    res.json({
      totalTickets,
      openTickets,
      urgentTickets,
      statusStats: stats,
      categoryStats,
      priorityStats
    });

  } catch (err) {
    console.error('Error fetching ticket stats:', err);
    res.status(500).json({ message: 'Failed to fetch ticket statistics' });
  }
});

// Admin: Update ticket status
router.put('/admin/ticket/:ticketId/status', async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { status, adminId } = req.body;

    if (!status || !adminId) {
      return res.status(400).json({ message: 'Status and admin ID are required' });
    }

    const ticket = await Ticket.findOne({ ticketId });
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    ticket.status = status;
    
    if (status === 'resolved') {
      ticket.resolvedAt = new Date();
    } else if (status === 'closed') {
      ticket.closedAt = new Date();
    }

    await ticket.save();

    await ticket.populate('studentId', 'fullName email phone enrollmentId program');

    res.json({
      message: 'Ticket status updated successfully',
      ticket
    });

  } catch (err) {
    console.error('Error updating ticket status:', err);
    res.status(500).json({ message: 'Failed to update ticket status' });
  }
});

// Admin: Respond to ticket
router.put('/admin/ticket/:ticketId/respond', async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { message, adminId } = req.body;

    if (!message || !adminId) {
      return res.status(400).json({ message: 'Message and admin ID are required' });
    }

    const ticket = await Ticket.findOne({ ticketId });
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    ticket.adminResponse = {
      message,
      respondedBy: adminId,
      respondedAt: new Date()
    };

    // Update status to in_progress if it was open
    if (ticket.status === 'open') {
      ticket.status = 'in_progress';
    }

    await ticket.save();

    await ticket.populate('studentId', 'fullName email phone enrollmentId program');
    await ticket.populate('adminResponse.respondedBy', 'fullName email');

    res.json({
      message: 'Response added successfully',
      ticket
    });

  } catch (err) {
    console.error('Error responding to ticket:', err);
    res.status(500).json({ message: 'Failed to add response' });
  }
});

// Admin: Get specific ticket details
router.get('/admin/ticket/:ticketId', async (req, res) => {
  try {
    const { ticketId } = req.params;

    const ticket = await Ticket.findOne({ ticketId })
      .populate('studentId', 'fullName email phone enrollmentId program country profilePicture')
      .populate('adminResponse.respondedBy', 'fullName email');

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    res.json({ ticket });

  } catch (err) {
    console.error('Error fetching admin ticket details:', err);
    res.status(500).json({ message: 'Failed to fetch ticket details' });
  }
});

// Test endpoint
router.get('/test', (req, res) => {
  res.json({ message: 'Ticket system is working' });
});

module.exports = router;
