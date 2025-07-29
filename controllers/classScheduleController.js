const express = require('express');
const ClassSchedule = require('../model/classScheduleModel');
const Student = require('../model/studentModel');
const Attendance = require('../model/attendanceModel');
const router = express.Router();

// Function to check and update class statuses
const updateClassStatuses = async () => {
  try {
    const now = new Date();
    // console.log('Running status update check at:', now);
    
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

        // Create absent records for all students in this program
        const students = await Student.find({ program: classItem.program });
        await Promise.all(students.map(student => 
          Attendance.create({
            classId: classItem._id,
            studentId: student._id,
            status: 'absent',
            joinTime: classItem.startTime,
            duration: 0,
            isAttendanceMarked: true
          })
        ));
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
        // console.log(`Class ${classItem._id} has completed its duration`);
        await ClassSchedule.findByIdAndUpdate(classItem._id, {
          status: 'completed',
          meetingId: null,
          meetingLink: null,
          completedAt: now,
          updatedAt: now
        });

        // Update attendance for students who didn't attend
        const allStudents = await Student.find({ program: classItem.program });
        const attendance = await Attendance.find({ classId: classItem._id });

        await Promise.all(allStudents.map(async (student) => {
          const studentAttendance = attendance.find(a => 
            a.studentId.toString() === student._id.toString()
          );

          if (!studentAttendance) {
            await Attendance.create({
              classId: classItem._id,
              studentId: student._id,
              status: 'absent',
              joinTime: classItem.startTime,
              duration: 0,
              isAttendanceMarked: true
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

    // Create absent records for students who didn't attend
    const absentPromises = allStudents.map(async (student) => {
      const studentAttendance = attendance.find(a => 
        a.studentId.toString() === student._id.toString()
      );

      if (!studentAttendance) {
        await Attendance.create({
          classId: id,
          studentId: student._id,
          status: 'absent',
          joinTime: classSchedule.startTime,
          duration: 0,
          isAttendanceMarked: true
        });
      }
    });

    await Promise.all(absentPromises);

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


    // Update their status
    const updatePromises = scheduledClasses.map(async (classItem) => {
      const minutesPassed = Math.floor((now - classItem.startTime) / (1000 * 60));

      await ClassSchedule.findByIdAndUpdate(classItem._id, {
        status: 'expired',
        meetingId: null,
        meetingLink: null
      });

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