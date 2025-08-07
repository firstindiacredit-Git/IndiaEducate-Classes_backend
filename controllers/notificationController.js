const express = require('express');
const Notification = require('../model/notificationModel');
const Student = require('../model/studentModel');
const FileUpload = require('../model/fileUploadModel');
const Quiz = require('../model/quizModel');
const Assignment = require('../model/assignmentModel');
const { formatTimeForStudent } = require('../utils/timezoneUtils');
const { 
  sendStudyMaterialNotificationEmail,
  sendQuizNotificationEmail,
  sendAssignmentNotificationEmail,
  sendWeeklyTestNotificationEmail,
  sendAssignmentReviewNotificationEmail,
  sendQuizReviewNotificationEmail
} = require('../utils/emailService');
const router = express.Router();

// Helper function to emit notification to student
const emitNotificationToStudent = (studentEmail, notification) => {
  if (global.io) {
    global.io.to(`notifications-${studentEmail}`).emit('new-notification', {
      notification,
      unreadCount: 1 // Increment by 1 for new notification
    });
    // console.log(`Emitted notification to student: ${studentEmail}`);
  }
};

// Helper function to create notification and send email
const createNotificationWithEmail = async (studentEmail, notificationData, emailData = null) => {
  try {
    // Create notification in database
    const notification = await Notification.create({
      studentEmail,
      ...notificationData
    });

    // Emit real-time notification
    emitNotificationToStudent(studentEmail, notification);

    // Send email notification if email data is provided
    if (emailData) {
      try {
        await emailData.sendEmailFunction(studentEmail, emailData.params);
      } catch (emailError) {
        console.error('Failed to send email notification:', emailError);
        // Don't fail the notification creation if email fails
      }
    }

    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
};

// Get notifications for a student
router.get('/:studentEmail', async (req, res) => {
  try {
    const { studentEmail } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    // Verify student exists
    const student = await Student.findOne({ email: studentEmail });
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Get notifications
    const notifications = await Notification.find({ studentEmail })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset))
      .lean();

    // Get unread count
    const unreadCount = await Notification.countDocuments({ 
      studentEmail, 
      isRead: false 
    });

    res.json({
      notifications,
      unreadCount,
      total: notifications.length
    });
  } catch (err) {
    console.error('Error fetching notifications:', err);
    res.status(500).json({ message: err.message });
  }
});

// Mark notification as read
router.put('/:notificationId/read', async (req, res) => {
  try {
    const { notificationId } = req.params;
    const { studentEmail } = req.body;

    // Verify student owns this notification
    const notification = await Notification.findOne({ 
      _id: notificationId, 
      studentEmail 
    });

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    // Mark as read
    await Notification.findByIdAndUpdate(notificationId, { isRead: true });

    // Emit updated unread count
    const unreadCount = await Notification.countDocuments({ 
      studentEmail, 
      isRead: false 
    });
    
    if (global.io) {
      global.io.to(`notifications-${studentEmail}`).emit('notification-read', {
        notificationId,
        unreadCount
      });
    }

    res.json({ message: 'Notification marked as read' });
  } catch (err) {
    console.error('Error marking notification as read:', err);
    res.status(500).json({ message: err.message });
  }
});

// Mark all notifications as read for a student
router.put('/:studentEmail/read-all', async (req, res) => {
  try {
    const { studentEmail } = req.params;

    // Verify student exists
    const student = await Student.findOne({ email: studentEmail });
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Mark all notifications as read
    await Notification.updateMany(
      { studentEmail, isRead: false },
      { isRead: true }
    );

    // Emit updated unread count
    if (global.io) {
      global.io.to(`notifications-${studentEmail}`).emit('all-notifications-read', {
        unreadCount: 0
      });
    }

    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    console.error('Error marking all notifications as read:', err);
    res.status(500).json({ message: err.message });
  }
});

// Delete a notification
router.delete('/:notificationId', async (req, res) => {
  try {
    const { notificationId } = req.params;
    const { studentEmail } = req.body;

    // Verify student owns this notification
    const notification = await Notification.findOne({ 
      _id: notificationId, 
      studentEmail 
    });

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    // Delete notification
    await Notification.findByIdAndDelete(notificationId);

    // Emit updated unread count
    const unreadCount = await Notification.countDocuments({ 
      studentEmail, 
      isRead: false 
    });
    
    if (global.io) {
      global.io.to(`notifications-${studentEmail}`).emit('notification-deleted', {
        notificationId,
        unreadCount
      });
    }

    res.json({ message: 'Notification deleted' });
  } catch (err) {
    console.error('Error deleting notification:', err);
    res.status(500).json({ message: err.message });
  }
});

