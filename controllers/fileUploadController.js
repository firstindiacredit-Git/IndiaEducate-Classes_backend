const express = require('express');
const router = express.Router();
const FileUpload = require('../model/fileUploadModel');
const Admin = require('../model/adminModel');
const { 
  uploadPdfMiddleware, 
  uploadVideoMiddleware, 
  uploadAudioMiddleware, 
  uploadImageMiddleware,
  uploadAnyFileMiddleware,
  deleteFileFromS3,
  getFileInfo 
} = require('../utils/fileUploadConfig');

// Middleware to verify admin authentication
const verifyAdmin = async (req, res, next) => {
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

// Upload PDF file
router.post('/upload-pdf', verifyAdmin, uploadPdfMiddleware, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No PDF file uploaded' });
    }

    const { category, description, tags } = req.body;
    const fileInfo = getFileInfo(req.file);

    const fileUpload = new FileUpload({
      ...fileInfo,
      category: category || 'study_material',
      description: description || '',
      tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
      uploadedBy: req.admin._id
    });

    await fileUpload.save();

    res.status(201).json({
      message: 'PDF uploaded successfully',
      file: fileUpload
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Upload video file (recorded classes)
router.post('/upload-video', verifyAdmin, uploadVideoMiddleware, async (req, res) => {
  console.log('Video upload endpoint called');
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No video file uploaded' });
    }

    const { category, description, tags } = req.body;
    const fileInfo = getFileInfo(req.file);

    const fileUpload = new FileUpload({
      ...fileInfo,
      category: category || 'recorded_class',
      description: description || '',
      tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
      uploadedBy: req.admin._id
    });

    await fileUpload.save();

    res.status(201).json({
      message: 'Video uploaded successfully',
      file: fileUpload
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Upload audio file (pronunciation practice)
router.post('/upload-audio', verifyAdmin, uploadAudioMiddleware, async (req, res) => {
  console.log('Audio upload endpoint called');
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No audio file uploaded' });
    }

    const { category, description, tags } = req.body;
    const fileInfo = getFileInfo(req.file);

    const fileUpload = new FileUpload({
      ...fileInfo,
      category: category || 'pronunciation_practice',
      description: description || '',
      tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
      uploadedBy: req.admin._id
    });

    await fileUpload.save();

    res.status(201).json({
      message: 'Audio uploaded successfully',
      file: fileUpload
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Upload image file
router.post('/upload-image', verifyAdmin, uploadImageMiddleware, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file uploaded' });
    }

    const { category, description, tags } = req.body;
    const fileInfo = getFileInfo(req.file);

    const fileUpload = new FileUpload({
      ...fileInfo,
      category: category || 'other',
      description: description || '',
      tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
      uploadedBy: req.admin._id
    });

    await fileUpload.save();

    res.status(201).json({
      message: 'Image uploaded successfully',
      file: fileUpload
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Upload any file type
router.post('/upload-file', verifyAdmin, uploadAnyFileMiddleware, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { category, description, tags } = req.body;
    const fileInfo = getFileInfo(req.file);

    const fileUpload = new FileUpload({
      ...fileInfo,
      category: category || 'other',
      description: description || '',
      tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
      uploadedBy: req.admin._id
    });

    await fileUpload.save();

    res.status(201).json({
      message: 'File uploaded successfully',
      file: fileUpload
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all files uploaded by admin
router.get('/admin-files', verifyAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 10, fileType, category, search } = req.query;
    const skip = (page - 1) * limit;

    let query = { uploadedBy: req.admin._id, isActive: true };

    if (fileType) {
      query.fileType = fileType;
    }

    if (category) {
      query.category = category;
    }

    if (search) {
      query.$or = [
        { fileName: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    const files = await FileUpload.find(query)
      .populate('uploadedBy', 'fullName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await FileUpload.countDocuments(query);

    res.json({
      files,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalFiles: total,
        hasNext: skip + files.length < total,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get file by ID
router.get('/file/:id', async (req, res) => {
  try {
    const file = await FileUpload.findById(req.params.id)
      .populate('uploadedBy', 'fullName email');

    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // For admin views, we don't increment the view count since it's for management purposes
    // The view count is only for tracking student interactions

    res.json({ file });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update file details
router.put('/file/:id', verifyAdmin, async (req, res) => {
  try {
    const { fileName, description, category, tags, isPublic } = req.body;

    const file = await FileUpload.findById(req.params.id);

    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Check if admin owns this file
    if (file.uploadedBy.toString() !== req.admin._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to update this file' });
    }

    if (fileName) file.fileName = fileName;
    if (description !== undefined) file.description = description;
    if (category) file.category = category;
    if (tags) file.tags = tags.split(',').map(tag => tag.trim());
    if (isPublic !== undefined) file.isPublic = isPublic;

    await file.save();

    res.json({
      message: 'File updated successfully',
      file
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete file
router.delete('/file/:id', verifyAdmin, async (req, res) => {
  try {
    const file = await FileUpload.findById(req.params.id);

    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Check if admin owns this file
    if (file.uploadedBy.toString() !== req.admin._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to delete this file' });
    }

    // Delete from S3
    await deleteFileFromS3(file.s3Url);

    // Soft delete by setting isActive to false
    file.isActive = false;
    await file.save();

    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get file statistics
router.get('/stats', verifyAdmin, async (req, res) => {
  try {
    const stats = await FileUpload.aggregate([
      { $match: { uploadedBy: req.admin._id, isActive: true } },
      {
        $group: {
          _id: null,
          totalFiles: { $sum: 1 },
          totalSize: { $sum: '$fileSize' },
          totalViews: { $sum: '$viewCount' },
          totalDownloads: { $sum: '$downloadCount' },
          byType: {
            $push: {
              fileType: '$fileType',
              fileSize: '$fileSize'
            }
          },
          byCategory: {
            $push: {
              category: '$category',
              fileSize: '$fileSize'
            }
          }
        }
      }
    ]);

    if (stats.length === 0) {
      return res.json({
        totalFiles: 0,
        totalSize: 0,
        totalViews: 0,
        totalDownloads: 0,
        byType: {},
        byCategory: {}
      });
    }

    const stat = stats[0];
    
    // Calculate type-wise statistics
    const byType = {};
    stat.byType.forEach(item => {
      if (!byType[item.fileType]) {
        byType[item.fileType] = { count: 0, size: 0 };
      }
      byType[item.fileType].count += 1;
      byType[item.fileType].size += item.fileSize;
    });

    // Calculate category-wise statistics
    const byCategory = {};
    stat.byCategory.forEach(item => {
      if (!byCategory[item.category]) {
        byCategory[item.category] = { count: 0, size: 0 };
      }
      byCategory[item.category].count += 1;
      byCategory[item.category].size += item.fileSize;
    });

    res.json({
      totalFiles: stat.totalFiles,
      totalSize: stat.totalSize,
      totalViews: stat.totalViews,
      totalDownloads: stat.totalDownloads,
      byType,
      byCategory
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router; 