const nodemailer = require('nodemailer');
const { formatTimeForStudent } = require('./timezoneUtils');

// Create transporter with error handling
let transporter;
try {
  // Option 1: Gmail (current)
  if (process.env.EMAIL_SERVICE === 'gmail' || !process.env.EMAIL_SERVICE) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      // Add these settings for better delivery and to avoid spam
      secure: true,
      tls: {
        rejectUnauthorized: false
      },
      // Add headers to improve deliverability
      headers: {
        'List-Unsubscribe': '<mailto:unsubscribe@indiaeducates.com>',
        'Precedence': 'bulk',
        'X-Auto-Response-Suppress': 'OOF, AutoReply'
      }
    });
  }
  // Option 2: SendGrid (alternative for better deliverability)
  else if (process.env.EMAIL_SERVICE === 'sendgrid') {
    transporter = nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      secure: false,
      auth: {
        user: 'apikey',
        pass: process.env.SENDGRID_API_KEY,
      },
    });
  }
} catch (error) {
  console.error('Failed to create email transporter:', error);
}

// Verify transporter configuration
const verifyTransporter = async () => {
  if (!transporter) {
    throw new Error('Email transporter not configured. Check EMAIL_USER and EMAIL_PASS environment variables.');
  }
  
  try {
    await transporter.verify();
    // console.log('Email transporter verified successfully');
  } catch (error) {
    console.error('Email transporter verification failed:', error);
    throw new Error('Email configuration is invalid. Please check your email credentials.');
  }
};

async function sendOTPEmail(to, otp) {
  await verifyTransporter();
  await transporter.sendMail({
    from: `"India Educates" <${process.env.EMAIL_USER}>`,
    to,
    subject: 'Your Login Verification Code - India Educates',
    text: `Hello,

You have requested to login to your India Educates account.

Your verification code is: ${otp}

This code will expire in 10 minutes.

If you did not request this code, please ignore this email.

Best regards,
India Educates Team`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #333; margin: 0;">India Educates</h2>
        </div>
        
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin-bottom: 20px;">
          <h3 style="color: #333; margin-top: 0;">Login Verification</h3>
          <p>You have requested to login to your India Educates account.</p>
          
          <div style="background-color: #007bff; color: white; padding: 15px; border-radius: 5px; text-align: center; margin: 20px 0;">
            <h2 style="margin: 0; font-size: 24px;">Your Verification Code</h2>
            <h1 style="margin: 10px 0; font-size: 32px; letter-spacing: 5px;">${otp}</h1>
          </div>
          
          <p><strong>This code will expire in 10 minutes.</strong></p>
        </div>
        
        <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; border-left: 4px solid #ffc107;">
          <p style="margin: 0; color: #856404;"><strong>Security Notice:</strong> If you did not request this code, please ignore this email and ensure your account is secure.</p>
        </div>
        
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #666; font-size: 12px;">
          <p>Best regards,<br>India Educates Team</p>
        </div>
      </div>
    `
  });
}

async function sendCredentialsEmail(to, email, password) {
  await verifyTransporter();
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
  await verifyTransporter();
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

async function sendClassScheduledEmail(to, studentName, classDetails, studentCountry = null) {
  await verifyTransporter();
  
  // Get student's timezone formatted times
  const startTimeFormatted = formatTimeForStudent(classDetails.startTime, studentCountry);
  const endTime = new Date(classDetails.startTime.getTime() + (classDetails.duration * 60000));
  const endTimeFormatted = formatTimeForStudent(endTime, studentCountry);
  
  const emailContent = `
Dear ${studentName},

A new class has been scheduled for your program. Here are the details:

Class Title: ${classDetails.title}
Description: ${classDetails.description || 'No description provided'}
Program: ${classDetails.program}
Date: ${startTimeFormatted.date}
Start Time: ${startTimeFormatted.time} (${startTimeFormatted.timezone})
End Time: ${endTimeFormatted.time} (${endTimeFormatted.timezone})
Duration: ${classDetails.duration} minutes

Please make sure to join the class on time. You will receive a meeting link when the class starts.

If you have any questions, please contact your instructor.

Best regards,
India Educates Team
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject: `New Class Scheduled: ${classDetails.title} - India Educates`,
    text: emailContent,
  });
}