// ===== STUDY MATERIAL NOTIFICATIONS =====

// Notify students about new study material upload
router.post('/study-material-uploaded', async (req, res) => {
  try {
    const { fileId, adminEmailOrPhone } = req.body;

    // Get file details
    const file = await FileUpload.findById(fileId).populate('uploadedBy', 'fullName');
    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Get all students (or filter by program if needed)
    const students = await Student.find({ isVerified: true });
    
    if (students.length === 0) {
      return res.status(404).json({ message: 'No students found' });
    }

    // Create notifications for all students
    const notifications = [];
    for (const student of students) {
      const notificationData = {
        type: 'study_material_uploaded',
        title: 'New Study Material Available',
        message: `New ${file.fileType} file "${file.fileName}" has been uploaded by ${file.uploadedBy.fullName}`,
        metadata: {
          fileId: file._id,
          fileName: file.fileName,
          fileType: file.fileType,
          category: file.category,
          uploadedBy: file.uploadedBy.fullName,
          fileSize: file.fileSize,
          description: file.description
        }
      };

      const emailData = {
        sendEmailFunction: sendStudyMaterialNotificationEmail,
        params: {
          studentName: student.fullName,
          fileName: file.fileName,
          fileType: file.fileType,
          category: file.category,
          uploadedBy: file.uploadedBy.fullName,
          description: file.description,
          fileSize: file.fileSize,
          studentCountry: student.country
        }
      };

      const notification = await createNotificationWithEmail(student.email, notificationData, emailData);
      notifications.push(notification);
    }

    res.status(201).json({
      message: `Notifications sent to ${students.length} students`,
      count: notifications.length
    });
  } catch (err) {
    console.error('Error creating study material notifications:', err);
    res.status(500).json({ message: err.message });
  }
});

// ===== QUIZ NOTIFICATIONS =====

// Notify students about new quiz
router.post('/quiz-created', async (req, res) => {
  try {
    const { quizId, adminEmailOrPhone } = req.body;

    // Get quiz details
    const quiz = await Quiz.findById(quizId).populate('createdBy', 'fullName');
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    // Get students assigned to this quiz or all students if none assigned
    let students;
    if (quiz.assignedTo && quiz.assignedTo.length > 0) {
      students = await Student.find({ 
        _id: { $in: quiz.assignedTo },
        isVerified: true 
      });
    } else {
      students = await Student.find({ isVerified: true });
    }

    if (students.length === 0) {
      return res.status(404).json({ message: 'No students found' });
    }

    // Format dates for student timezones
    const startDateFormatted = formatTimeForStudent(quiz.startDate, 'India'); // Default timezone
    const endDateFormatted = formatTimeForStudent(quiz.endDate, 'India');

    // Create notifications for students
    const notifications = [];
    for (const student of students) {
      const studentStartDate = formatTimeForStudent(quiz.startDate, student.country);
      const studentEndDate = formatTimeForStudent(quiz.endDate, student.country);

      const notificationData = {
        type: 'quiz_created',
        title: 'New Quiz Available',
        message: `New ${quiz.type} quiz "${quiz.title}" is now available. Duration: ${quiz.duration} minutes. Deadline: ${studentEndDate.date} at ${studentEndDate.time} (${studentEndDate.timezone})`,
        metadata: {
          quizId: quiz._id,
          quizTitle: quiz.title,
          quizType: quiz.type,
          subject: quiz.subject,
          duration: quiz.duration,
          totalMarks: quiz.totalMarks,
          passingMarks: quiz.passingMarks,
          startDate: quiz.startDate,
          endDate: quiz.endDate,
          createdBy: quiz.createdBy.fullName,
          studentTimezone: studentStartDate.timezone
        }
      };

      const emailData = {
        sendEmailFunction: sendQuizNotificationEmail,
        params: {
          studentName: student.fullName,
          quizTitle: quiz.title,
          quizType: quiz.type,
          subject: quiz.subject,
          duration: quiz.duration,
          totalMarks: quiz.totalMarks,
          passingMarks: quiz.passingMarks,
          startDate: studentStartDate,
          endDate: studentEndDate,
          createdBy: quiz.createdBy.fullName,
          studentCountry: student.country
        }
      };

      const notification = await createNotificationWithEmail(student.email, notificationData, emailData);
      notifications.push(notification);
    }

    res.status(201).json({
      message: `Quiz notifications sent to ${students.length} students`,
      count: notifications.length
    });
  } catch (err) {
    console.error('Error creating quiz notifications:', err);
    res.status(500).json({ message: err.message });
  }
});

