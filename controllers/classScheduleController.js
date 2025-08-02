const express = require('express');
const ClassSchedule = require('../model/classScheduleModel');
const Student = require('../model/studentModel');
const Attendance = require('../model/attendanceModel');
const Notification = require('../model/notificationModel');
const AdminNotification = require('../model/adminNotificationModel');
const { sendClassScheduledEmail, sendClassUpdatedEmail, sendClassCancelledEmail, sendClassStartedEmail } = require('../utils/emailService');
const { formatTimeForStudent } = require('../utils/timezoneUtils');
const router = express.Router();

// Function to send emails to all students in a program
const sendEmailsToProgramStudents = async (program, emailFunction, classDetails) => {
  try {
    const students = await Student.find({ program });
    
    const emailPromises = students.map(async (student) => {
      try {
        await emailFunction(student.email, student.fullName || 'Student', classDetails, student.country);
        console.log(`Email sent to ${student.email} for class: ${classDetails.title}`);
      } catch (error) {
        console.error(`Failed to send email to ${student.email}:`, error);
      }
    });

    await Promise.all(emailPromises);
    console.log(`Emails sent to ${students.length} students in program: ${program}`);
  } catch (error) {
    console.error('Error sending emails to students:', error);
  }
};

// Function to create notifications for all students in a program
const createNotificationsForProgram = async (program, notificationType, classDetails) => {
  try {
    const students = await Student.find({ program });
    
    const notificationPromises = students.map(async (student) => {
      try {
        let title, message;
        
        // Get timezone formatted times for student's country
        const startTimeFormatted = formatTimeForStudent(classDetails.startTime, student.country);
        const endTime = new Date(classDetails.startTime.getTime() + (classDetails.duration * 60000));
        const endTimeFormatted = formatTimeForStudent(endTime, student.country);
        
        switch (notificationType) {
          case 'class_scheduled':
            title = 'New Class Scheduled';
            message = `${classDetails.title} has been scheduled for ${startTimeFormatted.date} at ${startTimeFormatted.time} (${startTimeFormatted.timezone})`;
            break;
          case 'class_updated':
            title = 'Class Updated';
            message = `${classDetails.title} has been updated. New time: ${startTimeFormatted.date} at ${startTimeFormatted.time} (${startTimeFormatted.timezone})`;
            break;
          case 'class_cancelled':
            title = 'Class Cancelled';
            message = `${classDetails.title} scheduled for ${startTimeFormatted.date} at ${startTimeFormatted.time} (${startTimeFormatted.timezone}) has been cancelled`;
            break;
          case 'class_started':
            title = '🎥 LIVE CLASS STARTED';
            message = `${classDetails.title} has started! Click to join: ${classDetails.meetingLink}`;
            break;
          default:
            title = 'Class Notification';
            message = `Update regarding ${classDetails.title}`;
        }

        const notification = await Notification.create({
          studentEmail: student.email,
          type: notificationType,
          title,
          message,
          relatedClassId: classDetails._id,
          metadata: {
            classTitle: classDetails.title,
            program: classDetails.program,
            startTime: classDetails.startTime,
            duration: classDetails.duration,
            timezone: startTimeFormatted.timezone,
            localStartTime: startTimeFormatted.fullDateTime,
            localEndTime: endTimeFormatted.fullDateTime
          }
        });
        
        // Emit real-time notification via Socket.io
        if (global.io) {
          global.io.to(`notifications-${student.email}`).emit('new-notification', {
            notification,
            unreadCount: 1
          });
          console.log(`Real-time notification emitted to ${student.email} for class: ${classDetails.title}`);
        }
        
        console.log(`Notification created for ${student.email} for class: ${classDetails.title}`);
      } catch (error) {
        console.error(`Failed to create notification for ${student.email}:`, error);
      }
    });

    await Promise.all(notificationPromises);
    console.log(`Notifications created for ${students.length} students in program: ${program}`);
  } catch (error) {
    console.error('Error creating notifications for students:', error);
  }
};

