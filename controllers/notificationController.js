const express = require('express');
const Notification = require('../model/notificationModel');
const Student = require('../model/studentModel');
const { formatTimeForStudent } = require('../utils/timezoneUtils');
const router = express.Router();

// Helper function to emit notification to student
const emitNotificationToStudent = (studentEmail, notification) => {
  if (global.io) {
    global.io.to(`notifications-${studentEmail}`).emit('new-notification', {
      notification,
      unreadCount: 1 // Increment by 1 for new notification
    });
    console.log(`Emitted notification to student: ${studentEmail}`);
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