const express = require('express');
const FAQ = require('../model/faqModel');
const Admin = require('../model/adminModel');

const router = express.Router();

// Middleware for admin authentication
const adminAuth = require('../middlewares/adminAuth');
// Middleware for student authentication
const studentAuth = require('../middlewares/studentAuth');

// Get all active admin FAQs (for students)
const getAdminFAQs = async (req, res) => {
  try {
    const faqs = await FAQ.find({ isActive: true })
      .populate('addedBy', 'fullName')
      .sort({ priority: -1, createdAt: -1 })
      .select('-__v');

    res.status(200).json({
      success: true,
      message: 'FAQs retrieved successfully',
      faqs: faqs
    });
  } catch (error) {
    console.error('Error fetching FAQs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch FAQs',
      error: error.message
    });
  }
};

// Get all FAQs (for admin)
const getAllFAQs = async (req, res) => {
  try {
    const { page = 1, limit = 10, category, search, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    const query = {};
    
    // Filter by category
    if (category && category !== 'all') {
      query.category = category;
    }

    // Search functionality
    if (search) {
      query.$text = { $search: search };
    }

    // Sorting
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const faqs = await FAQ.find(query)
      .populate('addedBy', 'fullName email')
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('-__v');

    const total = await FAQ.countDocuments(query);

    res.status(200).json({
      success: true,
      message: 'FAQs retrieved successfully',
      faqs: faqs,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalFAQs: total,
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    console.error('Error fetching all FAQs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch FAQs',
      error: error.message
    });
  }
};

// Create new FAQ (admin only)
const createFAQ = async (req, res) => {
  try {
    const { question, answer, category, priority = 0, tags = [] } = req.body;
    const adminId = req.admin._id;

    // Validate required fields
    if (!question || !answer || !category) {
      return res.status(400).json({
        success: false,
        message: 'Question, answer, and category are required'
      });
    }

    // Validate category
    const validCategories = ['general', 'classes', 'assignments', 'materials', 'progress', 'technical', 'account', 'support'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category. Must be one of: ' + validCategories.join(', ')
      });
    }

    const newFAQ = new FAQ({
      question: question.trim(),
      answer: answer.trim(),
      category,
      priority: parseInt(priority) || 0,
      tags: tags.filter(tag => tag.trim()),
      addedBy: adminId
    });

    await newFAQ.save();

    const populatedFAQ = await FAQ.findById(newFAQ._id)
      .populate('addedBy', 'fullName email');

    res.status(201).json({
      success: true,
      message: 'FAQ created successfully',
      faq: populatedFAQ
    });
  } catch (error) {
    console.error('Error creating FAQ:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create FAQ',
      error: error.message
    });
  }
};

// Update FAQ (admin only)
const updateFAQ = async (req, res) => {
  try {
    const { id } = req.params;
    const { question, answer, category, priority, tags, isActive } = req.body;

    const faq = await FAQ.findById(id);
    if (!faq) {
      return res.status(404).json({
        success: false,
        message: 'FAQ not found'
      });
    }

    // Update fields if provided
    if (question !== undefined) faq.question = question.trim();
    if (answer !== undefined) faq.answer = answer.trim();
    if (category !== undefined) {
      const validCategories = ['general', 'classes', 'assignments', 'materials', 'progress', 'technical', 'account', 'support'];
      if (!validCategories.includes(category)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid category. Must be one of: ' + validCategories.join(', ')
        });
      }
      faq.category = category;
    }
    if (priority !== undefined) faq.priority = parseInt(priority) || 0;
    if (tags !== undefined) faq.tags = tags.filter(tag => tag.trim());
    if (isActive !== undefined) faq.isActive = isActive;

    await faq.save();

    const updatedFAQ = await FAQ.findById(id)
      .populate('addedBy', 'fullName email');

    res.status(200).json({
      success: true,
      message: 'FAQ updated successfully',
      faq: updatedFAQ
    });
  } catch (error) {
    console.error('Error updating FAQ:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update FAQ',
      error: error.message
    });
  }
};

// Delete FAQ (admin only)
const deleteFAQ = async (req, res) => {
  try {
    const { id } = req.params;

    const faq = await FAQ.findById(id);
    if (!faq) {
      return res.status(404).json({
        success: false,
        message: 'FAQ not found'
      });
    }

    await FAQ.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'FAQ deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting FAQ:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete FAQ',
      error: error.message
    });
  }
};

// Get FAQ by ID
const getFAQById = async (req, res) => {
  try {
    const { id } = req.params;

    const faq = await FAQ.findById(id)
      .populate('addedBy', 'fullName email');

    if (!faq) {
      return res.status(404).json({
        success: false,
        message: 'FAQ not found'
      });
    }

    // Increment view count for students
    if (req.student) {
      faq.viewCount += 1;
      await faq.save();
    }

    res.status(200).json({
      success: true,
      message: 'FAQ retrieved successfully',
      faq: faq
    });
  } catch (error) {
    console.error('Error fetching FAQ by ID:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch FAQ',
      error: error.message
    });
  }
};

// Mark FAQ as helpful (students only)
const markAsHelpful = async (req, res) => {
  try {
    const { id } = req.params;

    const faq = await FAQ.findById(id);
    if (!faq) {
      return res.status(404).json({
        success: false,
        message: 'FAQ not found'
      });
    }

    faq.helpfulCount += 1;
    await faq.save();

    res.status(200).json({
      success: true,
      message: 'FAQ marked as helpful',
      helpfulCount: faq.helpfulCount
    });
  } catch (error) {
    console.error('Error marking FAQ as helpful:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark FAQ as helpful',
      error: error.message
    });
  }
};

// Get FAQ statistics (admin only)
const getFAQStats = async (req, res) => {
  try {
    const stats = await FAQ.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          activeCount: {
            $sum: { $cond: ['$isActive', 1, 0] }
          },
          totalViews: { $sum: '$viewCount' },
          totalHelpful: { $sum: '$helpfulCount' }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    const totalFAQs = await FAQ.countDocuments();
    const activeFAQs = await FAQ.countDocuments({ isActive: true });
    const totalViews = await FAQ.aggregate([
      { $group: { _id: null, total: { $sum: '$viewCount' } } }
    ]);

    res.status(200).json({
      success: true,
      message: 'FAQ statistics retrieved successfully',
      stats: {
        totalFAQs,
        activeFAQs,
        totalViews: totalViews[0]?.total || 0,
        categoryStats: stats
      }
    });
  } catch (error) {
    console.error('Error fetching FAQ statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch FAQ statistics',
      error: error.message
    });
  }
};

// Student routes (no authentication required for viewing FAQs)
router.get('/admin-faqs', getAdminFAQs);
router.get('/:id', getFAQById);
router.post('/:id/helpful', studentAuth, markAsHelpful);

// Admin routes (require authentication)
router.get('/admin/all', adminAuth, getAllFAQs);
router.post('/admin/create', adminAuth, createFAQ);
router.put('/admin/:id', adminAuth, updateFAQ);
router.delete('/admin/:id', adminAuth, deleteFAQ);
router.get('/admin/stats', adminAuth, getFAQStats);

module.exports = router;