// Function to create admin notifications
const createAdminNotification = async (notificationType, classDetails) => {
  try {
    let title, message;
    
    switch (notificationType) {
      case 'upcoming_class_warning':
        title = '⚠️ Class Starting Soon';
        message = `Your class "${classDetails.title}" starts in 5 minutes. Please start it now, otherwise it will expire/get cancelled after 10 minutes.`;
        break;
      case 'class_expired':
        title = '❌ Class Expired';
        message = `Class "${classDetails.title}" has expired because it wasn't started on time.`;
        break;
      case 'class_started':
        title = '✅ Class Started';
        message = `Class "${classDetails.title}" has been started successfully.`;
        break;
      default:
        title = 'Class Notification';
        message = `Update regarding ${classDetails.title}`;
    }

    const notification = await AdminNotification.create({
      title,
      message,
      type: notificationType,
      relatedClassId: classDetails._id,
      metadata: {
        classTitle: classDetails.title,
        program: classDetails.program,
        startTime: classDetails.startTime,
        duration: classDetails.duration
      },
      isRead: false
    });

    // Emit real-time notification via Socket.io
    if (global.io) {
      global.io.emit('admin-new-notification', {
        notification,
        unreadCount: 1
      });
      console.log(`Admin notification emitted for class: ${classDetails.title}`);
    }

    console.log(`Admin notification created for class: ${classDetails.title}`);
  } catch (error) {
    console.error('Error creating admin notification:', error);
  }
};

