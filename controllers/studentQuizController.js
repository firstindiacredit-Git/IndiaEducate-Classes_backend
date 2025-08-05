const express = require('express');
const Quiz = require('../model/quizModel');
const QuizSubmission = require('../model/quizSubmissionModel');
const Student = require('../model/studentModel');

const router = express.Router();

// Get available quizzes for student
router.get('/available', async (req, res) => {
  try {
    const { studentEmailOrPhone } = req.query;
    
    if (!studentEmailOrPhone) {
      return res.status(400).json({ message: 'Student email or phone required' });
    }

    const student = await Student.findOne({
      $or: [{ email: studentEmailOrPhone }, { phone: studentEmailOrPhone }]
    });

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const now = new Date();
    
    
    // Get quizzes assigned to this student or all published quizzes
    const quizzes = await Quiz.find({
      $and: [
        { isActive: true },
        { isPublished: true },
        { startDate: { $lte: now } },
        { endDate: { $gte: now } },
        {
          $or: [
            { assignedTo: student._id },
            { assignedTo: { $size: 0 } } // Available to all students
          ]
        }
      ]
    })
    .populate('createdBy', 'fullName')
    .sort({ startDate: 1 });
    
    // Alternative query to check if the issue is with the complex query
    const simpleQuizzes = await Quiz.find({
      isActive: true,
      isPublished: true
    });
  
    
    // Test query without assignedTo constraint
    const noAssignmentQuizzes = await Quiz.find({
      isActive: true,
      isPublished: true
    });

   
  

    // Get student's submissions to check completion status
    const submissions = await QuizSubmission.find({ 
      student: student._id,
      quiz: { $in: quizzes.map(q => q._id) }
    });

    // Add submission status to each quiz
    const quizzesWithStatus = quizzes.map(quiz => {
      const submission = submissions.find(s => s.quiz.toString() === quiz._id.toString());
      const quizObj = quiz.toObject();
      
      if (submission) {
        quizObj.submissionStatus = submission.status;
        quizObj.isCompleted = submission.status === 'completed';
        quizObj.isPassed = submission.isPassed;
        quizObj.score = submission.totalMarksObtained;
        quizObj.percentage = submission.percentage;
        quizObj.attempts = submission.attempts;
        quizObj.canRetake = submission.canRetake;
      } else {
        quizObj.submissionStatus = 'not_started';
        quizObj.isCompleted = false;
        quizObj.isPassed = false;
        quizObj.score = 0;
        quizObj.percentage = 0;
        quizObj.attempts = 0;
        quizObj.canRetake = false;
      }
      
      return quizObj;
    });

    res.json(quizzesWithStatus);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get quiz details for taking
router.get('/:quizId/start', async (req, res) => {
  try {
    const { studentEmailOrPhone } = req.query;
    const { quizId } = req.params;
    
    if (!studentEmailOrPhone) {
      return res.status(400).json({ message: 'Student email or phone required' });
    }

    const student = await Student.findOne({
      $or: [{ email: studentEmailOrPhone }, { phone: studentEmailOrPhone }]
    });

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    // Check if quiz is available
    const now = new Date();
    if (!quiz.isActive || !quiz.isPublished || now < quiz.startDate || now > quiz.endDate) {
      return res.status(400).json({ message: 'Quiz is not available' });
    }

    // Check if student is assigned to this quiz
    if (quiz.assignedTo.length > 0 && !quiz.assignedTo.includes(student._id)) {
      return res.status(403).json({ message: 'You are not assigned to this quiz' });
    }

    // Check existing submissions
    const existingSubmission = await QuizSubmission.findOne({
      quiz: quizId,
      student: student._id
    }).sort({ attempts: -1 });

    if (existingSubmission && existingSubmission.status === 'completed' && !existingSubmission.canRetake) {
      return res.status(400).json({ 
        message: 'You have already completed this quiz',
        submission: existingSubmission
      });
    }

    // Create new submission or continue existing one
    let submission;
    if (existingSubmission && existingSubmission.status === 'in_progress') {
      submission = existingSubmission;
    } else {
      const attemptNumber = existingSubmission ? existingSubmission.attempts + 1 : 1;
      
      submission = new QuizSubmission({
        quiz: quizId,
        student: student._id,
        startTime: new Date(),
        status: 'in_progress',
        attempts: attemptNumber,
        maxAttempts: 1 // Default, can be configured per quiz
      });
      
      await submission.save();
    }

    // Return quiz without correct answers
    const quizForStudent = {
      _id: quiz._id,
      title: quiz.title,
      description: quiz.description,
      duration: quiz.duration,
      totalMarks: quiz.totalMarks,
      passingMarks: quiz.passingMarks,
      questions: quiz.questions.map(q => ({
        question: q.question,
        type: q.type,
        options: q.options,
        marks: q.marks
      })),
      submissionId: submission._id,
      startTime: submission.startTime
    };

    res.json(quizForStudent);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Submit quiz answers
router.post('/:quizId/submit', async (req, res) => {
  try {
    const { studentEmailOrPhone, answers, submissionId } = req.body;
    const { quizId } = req.params;
    
    if (!studentEmailOrPhone || !answers || !submissionId) {
      return res.status(400).json({ message: 'All required fields must be provided' });
    }

    const student = await Student.findOne({
      $or: [{ email: studentEmailOrPhone }, { phone: studentEmailOrPhone }]
    });

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const submission = await QuizSubmission.findById(submissionId);
    if (!submission || submission.student.toString() !== student._id.toString()) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    if (submission.status === 'completed') {
      return res.status(400).json({ message: 'Quiz already completed' });
    }

    // Calculate results
    let totalMarksObtained = 0;
    const processedAnswers = [];

    for (let i = 0; i < answers.length; i++) {
      const answer = answers[i];
      const question = quiz.questions[answer.questionIndex];
      
      if (!question) continue;

      let isCorrect = false;
      let marksObtained = 0;

      // Check if answer is correct
      if (question.type === 'multiple_choice' || question.type === 'true_false') {
        isCorrect = answer.answer === question.correctAnswer;
      } else if (question.type === 'fill_blank') {
        isCorrect = answer.answer.toLowerCase().trim() === question.correctAnswer.toLowerCase().trim();
      } else if (question.type === 'short_answer') {
        // For short answer, we'll mark as correct for now, admin can review later
        isCorrect = answer.answer.trim().length > 0;
      }

      marksObtained = isCorrect ? question.marks : 0;
      totalMarksObtained += marksObtained;

      processedAnswers.push({
        questionIndex: answer.questionIndex,
        answer: answer.answer,
        isCorrect,
        marksObtained,
        timeSpent: answer.timeSpent || 0
      });
    }

    const percentage = (totalMarksObtained / quiz.totalMarks) * 100;
    const isPassed = totalMarksObtained >= quiz.passingMarks;

    // Update submission
    submission.answers = processedAnswers;
    submission.totalMarksObtained = totalMarksObtained;
    submission.percentage = percentage;
    submission.isPassed = isPassed;
    submission.endTime = new Date();
    submission.duration = Math.round((submission.endTime - submission.startTime) / (1000 * 60)); // in minutes
    submission.status = 'completed';

    await submission.save();

    res.json({
      message: 'Quiz submitted successfully',
      result: {
        totalMarks: quiz.totalMarks,
        marksObtained: totalMarksObtained,
        percentage: percentage,
        isPassed: isPassed,
        passingMarks: quiz.passingMarks
      },
      submission
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get student's quiz history
router.get('/history', async (req, res) => {
  try {
    const { studentEmailOrPhone } = req.query;
    
    if (!studentEmailOrPhone) {
      return res.status(400).json({ message: 'Student email or phone required' });
    }

    const student = await Student.findOne({
      $or: [{ email: studentEmailOrPhone }, { phone: studentEmailOrPhone }]
    });

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const submissions = await QuizSubmission.find({ student: student._id })
      .populate('quiz', 'title subject type totalMarks passingMarks')
      .sort({ createdAt: -1 });

    res.json(submissions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get student's quiz performance statistics
router.get('/performance', async (req, res) => {
  try {
    const { studentEmailOrPhone } = req.query;
    
    if (!studentEmailOrPhone) {
      return res.status(400).json({ message: 'Student email or phone required' });
    }

    const student = await Student.findOne({
      $or: [{ email: studentEmailOrPhone }, { phone: studentEmailOrPhone }]
    });

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const submissions = await QuizSubmission.find({ 
      student: student._id,
      status: 'completed'
    }).populate('quiz', 'subject type');

    const stats = {
      totalQuizzes: submissions.length,
      passedQuizzes: submissions.filter(s => s.isPassed).length,
      averagePercentage: 0,
      subjectPerformance: {},
      typePerformance: {}
    };

    if (submissions.length > 0) {
      stats.averagePercentage = submissions.reduce((sum, s) => sum + s.percentage, 0) / submissions.length;

      // Subject-wise performance
      submissions.forEach(submission => {
        const subject = submission.quiz.subject;
        const type = submission.quiz.type;
        
        if (!stats.subjectPerformance[subject]) {
          stats.subjectPerformance[subject] = { total: 0, passed: 0, averageScore: 0 };
        }
        if (!stats.typePerformance[type]) {
          stats.typePerformance[type] = { total: 0, passed: 0, averageScore: 0 };
        }

        stats.subjectPerformance[subject].total++;
        stats.typePerformance[type].total++;
        
        if (submission.isPassed) {
          stats.subjectPerformance[subject].passed++;
          stats.typePerformance[type].passed++;
        }

        stats.subjectPerformance[subject].averageScore += submission.percentage;
        stats.typePerformance[type].averageScore += submission.percentage;
      });

      // Calculate averages
      Object.keys(stats.subjectPerformance).forEach(subject => {
        const perf = stats.subjectPerformance[subject];
        perf.averageScore = perf.averageScore / perf.total;
      });

      Object.keys(stats.typePerformance).forEach(type => {
        const perf = stats.typePerformance[type];
        perf.averageScore = perf.averageScore / perf.total;
      });
    }

    res.json(stats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get individual submission details
router.get('/submission/:submissionId', async (req, res) => {
  try {
    const { studentEmailOrPhone } = req.query;
    const { submissionId } = req.params;
    
    if (!studentEmailOrPhone) {
      return res.status(400).json({ message: 'Student email or phone required' });
    }

    const student = await Student.findOne({
      $or: [{ email: studentEmailOrPhone }, { phone: studentEmailOrPhone }]
    });

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const submission = await QuizSubmission.findById(submissionId)
      .populate('quiz', 'title subject type totalMarks passingMarks questions')
      .populate('student', 'fullName email');

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Check if this submission belongs to the student
    if (submission.student._id.toString() !== student._id.toString()) {
      return res.status(403).json({ message: 'You can only view your own submissions' });
    }

    res.json(submission);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Test endpoint to check quiz availability
router.get('/test/available', async (req, res) => {
  try {
    const { studentEmailOrPhone } = req.query;
    
    if (!studentEmailOrPhone) {
      return res.status(400).json({ message: 'Student email or phone required' });
    }

    const student = await Student.findOne({
      $or: [{ email: studentEmailOrPhone }, { phone: studentEmailOrPhone }]
    });

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const now = new Date();
    
    // Get all quizzes
    const allQuizzes = await Quiz.find({});
    
    // Get active and published quizzes
    const activePublishedQuizzes = await Quiz.find({
      isActive: true,
      isPublished: true
    });
    
    // Get quizzes within date range
    const dateRangeQuizzes = await Quiz.find({
      isActive: true,
      isPublished: true,
      startDate: { $lte: now },
      endDate: { $gte: now }
    });
    
    // Get final filtered quizzes
    const finalQuizzes = await Quiz.find({
      $and: [
        { isActive: true },
        { isPublished: true },
        { startDate: { $lte: now } },
        { endDate: { $gte: now } },
        {
          $or: [
            { assignedTo: student._id },
            { assignedTo: { $size: 0 } }
          ]
        }
      ]
    });

    res.json({
      student: {
        _id: student._id,
        email: student.email,
        phone: student.phone
      },
      currentTime: now,
      allQuizzes: allQuizzes.length,
      activePublishedQuizzes: activePublishedQuizzes.length,
      dateRangeQuizzes: dateRangeQuizzes.length,
      finalQuizzes: finalQuizzes.length,
      quizzes: finalQuizzes.map(q => ({
        title: q.title,
        isActive: q.isActive,
        isPublished: q.isPublished,
        startDate: q.startDate,
        endDate: q.endDate,
        assignedTo: q.assignedTo
      }))
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 