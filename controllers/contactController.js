const express = require('express');
const Contact = require('../model/contactModel');
const Admin = require('../model/adminModel');
const { sendContactNotificationEmail } = require('../utils/emailService');

const router = express.Router();

// Submit contact form
router.post('/submit', async (req, res) => {
  try {
    const { 
      studentName, 
      studentEmail, 
      studentPhone, 
      service, 
      message, 
      degree 
    } = req.body;

    // Validate required fields
    if (!studentName || !studentEmail || !studentPhone || !service || !message) {
      return res.status(400).json({ message: 'All required fields must be provided' });
    }

    // Create contact record
    const contact = new Contact({
      studentName,
      studentEmail,
      studentPhone,
      service,
      message,
      degree
    });

    await contact.save();

    // Get all admin emails
    const admins = await Admin.find({}, 'email fullName');
    
    // Send email notification to all admins
    if (admins.length > 0) {
      try {
        await sendContactNotificationEmail({
          admins: admins.map(admin => ({ email: admin.email, name: admin.fullName })),
          contactData: {
            studentName,
            studentEmail,
            studentPhone,
            service,
            message,
            degree
          }
        });

        // Update contact record to mark email as sent
        contact.emailSent = true;
        contact.emailSentAt = new Date();
        await contact.save();
      } catch (emailError) {
        console.error('Error sending contact notification emails:', emailError);
        // Don't fail the request if email fails
      }
    }

    res.status(201).json({
      message: 'Contact form submitted successfully',
      contactId: contact._id
    });

  } catch (err) {
    console.error('Error submitting contact form:', err);
    res.status(500).json({ message: 'Failed to submit contact form' });
  }
});

// Admin: Get all contact submissions
router.get('/admin/contacts', async (req, res) => {
  try {
    const { status, service, page = 1, limit = 20 } = req.query;
    
    const filter = {};
    if (status) filter.status = status;
    if (service) filter.service = service;

    const skip = (page - 1) * limit;

    const contacts = await Contact.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Contact.countDocuments(filter);

    res.json({
      contacts,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        totalContacts: total
      }
    });

  } catch (err) {
    console.error('Error fetching contacts:', err);
    res.status(500).json({ message: 'Failed to fetch contacts' });
  }
});

// Admin: Get contact statistics
router.get('/admin/stats', async (req, res) => {
  try {
    const stats = await Contact.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const serviceStats = await Contact.aggregate([
      {
        $group: {
          _id: '$service',
          count: { $sum: 1 }
        }
      }
    ]);

    const totalContacts = await Contact.countDocuments();
    const newContacts = await Contact.countDocuments({ status: 'new' });
    const unreadContacts = await Contact.countDocuments({ isRead: false });

    res.json({
      totalContacts,
      newContacts,
      unreadContacts,
      statusStats: stats,
      serviceStats
    });

  } catch (err) {
    console.error('Error fetching contact stats:', err);
    res.status(500).json({ message: 'Failed to fetch contact statistics' });
  }
});

// Admin: Get specific contact details
router.get('/admin/contact/:contactId', async (req, res) => {
  try {
    const { contactId } = req.params;

    const contact = await Contact.findById(contactId);
    if (!contact) {
      return res.status(404).json({ message: 'Contact not found' });
    }

    // Mark as read
    if (!contact.isRead) {
      contact.isRead = true;
      await contact.save();
    }

    // Fetch student details from Student collection
    const Student = require('../model/studentModel');
    const student = await Student.findOne({ 
      $or: [
        { email: contact.studentEmail },
        { phone: contact.studentPhone }
      ]
    });

    res.json({ 
      contact,
      student: student || null
    });

  } catch (err) {
    console.error('Error fetching contact details:', err);
    res.status(500).json({ message: 'Failed to fetch contact details' });
  }
});

// Admin: Update contact status
router.put('/admin/contact/:contactId/status', async (req, res) => {
  try {
    const { contactId } = req.params;
    const { status, adminId } = req.body;

    if (!status || !adminId) {
      return res.status(400).json({ message: 'Status and admin ID are required' });
    }

    const contact = await Contact.findById(contactId);
    if (!contact) {
      return res.status(404).json({ message: 'Contact not found' });
    }

    contact.status = status;
    await contact.save();

    res.json({
      message: 'Contact status updated successfully',
      contact
    });

  } catch (err) {
    console.error('Error updating contact status:', err);
    res.status(500).json({ message: 'Failed to update contact status' });
  }
});

// Admin: Respond to contact
router.put('/admin/contact/:contactId/respond', async (req, res) => {
  try {
    const { contactId } = req.params;
    const { message, adminId } = req.body;

    if (!message || !adminId) {
      return res.status(400).json({ message: 'Message and admin ID are required' });
    }

    const contact = await Contact.findById(contactId);
    if (!contact) {
      return res.status(404).json({ message: 'Contact not found' });
    }

    contact.adminResponse = {
      message,
      respondedBy: adminId,
      respondedAt: new Date()
    };

    // Update status to responded if it was new or in_progress
    if (contact.status === 'new' || contact.status === 'in_progress') {
      contact.status = 'responded';
    }

    await contact.save();

    res.json({
      message: 'Response added successfully',
      contact
    });

  } catch (err) {
    console.error('Error responding to contact:', err);
    res.status(500).json({ message: 'Failed to add response' });
  }
});

// Admin: Mark contact as read
router.put('/admin/contact/:contactId/read', async (req, res) => {
  try {
    const { contactId } = req.params;

    const contact = await Contact.findById(contactId);
    if (!contact) {
      return res.status(404).json({ message: 'Contact not found' });
    }

    contact.isRead = true;
    await contact.save();

    res.json({
      message: 'Contact marked as read',
      contact
    });

  } catch (err) {
    console.error('Error marking contact as read:', err);
    res.status(500).json({ message: 'Failed to mark contact as read' });
  }
});

module.exports = router;