// Function to check and update class statuses
const updateClassStatuses = async () => {
  try {
    const now = new Date();
    // console.log('Running status update check at:', now);
    
    // Check for upcoming classes (5 minutes before start time)
    const upcomingClasses = await ClassSchedule.find({
      status: 'scheduled',
      startTime: { 
        $gt: now,
        $lte: new Date(now.getTime() + 5 * 60000) // Within next 5 minutes
      }
    });

    // Create admin notifications for upcoming classes
    for (const classItem of upcomingClasses) {
      const startTime = new Date(classItem.startTime);
      const minutesUntilStart = Math.floor((startTime - now) / (1000 * 60));
      
      // Check if we haven't already sent a notification for this class
      const existingNotification = await AdminNotification.findOne({
        relatedClassId: classItem._id,
        type: 'upcoming_class_warning'
      });

      if (!existingNotification && minutesUntilStart <= 5) {
        await createAdminNotification('upcoming_class_warning', classItem);
      }
    }
    
    // Find all scheduled classes that have passed their start time
    const scheduledClasses = await ClassSchedule.find({
      status: 'scheduled',
      startTime: { $lt: now }
    });

    // console.log('Found scheduled classes to check:', scheduledClasses);

    // Update expired classes
    for (const classItem of scheduledClasses) {
      const startTime = new Date(classItem.startTime);
      const minutesPassed = Math.floor((now - startTime) / (1000 * 60));
      
      // If 5 minutes have passed since start time and class wasn't started
      if (minutesPassed >= 5) {
        // console.log(`Class ${classItem._id} has expired. Minutes passed: ${minutesPassed}`);
        await ClassSchedule.findByIdAndUpdate(classItem._id, {
          status: 'expired',
          updatedAt: now
        });

        // Emit Socket.io event for class status change
        if (global.io) {
          global.io.emit('class-status-changed', {
            classId: classItem._id,
            status: 'expired',
            program: classItem.program,
            title: classItem.title
          });
          
          // Emit specific event for expired classes
          global.io.emit('new-expired-class', {
            classId: classItem._id,
            status: 'expired',
            program: classItem.program,
            title: classItem.title,
            startTime: classItem.startTime,
            duration: classItem.duration
          });
        }

        // Send cancellation emails to all students in the program
        await sendEmailsToProgramStudents(classItem.program, sendClassCancelledEmail, classItem);

        // Create notifications for all students in the program
        await createNotificationsForProgram(classItem.program, 'class_cancelled', classItem);

        // Create admin notification for expired class
        await createAdminNotification('class_expired', classItem);

        // Create absent records for all students in this program
        const students = await Student.find({ program: classItem.program });
        const existingAttendance = await Attendance.find({ classId: classItem._id });
        
        await Promise.all(students.map(async (student) => {
          // Check if student already has an attendance record
          const existingRecord = existingAttendance.find(a => 
            a.studentId.toString() === student._id.toString()
          );
          
          if (!existingRecord) {
            // Only create absent record if student doesn't have any attendance record
            try {
              await Attendance.create({
                classId: classItem._id,
                studentId: student._id,
                status: 'absent',
                joinTime: classItem.startTime,
                duration: 0,
                isAttendanceMarked: true
              });
            } catch (error) {
              // Handle duplicate key error - record might already exist
              console.log(`Attendance record already exists for student ${student._id} in class ${classItem._id}`);
            }
          } else {
            // Student has an attendance record - update it if they didn't leave
            if (!existingRecord.leaveTime) {
              // Calculate duration from join to class start time (since class expired)
              const duration = Math.floor((classItem.startTime - existingRecord.joinTime) / (1000 * 60));
              
              let finalStatus = 'absent';
              if (duration >= 5) {
                finalStatus = 'partial';
              }
              
              console.log(`Expired class ${classItem._id} - Student ${student._id}:`);
              console.log(`- Duration: ${duration} minutes`);
              console.log(`- Final status: ${finalStatus}`);
              
              await Attendance.findByIdAndUpdate(existingRecord._id, {
                status: finalStatus,
                duration: Math.max(0, duration),
                isAttendanceMarked: true,
                leaveTime: classItem.startTime
              });
            }
          }
        }));
      }
    }

    // Find all ongoing classes that should be completed
    const ongoingClasses = await ClassSchedule.find({
      status: 'ongoing'
    });

    // Update completed classes
    for (const classItem of ongoingClasses) {
      const startTime = new Date(classItem.startTime);
      const endTime = new Date(startTime.getTime() + (classItem.duration * 60000));
      
      if (now > endTime) {
        console.log(`Class ${classItem._id} has completed its duration. Auto-ending meeting...`);
        
        // Auto-end the Jitsi meeting by updating status
        await ClassSchedule.findByIdAndUpdate(classItem._id, {
          status: 'completed',
          meetingId: null,
          meetingLink: null,
          completedAt: now,
          updatedAt: now
        });

        // Emit Socket.io event for class status change
        if (global.io) {
          global.io.emit('class-status-changed', {
            classId: classItem._id,
            status: 'completed',
            program: classItem.program,
            title: classItem.title
          });
        }

        // Send notification to all participants (if needed)
        console.log(`Meeting for class ${classItem.title} has been automatically ended due to time completion.`);

        // Update attendance for all students in this program
        const allStudents = await Student.find({ program: classItem.program });
        const attendance = await Attendance.find({ classId: classItem._id });

        await Promise.all(allStudents.map(async (student) => {
          const studentAttendance = attendance.find(a => 
            a.studentId.toString() === student._id.toString()
          );

          if (!studentAttendance) {
            // Student didn't join at all - mark as absent
            try {
              await Attendance.create({
                classId: classItem._id,
                studentId: student._id,
                status: 'absent',
                joinTime: classItem.startTime,
                duration: 0,
                isAttendanceMarked: true
              });
            } catch (error) {
              // Handle duplicate key error - record might already exist
              console.log(`Attendance record already exists for student ${student._id} in class ${classItem._id}`);
            }
          } else {
            // Student joined - calculate final status based on duration
            const classDuration = classItem.duration;
            let studentDuration = studentAttendance.duration || 0;
            
            // Calculate actual duration if student didn't leave
            let actualDuration = studentDuration;
            if (!studentAttendance.leaveTime) {
              // Student didn't leave - calculate duration from join to class end
              const classEndTime = new Date(classItem.startTime.getTime() + (classItem.duration * 60000));
              actualDuration = Math.floor((classEndTime - studentAttendance.joinTime) / (1000 * 60));
            }
            
            let finalStatus = 'absent';
            
            if (actualDuration >= classDuration * 0.8) {
              // Attended 80% or more of the class
              finalStatus = 'present';
            } else if (actualDuration >= 5) {
              // Attended at least 5 minutes but less than 80%
              finalStatus = 'partial';
            } else {
              // Attended less than 5 minutes
              finalStatus = 'absent';
            }

            console.log(`Auto-ending class ${classItem._id} - Student ${student._id}:`);
            console.log(`- Student duration: ${studentDuration} minutes`);
            console.log(`- Actual duration: ${actualDuration} minutes`);
            console.log(`- Class duration: ${classDuration} minutes`);
            console.log(`- Attendance percentage: ${((actualDuration / classDuration) * 100).toFixed(2)}%`);
            console.log(`- Final status: ${finalStatus}`);

            // Update the attendance record with final status
            await Attendance.findByIdAndUpdate(studentAttendance._id, {
              status: finalStatus,
              duration: actualDuration,
              isAttendanceMarked: true,
              leaveTime: studentAttendance.leaveTime || new Date()
            });
          }
        }));
      }
    }
  } catch (err) {
    console.error('Error updating class statuses:', err);
  }
};

