const express = require('express');
const Quiz = require('../model/quizModel');
const QuizSubmission = require('../model/quizSubmissionModel');
const Student = require('../model/studentModel');
const Admin = require('../model/adminModel');

const router = express.Router();

// Helper function to calculate week number
function getWeekNumber(date) {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date - startOfYear) / (24 * 60 * 60 * 1000));
  return Math.ceil((days + startOfYear.getDay() + 1) / 7);
}

// Helper function to send quiz notifications
const sendQuizNotifications = async (quizId, adminEmailOrPhone, isWeeklyTest = false, protocol, host) => {
  try {
    const endpoint = isWeeklyTest ? '/api/notifications/weekly-test-created' : '/api/notifications/quiz-created';
    
    // Make API call to notification service
    const response = await fetch(`${protocol}://${host}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        quizId: quizId,
        adminEmailOrPhone: adminEmailOrPhone
      })
    });

    if (!response.ok) {
      console.error('Failed to send quiz notifications');
    }
  } catch (error) {
    console.error('Error sending quiz notifications:', error);
  }
};

// Helper function to send quiz review notifications
const sendQuizReviewNotifications = async (submission, adminEmailOrPhone, protocol, host) => {
  try {
    const student = await Student.findById(submission.student);
    const quiz = await Quiz.findById(submission.quiz);
    
    if (!student || !quiz) {
      return;
    }

    // Make API call to notification service
    const response = await fetch(`${protocol}://${host}/api/notifications/quiz-reviewed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        studentEmail: student.email,
        quizTitle: quiz.title,
        score: submission.totalMarksObtained,
        totalMarks: quiz.totalMarks,
        isPassed: submission.isPassed,
        adminFeedback: submission.adminFeedback
      })
    });

    if (!response.ok) {
      console.error('Failed to send quiz review notifications');
    }
  } catch (error) {
    console.error('Error sending quiz review notifications:', error);
  }
};

// Create Quiz (Admin only)
router.post('/create', async (req, res) => {
  try {
    const { 
      title, 
      description, 
      type, 
      subject, 
      language, 
      duration, 
      totalMarks, 
      passingMarks, 
      questions, 
      startDate, 
      endDate, 
      assignedTo,
      weekNumber,
      isWeeklyTest = false,
      adminEmailOrPhone 
    } = req.body;

    // Validate required fields
    if (!title || !description || !type || !subject || !language || !duration || !totalMarks || !passingMarks || !questions || !startDate || !endDate) {
      return res.status(400).json({ message: 'All required fields must be provided' });
    }

    // Find admin
    const admin = await Admin.findOne({
      $or: [{ email: adminEmailOrPhone }, { phone: adminEmailOrPhone }]
    });

    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    // Validate questions
    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ message: 'At least one question is required' });
    }

    // Calculate total marks from questions
    const calculatedTotalMarks = questions.reduce((sum, question) => sum + question.marks, 0);
    if (calculatedTotalMarks !== totalMarks) {
      return res.status(400).json({ message: 'Total marks must match sum of question marks' });
    }

    // Validate passing marks
    if (passingMarks > totalMarks) {
      return res.status(400).json({ message: 'Passing marks cannot exceed total marks' });
    }

    // Create quiz
    const quiz = new Quiz({
      title,
      description,
      type,
      subject,
      language,
      duration,
      totalMarks,
      passingMarks,
      questions,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      createdBy: admin._id,
      assignedTo: assignedTo || [],
      weekNumber: weekNumber || getWeekNumber(new Date(startDate)),
      year: new Date().getFullYear()
    });

    await quiz.save();

    // Send notifications to students
    setTimeout(() => {
      sendQuizNotifications(quiz._id, adminEmailOrPhone, isWeeklyTest, req.protocol, req.get('host'));
    }, 100);

    res.status(201).json({ 
      message: 'Quiz created successfully', 
      quiz 
    });
  } catch (err) {
    console.error('Error creating quiz:', err);
    res.status(500).json({ message: err.message });
  }
});

