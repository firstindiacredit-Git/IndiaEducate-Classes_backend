const Admin = require('../model/adminModel');

const adminAuth = async (req, res, next) => {
  try {
    // Get admin credentials from request headers (sent by frontend)
    const adminEmail = req.headers['admin-email'];
    const adminPhone = req.headers['admin-phone'];
    
    if (!adminEmail && !adminPhone) {
      return res.status(400).json({ message: 'Admin credentials required' });
    }

    const admin = await Admin.findOne({
      $or: [
        { email: adminEmail },
        { phone: adminPhone },
        { email: adminPhone },
        { phone: adminEmail }
      ],
    });

    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    req.admin = admin;
    next();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = adminAuth;
