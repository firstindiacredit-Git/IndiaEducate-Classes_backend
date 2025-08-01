const express = require('express');
const AdminNotification = require('../model/adminNotificationModel');
const router = express.Router();

// Get all notifications for admin
router.get('/', async (req, res) => {
  try {
    const notifications = await AdminNotification.find()
      .sort({ createdAt: -1 })
      .limit(50);

    const unreadCount = await AdminNotification.countDocuments({ isRead: false });

    res.json({
      notifications,
      unreadCount
    });
  } catch (err) {
    console.error('Error fetching admin notifications:', err);
    res.status(500).json({ message: err.message });
  }
});

// Mark notification as read
router.put('/:notificationId/read', async (req, res) => {
  try {
    const { notificationId } = req.params;
    
    await AdminNotification.findByIdAndUpdate(notificationId, {
      isRead: true,
      readAt: new Date()
    });

    const unreadCount = await AdminNotification.countDocuments({ isRead: false });

    // Emit Socket.io event for real-time update
    if (global.io) {
      global.io.emit('admin-notification-read', { unreadCount });
    }

    res.json({ message: 'Notification marked as read', unreadCount });
  } catch (err) {
    console.error('Error marking notification as read:', err);
    res.status(500).json({ message: err.message });
  }
});

// Mark all notifications as read
router.put('/read-all', async (req, res) => {
  try {
    await AdminNotification.updateMany(
      { isRead: false },
      { 
        isRead: true, 
        readAt: new Date() 
      }
    );

    // Emit Socket.io event for real-time update
    if (global.io) {
      global.io.emit('admin-all-notifications-read');
    }

    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    console.error('Error marking all notifications as read:', err);
    res.status(500).json({ message: err.message });
  }
});

// Create notification for admin
router.post('/create', async (req, res) => {
  try {
    const { title, message, type, relatedClassId, metadata } = req.body;

    const notification = await AdminNotification.create({
      title,
      message,
      type,
      relatedClassId,
      metadata,
      isRead: false
    });

    // Emit Socket.io event for real-time notification
    if (global.io) {
      global.io.emit('admin-new-notification', {
        notification,
        unreadCount: 1
      });
    }

    res.status(201).json({
      message: 'Notification created successfully',
      notification
    });
  } catch (err) {
    console.error('Error creating admin notification:', err);
    res.status(500).json({ message: err.message });
  }
});

// Test endpoint for admin notifications
router.post('/test', async (req, res) => {
  try {
    const testNotification = await AdminNotification.create({
      title: 'Test Notification',
      message: 'This is a test notification for admin',
      type: 'test',
      isRead: false
    });

    // Emit Socket.io event for real-time notification
    if (global.io) {
      global.io.emit('admin-new-notification', {
        notification: testNotification,
        unreadCount: 1
      });
    }

    res.json({
      message: 'Test notification created successfully',
      notification: testNotification
    });
  } catch (err) {
    console.error('Error creating test notification:', err);
    res.status(500).json({ message: err.message });
  }
});

// Test endpoint for upcoming class warning
router.post('/test-upcoming-warning', async (req, res) => {
  try {
    const testNotification = await AdminNotification.create({
      title: '⚠️ Class Starting Soon',
      message: 'Your class "Test Class" starts in 5 minutes. Please start it now, otherwise it will expire/get cancelled after 10 minutes.',
      type: 'upcoming_class_warning',
      isRead: false,
      metadata: {
        classTitle: 'Test Class',
        program: '24-session',
        startTime: new Date(),
        duration: 60
      }
    });

    // Emit Socket.io event for real-time notification
    if (global.io) {
      global.io.emit('admin-new-notification', {
        notification: testNotification,
        unreadCount: 1
      });
    }

    res.json({
      message: 'Test upcoming class warning created successfully',
      notification: testNotification
    });
  } catch (err) {
    console.error('Error creating test upcoming warning:', err);
    res.status(500).json({ message: err.message });
  }
});

// Test endpoint for expired class notification
router.post('/test-expired', async (req, res) => {
  try {
    const testNotification = await AdminNotification.create({
      title: '❌ Class Expired',
      message: 'Class "Test Class" has expired because it wasn\'t started on time.',
      type: 'class_expired',
      isRead: false,
      metadata: {
        classTitle: 'Test Class',
        program: '24-session',
        startTime: new Date(),
        duration: 60
      }
    });

    // Emit Socket.io event for real-time notification
    if (global.io) {
      global.io.emit('admin-new-notification', {
        notification: testNotification,
        unreadCount: 1
      });
    }

    res.json({
      message: 'Test expired class notification created successfully',
      notification: testNotification
    });
  } catch (err) {
    console.error('Error creating test expired notification:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 