// Run status updates more frequently (every 30 seconds)
setInterval(updateClassStatuses, 30000);

// Also run immediately when server starts
updateClassStatuses();

// Create a new class schedule
router.post('/create', async (req, res) => {
  try {
    const { title, description, startTime, duration, program } = req.body;
    const adminId = req.body.adminId;

    // Validate duration
    if (!duration || duration < 5 || duration > 180) {
      return res.status(400).json({ 
        message: 'Duration must be between 5 and 180 minutes' 
      });
    }

    const classSchedule = await ClassSchedule.create({
      title,
      description,
      startTime: new Date(startTime),
      duration,
      program,
      createdBy: adminId,
      status: 'scheduled'
    });

    // Send email notifications to all students in the program
    await sendEmailsToProgramStudents(program, sendClassScheduledEmail, classSchedule);

    // Create notifications for all students in the program
    await createNotificationsForProgram(program, 'class_scheduled', classSchedule);

    // Emit Socket.io event for new class scheduled
    if (global.io) {
      global.io.emit('new-class-scheduled', {
        classId: classSchedule._id,
        title: classSchedule.title,
        program: classSchedule.program,
        startTime: classSchedule.startTime,
        duration: classSchedule.duration
      });
    }

    res.status(201).json({
      message: 'Class scheduled successfully',
      schedule: classSchedule
    });
  } catch (err) {
    console.error('Error creating class:', err);
    res.status(500).json({ message: err.message });
  }
});

// Get all upcoming classes for a program
router.get('/upcoming/:program', async (req, res) => {
  try {
    const { program } = req.params;
    const now = new Date();

    // First run the status update
    await updateClassStatuses();

    // Then get the updated classes
    const query = {
      $or: [
        // Classes that haven't started yet or are within 5 minutes of start time
        {
          $and: [
            { status: 'scheduled' },
            {
              $or: [
                { startTime: { $gt: now } },
                {
                  startTime: {
                    $gt: new Date(now.getTime() - 5 * 60000) // within last 5 minutes
                  }
                }
              ]
            }
          ]
        },
        // Currently ongoing classes
        {
          status: 'ongoing'
        }
      ]
    };

    // Only filter by program if it's not 'all'
    if (program !== 'all') {
      query.program = program;
    }

    const classes = await ClassSchedule.find(query)
      .sort({ startTime: 1 })
      .lean();

    res.json(classes);
  } catch (err) {
    console.error('Error fetching upcoming classes:', err);
    res.status(500).json({ message: err.message });
  }
});

