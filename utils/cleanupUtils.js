const Student = require('../model/studentModel');

// Cleanup expired pending registrations
async function cleanupExpiredPendingRegistrations() {
  try {
    const result = await Student.PendingStudent.deleteMany({
      otpExpires: { $lt: new Date() }
    });
    console.log(`Cleaned up ${result.deletedCount} expired pending registrations at ${new Date().toISOString()}`);
    return result.deletedCount;
  } catch (error) {
    console.error('Error cleaning up expired pending registrations:', error);
    throw error;
  }
}

// Set up periodic cleanup (every 30 minutes)
function setupPeriodicCleanup() {
  // Run cleanup every 30 minutes
  setInterval(async () => {
    try {
      await cleanupExpiredPendingRegistrations();
    } catch (error) {
      console.error('Periodic cleanup failed:', error);
    }
  }, 30 * 60 * 1000); // 30 minutes in milliseconds
  
  // console.log('Periodic cleanup setup complete - will run every 30 minutes');
}

module.exports = {
  cleanupExpiredPendingRegistrations,
  setupPeriodicCleanup
};