// Notify students about weekly test
router.post('/weekly-test-created', async (req, res) => {
  try {
    const { quizId, adminEmailOrPhone } = req.body;

    // Get quiz details
    const quiz = await Quiz.findById(quizId).populate('createdBy', 'fullName');
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    // Get all students
    const students = await Student.find({ isVerified: true });
    
    if (students.length === 0) {
      return res.status(404).json({ message: 'No students found' });
    }

    // Create notifications for all students
    const notifications = [];
    for (const student of students) {
      const studentStartDate = formatTimeForStudent(quiz.startDate, student.country);
      const studentEndDate = formatTimeForStudent(quiz.endDate, student.country);

      const notificationData = {
        type: 'weekly_test_created',
        title: 'Weekly Test Available',
        message: `Weekly ${quiz.subject} test "${quiz.title}" is now available. Duration: ${quiz.duration} minutes. Deadline: ${studentEndDate.date} at ${studentEndDate.time} (${studentEndDate.timezone})`,
        metadata: {
          quizId: quiz._id,
          quizTitle: quiz.title,
          subject: quiz.subject,
          duration: quiz.duration,
          totalMarks: quiz.totalMarks,
          passingMarks: quiz.passingMarks,
          startDate: quiz.startDate,
          endDate: quiz.endDate,
          createdBy: quiz.createdBy.fullName,
          studentTimezone: studentStartDate.timezone,
          weekNumber: quiz.weekNumber
        }
      };

      const emailData = {
        sendEmailFunction: sendWeeklyTestNotificationEmail,
        params: {
          studentName: student.fullName,
          quizTitle: quiz.title,
          subject: quiz.subject,
          duration: quiz.duration,
          totalMarks: quiz.totalMarks,
          passingMarks: quiz.passingMarks,
          startDate: studentStartDate,
          endDate: studentEndDate,
          createdBy: quiz.createdBy.fullName,
          studentCountry: student.country,
          weekNumber: quiz.weekNumber
        }
      };

      const notification = await createNotificationWithEmail(student.email, notificationData, emailData);
      notifications.push(notification);
    }

    res.status(201).json({
      message: `Weekly test notifications sent to ${students.length} students`,
      count: notifications.length
    });
  } catch (err) {
    console.error('Error creating weekly test notifications:', err);
    res.status(500).json({ message: err.message });
  }
});

// ===== ASSIGNMENT NOTIFICATIONS =====

// Notify students about new assignment
router.post('/assignment-created', async (req, res) => {
  try {
    const { assignmentId, adminEmailOrPhone } = req.body;

    // Get assignment details
    const assignment = await Assignment.findById(assignmentId).populate('createdBy', 'fullName');
    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    // Get students assigned to this assignment or all students if none assigned
    let students;
    if (assignment.assignedTo && assignment.assignedTo.length > 0) {
      students = await Student.find({ 
        _id: { $in: assignment.assignedTo },
        isVerified: true 
      });
    } else {
      students = await Student.find({ isVerified: true });
    }

    if (students.length === 0) {
      return res.status(404).json({ message: 'No students found' });
    }

    // Create notifications for students
    const notifications = [];
    for (const student of students) {
      const studentStartDate = formatTimeForStudent(assignment.startDate, student.country);
      const studentEndDate = formatTimeForStudent(assignment.endDate, student.country);

      const notificationData = {
        type: 'assignment_created',
        title: 'New Assignment Available',
        message: `New ${assignment.type} assignment "${assignment.title}" is now available. Duration: ${assignment.duration} minutes. Deadline: ${studentEndDate.date} at ${studentEndDate.time} (${studentEndDate.timezone})`,
        metadata: {
          assignmentId: assignment._id,
          assignmentTitle: assignment.title,
          assignmentType: assignment.type,
          subject: assignment.subject,
          duration: assignment.duration,
          totalMarks: assignment.totalMarks,
          passingMarks: assignment.passingMarks,
          startDate: assignment.startDate,
          endDate: assignment.endDate,
          createdBy: assignment.createdBy.fullName,
          studentTimezone: studentStartDate.timezone,
          instructions: assignment.instructions
        }
      };

      const emailData = {
        sendEmailFunction: sendAssignmentNotificationEmail,
        params: {
          studentName: student.fullName,
          assignmentTitle: assignment.title,
          assignmentType: assignment.type,
          subject: assignment.subject,
          duration: assignment.duration,
          totalMarks: assignment.totalMarks,
          passingMarks: assignment.passingMarks,
          startDate: studentStartDate,
          endDate: studentEndDate,
          createdBy: assignment.createdBy.fullName,
          studentCountry: student.country,
          instructions: assignment.instructions
        }
      };

      const notification = await createNotificationWithEmail(student.email, notificationData, emailData);
      notifications.push(notification);
    }

    res.status(201).json({
      message: `Assignment notifications sent to ${students.length} students`,
      count: notifications.length
    });
  } catch (err) {
    console.error('Error creating assignment notifications:', err);
    res.status(500).json({ message: err.message });
  }
});

