const multer = require('multer');
const multerS3 = require('multer-s3');
const { s3Client, bucketName, getPublicUrl } = require('./s3Config');
const path = require('path');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');

// Allowed file types for different categories
const ALLOWED_FILE_TYPES = {
  pdf: ['application/pdf'],
  video: ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/flv', 'video/webm'],
  audio: ['audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a', 'audio/aac', 'audio/x-m4a', 'audio/mpeg', 'audio/mp4', 'audio/webm'],
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
};

// File size limits (in bytes)
const FILE_SIZE_LIMITS = {
  pdf: 50 * 1024 * 1024, // 50MB
  video: 500 * 1024 * 1024, // 500MB
  audio: 100 * 1024 * 1024, // 100MB
  image: 10 * 1024 * 1024 // 10MB
};

// Helper function to get file type from mimetype
const getFileTypeFromMimeType = (mimetype) => {
  for (const [type, mimeTypes] of Object.entries(ALLOWED_FILE_TYPES)) {
    if (mimeTypes.includes(mimetype)) {
      return type;
    }
  }
  return null;
};

// Helper function to get size limit for file type
const getSizeLimitForFileType = (fileType) => {
  return FILE_SIZE_LIMITS[fileType] || FILE_SIZE_LIMITS.pdf;
};

// Create multer upload configuration
const createUploadConfig = (fileType) => {
  const allowedMimeTypes = ALLOWED_FILE_TYPES[fileType] || [];
  const sizeLimit = getSizeLimitForFileType(fileType);
  
  return multer({
    storage: multerS3({
      s3: s3Client,
      bucket: bucketName,
      contentType: multerS3.AUTO_CONTENT_TYPE,
      metadata: function (req, file, cb) {
        cb(null, { 
          fieldName: file.fieldname,
          originalName: file.originalname,
          fileType: fileType
        });
      },
      key: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const key = `uploads/${fileType}/${uniqueSuffix}${ext}`;
        // Add the public URL to the file object
        file.publicUrl = getPublicUrl(key);
        file.s3Key = key;
        cb(null, key);
      }
    }),
    fileFilter: (req, file, cb) => {
      
      // Check file type by MIME type first
      if (allowedMimeTypes.includes(file.mimetype)) {
        return cb(null, true);
      }
      
      // Fallback: Check by file extension
      const fileExtension = path.extname(file.originalname).toLowerCase();
      const allowedExtensions = {
        pdf: ['.pdf'],
        video: ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm'],
        audio: ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.webm'],
        image: ['.jpg', '.jpeg', '.png', '.gif', '.webp']
      };
      
      if (allowedExtensions[fileType] && allowedExtensions[fileType].includes(fileExtension)) {
        return cb(null, true);
      }
      
      return cb(new Error(`Invalid file type for ${fileType}. Allowed types: ${allowedMimeTypes.join(', ')}`), false);
    },
    limits: {
      fileSize: sizeLimit,
    }
  });
};

// Create upload middlewares for different file types
const uploadPdf = createUploadConfig('pdf').single('file');
const uploadVideo = createUploadConfig('video').single('file');
const uploadAudio = createUploadConfig('audio').single('file');
const uploadImage = createUploadConfig('image').single('file');

// Generic upload middleware that accepts any file type
const uploadAnyFile = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: bucketName,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    metadata: function (req, file, cb) {
      cb(null, { 
        fieldName: file.fieldname,
        originalName: file.originalname
      });
    },
    key: function (req, file, cb) {
      const fileType = getFileTypeFromMimeType(file.mimetype);
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const ext = path.extname(file.originalname);
      const key = `uploads/${fileType || 'other'}/${uniqueSuffix}${ext}`;
      file.publicUrl = getPublicUrl(key);
      file.s3Key = key;
      file.fileType = fileType;
      cb(null, key);
    }
  }),
  fileFilter: (req, file, cb) => {
    const allAllowedTypes = Object.values(ALLOWED_FILE_TYPES).flat();
    if (!allAllowedTypes.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Only PDF, video, audio, and image files are allowed.'), false);
    }
    cb(null, true);
  },
  limits: {
    fileSize: Math.max(...Object.values(FILE_SIZE_LIMITS)), // Use the largest size limit
  }
}).single('file');

// Wrapper function to handle multer errors
const createUploadMiddleware = (uploadFunction) => {
  return (req, res, next) => {
    uploadFunction(req, res, function (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          const fileType = req.file?.fileType || 'file';
          const sizeLimit = getSizeLimitForFileType(fileType);
          const sizeInMB = Math.round(sizeLimit / (1024 * 1024));
          return res.status(400).json({
            message: `File is too large. Maximum size allowed for ${fileType} is ${sizeInMB}MB.`
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
};

// Export specific upload middlewares
const uploadPdfMiddleware = createUploadMiddleware(uploadPdf);
const uploadVideoMiddleware = createUploadMiddleware(uploadVideo);
const uploadAudioMiddleware = createUploadMiddleware(uploadAudio);
const uploadImageMiddleware = createUploadMiddleware(uploadImage);
const uploadAnyFileMiddleware = createUploadMiddleware(uploadAnyFile);

// Helper to delete file from S3
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

// Helper to get file info
const getFileInfo = (file) => {
  if (!file) return null;
  
  const fileType = getFileTypeFromMimeType(file.mimetype);
  return {
    fileName: file.originalname,
    originalName: file.originalname,
    fileType: fileType,
    fileSize: file.size,
    mimeType: file.mimetype,
    s3Key: file.s3Key,
    s3Url: file.publicUrl,
    location: file.publicUrl
  };
};

module.exports = {
  uploadPdfMiddleware,
  uploadVideoMiddleware,
  uploadAudioMiddleware,
  uploadImageMiddleware,
  uploadAnyFileMiddleware,
  deleteFileFromS3,
  getFileInfo,
  ALLOWED_FILE_TYPES,
  FILE_SIZE_LIMITS,
  getFileTypeFromMimeType,
  getSizeLimitForFileType
}; 