async function sendClassUpdatedEmail(to, studentName, classDetails, studentCountry = null) {
  await verifyTransporter();
  
  // Get student's timezone formatted times
  const startTimeFormatted = formatTimeForStudent(classDetails.startTime, studentCountry);
  const endTime = new Date(classDetails.startTime.getTime() + (classDetails.duration * 60000));
  const endTimeFormatted = formatTimeForStudent(endTime, studentCountry);
  
  const emailContent = `
Dear ${studentName},

A class in your program has been updated. Here are the updated details:

Class Title: ${classDetails.title}
Description: ${classDetails.description || 'No description provided'}
Program: ${classDetails.program}
Date: ${startTimeFormatted.date}
Start Time: ${startTimeFormatted.time} (${startTimeFormatted.timezone})
End Time: ${endTimeFormatted.time} (${endTimeFormatted.timezone})
Duration: ${classDetails.duration} minutes

Please note these changes and adjust your schedule accordingly.

If you have any questions, please contact your instructor.

Best regards,
India Educates Team
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject: `Class Updated: ${classDetails.title} - India Educates`,
    text: emailContent,
  });
}

async function sendClassCancelledEmail(to, studentName, classDetails, studentCountry = null) {
  await verifyTransporter();
  
  // Get student's timezone formatted times
  const startTimeFormatted = formatTimeForStudent(classDetails.startTime, studentCountry);
  
  const emailContent = `
Dear ${studentName},

A class in your program has been cancelled. Here are the details of the cancelled class:

Class Title: ${classDetails.title}
Description: ${classDetails.description || 'No description provided'}
Program: ${classDetails.program}
Scheduled Date: ${startTimeFormatted.date}
Scheduled Time: ${startTimeFormatted.time} (${startTimeFormatted.timezone})

The class has been cancelled and will not take place. You will be notified when a new class is scheduled to replace this one.

If you have any questions, please contact your instructor.

Best regards,
India Educates Team
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject: `Class Cancelled: ${classDetails.title} - India Educates`,
    text: emailContent,
  });
}

async function sendClassStartedEmail(to, studentName, classDetails, studentCountry = null) {
  await verifyTransporter();
  
  // Get student's timezone formatted times
  const startTimeFormatted = formatTimeForStudent(classDetails.startTime, studentCountry);
  const endTime = new Date(classDetails.startTime.getTime() + (classDetails.duration * 60000));
  const endTimeFormatted = formatTimeForStudent(endTime, studentCountry);
  
  const emailContent = `
Dear ${studentName},

Your class has started! Here are the details:

Class Title: ${classDetails.title}
Description: ${classDetails.description || 'No description provided'}
Program: ${classDetails.program}
Start Time: ${startTimeFormatted.time} (${startTimeFormatted.timezone})
End Time: ${endTimeFormatted.time} (${endTimeFormatted.timezone})
Duration: ${classDetails.duration} minutes

🎥 JOIN CLASS NOW:
${classDetails.meetingLink}

Click the link above to join the live class immediately.

Important Notes:
- Make sure you have a stable internet connection
- Join with your full name for attendance tracking
- The class will end automatically after ${classDetails.duration} minutes
- If you face any technical issues, contact your instructor immediately

We hope you have a great learning session!

Best regards,
India Educates Team
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject: `🎥 LIVE CLASS STARTED: ${classDetails.title} - India Educates`,
    text: emailContent,
  });
}

module.exports = { 
  sendOTPEmail, 
  sendCredentialsEmail, 
  sendProfileUpdateEmail,
  sendClassScheduledEmail,
  sendClassUpdatedEmail,
  sendClassCancelledEmail,
  sendClassStartedEmail
};
