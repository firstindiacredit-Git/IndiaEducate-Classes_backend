const express = require('express');
const Attendance = require('../model/attendanceModel');
const ClassSchedule = require('../model/classScheduleModel');
const Student = require('../model/studentModel');
const router = express.Router();

// Record student join time
router.post('/join', async (req, res) => {
  try {
    const { classId, studentId, isReconnect = false } = req.body;

    // Check if class exists and is ongoing (exclude expired sessions)
    const classSession = await ClassSchedule.findOne({
      _id: classId,
      status: 'ongoing'
    });

    if (!classSession) {
      return res.status(404).json({ message: 'Class not found or not ongoing' });
    }

    // Check if attendance record already exists
    const existingAttendance = await Attendance.findOne({ classId, studentId });
    
    if (existingAttendance && !isReconnect) {
      // Student already joined, don't create duplicate record
      return res.json({
        message: 'Already joined this class',
        attendance: existingAttendance,
        isReconnect: true
      });
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
        },
        $set: {
          // Update join time only if this is a reconnect
          ...(isReconnect && { joinTime: new Date() })
        }
      },
      { upsert: true, new: true }
    );

    res.json({
      message: isReconnect ? 'Reconnected successfully' : 'Join time recorded',
      attendance,
      isReconnect
    });
  } catch (err) {
    console.error('Error recording join time:', err);
    res.status(500).json({ message: err.message });
  }
});

// Handle reconnection scenario
router.post('/reconnect', async (req, res) => {
  try {
    const { classId, studentId } = req.body;

    // Check if class exists and is ongoing (exclude expired sessions)
    const classSession = await ClassSchedule.findOne({
      _id: classId,
      status: 'ongoing'
    });

    if (!classSession) {
      return res.status(404).json({ message: 'Class not found or not ongoing' });
    }

    // Find existing attendance record
    const existingAttendance = await Attendance.findOne({ classId, studentId });
    
    if (!existingAttendance) {
      // No existing record, create new one
      const newAttendance = await Attendance.create({
        classId,
        studentId,
        joinTime: new Date(),
        status: 'partial',
        duration: 0,
        isAttendanceMarked: false
      });

      return res.json({
        message: 'New attendance record created',
        attendance: newAttendance,
        isReconnect: false
      });
    }

    // Update existing record for reconnection
    const updatedAttendance = await Attendance.findOneAndUpdate(
      { classId, studentId },
      {
        // Don't update joinTime if student was already present for significant time
        // Only update if they were present for less than 5 minutes
        ...(existingAttendance.duration < 5 && { joinTime: new Date() }),
        status: 'partial',
        isAttendanceMarked: false
      },
      { new: true }
    );

    res.json({
      message: 'Reconnected successfully',
      attendance: updatedAttendance,
      isReconnect: true
    });
  } catch (err) {
    console.error('Error handling reconnection:', err);
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

    // console.log(`Student ${studentId} leaving class ${classId}:`);
    // console.log(`- Duration: ${duration} minutes`);
    // console.log(`- Class duration: ${classDuration} minutes`);
    // console.log(`- Attendance percentage: ${attendancePercentage.toFixed(2)}%`);
    // console.log(`- Final status: ${status}`);

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
    // Only include completed classes, exclude expired sessions
    const classes = await ClassSchedule.find({
      status: 'completed'
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

    // First get the student details to know their program
    const student = await Student.findById(studentId).lean();
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Get only completed classes for the student's program (exclude expired sessions)
    const allClasses = await ClassSchedule.find({
      program: student.program,
      status: 'completed'
    }).lean();

    // Get all attendance records for this student
    const studentAttendanceRecords = await Attendance.find({ studentId }).lean();

    // Create a map of classId to attendance record for quick lookup
    const attendanceMap = {};
    studentAttendanceRecords.forEach(record => {
      attendanceMap[record.classId.toString()] = record;
    });

    // Create complete attendance history including classes where student didn't join
    const attendanceHistory = allClasses.map(classSession => {
      const attendanceRecord = attendanceMap[classSession._id.toString()];
      
      if (attendanceRecord) {
        // Student joined this class
        return {
          _id: attendanceRecord._id,
          classId: classSession,
          studentId: student._id,
          joinTime: attendanceRecord.joinTime,
          leaveTime: attendanceRecord.leaveTime,
          duration: attendanceRecord.duration,
          status: attendanceRecord.status,
          isAttendanceMarked: attendanceRecord.isAttendanceMarked
        };
      } else {
        // Student didn't join this class - mark as absent
        return {
          _id: `absent_${classSession._id}_${studentId}`,
          classId: classSession,
          studentId: student._id,
          joinTime: classSession.startTime,
          leaveTime: null,
          duration: 0,
          status: 'absent',
          isAttendanceMarked: true
        };
      }
    });

    // Calculate statistics based on the complete history
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

// Debug endpoint to check student attendance data
router.get('/debug/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;

    // Get student details
    const student = await Student.findById(studentId).lean();
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Get only completed classes for the student's program (exclude expired sessions)
    const allClasses = await ClassSchedule.find({
      program: student.program,
      status: 'completed'
    }).lean();

    // Get student's attendance records
    const studentAttendanceRecords = await Attendance.find({ studentId }).lean();

    // Get detailed attendance for each class
    const detailedAttendance = await Promise.all(allClasses.map(async (classSession) => {
      const attendanceRecord = studentAttendanceRecords.find(
        record => record.classId.toString() === classSession._id.toString()
      );

      return {
        classId: classSession._id,
        className: classSession.title,
        classStartTime: classSession.startTime,
        classDuration: classSession.duration,
        studentJoined: !!attendanceRecord,
        attendanceRecord: attendanceRecord ? {
          joinTime: attendanceRecord.joinTime,
          leaveTime: attendanceRecord.leaveTime,
          duration: attendanceRecord.duration,
          status: attendanceRecord.status,
          isAttendanceMarked: attendanceRecord.isAttendanceMarked
        } : null,
        expectedStatus: attendanceRecord ? attendanceRecord.status : 'absent'
      };
    }));

    res.json({
      student: {
        _id: student._id,
        fullName: student.fullName,
        email: student.email,
        program: student.program
      },
      totalClasses: allClasses.length,
      classesJoined: studentAttendanceRecords.length,
      classesNotJoined: allClasses.length - studentAttendanceRecords.length,
      detailedAttendance
    });
  } catch (err) {
    console.error('Error in debug endpoint:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 