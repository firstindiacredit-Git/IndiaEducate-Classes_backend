const Student = require('../model/studentModel');

const studentAuth = async (req, res, next) => {
  try {
    // Get student credentials from request headers (sent by frontend)
    const studentEmail = req.headers['student-email'];
    const studentPhone = req.headers['student-phone'];
    
    if (!studentEmail && !studentPhone) {
      return res.status(400).json({ message: 'Student credentials required' });
    }

    const student = await Student.findOne({
      $or: [
        { email: studentEmail },
        { phone: studentPhone },
        { email: studentPhone },
        { phone: studentEmail }
      ],
    });

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    req.student = student;
    next();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = studentAuth;
