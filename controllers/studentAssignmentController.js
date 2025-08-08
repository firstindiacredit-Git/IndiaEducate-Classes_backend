const express = require('express');
const Assignment = require('../model/assignmentModel');
const AssignmentSubmission = require('../model/assignmentSubmissionModel');
const Student = require('../model/studentModel');
const { 
  uploadAudioMiddleware, 
  uploadVideoMiddleware,
  getFileInfo 
} = require('../utils/fileUploadConfig');

const router = express.Router();

// Get available assignments for student
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
    
    // Get assignments assigned to this student or all published assignments
    const assignments = await Assignment.find({
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

    // Get student's submissions to check completion status
    const submissions = await AssignmentSubmission.find({ 
      student: student._id,
      assignment: { $in: assignments.map(a => a._id) }
    });

    // Add submission status to each assignment
    const assignmentsWithStatus = assignments.map(assignment => {
      const submission = submissions.find(s => s.assignment.toString() === assignment._id.toString());
      const assignmentObj = assignment.toObject();
      
      if (submission) {
        assignmentObj.submissionStatus = submission.status;
        assignmentObj.isSubmitted = submission.status !== 'draft';
        assignmentObj.isReviewed = submission.status === 'reviewed' || submission.status === 'approved' || submission.status === 'rejected';
        assignmentObj.isPassed = submission.isPassed;
        assignmentObj.score = submission.totalScore;
        assignmentObj.percentage = submission.percentage;
        assignmentObj.attempts = submission.attempts;
        assignmentObj.canResubmit = submission.canResubmit;
        assignmentObj.submissionId = submission._id;
      } else {
        assignmentObj.submissionStatus = 'not_started';
        assignmentObj.isSubmitted = false;
        assignmentObj.isReviewed = false;
        assignmentObj.isPassed = false;
        assignmentObj.score = 0;
        assignmentObj.percentage = 0;
        assignmentObj.attempts = 0;
        assignmentObj.canResubmit = false;
        assignmentObj.submissionId = null;
      }
      
      return assignmentObj;
    });

    res.json(assignmentsWithStatus);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get assignment details for submission
router.get('/:assignmentId/start', async (req, res) => {
  try {
    const { studentEmailOrPhone } = req.query;
    const { assignmentId } = req.params;
    
    if (!studentEmailOrPhone) {
      return res.status(400).json({ message: 'Student email or phone required' });
    }

    const student = await Student.findOne({
      $or: [{ email: studentEmailOrPhone }, { phone: studentEmailOrPhone }]
    });

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const assignment = await Assignment.findById(assignmentId);
    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    // Check if assignment is available
    const now = new Date();
    if (!assignment.isActive || !assignment.isPublished || now < assignment.startDate || now > assignment.endDate) {
      return res.status(400).json({ message: 'Assignment is not available' });
    }

    // Check if student is assigned to this assignment
    if (assignment.assignedTo.length > 0 && !assignment.assignedTo.includes(student._id)) {
      return res.status(403).json({ message: 'You are not assigned to this assignment' });
    }

    // Check existing submissions
    const existingSubmission = await AssignmentSubmission.findOne({
      assignment: assignmentId,
      student: student._id
    }).sort({ attempts: -1 });

    if (existingSubmission && existingSubmission.status === 'approved' && !existingSubmission.canResubmit) {
      return res.status(400).json({ 
        message: 'You have already completed this assignment',
        submission: existingSubmission
      });
    }

    // Create new submission or continue existing one
    let submission;
    if (existingSubmission && existingSubmission.status === 'draft') {
      submission = existingSubmission;
    } else {
      const attemptNumber = existingSubmission ? existingSubmission.attempts + 1 : 1;
      
      submission = new AssignmentSubmission({
        assignment: assignmentId,
        student: student._id,
        status: 'draft',
        attempts: attemptNumber,
        maxAttempts: 3 // Default, can be configured per assignment
      });
      
      await submission.save();
    }

    // Return assignment details
    const assignmentForStudent = {
      _id: assignment._id,
      title: assignment.title,
      description: assignment.description,
      paragraph: assignment.paragraph,
      type: assignment.type,
      duration: assignment.duration,
      maxFileSize: assignment.maxFileSize,
      allowedFormats: assignment.allowedFormats,
      instructions: assignment.instructions,
      rubric: assignment.rubric,
      totalMarks: assignment.totalMarks,
      passingMarks: assignment.passingMarks,
      endDate: assignment.endDate,
      submissionId: submission._id
    };

    res.json(assignmentForStudent);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Submit assignment
router.post('/:assignmentId/submit', async (req, res) => {
  try {
    const { studentEmailOrPhone, submissionText, duration, submissionId } = req.body;
    const { assignmentId } = req.params;
    
    if (!studentEmailOrPhone || !submissionId) {
      return res.status(400).json({ message: 'All required fields must be provided' });
    }

    const student = await Student.findOne({
      $or: [{ email: studentEmailOrPhone }, { phone: studentEmailOrPhone }]
    });

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const assignment = await Assignment.findById(assignmentId);
    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    const submission = await AssignmentSubmission.findById(submissionId);
    if (!submission || submission.student.toString() !== student._id.toString()) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    if (submission.status === 'submitted' || submission.status === 'under_review' || submission.status === 'reviewed') {
      return res.status(400).json({ message: 'Assignment already submitted' });
    }

    // Update submission
    submission.submissionText = submissionText || '';
    submission.duration = duration || 0;
    submission.status = 'submitted';
    submission.submittedAt = new Date();

    // Check if submission is late
    const now = new Date();
    if (now > assignment.endDate) {
      submission.submittedBeforeDeadline = false;
      submission.lateSubmissionMinutes = Math.floor((now - assignment.endDate) / (1000 * 60));
    }

    await submission.save();

    res.json({
      message: 'Assignment submitted successfully',
      submission
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Upload audio/video file for assignment
router.post('/:assignmentId/upload', async (req, res) => {
  const { assignmentId } = req.params;
  
  try {
    const assignment = await Assignment.findById(assignmentId);
    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    // Use appropriate middleware based on assignment type
    const uploadMiddleware = assignment.type === 'audio' ? uploadAudioMiddleware : uploadVideoMiddleware;
    
    uploadMiddleware(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ message: err.message });
      }

      try {
        // Get form data from req.body (after multer processes it)
        const { studentEmailOrPhone, submissionId } = req.body;
        
        if (!studentEmailOrPhone || !submissionId) {
          return res.status(400).json({ message: 'All required fields must be provided' });
        }

        if (!req.file) {
          return res.status(400).json({ message: 'No file uploaded' });
        }

        const student = await Student.findOne({
          $or: [{ email: studentEmailOrPhone }, { phone: studentEmailOrPhone }]
        });

        if (!student) {
          return res.status(404).json({ message: 'Student not found' });
        }

        const submission = await AssignmentSubmission.findById(submissionId);
        if (!submission || submission.student.toString() !== student._id.toString()) {
          return res.status(404).json({ message: 'Submission not found' });
        }

        // Validate file type
        const fileExtension = req.file.originalname.split('.').pop().toLowerCase();
        if (!assignment.allowedFormats.includes(fileExtension)) {
          return res.status(400).json({ 
            message: `Invalid file format. Allowed formats: ${assignment.allowedFormats.join(', ')}` 
          });
        }

        // Validate file size
        const fileSizeMB = req.file.size / (1024 * 1024);
        if (fileSizeMB > assignment.maxFileSize) {
          return res.status(400).json({ 
            message: `File size too large. Maximum allowed: ${assignment.maxFileSize}MB` 
          });
        }

        const fileInfo = getFileInfo(req.file);

        // Update submission with file info
        submission.submissionFile = {
          fileName: fileInfo.fileName,
          originalName: fileInfo.originalName,
          fileType: assignment.type,
          fileSize: fileInfo.fileSize,
          mimeType: fileInfo.mimeType,
          s3Key: fileInfo.s3Key,
          s3Url: fileInfo.s3Url
        };

        await submission.save();

        res.json({
          message: 'File uploaded successfully',
          submission
        });
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get student's assignment history
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

    const submissions = await AssignmentSubmission.find({ student: student._id })
      .populate('assignment', 'title subject type totalMarks passingMarks')
      .populate('reviewedBy', 'fullName email')
      .sort({ createdAt: -1 });

    res.json(submissions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get student's assignment performance statistics
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

    const submissions = await AssignmentSubmission.find({ 
      student: student._id,
      status: { $in: ['reviewed', 'approved', 'rejected'] }
    }).populate('assignment', 'subject type');

    const stats = {
      totalAssignments: submissions.length,
      passedAssignments: submissions.filter(s => s.isPassed).length,
      averagePercentage: 0,
      subjectPerformance: {},
      typePerformance: {}
    };

    if (submissions.length > 0) {
      stats.averagePercentage = submissions.reduce((sum, s) => sum + s.percentage, 0) / submissions.length;

      // Subject-wise performance
      submissions.forEach(submission => {
        const subject = submission.assignment.subject;
        const type = submission.assignment.type;
        
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

    const submission = await AssignmentSubmission.findById(submissionId)
      .populate('assignment', 'title subject type totalMarks passingMarks paragraph instructions rubric')
      .populate('student', 'fullName email')
      .populate('reviewedBy', 'fullName email');

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

// Get overall progress statistics
router.get('/progress', async (req, res) => {
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
    
    // Get ALL assignments that this student has submissions for OR is assigned to
    const allAssignmentSubmissions = await AssignmentSubmission.find({ 
      student: student._id
    }).populate('assignment');

    // Get assignment IDs that the student has submissions for
    const submittedAssignmentIds = allAssignmentSubmissions.map(s => s.assignment._id);

    // Get assignments assigned to this student OR that the student has submissions for
    // Remove the isActive and isPublished filters to include all assignments
    const assignments = await Assignment.find({
      $or: [
        { assignedTo: student._id },
        { assignedTo: { $size: 0 } },
        { _id: { $in: submittedAssignmentIds } }
      ]
    });

    // If no assignments found, include all assignments that student has submissions for
    if (assignments.length === 0 && submittedAssignmentIds.length > 0) {
      const submittedAssignments = await Assignment.find({
        _id: { $in: submittedAssignmentIds }
      });
      assignments.push(...submittedAssignments);
    }

    // Get submissions for the assignments we found
    const assignmentSubmissions = allAssignmentSubmissions.filter(s => 
      assignments.some(a => a._id.toString() === s.assignment.toString())
    );

    // Calculate assignment progress - use all submissions
    const assignmentStats = {
      total: allAssignmentSubmissions.length,
      completed: allAssignmentSubmissions.filter(s => s.status === 'submitted' || s.status === 'reviewed' || s.status === 'approved' || s.status === 'rejected').length,
      passed: allAssignmentSubmissions.filter(s => s.isPassed).length,
      inProgress: allAssignmentSubmissions.filter(s => s.status === 'draft').length,
      notStarted: 0
    };

    // Get all quizzes assigned to this student (including completed ones)
    const Quiz = require('../model/quizModel');
    const QuizSubmission = require('../model/quizSubmissionModel');

    // Get ALL quiz submissions for this student
    const allQuizSubmissions = await QuizSubmission.find({ 
      student: student._id
    }).populate('quiz');

    // Get quiz IDs that the student has submissions for
    const submittedQuizIds = allQuizSubmissions.map(s => s.quiz._id);

    // Get quizzes assigned to this student OR that the student has submissions for
    // Remove the isActive and isPublished filters to include all quizzes
    const quizzes = await Quiz.find({
      $or: [
        { assignedTo: student._id },
        { assignedTo: { $size: 0 } },
        { _id: { $in: submittedQuizIds } }
      ]
    });

    // If no quizzes found, include all quizzes that student has submissions for
    if (quizzes.length === 0 && submittedQuizIds.length > 0) {
      const submittedQuizzes = await Quiz.find({
        _id: { $in: submittedQuizIds }
      });
      quizzes.push(...submittedQuizzes);
    }

    // Get submissions for the quizzes we found
    const quizSubmissions = allQuizSubmissions.filter(s => 
      quizzes.some(q => q._id.toString() === s.quiz.toString())
    );

    // Calculate quiz progress - use all submissions
    const quizStats = {
      total: allQuizSubmissions.length,
      completed: allQuizSubmissions.filter(s => s.status === 'completed').length,
      passed: allQuizSubmissions.filter(s => s.isPassed).length,
      inProgress: allQuizSubmissions.filter(s => s.status === 'in_progress').length,
      notStarted: 0
    };

    // Get attendance data
    const Attendance = require('../model/attendanceModel');
    const ClassSchedule = require('../model/classScheduleModel');
    
    // Get all completed/expired classes for the student's program
    const allClasses = await ClassSchedule.find({
      program: student.program,
      status: { $in: ['completed', 'expired'] }
    });

    // Get all attendance records for this student
    const studentAttendanceRecords = await Attendance.find({ studentId: student._id });

    // Calculate attendance statistics
    const attendanceStats = {
      total: allClasses.length,
      attended: studentAttendanceRecords.filter(r => r.status === 'present').length,
      percentage: allClasses.length > 0 ? 
        Math.round((studentAttendanceRecords.filter(r => r.status === 'present').length / allClasses.length) * 100) : 0
    };

    // Calculate overall progress
    const totalActivities = assignmentStats.total + quizStats.total + attendanceStats.total;
    const completedActivities = assignmentStats.completed + quizStats.completed + attendanceStats.attended;
    const overallProgress = totalActivities > 0 ? (completedActivities / totalActivities) * 100 : 0;

    res.json({
      overall: {
        totalActivities,
        completedActivities,
        progressPercentage: Math.round(overallProgress),
        remainingActivities: totalActivities - completedActivities
      },
      assignments: assignmentStats,
      quizzes: quizStats,
      attendance: attendanceStats,
      breakdown: {
        assignments: {
          total: assignmentStats.total,
          completed: assignmentStats.completed,
          percentage: assignmentStats.total > 0 ? Math.round((assignmentStats.completed / assignmentStats.total) * 100) : 0
        },
        quizzes: {
          total: quizStats.total,
          completed: quizStats.completed,
          percentage: quizStats.total > 0 ? Math.round((quizStats.completed / quizStats.total) * 100) : 0
        },
        attendance: {
          total: attendanceStats.total,
          attended: attendanceStats.attended,
          percentage: attendanceStats.percentage
        }
      },
      // Debug information
      debug: {
        studentId: student._id,
        studentProgram: student.program,
        totalAssignmentsFound: assignments.length,
        totalQuizzesFound: quizzes.length,
        totalAssignmentSubmissions: allAssignmentSubmissions.length,
        totalQuizSubmissions: allQuizSubmissions.length,
        submittedAssignmentIds: submittedAssignmentIds,
        submittedQuizIds: submittedQuizIds,
        assignmentStats: assignmentStats,
        quizStats: quizStats,
        assignmentSubmissions: assignmentSubmissions.map(s => ({
          assignmentId: s.assignment,
          status: s.status,
          isPassed: s.isPassed
        })),
        quizSubmissions: quizSubmissions.map(s => ({
          quizId: s.quiz,
          status: s.status,
          isPassed: s.isPassed
        })),
        allAssignmentSubmissions: allAssignmentSubmissions.map(s => ({
          assignmentId: s.assignment,
          status: s.status,
          isPassed: s.isPassed
        })),
        allQuizSubmissions: allQuizSubmissions.map(s => ({
          quizId: s.quiz,
          status: s.status,
          isPassed: s.isPassed
        }))
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Check for new badges and send notifications
const checkForNewBadges = async (studentId, currentBadges, previousBadges = []) => {
  try {
    const newBadges = currentBadges.filter(currentBadge => 
      !previousBadges.some(prevBadge => prevBadge.id === currentBadge.id)
    );

    if (newBadges.length > 0) {
      // Here you can add notification logic
      // For now, we'll just log the new badges
     
      // You can integrate with your notification system here
      // For example, send a socket notification or email
    }

    return newBadges;
  } catch (err) {
    console.error('Error checking for new badges:', err);
    return [];
  }
};

// Get detailed progress tracking with badges and achievements
router.get('/detailed-progress', async (req, res) => {
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

    // Get assignment data
    const allAssignmentSubmissions = await AssignmentSubmission.find({ 
      student: student._id
    }).populate('assignment');

    const assignmentStats = {
      total: allAssignmentSubmissions.length,
      completed: allAssignmentSubmissions.filter(s => s.status === 'submitted' || s.status === 'reviewed' || s.status === 'approved' || s.status === 'rejected').length,
      passed: allAssignmentSubmissions.filter(s => s.isPassed).length,
      inProgress: allAssignmentSubmissions.filter(s => s.status === 'draft').length,
      notStarted: 0
    };

    // Get quiz data
    const Quiz = require('../model/quizModel');
    const QuizSubmission = require('../model/quizSubmissionModel');

    const allQuizSubmissions = await QuizSubmission.find({ 
      student: student._id
    }).populate('quiz');

    const quizStats = {
      total: allQuizSubmissions.length,
      completed: allQuizSubmissions.filter(s => s.status === 'completed').length,
      passed: allQuizSubmissions.filter(s => s.isPassed).length,
      inProgress: allQuizSubmissions.filter(s => s.status === 'in_progress').length,
      notStarted: 0
    };

    // Get attendance data
    const Attendance = require('../model/attendanceModel');
    const ClassSchedule = require('../model/classScheduleModel');
    
    const allClasses = await ClassSchedule.find({
      program: student.program,
      status: { $in: ['completed', 'expired'] }
    });

    const studentAttendanceRecords = await Attendance.find({ studentId: student._id });

    const attendanceStats = {
      total: allClasses.length,
      attended: studentAttendanceRecords.filter(r => r.status === 'present').length,
      partial: studentAttendanceRecords.filter(r => r.status === 'partial').length,
      absent: studentAttendanceRecords.filter(r => r.status === 'absent').length,
      percentage: allClasses.length > 0 ? 
        Math.round((studentAttendanceRecords.filter(r => r.status === 'present').length / allClasses.length) * 100) : 0
    };

    // Calculate overall progress
    const totalActivities = assignmentStats.total + quizStats.total + attendanceStats.total;
    const completedActivities = assignmentStats.completed + quizStats.completed + attendanceStats.attended;
    const overallProgress = totalActivities > 0 ? (completedActivities / totalActivities) * 100 : 0;

    // Calculate skill-specific progress
    const skillProgress = {
      pronunciation: {
        assignments: allAssignmentSubmissions.filter(s => s.assignment?.subject === 'english' && s.isPassed).length,
        quizzes: allQuizSubmissions.filter(s => s.quiz?.subject === 'english' && s.isPassed).length,
        total: 0,
        percentage: 0
      },
      grammar: {
        assignments: allAssignmentSubmissions.filter(s => s.assignment?.subject === 'english' && s.isPassed).length,
        quizzes: allQuizSubmissions.filter(s => s.quiz?.subject === 'english' && s.isPassed).length,
        total: 0,
        percentage: 0
      },
      vocabulary: {
        assignments: allAssignmentSubmissions.filter(s => s.assignment?.subject === 'english' && s.isPassed).length,
        quizzes: allQuizSubmissions.filter(s => s.quiz?.subject === 'english' && s.isPassed).length,
        total: 0,
        percentage: 0
      },
      listening: {
        assignments: allAssignmentSubmissions.filter(s => s.assignment?.type === 'audio' && s.isPassed).length,
        quizzes: allQuizSubmissions.filter(s => s.quiz?.type === 'listening' && s.isPassed).length,
        total: 0,
        percentage: 0
      },
      speaking: {
        assignments: allAssignmentSubmissions.filter(s => s.assignment?.type === 'video' && s.isPassed).length,
        quizzes: allQuizSubmissions.filter(s => s.quiz?.type === 'speaking' && s.isPassed).length,
        total: 0,
        percentage: 0
      }
    };

    // Calculate percentages for each skill
    Object.keys(skillProgress).forEach(skill => {
      const skillData = skillProgress[skill];
      skillData.total = skillData.assignments + skillData.quizzes;
      skillData.percentage = skillData.total > 0 ? Math.round((skillData.total / (skillData.total + 5)) * 100) : 0; // Assuming 5 activities per skill
    });

    // Generate badges based on achievements
    const badges = [];
    
    // Overall progress badges
    if (overallProgress >= 90) {
      badges.push({
        id: 'master_learner',
        name: 'Master Learner',
        description: 'Achieved 90%+ overall progress',
        icon: '🏆',
        color: '#FFD700',
        category: 'overall'
      });
    } else if (overallProgress >= 75) {
      badges.push({
        id: 'excellent_progress',
        name: 'Excellent Progress',
        description: 'Achieved 75%+ overall progress',
        icon: '⭐',
        color: '#52c41a',
        category: 'overall'
      });
    } else if (overallProgress >= 50) {
      badges.push({
        id: 'good_progress',
        name: 'Good Progress',
        description: 'Achieved 50%+ overall progress',
        icon: '👍',
        color: '#1890ff',
        category: 'overall'
      });
    }

    // Assignment badges
    if (assignmentStats.passed >= 10) {
      badges.push({
        id: 'assignment_master',
        name: 'Assignment Master',
        description: 'Completed 10+ assignments successfully',
        icon: '📝',
        color: '#722ed1',
        category: 'assignments'
      });
    } else if (assignmentStats.passed >= 5) {
      badges.push({
        id: 'assignment_expert',
        name: 'Assignment Expert',
        description: 'Completed 5+ assignments successfully',
        icon: '📋',
        color: '#1890ff',
        category: 'assignments'
      });
    }

    // Quiz badges
    if (quizStats.passed >= 10) {
      badges.push({
        id: 'quiz_master',
        name: 'Quiz Master',
        description: 'Passed 10+ quizzes',
        icon: '🧠',
        color: '#52c41a',
        category: 'quizzes'
      });
    } else if (quizStats.passed >= 5) {
      badges.push({
        id: 'quiz_expert',
        name: 'Quiz Expert',
        description: 'Passed 5+ quizzes',
        icon: '❓',
        color: '#faad14',
        category: 'quizzes'
      });
    }

    // Attendance badges
    if (attendanceStats.percentage >= 95) {
      badges.push({
        id: 'perfect_attendance',
        name: 'Perfect Attendance',
        description: '95%+ attendance rate',
        icon: '🎯',
        color: '#52c41a',
        category: 'attendance'
      });
    } else if (attendanceStats.percentage >= 80) {
      badges.push({
        id: 'regular_attender',
        name: 'Regular Attender',
        description: '80%+ attendance rate',
        icon: '📅',
        color: '#1890ff',
        category: 'attendance'
      });
    }

    // Skill-specific badges
    if (skillProgress.pronunciation.percentage >= 80) {
      badges.push({
        id: 'pronunciation_pro',
        name: 'Pronunciation Pro',
        description: 'Excellent pronunciation skills',
        icon: '🗣️',
        color: '#eb2f96',
        category: 'skills'
      });
    }

    if (skillProgress.grammar.percentage >= 80) {
      badges.push({
        id: 'grammar_guru',
        name: 'Grammar Guru',
        description: 'Mastered grammar concepts',
        icon: '📚',
        color: '#722ed1',
        category: 'skills'
      });
    }

    if (skillProgress.vocabulary.percentage >= 80) {
      badges.push({
        id: 'vocabulary_virtuoso',
        name: 'Vocabulary Virtuoso',
        description: 'Expanded vocabulary significantly',
        icon: '📖',
        color: '#52c41a',
        category: 'skills'
      });
    }

    if (skillProgress.listening.percentage >= 80) {
      badges.push({
        id: 'listening_legend',
        name: 'Listening Legend',
        description: 'Excellent listening comprehension',
        icon: '👂',
        color: '#1890ff',
        category: 'skills'
      });
    }

    if (skillProgress.speaking.percentage >= 80) {
      badges.push({
        id: 'speaking_star',
        name: 'Speaking Star',
        description: 'Outstanding speaking skills',
        icon: '🎤',
        color: '#faad14',
        category: 'skills'
      });
    }

    // Streak badges
    const recentSubmissions = allAssignmentSubmissions
      .concat(allQuizSubmissions)
      .filter(s => {
        const submissionDate = new Date(s.createdAt || s.submittedAt);
        const daysDiff = (new Date() - submissionDate) / (1000 * 60 * 60 * 24);
        return daysDiff <= 7;
      });

    if (recentSubmissions.length >= 5) {
      badges.push({
        id: 'consistent_learner',
        name: 'Consistent Learner',
        description: 'Completed 5+ activities this week',
        icon: '🔥',
        color: '#ff4d4f',
        category: 'streak'
      });
    }

    // First achievement badges
    if (assignmentStats.passed >= 1) {
      badges.push({
        id: 'first_assignment',
        name: 'First Assignment',
        description: 'Completed your first assignment',
        icon: '🎉',
        color: '#52c41a',
        category: 'milestone'
      });
    }

    if (quizStats.passed >= 1) {
      badges.push({
        id: 'first_quiz',
        name: 'First Quiz',
        description: 'Passed your first quiz',
        icon: '🎊',
        color: '#1890ff',
        category: 'milestone'
      });
    }

    // Check for new badges (you can store previous badges in student profile or separate collection)
    const newBadges = await checkForNewBadges(student._id, badges);

    res.json({
      student: {
        id: student._id,
        name: student.fullName,
        program: student.program
      },
      overall: {
        totalActivities,
        completedActivities,
        progressPercentage: Math.round(overallProgress),
        remainingActivities: totalActivities - completedActivities
      },
      breakdown: {
        assignments: {
          total: assignmentStats.total,
          completed: assignmentStats.completed,
          passed: assignmentStats.passed,
          percentage: assignmentStats.total > 0 ? Math.round((assignmentStats.completed / assignmentStats.total) * 100) : 0
        },
        quizzes: {
          total: quizStats.total,
          completed: quizStats.completed,
          passed: quizStats.passed,
          percentage: quizStats.total > 0 ? Math.round((quizStats.completed / quizStats.total) * 100) : 0
        },
        attendance: {
          total: attendanceStats.total,
          attended: attendanceStats.attended,
          partial: attendanceStats.partial,
          absent: attendanceStats.absent,
          percentage: attendanceStats.percentage
        }
      },
      skills: skillProgress,
      badges: badges,
      newBadges: newBadges, // Include new badges in response
      achievements: {
        totalBadges: badges.length,
        categories: {
          overall: badges.filter(b => b.category === 'overall').length,
          assignments: badges.filter(b => b.category === 'assignments').length,
          quizzes: badges.filter(b => b.category === 'quizzes').length,
          attendance: badges.filter(b => b.category === 'attendance').length,
          skills: badges.filter(b => b.category === 'skills').length,
          streak: badges.filter(b => b.category === 'streak').length,
          milestone: badges.filter(b => b.category === 'milestone').length
        }
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 