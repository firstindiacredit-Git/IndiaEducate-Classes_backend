const express = require('express');
const Attendance = require('../model/attendanceModel');
const ClassSchedule = require('../model/classScheduleModel');
const Student = require('../model/studentModel');
const router = express.Router();

// Record student join time
router.post('/join', async (req, res) => {
  try {
    const { classId, studentId } = req.body;

    // Check if class exists and is ongoing
    const classSession = await ClassSchedule.findOne({
      _id: classId,
      status: 'ongoing'
    });

    if (!classSession) {
      return res.status(404).json({ message: 'Class not found or not ongoing' });
    }

    // Create or update attendance record
    const attendance = await Attendance.findOneAndUpdate(
      { classId, studentId },
      {
        $setOnInsert: {
          joinTime: new Date(),
          status: 'partial', // Start with partial, will be updated when they leave
          duration: 0,
          isAttendanceMarked: false
        }
      },
      { upsert: true, new: true }
    );

    res.json({
      message: 'Join time recorded',
      attendance
    });
  } catch (err) {
    console.error('Error recording join time:', err);
    res.status(500).json({ message: err.message });
  }
});

// Record student leave time and calculate duration
router.post('/leave', async (req, res) => {
  try {
    const { classId, studentId } = req.body;
    const leaveTime = new Date();

    const attendance = await Attendance.findOne({ classId, studentId });
    if (!attendance) {
      return res.status(404).json({ message: 'Attendance record not found' });
    }

    // Calculate duration in minutes
    const duration = Math.floor((leaveTime - attendance.joinTime) / (1000 * 60));

    // Get class details to calculate percentage
    const classSession = await ClassSchedule.findById(classId);
    const classDuration = classSession ? classSession.duration : 60; // Default 60 minutes
    
    // Calculate attendance percentage
    const attendancePercentage = (duration / classDuration) * 100;
    
    // Update attendance status based on duration and percentage
    let status = 'absent';
    
    if (duration >= 5) {
      if (attendancePercentage >= 80) {
        // Attended 80% or more of the class
        status = 'present';
      } else {
        // Attended at least 5 minutes but less than 80%
        status = 'partial';
      }
    } else {
      // Attended less than 5 minutes
      status = 'absent';
    }

    console.log(`Student ${studentId} leaving class ${classId}:`);
    console.log(`- Duration: ${duration} minutes`);
    console.log(`- Class duration: ${classDuration} minutes`);
    console.log(`- Attendance percentage: ${attendancePercentage.toFixed(2)}%`);
    console.log(`- Final status: ${status}`);

    // Update attendance record
    const updatedAttendance = await Attendance.findOneAndUpdate(
      { classId, studentId },
      {
        leaveTime,
        duration,
        status,
        isAttendanceMarked: true
      },
      { new: true }
    );

    res.json({
      message: 'Leave time recorded and attendance marked',
      attendance: updatedAttendance
    });
  } catch (err) {
    console.error('Error recording leave time:', err);
    res.status(500).json({ message: err.message });
  }
});

// Get attendance for a specific class
router.get('/class/:classId', async (req, res) => {
  try {
    const { classId } = req.params;

    const attendanceRecords = await Attendance.find({ classId })
      .populate('studentId', 'fullName email program')
      .lean();

    // Get class details
    const classDetails = await ClassSchedule.findById(classId).lean();

    // Calculate statistics
    const stats = {
      totalStudents: attendanceRecords.length,
      present: attendanceRecords.filter(r => r.status === 'present').length,
      partial: attendanceRecords.filter(r => r.status === 'partial').length,
      absent: attendanceRecords.filter(r => r.status === 'absent').length
    };

    res.json({
      classDetails,
      stats,
      attendance: attendanceRecords
    });
  } catch (err) {
    console.error('Error fetching class attendance:', err);
    res.status(500).json({ message: err.message });
  }
});

// Get attendance summary for all classes
router.get('/summary', async (req, res) => {
  try {
    const classes = await ClassSchedule.find({
      status: { $in: ['completed', 'expired'] }
    }).lean();

    const summary = await Promise.all(classes.map(async (classSession) => {
      const attendanceRecords = await Attendance.find({ classId: classSession._id })
        .populate('studentId', 'fullName email program')
        .lean();

      return {
        class: classSession,
        stats: {
          totalStudents: attendanceRecords.length,
          present: attendanceRecords.filter(r => r.status === 'present').length,
          partial: attendanceRecords.filter(r => r.status === 'partial').length,
          absent: attendanceRecords.filter(r => r.status === 'absent').length
        },
        attendance: attendanceRecords
      };
    }));

    res.json(summary);
  } catch (err) {
    console.error('Error fetching attendance summary:', err);
    res.status(500).json({ message: err.message });
  }
});

// Get student's attendance history
router.get('/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;

    const attendanceHistory = await Attendance.find({ studentId })
      .populate('classId', 'title startTime duration program')
      .lean();

    const stats = {
      totalClasses: attendanceHistory.length,
      present: attendanceHistory.filter(r => r.status === 'present').length,
      partial: attendanceHistory.filter(r => r.status === 'partial').length,
      absent: attendanceHistory.filter(r => r.status === 'absent').length,
      attendancePercentage: Math.round(
        (attendanceHistory.filter(r => r.status === 'present').length / 
        attendanceHistory.length) * 100
      ) || 0
    };

    res.json({
      stats,
      history: attendanceHistory
    });
  } catch (err) {
    console.error('Error fetching student attendance:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 