// Start a class (create Jitsi meeting)
router.post('/start/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const meetingId = 'class_' + Math.random().toString(36).substr(2, 9);
    const meetingLink = `https://meet.jit.si/${meetingId}`;

    const classSchedule = await ClassSchedule.findByIdAndUpdate(
      id,
      {
        status: 'ongoing',
        meetingId,
        meetingLink
      },
      { new: true }
    );

    if (!classSchedule) {
      return res.status(404).json({ message: 'Class schedule not found' });
    }

    // Send email notifications to all students in the program about class starting
    await sendEmailsToProgramStudents(classSchedule.program, sendClassStartedEmail, classSchedule);

    // Create notifications for all students in the program
    await createNotificationsForProgram(classSchedule.program, 'class_started', classSchedule);

    // Create admin notification for class started
    await createAdminNotification('class_started', classSchedule);

    // Emit Socket.io event for class started
    if (global.io) {
      global.io.emit('class-status-changed', {
        classId: classSchedule._id,
        status: 'ongoing',
        program: classSchedule.program,
        title: classSchedule.title,
        updates: {
          meetingId,
          meetingLink
        }
      });
    }

    res.json({
      message: 'Class started successfully',
      schedule: classSchedule
    });
  } catch (err) {
    console.error('Error starting class:', err);
    res.status(500).json({ message: err.message });
  }
});

// End a class
router.post('/end/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Find the class and update its status
    const classSchedule = await ClassSchedule.findByIdAndUpdate(
      id,
      {
        status: 'completed',
        meetingId: null,
        meetingLink: null,
        completedAt: new Date()
      },
      { new: true }
    );

    if (!classSchedule) {
      return res.status(404).json({ message: 'Class schedule not found' });
    }

    // Mark attendance for students who didn't attend
    const allStudents = await Student.find({ program: classSchedule.program });
    const attendance = await Attendance.find({ classId: id });

    // Process attendance for all students
    const attendancePromises = allStudents.map(async (student) => {
      const studentAttendance = attendance.find(a => 
        a.studentId.toString() === student._id.toString()
      );

      if (!studentAttendance) {
        // Student didn't join at all - mark as absent
        try {
          await Attendance.create({
            classId: id,
            studentId: student._id,
            status: 'absent',
            joinTime: classSchedule.startTime,
            duration: 0,
            isAttendanceMarked: true
          });
        } catch (error) {
          // Handle duplicate key error - record might already exist
          console.log(`Attendance record already exists for student ${student._id} in class ${id}`);
        }
      } else {
        // Student joined - calculate final status based on duration
        const classDuration = classSchedule.duration;
        let studentDuration = studentAttendance.duration || 0;
        
        // Calculate actual duration if student didn't leave
        let actualDuration = studentDuration;
        if (!studentAttendance.leaveTime) {
          // Student didn't leave - calculate duration from join to class end
          const classEndTime = new Date(classSchedule.startTime.getTime() + (classSchedule.duration * 60000));
          actualDuration = Math.floor((classEndTime - studentAttendance.joinTime) / (1000 * 60));
        }
        
        let finalStatus = 'absent';
        
        if (actualDuration >= classDuration * 0.8) {
          // Attended 80% or more of the class
          finalStatus = 'present';
        } else if (actualDuration >= 5) {
          // Attended at least 5 minutes but less than 80%
          finalStatus = 'partial';
        } else {
          // Attended less than 5 minutes
          finalStatus = 'absent';
        }

        console.log(`Manual ending class ${id} - Student ${student._id}:`);
        console.log(`- Student duration: ${studentDuration} minutes`);
        console.log(`- Actual duration: ${actualDuration} minutes`);
        console.log(`- Class duration: ${classDuration} minutes`);
        console.log(`- Attendance percentage: ${((actualDuration / classDuration) * 100).toFixed(2)}%`);
        console.log(`- Final status: ${finalStatus}`);

        // Update the attendance record with final status
        await Attendance.findByIdAndUpdate(studentAttendance._id, {
          status: finalStatus,
          duration: actualDuration,
          isAttendanceMarked: true,
          leaveTime: studentAttendance.leaveTime || new Date()
        });
      }
    });

    await Promise.all(attendancePromises);

    res.json({
      message: 'Class ended successfully',
      schedule: classSchedule
    });
  } catch (err) {
    console.error('Error ending class:', err);
    res.status(500).json({ message: err.message });
  }
});