// Get all quizzes (Admin)
router.get('/all', async (req, res) => {
  try {
    const { type, subject, isActive, isPublished } = req.query;
    
    const filter = {};
    if (type) filter.type = type;
    if (subject) filter.subject = subject;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (isPublished !== undefined) filter.isPublished = isPublished === 'true';

    const quizzes = await Quiz.find(filter)
      .populate('createdBy', 'fullName email')
      .populate('assignedTo', 'fullName email')
      .sort({ createdAt: -1 });

    res.json(quizzes);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get quiz by ID
router.get('/:id', async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id)
      .populate('createdBy', 'fullName email')
      .populate('assignedTo', 'fullName email');

    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    res.json(quiz);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update quiz
router.put('/:id', async (req, res) => {
  try {
    const { adminEmailOrPhone } = req.body;
    
    const admin = await Admin.findOne({
      $or: [{ email: adminEmailOrPhone }, { phone: adminEmailOrPhone }]
    });

    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    // Check if admin created this quiz
    if (quiz.createdBy.toString() !== admin._id.toString()) {
      return res.status(403).json({ message: 'You can only update quizzes you created' });
    }

    const updatedQuiz = await Quiz.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('createdBy', 'fullName email')
     .populate('assignedTo', 'fullName email');

    res.json({ message: 'Quiz updated successfully', quiz: updatedQuiz });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete quiz
router.delete('/:id', async (req, res) => {
  try {
    const { adminEmailOrPhone } = req.body;
    
    const admin = await Admin.findOne({
      $or: [{ email: adminEmailOrPhone }, { phone: adminEmailOrPhone }]
    });

    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    // Check if admin created this quiz
    if (quiz.createdBy.toString() !== admin._id.toString()) {
      return res.status(403).json({ message: 'You can only delete quizzes you created' });
    }

    // Check if any submissions exist
    const submissions = await QuizSubmission.find({ quiz: req.params.id });
    if (submissions.length > 0) {
      return res.status(400).json({ message: 'Cannot delete quiz with existing submissions' });
    }

    await Quiz.findByIdAndDelete(req.params.id);
    res.json({ message: 'Quiz deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Publish/Unpublish quiz
router.patch('/:id/publish', async (req, res) => {
  try {
    const { isPublished, adminEmailOrPhone } = req.body;
    
    const admin = await Admin.findOne({
      $or: [{ email: adminEmailOrPhone }, { phone: adminEmailOrPhone }]
    });

    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    quiz.isPublished = isPublished;
    await quiz.save();

    res.json({ 
      message: `Quiz ${isPublished ? 'published' : 'unpublished'} successfully`,
      quiz 
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get quiz submissions (Admin)
router.get('/:id/submissions', async (req, res) => {
  try {
    const submissions = await QuizSubmission.find({ quiz: req.params.id })
      .populate('student', 'fullName email')
      .populate('quiz', 'title totalMarks passingMarks')
      .sort({ createdAt: -1 });

    res.json(submissions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Review submission (Admin)
router.patch('/submission/:submissionId/review', async (req, res) => {
  try {
    const { adminFeedback, adminScore, adminEmailOrPhone } = req.body;
    
    const admin = await Admin.findOne({
      $or: [{ email: adminEmailOrPhone }, { phone: adminEmailOrPhone }]
    });

    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    const submission = await QuizSubmission.findById(req.params.submissionId);
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    submission.adminFeedback = adminFeedback;
    submission.adminScore = adminScore;
    submission.isReviewed = true;
    await submission.save();

    // Send review notification to student
    setTimeout(() => {
      sendQuizReviewNotifications(submission, adminEmailOrPhone, req.protocol, req.get('host'));
    }, 100);

    res.json({ message: 'Submission reviewed successfully', submission });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get quiz statistics (Admin)
router.get('/:id/statistics', async (req, res) => {
  try {
    const submissions = await QuizSubmission.find({ quiz: req.params.id });
    
    const stats = {
      totalSubmissions: submissions.length,
      completedSubmissions: submissions.filter(s => s.status === 'completed').length,
      passedSubmissions: submissions.filter(s => s.isPassed).length,
      averageScore: 0,
      averagePercentage: 0
    };

    if (stats.completedSubmissions > 0) {
      const completedSubs = submissions.filter(s => s.status === 'completed');
      stats.averageScore = completedSubs.reduce((sum, s) => sum + s.totalMarksObtained, 0) / completedSubs.length;
      stats.averagePercentage = completedSubs.reduce((sum, s) => sum + s.percentage, 0) / completedSubs.length;
    }

    res.json(stats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 