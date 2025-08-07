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

module.exports = router; 