// ===== REVIEW NOTIFICATIONS =====

// Notify student about assignment review
router.post('/assignment-reviewed', async (req, res) => {
  try {
    const { studentEmail, assignmentTitle, score, totalMarks, isPassed, adminFeedback } = req.body;

    // Verify student exists
    const student = await Student.findOne({ email: studentEmail });
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const notificationData = {
      type: 'assignment_reviewed',
      title: 'Assignment Reviewed',
      message: `Your assignment "${assignmentTitle}" has been reviewed. Score: ${score}/${totalMarks} (${isPassed ? 'Passed' : 'Failed'})`,
      metadata: {
        assignmentTitle,
        score,
        totalMarks,
        isPassed,
        adminFeedback,
        percentage: Math.round((score / totalMarks) * 100)
      }
    };

    const emailData = {
      sendEmailFunction: sendAssignmentReviewNotificationEmail,
      params: {
        studentName: student.fullName,
        assignmentTitle,
        score,
        totalMarks,
        isPassed,
        adminFeedback,
        percentage: Math.round((score / totalMarks) * 100),
        studentCountry: student.country
      }
    };

    const notification = await createNotificationWithEmail(studentEmail, notificationData, emailData);

    res.status(201).json({
      message: 'Assignment review notification sent',
      notification
    });
  } catch (err) {
    console.error('Error creating assignment review notification:', err);
    res.status(500).json({ message: err.message });
  }
});

// Notify student about quiz review
router.post('/quiz-reviewed', async (req, res) => {
  try {
    const { studentEmail, quizTitle, score, totalMarks, isPassed, adminFeedback } = req.body;

    // Verify student exists
    const student = await Student.findOne({ email: studentEmail });
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const notificationData = {
      type: 'quiz_reviewed',
      title: 'Quiz Reviewed',
      message: `Your quiz "${quizTitle}" has been reviewed. Score: ${score}/${totalMarks} (${isPassed ? 'Passed' : 'Failed'})`,
      metadata: {
        quizTitle,
        score,
        totalMarks,
        isPassed,
        adminFeedback,
        percentage: Math.round((score / totalMarks) * 100)
      }
    };

    const emailData = {
      sendEmailFunction: sendQuizReviewNotificationEmail,
      params: {
        studentName: student.fullName,
        quizTitle,
        score,
        totalMarks,
        isPassed,
        adminFeedback,
        percentage: Math.round((score / totalMarks) * 100),
        studentCountry: student.country
      }
    };

    const notification = await createNotificationWithEmail(studentEmail, notificationData, emailData);

    res.status(201).json({
      message: 'Quiz review notification sent',
      notification
    });
  } catch (err) {
    console.error('Error creating quiz review notification:', err);
    res.status(500).json({ message: err.message });
  }
});

// ===== LEGACY ENDPOINTS (for backward compatibility) =====

// Create notification (admin function)
router.post('/create', async (req, res) => {
  try {
    const { studentEmail, type, title, message, relatedClassId, metadata } = req.body;

    // Verify student exists
    const student = await Student.findOne({ email: studentEmail });
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Create notification
    const notification = await Notification.create({
      studentEmail,
      type,
      title,
      message,
      relatedClassId,
      metadata
    });

    // Emit real-time notification
    emitNotificationToStudent(studentEmail, notification);

    res.status(201).json({
      message: 'Notification created successfully',
      notification
    });
  } catch (err) {
    console.error('Error creating notification:', err);
    res.status(500).json({ message: err.message });
  }
});

