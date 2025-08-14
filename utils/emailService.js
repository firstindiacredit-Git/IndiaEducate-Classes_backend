const nodemailer = require('nodemailer');
const { formatTimeForStudent, getTimezoneFromCountry, getCurrentTimeInStudentTimezone } = require('./timezoneUtils');

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

// Add this helper function for sending emails
async function sendEmail(to, subject, html) {
  await verifyTransporter();
  await transporter.sendMail({
    from: `"India Educates" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html
  });
}

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

Please login using these credentials at: ${process.env.FRONTEND_URL}

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

You can login at: ${process.env.FRONTEND_URL}
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

// Study Material Notification Email
async function sendStudyMaterialNotificationEmail(to, params) {
  const { studentName, fileName, fileType, category, uploadedBy, description, fileSize, studentCountry } = params;
  
  const currentTime = getCurrentTimeInStudentTimezone(studentCountry);
  
  const subject = 'New Study Material Available - IndiaEducates';
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>New Study Material</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .file-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
        .file-type { display: inline-block; background: #667eea; color: white; padding: 5px 10px; border-radius: 15px; font-size: 12px; }
        .category { display: inline-block; background: #764ba2; color: white; padding: 5px 10px; border-radius: 15px; font-size: 12px; margin-left: 10px; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        .timezone { background: #e8f4fd; padding: 10px; border-radius: 5px; margin: 15px 0; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📚 New Study Material Available</h1>
          <p>Hello ${studentName},</p>
        </div>
        
        <div class="content">
          <p>Great news! A new study material has been uploaded to your learning platform.</p>
          
          <div class="file-info">
            <h3>📄 ${fileName}</h3>
            <p><span class="file-type">${fileType.toUpperCase()}</span> <span class="category">${category}</span></p>
            <p><strong>Uploaded by:</strong> ${uploadedBy}</p>
            <p><strong>File size:</strong> ${(fileSize / (1024 * 1024)).toFixed(2)} MB</p>
            ${description ? `<p><strong>Description:</strong> ${description}</p>` : ''}
          </div>
          
          <div class="timezone">
            <strong>⏰ Your Local Time:</strong> ${currentTime.time} (${currentTime.timezone})
          </div>
          
          <p>You can access this material from your student dashboard under the "File Library" section.</p>
          
          <p style="margin-top: 30px;">
            <strong>Best regards,</strong><br>
            IndiaEducates Team
          </p>
        </div>
        
        <div class="footer">
          <p>This is an automated notification from IndiaEducates Learning Platform</p>
          <p>Current time in your timezone: ${currentTime.date} at ${currentTime.time}</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail(to, subject, htmlContent);
}

// Quiz Notification Email
async function sendQuizNotificationEmail(to, params) {
  const { studentName, quizTitle, quizType, subject, duration, totalMarks, passingMarks, startDate, endDate, createdBy, studentCountry } = params;
  
  const currentTime = getCurrentTimeInStudentTimezone(studentCountry);
  
  const subject_line = 'New Quiz Available - IndiaEducates';
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>New Quiz Available</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .quiz-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ff6b6b; }
        .quiz-type { display: inline-block; background: #ff6b6b; color: white; padding: 5px 10px; border-radius: 15px; font-size: 12px; }
        .subject { display: inline-block; background: #ee5a24; color: white; padding: 5px 10px; border-radius: 15px; font-size: 12px; margin-left: 10px; }
        .deadline { background: #fff3cd; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 4px solid #ffc107; }
        .timezone { background: #e8f4fd; padding: 10px; border-radius: 5px; margin: 15px 0; font-size: 14px; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📝 New Quiz Available</h1>
          <p>Hello ${studentName},</p>
        </div>
        
        <div class="content">
          <p>A new quiz has been created and is now available for you to take.</p>
          
          <div class="quiz-info">
            <h3>📋 ${quizTitle}</h3>
            <p><span class="quiz-type">${quizType.toUpperCase()}</span> <span class="subject">${subject}</span></p>
            <p><strong>Duration:</strong> ${duration} minutes</p>
            <p><strong>Total Marks:</strong> ${totalMarks}</p>
            <p><strong>Passing Marks:</strong> ${passingMarks}</p>
            <p><strong>Created by:</strong> ${createdBy}</p>
          </div>
          
          <div class="deadline">
            <h4>⏰ Important Deadlines</h4>
            <p><strong>Available from:</strong> ${startDate.date} at ${startDate.time} (${startDate.timezone})</p>
            <p><strong>Deadline:</strong> ${endDate.date} at ${endDate.time} (${endDate.timezone})</p>
          </div>
          
          <div class="timezone">
            <strong>⏰ Your Local Time:</strong> ${currentTime.time} (${currentTime.timezone})
          </div>
          
          <p>You can access this quiz from your student dashboard under the "Quiz Dashboard" section.</p>
          
          <p style="margin-top: 30px;">
            <strong>Best regards,</strong><br>
            IndiaEducates Team
          </p>
        </div>
        
        <div class="footer">
          <p>This is an automated notification from IndiaEducates Learning Platform</p>
          <p>Current time in your timezone: ${currentTime.date} at ${currentTime.time}</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail(to, subject_line, htmlContent);
}

// Weekly Test Notification Email
async function sendWeeklyTestNotificationEmail(to, params) {
  const { studentName, quizTitle, subject, duration, totalMarks, passingMarks, startDate, endDate, createdBy, studentCountry, weekNumber } = params;
  
  const currentTime = getCurrentTimeInStudentTimezone(studentCountry);
  
  const subject_line = `Weekly Test - Week ${weekNumber} - IndiaEducates`;
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Weekly Test Available</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .quiz-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
        .week-badge { display: inline-block; background: #667eea; color: white; padding: 8px 15px; border-radius: 20px; font-size: 14px; font-weight: bold; }
        .subject { display: inline-block; background: #764ba2; color: white; padding: 5px 10px; border-radius: 15px; font-size: 12px; margin-left: 10px; }
        .deadline { background: #fff3cd; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 4px solid #ffc107; }
        .timezone { background: #e8f4fd; padding: 10px; border-radius: 5px; margin: 15px 0; font-size: 14px; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📊 Weekly Test Available</h1>
          <p>Hello ${studentName},</p>
        </div>
        
        <div class="content">
          <p>Your weekly test for this week is now available!</p>
          
          <div class="quiz-info">
            <h3>📋 ${quizTitle}</h3>
            <p><span class="week-badge">Week ${weekNumber}</span> <span class="subject">${subject}</span></p>
            <p><strong>Duration:</strong> ${duration} minutes</p>
            <p><strong>Total Marks:</strong> ${totalMarks}</p>
            <p><strong>Passing Marks:</strong> ${passingMarks}</p>
            <p><strong>Created by:</strong> ${createdBy}</p>
          </div>
          
          <div class="deadline">
            <h4>⏰ Important Deadlines</h4>
            <p><strong>Available from:</strong> ${startDate.date} at ${startDate.time} (${startDate.timezone})</p>
            <p><strong>Deadline:</strong> ${endDate.date} at ${endDate.time} (${endDate.timezone})</p>
          </div>
          
          <div class="timezone">
            <strong>⏰ Your Local Time:</strong> ${currentTime.time} (${currentTime.timezone})
          </div>
          
          <p>You can access this weekly test from your student dashboard under the "Quiz Dashboard" section.</p>
          
          <p style="margin-top: 30px;">
            <strong>Best regards,</strong><br>
            IndiaEducates Team
          </p>
        </div>
        
        <div class="footer">
          <p>This is an automated notification from IndiaEducates Learning Platform</p>
          <p>Current time in your timezone: ${currentTime.date} at ${currentTime.time}</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail(to, subject_line, htmlContent);
}

// Assignment Notification Email
async function sendAssignmentNotificationEmail(to, params) {
  const { studentName, assignmentTitle, assignmentType, subject, duration, totalMarks, passingMarks, startDate, endDate, createdBy, studentCountry, instructions } = params;
  
  const currentTime = getCurrentTimeInStudentTimezone(studentCountry);
  
  const subject_line = 'New Assignment Available - IndiaEducates';
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>New Assignment Available</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #4ecdc4 0%, #44a08d 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .assignment-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #4ecdc4; }
        .assignment-type { display: inline-block; background: #4ecdc4; color: white; padding: 5px 10px; border-radius: 15px; font-size: 12px; }
        .subject { display: inline-block; background: #44a08d; color: white; padding: 5px 10px; border-radius: 15px; font-size: 12px; margin-left: 10px; }
        .deadline { background: #fff3cd; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 4px solid #ffc107; }
        .instructions { background: #e8f4fd; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 4px solid #17a2b8; }
        .timezone { background: #e8f4fd; padding: 10px; border-radius: 5px; margin: 15px 0; font-size: 14px; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📝 New Assignment Available</h1>
          <p>Hello ${studentName},</p>
        </div>
        
        <div class="content">
          <p>A new assignment has been created and is now available for you to complete.</p>
          
          <div class="assignment-info">
            <h3>📋 ${assignmentTitle}</h3>
            <p><span class="assignment-type">${assignmentType.toUpperCase()}</span> <span class="subject">${subject}</span></p>
            <p><strong>Duration:</strong> ${duration} minutes</p>
            <p><strong>Total Marks:</strong> ${totalMarks}</p>
            <p><strong>Passing Marks:</strong> ${passingMarks}</p>
            <p><strong>Created by:</strong> ${createdBy}</p>
          </div>
          
          ${instructions ? `
          <div class="instructions">
            <h4>📋 Instructions</h4>
            <p>${instructions}</p>
          </div>
          ` : ''}
          
          <div class="deadline">
            <h4>⏰ Important Deadlines</h4>
            <p><strong>Available from:</strong> ${startDate.date} at ${startDate.time} (${startDate.timezone})</p>
            <p><strong>Deadline:</strong> ${endDate.date} at ${endDate.time} (${endDate.timezone})</p>
          </div>
          
          <div class="timezone">
            <strong>⏰ Your Local Time:</strong> ${currentTime.time} (${currentTime.timezone})
          </div>
          
          <p>You can access this assignment from your student dashboard under the "Assignment Dashboard" section.</p>
          
          <p style="margin-top: 30px;">
            <strong>Best regards,</strong><br>
            IndiaEducates Team
          </p>
        </div>
        
        <div class="footer">
          <p>This is an automated notification from IndiaEducates Learning Platform</p>
          <p>Current time in your timezone: ${currentTime.date} at ${currentTime.time}</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail(to, subject_line, htmlContent);
}

// Assignment Review Notification Email
async function sendAssignmentReviewNotificationEmail(to, params) {
  const { studentName, assignmentTitle, score, totalMarks, isPassed, adminFeedback, percentage, studentCountry } = params;
  
  const currentTime = getCurrentTimeInStudentTimezone(studentCountry);
  
  const subject_line = 'Assignment Reviewed - IndiaEducates';
  
  const statusColor = isPassed ? '#28a745' : '#dc3545';
  const statusText = isPassed ? 'PASSED' : 'FAILED';
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Assignment Reviewed</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #4ecdc4 0%, #44a08d 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .result-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #4ecdc4; }
        .status { display: inline-block; background: ${statusColor}; color: white; padding: 8px 15px; border-radius: 20px; font-size: 14px; font-weight: bold; }
        .score { font-size: 24px; font-weight: bold; color: ${statusColor}; }
        .feedback { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 4px solid #6c757d; }
        .timezone { background: #e8f4fd; padding: 10px; border-radius: 5px; margin: 15px 0; font-size: 14px; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📝 Assignment Reviewed</h1>
          <p>Hello ${studentName},</p>
        </div>
        
        <div class="content">
          <p>Your assignment has been reviewed by your instructor.</p>
          
          <div class="result-info">
            <h3>📋 ${assignmentTitle}</h3>
            <p><span class="status">${statusText}</span></p>
            <p class="score">${score}/${totalMarks} (${percentage}%)</p>
            <p><strong>Passing Marks:</strong> ${Math.ceil(totalMarks * 0.4)}</p>
          </div>
          
          ${adminFeedback ? `
          <div class="feedback">
            <h4>💬 Instructor Feedback</h4>
            <p>${adminFeedback}</p>
          </div>
          ` : ''}
          
          <div class="timezone">
            <strong>⏰ Your Local Time:</strong> ${currentTime.time} (${currentTime.timezone})
          </div>
          
          <p>You can view the detailed results from your student dashboard under the "Assignment History" section.</p>
          
          <p style="margin-top: 30px;">
            <strong>Best regards,</strong><br>
            IndiaEducates Team
          </p>
        </div>
        
        <div class="footer">
          <p>This is an automated notification from IndiaEducates Learning Platform</p>
          <p>Current time in your timezone: ${currentTime.date} at ${currentTime.time}</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail(to, subject_line, htmlContent);
}

// Quiz Review Notification Email
async function sendQuizReviewNotificationEmail(to, params) {
  const { studentName, quizTitle, score, totalMarks, isPassed, adminFeedback, percentage, studentCountry } = params;
  
  const currentTime = getCurrentTimeInStudentTimezone(studentCountry);
  
  const subject_line = 'Quiz Reviewed - IndiaEducates';
  
  const statusColor = isPassed ? '#28a745' : '#dc3545';
  const statusText = isPassed ? 'PASSED' : 'FAILED';
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Quiz Reviewed</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .result-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ff6b6b; }
        .status { display: inline-block; background: ${statusColor}; color: white; padding: 8px 15px; border-radius: 20px; font-size: 14px; font-weight: bold; }
        .score { font-size: 24px; font-weight: bold; color: ${statusColor}; }
        .feedback { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 4px solid #6c757d; }
        .timezone { background: #e8f4fd; padding: 10px; border-radius: 5px; margin: 15px 0; font-size: 14px; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📝 Quiz Reviewed</h1>
          <p>Hello ${studentName},</p>
        </div>
        
        <div class="content">
          <p>Your quiz has been reviewed by your instructor.</p>
          
          <div class="result-info">
            <h3>📋 ${quizTitle}</h3>
            <p><span class="status">${statusText}</span></p>
            <p class="score">${score}/${totalMarks} (${percentage}%)</p>
            <p><strong>Passing Marks:</strong> ${Math.ceil(totalMarks * 0.4)}</p>
          </div>
          
          ${adminFeedback ? `
          <div class="feedback">
            <h4>💬 Instructor Feedback</h4>
            <p>${adminFeedback}</p>
          </div>
          ` : ''}
          
          <div class="timezone">
            <strong>⏰ Your Local Time:</strong> ${currentTime.time} (${currentTime.timezone})
          </div>
          
          <p>You can view the detailed results from your student dashboard under the "Quiz History" section.</p>
          
          <p style="margin-top: 30px;">
            <strong>Best regards,</strong><br>
            IndiaEducates Team
          </p>
        </div>
        
        <div class="footer">
          <p>This is an automated notification from IndiaEducates Learning Platform</p>
          <p>Current time in your timezone: ${currentTime.date} at ${currentTime.time}</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail(to, subject_line, htmlContent);
}

// Contact Notification Email
async function sendContactNotificationEmail(params) {
  const { admins, contactData } = params;
  
  const subject_line = 'New Contact Form Submission - IndiaEducates';
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>New Contact Form Submission</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .contact-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
        .priority { display: inline-block; background: #ff6b6b; color: white; padding: 5px 10px; border-radius: 15px; font-size: 12px; }
        .category { display: inline-block; background: #764ba2; color: white; padding: 5px 10px; border-radius: 15px; font-size: 12px; margin-left: 10px; }
        .message-box { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 4px solid #17a2b8; }
        .education-info { background: #e8f4fd; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 4px solid #17a2b8; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📧 New Contact Form Submission</h1>
          <p>Hello Admin Team,</p>
        </div>
        
        <div class="content">
          <p>A new contact form has been submitted by a student. Please review the details below:</p>
          
          <div class="contact-info">
            <h3>📋 Contact Details</h3>
            <p><strong>Student Name:</strong> ${contactData.studentName}</p>
            <p><strong>Email:</strong> ${contactData.studentEmail}</p>
            <p><strong>Phone:</strong> ${contactData.studentPhone}</p>
            <p><strong>Service:</strong> ${contactData.service.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</p>
            <p><span class="service">${contactData.service.replace(/_/g, ' ').toUpperCase()}</span></p>
          </div>
          
          ${contactData.degree ? `
          <div class="education-info">
            <h4>🎓 Educational Background</h4>
            <p><strong>Selected Degree:</strong> ${contactData.degree === 'bachelor' ? 'Bachelor Degree' : 'Master Degree'}</p>
          </div>
          ` : ''}
          
          <div class="message-box">
            <h4>💬 Message</h4>
            <p>${contactData.message}</p>
          </div>
          
          <p><strong>Submitted at:</strong> ${new Date().toLocaleString('en-US', { 
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          })} (IST)</p>
          
          <p style="margin-top: 30px;">
            <strong>Best regards,</strong><br>
            IndiaEducates System
          </p>
        </div>
        
        <div class="footer">
          <p>This is an automated notification from IndiaEducates Learning Platform</p>
          <p>Please respond to this inquiry promptly to maintain excellent customer service.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  // Send email to all admins
  for (const admin of admins) {
    try {
      await sendEmail(admin.email, subject_line, htmlContent);
    } catch (error) {
      console.error(`Failed to send contact notification to ${admin.email}:`, error);
    }
  }
}

module.exports = {
  sendOTPEmail,
  sendCredentialsEmail,
  sendProfileUpdateEmail,
  sendClassScheduledEmail,
  sendClassUpdatedEmail,
  sendClassCancelledEmail,
  sendClassStartedEmail,
  sendStudyMaterialNotificationEmail,
  sendQuizNotificationEmail,
  sendWeeklyTestNotificationEmail,
  sendAssignmentNotificationEmail,
  sendAssignmentReviewNotificationEmail,
  sendQuizReviewNotificationEmail,
  sendContactNotificationEmail
};
