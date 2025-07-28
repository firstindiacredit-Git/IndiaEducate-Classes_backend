const multer = require('multer');
const multerS3 = require('multer-s3');
const { s3Client, bucketName, getPublicUrl } = require('./s3Config');
const path = require('path');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');

// Allowed file types
const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'image/gif'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// Configure multer for uploading to S3
const upload = multer({
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
    if (!ALLOWED_FILE_TYPES.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Only JPG, PNG and GIF files are allowed.'), false);
    }
    cb(null, true);
  },
  limits: {
    fileSize: MAX_FILE_SIZE, // 5MB limit
  }
}).single('profilePicture');

// Wrapper function to handle multer errors
const uploadMiddleware = (req, res, next) => {
  upload(req, res, function (err) {
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
  uploadMiddleware,
  deleteFileFromS3
};
