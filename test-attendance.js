const mongoose = require('mongoose');
const Attendance = require('./model/attendanceModel');
const ClassSchedule = require('./model/classScheduleModel');
const Student = require('./model/studentModel');

// Test attendance logic
async function testAttendanceLogic() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/indiaeducates');
    console.log('Connected to MongoDB');

    // Create a test class
    const testClass = await ClassSchedule.create({
      title: 'Test Class',
      description: 'Test class for attendance',
      startTime: new Date(),
      duration: 10, // 10 minutes
      program: '24-session',
      status: 'ongoing'
    });

    // Create a test student
    const testStudent = await Student.create({
      fullName: 'Test Student',
      email: 'test@example.com',
      program: '24-session'
    });

    console.log('Created test class and student');

    // Simulate student joining
    const joinTime = new Date();
    const attendance = await Attendance.create({
      classId: testClass._id,
      studentId: testStudent._id,
      joinTime: joinTime,
      status: 'partial',
      duration: 0,
      isAttendanceMarked: false
    });

    console.log('Student joined at:', joinTime);

    // Simulate different leave scenarios
    const scenarios = [
      { name: 'Left after 2 minutes (should be absent)', leaveAfterMinutes: 2 },
      { name: 'Left after 5 minutes (should be partial)', leaveAfterMinutes: 5 },
      { name: 'Left after 8 minutes (should be present)', leaveAfterMinutes: 8 }
    ];

    for (const scenario of scenarios) {
      console.log(`\n--- Testing: ${scenario.name} ---`);
      
      // Calculate leave time
      const leaveTime = new Date(joinTime.getTime() + (scenario.leaveAfterMinutes * 60000));
      const duration = Math.floor((leaveTime - joinTime) / (1000 * 60));
      const classDuration = testClass.duration;
      const attendancePercentage = (duration / classDuration) * 100;
      
      let status = 'absent';
      if (duration >= 5) {
        if (attendancePercentage >= 80) {
          status = 'present';
        } else {
          status = 'partial';
        }
      }
      
      console.log(`Duration: ${duration} minutes`);
      console.log(`Class duration: ${classDuration} minutes`);
      console.log(`Attendance percentage: ${attendancePercentage.toFixed(2)}%`);
      console.log(`Calculated status: ${status}`);
      
      // Update attendance record
      await Attendance.findByIdAndUpdate(attendance._id, {
        leaveTime: leaveTime,
        duration: duration,
        status: status,
        isAttendanceMarked: true
      });
      
      console.log('Attendance record updated');
    }

    // Clean up
    await Attendance.deleteMany({ classId: testClass._id });
    await Student.findByIdAndDelete(testStudent._id);
    await ClassSchedule.findByIdAndDelete(testClass._id);
    
    console.log('\nTest completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

testAttendanceLogic(); 