// Update a class schedule
router.put('/update/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, startTime, duration, program } = req.body;

    // Validate duration
    if (duration && (duration < 5 || duration > 180)) {
      return res.status(400).json({ 
        message: 'Duration must be between 5 and 180 minutes' 
      });
    }

    // Find the class first
    const existingClass = await ClassSchedule.findById(id);
    if (!existingClass) {
      return res.status(404).json({ message: 'Class not found' });
    }

    // Only allow editing if class is still scheduled
    if (existingClass.status !== 'scheduled') {
      return res.status(400).json({ 
        message: 'Cannot edit class that has already started or completed' 
      });
    }

    // Update the class
    const updatedClass = await ClassSchedule.findByIdAndUpdate(
      id,
      {
        title,
        description,
        startTime: new Date(startTime),
        duration,
        program
      },
      { new: true }
    );

    // Send email notifications to all students in the program about the update
    await sendEmailsToProgramStudents(program, sendClassUpdatedEmail, updatedClass);

    // Create notifications for all students in the program
    await createNotificationsForProgram(program, 'class_updated', updatedClass);

    // Emit Socket.io event for class updated
    if (global.io) {
      global.io.emit('class-updated', {
        classId: updatedClass._id,
        title: updatedClass.title,
        program: updatedClass.program,
        startTime: updatedClass.startTime,
        duration: updatedClass.duration
      });
    }

    res.json({
      message: 'Class updated successfully',
      schedule: updatedClass
    });
  } catch (err) {
    console.error('Error updating class:', err);
    res.status(500).json({ message: err.message });
  }
});

// Get active class for a program
router.get('/active/:program', async (req, res) => {
  try {
    const { program } = req.params;
    
    const now = new Date();

    // Build query based on program parameter
    const query = {
      status: 'ongoing',
      // Check if class duration hasn't exceeded
      $expr: {
        $lt: [
          now,
          {
            $add: [
              '$startTime',
              { $multiply: ['$duration', 60000] } // Convert minutes to milliseconds
            ]
          }
        ]
      }
    };

    // Only filter by program if it's not 'all'
    if (program !== 'all') {
      query.program = program;
    }


    const activeClass = await ClassSchedule.findOne(query);
    
    if (activeClass) {
      const endTime = new Date(activeClass.startTime);
      endTime.setMinutes(endTime.getMinutes() + activeClass.duration);
      const remainingTime = endTime - now;
   
      
      res.json({
        ...activeClass.toObject(),
        remainingTime: Math.max(0, Math.floor(remainingTime / 60000))
      });
    } else {
    //   console.log('No active class found');
      res.json(null);
    }
  } catch (err) {
    console.error('Error fetching active class:', err);
    res.status(500).json({ message: err.message });
  }
});

// Get all ongoing classes
router.get('/ongoing', async (req, res) => {
  try {
    const ongoingClasses = await ClassSchedule.find({ status: 'ongoing' })
      .populate('adminId', 'fullName email')
      .lean();

    res.json(ongoingClasses);
  } catch (err) {
    console.error('Error fetching ongoing classes:', err);
    res.status(500).json({ message: err.message });
  }
});

// Get all classes
router.get('/all', async (req, res) => {
  try {
    const allClasses = await ClassSchedule.find()
      .sort({ startTime: 1 })
      .lean();

    res.json(allClasses);
  } catch (err) {
    console.error('Error fetching all classes:', err);
    res.status(500).json({ message: err.message });
  }
});

// Get completed sessions count and details
router.get('/completed-sessions', async (req, res) => {
  try {
    // Get total count of completed sessions
    const completedCount = await ClassSchedule.countDocuments({ 
      status: 'completed'
    });

    // Get details of completed sessions
    const completedSessions = await ClassSchedule.find({ 
      status: 'completed'
    })
    .sort({ startTime: -1 }) // Most recent first
    .lean();

    // Add formatted date and duration info to each session
    const sessionsWithDetails = completedSessions.map(session => {
      const startTime = new Date(session.startTime);
      const endTime = new Date(startTime);
      endTime.setMinutes(endTime.getMinutes() + session.duration);

      return {
        ...session,
        formattedStartTime: startTime.toLocaleString(),
        formattedEndTime: endTime.toLocaleString(),
        actualDuration: session.duration
      };
    });

    res.json({
      totalCompleted: completedCount,
      sessions: sessionsWithDetails
    });
  } catch (err) {
    console.error('Error fetching completed sessions:', err);
    res.status(500).json({ message: err.message });
  }
});

