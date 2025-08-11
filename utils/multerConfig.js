const multer = require('multer');
const multerS3 = require('multer-s3');
const { s3Client, bucketName, getPublicUrl } = require('./s3Config');
const path = require('path');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');

// Allowed file types for profile pictures
const ALLOWED_PROFILE_FILE_TYPES = ['image/jpeg', 'image/png', 'image/gif'];
// Allowed file types for ticket attachments
const ALLOWED_TICKET_FILE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'text/plain'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// Configure multer for profile picture uploads
const profileUpload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: bucketName,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    metadata: function (req, file, cb) {
      cb(null, { fieldName: file.fieldname });
    },
    key: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const ext = path.extname(file.originalname);
      const key = `students/profilePictures/${uniqueSuffix}${ext}`;
      // Add the public URL to the file object
      file.publicUrl = getPublicUrl(key);
      cb(null, key);
    }
  }),
  fileFilter: (req, file, cb) => {
    // Check file type
    if (!ALLOWED_PROFILE_FILE_TYPES.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Only JPG, PNG and GIF files are allowed.'), false);
    }
    cb(null, true);
  },
  limits: {
    fileSize: MAX_FILE_SIZE, // 5MB limit
  }
}).single('profilePicture');

// Configure multer for ticket attachment uploads
const ticketUpload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: bucketName,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    metadata: function (req, file, cb) {
      cb(null, { fieldName: file.fieldname });
    },
    key: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const ext = path.extname(file.originalname);
      const key = `tickets/attachments/${uniqueSuffix}${ext}`;
      // Add the public URL to the file object
      file.publicUrl = getPublicUrl(key);
      cb(null, key);
    }
  }),
  fileFilter: (req, file, cb) => {
    // Check file type
    if (!ALLOWED_TICKET_FILE_TYPES.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Only JPG, PNG, GIF, PDF and TXT files are allowed.'), false);
    }
    cb(null, true);
  },
  limits: {
    fileSize: MAX_FILE_SIZE, // 5MB limit
  }
}).single('attachment');

// Wrapper function to handle profile picture upload errors
const profileUploadMiddleware = (req, res, next) => {
  profileUpload(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          message: 'File is too large. Maximum size allowed is 5MB.'
        });
      }
      return res.status(400).json({
        message: 'File upload error: ' + err.message
      });
    } else if (err) {
      return res.status(400).json({
        message: err.message
      });
    }
    // If file was uploaded, add the public URL to req.file
    if (req.file) {
      req.file.location = req.file.publicUrl;
    }
    next();
  });
};

// Wrapper function to handle ticket attachment upload errors
const ticketUploadMiddleware = (req, res, next) => {
 
  
  ticketUpload(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      console.error('Multer error:', err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          message: 'File is too large. Maximum size allowed is 5MB.'
        });
      }
      return res.status(400).json({
        message: 'File upload error: ' + err.message
      });
    } else if (err) {
      console.error('Other upload error:', err);
      return res.status(400).json({
        message: err.message
      });
    }
    

    // If file was uploaded, add the public URL to req.file
    if (req.file) {
      req.file.location = req.file.publicUrl;

    }
    next();
  });
};

// Helper to delete old profile picture from S3
const deleteFileFromS3 = async (fileUrl) => {
  if (!fileUrl) return;
  try {
    const key = fileUrl.split('.com/')[1]; // Extract key from URL
    await s3Client.send(new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key
    }));
  } catch (error) {
    console.error('Error deleting file from S3:', error);
  }
};

module.exports = {
  uploadMiddleware: profileUploadMiddleware, // For backward compatibility
  profileUploadMiddleware,
  ticketUploadMiddleware,
  deleteFileFromS3
};