// Create notifications for all students in a program
router.post('/create-for-program', async (req, res) => {
  try {
    const { program, type, title, message, relatedClassId, metadata } = req.body;

    // Get all students in the program
    const students = await Student.find({ program });
    
    if (students.length === 0) {
      return res.status(404).json({ message: 'No students found in this program' });
    }

    // Create notifications for all students
    const notifications = await Promise.all(
      students.map(student => 
        Notification.create({
          studentEmail: student.email,
          type,
          title,
          message,
          relatedClassId,
          metadata
        })
      )
    );

    // Emit real-time notifications to all students
    notifications.forEach(notification => {
      emitNotificationToStudent(notification.studentEmail, notification);
    });

    res.status(201).json({
      message: `Notifications created for ${students.length} students`,
      count: notifications.length
    });
  } catch (err) {
    console.error('Error creating notifications for program:', err);
    res.status(500).json({ message: err.message });
  }
});

// Test endpoint to create sample notifications
router.post('/test/:studentEmail', async (req, res) => {
  try {
    const { studentEmail } = req.params;
    
    // Verify student exists
    const student = await Student.findOne({ email: studentEmail });
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Get timezone formatted times for student's country
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    
    const tomorrowFormatted = formatTimeForStudent(tomorrow, student.country);
    const twoHoursFromNowFormatted = formatTimeForStudent(twoHoursFromNow, student.country);
    const twoHoursAgoFormatted = formatTimeForStudent(twoHoursAgo, student.country);

    // Create sample notifications with timezone-aware messages
    const sampleNotifications = [
      {
        studentEmail,
        type: 'class_scheduled',
        title: 'New Class Scheduled',
        message: `Mathematics Class has been scheduled for ${tomorrowFormatted.date} at ${tomorrowFormatted.time} (${tomorrowFormatted.timezone})`,
        metadata: {
          classTitle: 'Mathematics Class',
          program: student.program,
          startTime: tomorrow,
          duration: 60,
          timezone: tomorrowFormatted.timezone
        }
      },
      {
        studentEmail,
        type: 'class_updated',
        title: 'Class Updated',
        message: `Science Class time has been changed to ${twoHoursFromNowFormatted.time} (${twoHoursFromNowFormatted.timezone})`,
        metadata: {
          classTitle: 'Science Class',
          program: student.program,
          startTime: twoHoursFromNow,
          duration: 90,
          timezone: twoHoursFromNowFormatted.timezone
        }
      },
      {
        studentEmail,
        type: 'class_cancelled',
        title: 'Class Cancelled',
        message: `English Class scheduled for ${twoHoursAgoFormatted.date} at ${twoHoursAgoFormatted.time} (${twoHoursAgoFormatted.timezone}) has been cancelled`,
        metadata: {
          classTitle: 'English Class',
          program: student.program,
          startTime: twoHoursAgo,
          duration: 60,
          timezone: twoHoursAgoFormatted.timezone
        }
      }
    ];

    const createdNotifications = await Promise.all(
      sampleNotifications.map(notification => Notification.create(notification))
    );

    // Emit real-time notifications
    createdNotifications.forEach(notification => {
      emitNotificationToStudent(notification.studentEmail, notification);
    });

    res.json({
      message: 'Sample notifications created successfully',
      count: createdNotifications.length,
      notifications: createdNotifications
    });
  } catch (err) {
    console.error('Error creating test notifications:', err);
    res.status(500).json({ message: err.message });
  }
}); 

// Test endpoint to verify timezone conversion
router.get('/test-timezone/:studentEmail', async (req, res) => {
  try {
    const { studentEmail } = req.params;
    
    // Verify student exists
    const student = await Student.findOne({ email: studentEmail });
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Test timezone conversion
    const testTime = new Date();
    const formattedTime = formatTimeForStudent(testTime, student.country);
    
    res.json({
      student: {
        email: student.email,
        country: student.country,
        fullName: student.fullName
      },
      timezoneTest: {
        utcTime: testTime.toISOString(),
        localTime: formattedTime,
        timezone: formattedTime.timezone
      }
    });
  } catch (err) {
    console.error('Error testing timezone conversion:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 