// Get expired sessions
router.get('/expired-sessions', async (req, res) => {
  try {
    // Get total count of expired sessions
    const expiredCount = await ClassSchedule.countDocuments({ 
      status: 'expired'
    });

    // Get details of expired sessions
    const expiredSessions = await ClassSchedule.find({ 
      status: 'expired'
    })
    .sort({ startTime: -1 }) // Most recent first
    .lean();

    // Add formatted date info to each session
    const sessionsWithDetails = expiredSessions.map(session => {
      const scheduledStartTime = new Date(session.startTime);
      return {
        ...session,
        formattedStartTime: scheduledStartTime.toLocaleString(),
        formattedScheduledEndTime: new Date(scheduledStartTime.getTime() + session.duration * 60000).toLocaleString()
      };
    });

    res.json({
      totalExpired: expiredCount,
      sessions: sessionsWithDetails
    });
  } catch (err) {
    console.error('Error fetching expired sessions:', err);
    res.status(500).json({ message: err.message });
  }
});

// Manual check for expired classes
router.post('/check-expired', async (req, res) => {
  try {
    const now = new Date();
    const EXPIRY_MINUTES = 5; // Changed from 15 to 5 minutes for testing

    // Find all scheduled classes that should be expired
    const scheduledClasses = await ClassSchedule.find({
      status: 'scheduled',
      startTime: { $lt: new Date(now - EXPIRY_MINUTES * 60000) }
    });

    // Update their status and send cancellation emails
    const updatePromises = scheduledClasses.map(async (classItem) => {
      const minutesPassed = Math.floor((now - classItem.startTime) / (1000 * 60));

      await ClassSchedule.findByIdAndUpdate(classItem._id, {
        status: 'expired',
        meetingId: null,
        meetingLink: null
      });

      // Send cancellation emails to all students in the program
      await sendEmailsToProgramStudents(classItem.program, sendClassCancelledEmail, classItem);

      // Create notifications for all students in the program
      await createNotificationsForProgram(classItem.program, 'class_cancelled', classItem);

      // Create admin notification for expired class
      await createAdminNotification('class_expired', classItem);

      // Emit Socket.io events for expired classes
      if (global.io) {
        global.io.emit('class-status-changed', {
          classId: classItem._id,
          status: 'expired',
          program: classItem.program,
          title: classItem.title
        });
        
        global.io.emit('new-expired-class', {
          classId: classItem._id,
          status: 'expired',
          program: classItem.program,
          title: classItem.title,
          startTime: classItem.startTime,
          duration: classItem.duration
        });
      }

      return classItem._id;
    });

    const updatedIds = await Promise.all(updatePromises);

    res.json({
      message: `Checked and updated ${updatedIds.length} expired classes`,
      updatedClasses: updatedIds
    });
  } catch (err) {
    console.error('Error checking expired classes:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;

// Test endpoint for email functionality
router.post('/test-email', async (req, res) => {
  try {
    const { email, studentName, program } = req.body;
    
    if (!email || !studentName || !program) {
      return res.status(400).json({ 
        message: 'Email, studentName, and program are required' 
      });
    }

    const testClassDetails = {
      title: 'Test Class',
      description: 'This is a test class for email functionality',
      program: program,
      startTime: new Date(),
      duration: 60
    };

    // Test the email function
    await sendClassScheduledEmail(email, studentName, testClassDetails);

    res.json({
      message: 'Test email sent successfully',
      sentTo: email
    });
  } catch (err) {
    console.error('Error sending test email:', err);
    res.status(500).json({ message: err.message });
  }
}); 