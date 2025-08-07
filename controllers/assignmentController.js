const express = require('express');
const Assignment = require('../model/assignmentModel');
const AssignmentSubmission = require('../model/assignmentSubmissionModel');
const Student = require('../model/studentModel');
const Admin = require('../model/adminModel');

const router = express.Router();

// Helper function to calculate week number
function getWeekNumber(date) {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date - startOfYear) / (24 * 60 * 60 * 1000));
  return Math.ceil((days + startOfYear.getDay() + 1) / 7);
}

// Helper function to send assignment notifications
const sendAssignmentNotifications = async (assignmentId, adminEmailOrPhone, protocol, host) => {
  try {
    // Make API call to notification service
    const response = await fetch(`${protocol}://${host}/api/notifications/assignment-created`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        assignmentId: assignmentId,
        adminEmailOrPhone: adminEmailOrPhone
      })
    });

    if (!response.ok) {
      console.error('Failed to send assignment notifications');
    }
  } catch (error) {
    console.error('Error sending assignment notifications:', error);
  }
};

// Helper function to send assignment review notifications
const sendAssignmentReviewNotifications = async (submission, adminEmailOrPhone, protocol, host) => {
  try {
    const student = await Student.findById(submission.student);
    const assignment = await Assignment.findById(submission.assignment);
    
    if (!student || !assignment) {
      return;
    }

    // Make API call to notification service
    const response = await fetch(`${protocol}://${host}/api/notifications/assignment-reviewed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        studentEmail: student.email,
        assignmentTitle: assignment.title,
        score: submission.totalScore,
        totalMarks: assignment.totalMarks,
        isPassed: submission.isPassed,
        adminFeedback: submission.adminFeedback
      })
    });

    if (!response.ok) {
      console.error('Failed to send assignment review notifications');
    }
  } catch (error) {
    console.error('Error sending assignment review notifications:', error);
  }
};

// Create Assignment (Admin only)
router.post('/create', async (req, res) => {
  try {
    const { 
      title, 
      description, 
      paragraph,
      type, 
      subject, 
      language, 
      duration, 
      maxFileSize,
      allowedFormats,
      startDate, 
      endDate, 
      assignedTo,
      weekNumber,
      instructions,
      rubric,
      totalMarks,
      passingMarks,
      adminEmailOrPhone 
    } = req.body;

    // Validate required fields
    if (!title || !description || !paragraph || !type || !subject || !language || !duration || !startDate || !endDate) {
      return res.status(400).json({ message: 'All required fields must be provided' });
    }

    // Find admin
    const admin = await Admin.findOne({
      $or: [{ email: adminEmailOrPhone }, { phone: adminEmailOrPhone }]
    });

    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    // Validate type
    if (!['audio', 'video'].includes(type)) {
      return res.status(400).json({ message: 'Type must be either audio or video' });
    }

    // Validate passing marks
    if (passingMarks > totalMarks) {
      return res.status(400).json({ message: 'Passing marks cannot exceed total marks' });
    }

    // Create assignment
    const assignment = new Assignment({
      title,
      description,
      paragraph,
      type,
      subject,
      language,
      duration,
      maxFileSize: maxFileSize || 100,
      allowedFormats: allowedFormats || (type === 'audio' ? ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'webm'] : ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm']),
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      createdBy: admin._id,
      assignedTo: assignedTo || [],
      weekNumber: weekNumber || getWeekNumber(new Date(startDate)),
      year: new Date().getFullYear(),
      instructions,
      rubric: rubric || {
        pronunciation: 25,
        fluency: 25,
        clarity: 25,
        expression: 25
      },
      totalMarks: totalMarks || 100,
      passingMarks: passingMarks || 40
    });

    await assignment.save();

    // Send notifications to students
    setTimeout(() => {
      sendAssignmentNotifications(assignment._id, adminEmailOrPhone, req.protocol, req.get('host'));
    }, 100);

    res.status(201).json({ 
      message: 'Assignment created successfully', 
      assignment 
    });
  } catch (err) {
    console.error('Error creating assignment:', err);
    res.status(500).json({ message: err.message });
  }
});

// Get all assignments (Admin)
router.get('/all', async (req, res) => {
  try {
    const { type, subject, isActive, isPublished } = req.query;
    
    const filter = {};
    if (type) filter.type = type;
    if (subject) filter.subject = subject;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (isPublished !== undefined) filter.isPublished = isPublished === 'true';

    const assignments = await Assignment.find(filter)
      .populate('createdBy', 'fullName email')
      .populate('assignedTo', 'fullName email')
      .sort({ createdAt: -1 });

    res.json(assignments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get assignment by ID
router.get('/:id', async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id)
      .populate('createdBy', 'fullName email')
      .populate('assignedTo', 'fullName email');

    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    res.json(assignment);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update assignment
router.put('/:id', async (req, res) => {
  try {
    const { adminEmailOrPhone } = req.body;
    
    const admin = await Admin.findOne({
      $or: [{ email: adminEmailOrPhone }, { phone: adminEmailOrPhone }]
    });

    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    // Check if admin created this assignment
    if (assignment.createdBy.toString() !== admin._id.toString()) {
      return res.status(403).json({ message: 'You can only update assignments you created' });
    }

    const updatedAssignment = await Assignment.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('createdBy', 'fullName email')
     .populate('assignedTo', 'fullName email');

    res.json({ message: 'Assignment updated successfully', assignment: updatedAssignment });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete assignment
router.delete('/:id', async (req, res) => {
  try {
    const { adminEmailOrPhone } = req.body;
    
    const admin = await Admin.findOne({
      $or: [{ email: adminEmailOrPhone }, { phone: adminEmailOrPhone }]
    });

    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    // Check if admin created this assignment
    if (assignment.createdBy.toString() !== admin._id.toString()) {
      return res.status(403).json({ message: 'You can only delete assignments you created' });
    }

    // Check if any submissions exist
    const submissions = await AssignmentSubmission.find({ assignment: req.params.id });
    if (submissions.length > 0) {
      return res.status(400).json({ message: 'Cannot delete assignment with existing submissions' });
    }

    await Assignment.findByIdAndDelete(req.params.id);
    res.json({ message: 'Assignment deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Publish/Unpublish assignment
router.patch('/:id/publish', async (req, res) => {
  try {
    const { isPublished, adminEmailOrPhone } = req.body;
    
    const admin = await Admin.findOne({
      $or: [{ email: adminEmailOrPhone }, { phone: adminEmailOrPhone }]
    });

    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    assignment.isPublished = isPublished;
    await assignment.save();

    res.json({ 
      message: `Assignment ${isPublished ? 'published' : 'unpublished'} successfully`,
      assignment 
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get assignment submissions (Admin)
router.get('/:id/submissions', async (req, res) => {
  try {
    const submissions = await AssignmentSubmission.find({ assignment: req.params.id })
      .populate('student', 'fullName email')
      .populate('assignment', 'title totalMarks passingMarks type')
      .populate('reviewedBy', 'fullName email')
      .sort({ createdAt: -1 });

    res.json(submissions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Review submission (Admin)
router.patch('/submission/:submissionId/review', async (req, res) => {
  try {
    const { 
      scores, 
      adminFeedback, 
      adminComments, 
      status,
      adminEmailOrPhone 
    } = req.body;
    
    const admin = await Admin.findOne({
      $or: [{ email: adminEmailOrPhone }, { phone: adminEmailOrPhone }]
    });

    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    const submission = await AssignmentSubmission.findById(req.params.submissionId);
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Update submission with review data
    if (scores) {
      submission.scores = scores;
    }
    if (adminFeedback) {
      submission.adminFeedback = adminFeedback;
    }
    if (adminComments) {
      submission.adminComments = adminComments;
    }
    if (status) {
      submission.status = status;
    }
    
    submission.reviewedBy = admin._id;
    submission.reviewedAt = new Date();

    await submission.save();

    // Send review notification to student
    setTimeout(() => {
      sendAssignmentReviewNotifications(submission, adminEmailOrPhone, req.protocol, req.get('host'));
    }, 100);

    res.json({ message: 'Submission reviewed successfully', submission });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get assignment statistics (Admin)
router.get('/:id/statistics', async (req, res) => {
  try {
    const submissions = await AssignmentSubmission.find({ assignment: req.params.id });
    
    const stats = {
      totalSubmissions: submissions.length,
      submittedSubmissions: submissions.filter(s => s.status === 'submitted').length,
      underReviewSubmissions: submissions.filter(s => s.status === 'under_review').length,
      reviewedSubmissions: submissions.filter(s => s.status === 'reviewed').length,
      approvedSubmissions: submissions.filter(s => s.status === 'approved').length,
      rejectedSubmissions: submissions.filter(s => s.status === 'rejected').length,
      passedSubmissions: submissions.filter(s => s.isPassed).length,
      averageScore: 0,
      averagePercentage: 0
    };

    if (stats.reviewedSubmissions > 0) {
      const reviewedSubs = submissions.filter(s => s.status === 'reviewed' || s.status === 'approved' || s.status === 'rejected');
      stats.averageScore = reviewedSubs.reduce((sum, s) => sum + s.totalScore, 0) / reviewedSubs.length;
      stats.averagePercentage = reviewedSubs.reduce((sum, s) => sum + s.percentage, 0) / reviewedSubs.length;
    }

    res.json(stats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 