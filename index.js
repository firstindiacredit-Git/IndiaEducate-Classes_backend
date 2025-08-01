// Import dependencies
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const { createServer } = require('http');
const { Server } = require('socket.io');

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
  console.log('User connected:', socket.id);

  // Handle student joining their notification room
  socket.on('join-notifications', (studentEmail) => {
    if (studentEmail) {
      socket.join(`notifications-${studentEmail}`);
      console.log(`Student ${studentEmail} joined notifications room`);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
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

// Routes
app.use('/api/admin', adminRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/classes', classScheduleRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin/notifications', adminNotificationRoutes);

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
  await connectDB();
  console.log(`Server running on port ${PORT}`);
});
