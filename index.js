// Import dependencies
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const { createServer } = require('http');
const { Server } = require('socket.io');
const http = require('http');

const path = require("path");

// Load env variables
dotenv.config();

// Create express app
const app = express();
const server = createServer(app);

// Create Socket.io server
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

// Socket.io connection handling
io.on('connection', (socket) => {
  // console.log('User connected:', socket.id);

  // Handle student joining their notification room
  socket.on('join-notifications', (studentEmail) => {
    if (studentEmail) {
      socket.join(`notifications-${studentEmail}`);
      // console.log(`Student ${studentEmail} joined notifications room`);
    }
  });

  // Handle student leaving their notification room
  socket.on('leave-notifications', (studentEmail) => {
    if (studentEmail) {
      socket.leave(`notifications-${studentEmail}`);
      // console.log(`Student ${studentEmail} left notifications room`);
    }
  });

  // Handle student joining their profile room
  socket.on('join-profile', (studentEmail) => {
    if (studentEmail) {
      socket.join(`profile-${studentEmail}`);
      // console.log(`Student ${studentEmail} joined profile room`);
    }
  });

  // Handle student leaving their profile room
  socket.on('leave-profile', (studentEmail) => {
    if (studentEmail) {
      socket.leave(`profile-${studentEmail}`);
      // console.log(`Student ${studentEmail} left profile room`);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    // console.log('User disconnected:', socket.id);
  });
});

// Make io available globally
global.io = io;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// MongoDB Connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB connected successfully');
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  }
};

// Test route
app.get('/test', (req, res) => {
  res.send('API is running...');
});

// Add your API routes here
const adminRoutes = require('./controllers/adminUser');
const studentRoutes = require('./controllers/studentUser');
const classScheduleRoutes = require('./controllers/classScheduleController');
const attendanceRoutes = require('./controllers/attendanceController');
const notificationRoutes = require('./controllers/notificationController');
const adminNotificationRoutes = require('./controllers/adminNotificationController');

// API Routes
app.use('/api/admin', adminRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/classes', classScheduleRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin/notifications', adminNotificationRoutes);


app.use(express.static(path.join(__dirname, 'dist')));

// Catch-all route for SPA - must be after API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
  await connectDB();
  console.log(`Server running on port ${PORT}`);
});
