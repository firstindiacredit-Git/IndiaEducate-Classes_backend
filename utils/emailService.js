const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendOTPEmail(to, otp) {
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject: 'Your OTP Code',
    text: `Your OTP code is: ${otp}`,
  });
}

async function sendCredentialsEmail(to, email, password) {
  const emailContent = `
Dear Student,

Welcome to India Educates! Your account has been created by the administrator.

Here are your login credentials:
Email/Username: ${email}
Password: ${password}

Please login using these credentials at: ${process.env.FRONTEND_URL || 'http://localhost:5173'}

For security reasons, we recommend changing your password after your first login.

Best regards,
India Educates Team
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject: 'Welcome to India Educates - Your Account Credentials',
    text: emailContent,
  });
}

async function sendProfileUpdateEmail(to, studentDetails, newPassword = null) {
  const emailContent = `
Dear Student,

Your profile has been updated by the administrator. Here are your updated details:

Full Name: ${studentDetails.fullName || 'Not Set'}
Email: ${studentDetails.email}
Phone: ${studentDetails.phone}
Program: ${studentDetails.program || 'Not Set'}
Country: ${studentDetails.country || 'Not Set'}
Enrollment ID: ${studentDetails.enrollmentId || 'Not Set'}
${newPassword ? `\nYour password has been updated. New password: ${newPassword}` : ''}

You can login at: ${process.env.FRONTEND_URL || 'http://localhost:5173'}
${newPassword ? '\nFor security reasons, we recommend changing your password after your next login.' : ''}

If you have any questions about these changes, please contact our support team.

Best regards,
India Educates Team
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject: 'Your Profile Has Been Updated - India Educates',
    text: emailContent,
  });
}

module.exports = { sendOTPEmail, sendCredentialsEmail, sendProfileUpdateEmail };
