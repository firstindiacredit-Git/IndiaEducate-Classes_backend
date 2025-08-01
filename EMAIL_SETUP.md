# Email Setup for India Educates

## Environment Variables Required

To enable email notifications for class scheduling, updates, and cancellations, you need to set the following environment variables:

### Required Variables

1. **EMAIL_USER**: Your Gmail address (e.g., `your-email@gmail.com`)
2. **EMAIL_PASS**: Your Gmail app password (not your regular password)
3. **FRONTEND_URL**: Your frontend application URL (optional, defaults to `http://localhost:5173`)

### How to Get Gmail App Password

1. Go to your Google Account settings
2. Navigate to Security
3. Enable 2-Step Verification if not already enabled
4. Go to App passwords
5. Generate a new app password for "Mail"
6. Use this password as your `EMAIL_PASS`

### Example .env file

Create a `.env` file in the backend directory with:

```
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
FRONTEND_URL=http://localhost:5173
MONGO_URI=your-mongodb-connection-string
PORT=5000
```

## Email Notifications

The system now sends automatic email notifications for:

1. **New Class Scheduled**: When a new class is created, all students in that program receive an email with class details
2. **Class Updated**: When a class is edited, all students receive an updated class information
3. **Class Cancelled**: When a class expires (5 minutes after start time without being started), all students receive a cancellation notice

## Testing Email Functionality

You can test the email functionality using the test endpoint:

```
POST /api/classes/test-email
Content-Type: application/json

{
  "email": "test@example.com",
  "studentName": "Test Student",
  "program": "24-session"
}
```

## Troubleshooting

- Make sure your Gmail account has "Less secure app access" enabled or use app passwords
- Check that all environment variables are properly set
- Verify that nodemailer is installed (`npm install nodemailer`)
- Check server logs for any email sending errors 