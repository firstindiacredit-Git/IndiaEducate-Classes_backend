const express = require('express');
const router = express.Router();
const FileUpload = require('../model/fileUploadModel');
const Student = require('../model/studentModel');

// Middleware to verify student authentication
const verifyStudent = async (req, res, next) => {
  try {
    // For GET requests, check query params, for others check body
    const emailOrPhone = req.method === 'GET' ? req.query.emailOrPhone : req.body.emailOrPhone;
    
    if (!emailOrPhone) {
      return res.status(400).json({ message: 'Email or phone required' });
    }

    const student = await Student.findOne({
      $or: [{ email: emailOrPhone }, { phone: emailOrPhone }],
    });

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    req.student = student;
    next();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get all public files for students
router.get('/files', async (req, res) => {
  try {
    const { page = 1, limit = 12, fileType, category, search, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    const skip = (page - 1) * limit;

    let query = { isPublic: true, isActive: true };

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

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const files = await FileUpload.find(query)
      .populate('uploadedBy', 'fullName')
      .sort(sortOptions)
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

// Get file by ID for viewing
router.get('/file/:id', verifyStudent, async (req, res) => {
  try {
    const file = await FileUpload.findById(req.params.id)
      .populate('uploadedBy', 'fullName');

    if (!file || !file.isPublic || !file.isActive) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Check if student has already viewed this file
    const hasViewed = file.viewedBy.includes(req.student._id);
    
    if (!hasViewed) {
      // Add student to viewedBy array and increment view count
      file.viewedBy.push(req.student._id);
      file.viewCount = file.viewedBy.length; // Update count based on unique viewers
      await file.save();
    }

    res.json({ file });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Download file (increment download count)
router.post('/download/:id', verifyStudent, async (req, res) => {
  try {
    const file = await FileUpload.findById(req.params.id);

    if (!file || !file.isPublic || !file.isActive) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Check if student has already downloaded this file
    const hasDownloaded = file.downloadedBy.includes(req.student._id);
    
    if (!hasDownloaded) {
      // Add student to downloadedBy array and increment download count
      file.downloadedBy.push(req.student._id);
      file.downloadCount = file.downloadedBy.length; // Update count based on unique downloaders
      await file.save();
    }

    // Create a download URL with proper headers
    const downloadUrl = `${req.protocol}://${req.get('host')}/api/student/files/download-file/${file._id}`;

    res.json({
      message: 'Download link generated',
      downloadUrl: downloadUrl,
      fileName: file.fileName
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Proxy download endpoint that serves file with proper headers
router.get('/download-file/:id', async (req, res) => {
  try {
    const file = await FileUpload.findById(req.params.id);

    if (!file || !file.isPublic || !file.isActive) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Set proper headers for download
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    
    // Fetch the file from S3 and pipe it to the response
    const https = require('https');
    const url = require('url');
    
    const s3Url = new URL(file.s3Url);
    
    const options = {
      hostname: s3Url.hostname,
      path: s3Url.pathname + s3Url.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FileDownload/1.0)'
      }
    };

    const request = https.request(options, (s3Response) => {
      // Set our custom headers
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
      res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
      res.setHeader('Content-Length', s3Response.headers['content-length']);
      
      // Pipe the S3 response to our response
      s3Response.pipe(res);
    });

    request.on('error', (error) => {
      console.error('S3 request error:', error);
      res.status(500).json({ message: 'Failed to download file' });
    });

    request.end();
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get files by category
router.get('/category/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const { page = 1, limit = 12, fileType, search } = req.query;
    const skip = (page - 1) * limit;

    let query = { 
      category, 
      isPublic: true, 
      isActive: true 
    };

    if (fileType) {
      query.fileType = fileType;
    }

    if (search) {
      query.$or = [
        { fileName: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    const files = await FileUpload.find(query)
      .populate('uploadedBy', 'fullName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await FileUpload.countDocuments(query);

    res.json({
      files,
      category,
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

// Get files by file type
router.get('/type/:fileType', async (req, res) => {
  try {
    const { fileType } = req.params;
    const { page = 1, limit = 12, category, search } = req.query;
    const skip = (page - 1) * limit;

    let query = { 
      fileType, 
      isPublic: true, 
      isActive: true 
    };

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
      .populate('uploadedBy', 'fullName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await FileUpload.countDocuments(query);

    res.json({
      files,
      fileType,
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

// Get popular files (most viewed/downloaded)
router.get('/popular', async (req, res) => {
  try {
    const { limit = 10, timeFrame = 'all' } = req.query;
    
    let dateFilter = {};
    if (timeFrame === 'week') {
      dateFilter = { createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } };
    } else if (timeFrame === 'month') {
      dateFilter = { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } };
    }

    const files = await FileUpload.find({
      isPublic: true,
      isActive: true,
      ...dateFilter
    })
      .populate('uploadedBy', 'fullName')
      .sort({ viewCount: -1, downloadCount: -1 })
      .limit(parseInt(limit));

    res.json({ files });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get recent files
router.get('/recent', async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const files = await FileUpload.find({
      isPublic: true,
      isActive: true
    })
      .populate('uploadedBy', 'fullName')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.json({ files });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Search files with advanced filters
router.get('/search', async (req, res) => {
  try {
    const { 
      q, 
      fileType, 
      category, 
      page = 1, 
      limit = 12,
      sortBy = 'relevance',
      sortOrder = 'desc'
    } = req.query;
    const skip = (page - 1) * limit;

    let query = { isPublic: true, isActive: true };

    if (q) {
      query.$or = [
        { fileName: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
        { tags: { $in: [new RegExp(q, 'i')] } }
      ];
    }

    if (fileType) {
      query.fileType = fileType;
    }

    if (category) {
      query.category = category;
    }

    let sortOptions = {};
    if (sortBy === 'relevance' && q) {
      // For relevance sorting, we'll use text score if available
      sortOptions = { score: { $meta: 'textScore' } };
    } else if (sortBy === 'views') {
      sortOptions = { viewCount: sortOrder === 'desc' ? -1 : 1 };
    } else if (sortBy === 'downloads') {
      sortOptions = { downloadCount: sortOrder === 'desc' ? -1 : 1 };
    } else {
      sortOptions = { createdAt: sortOrder === 'desc' ? -1 : 1 };
    }

    const files = await FileUpload.find(query)
      .populate('uploadedBy', 'fullName')
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await FileUpload.countDocuments(query);

    res.json({
      files,
      searchQuery: q,
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

// Get file categories and types for filtering
router.get('/filters', async (req, res) => {
  try {
    const categories = await FileUpload.distinct('category', { isPublic: true, isActive: true });
    const fileTypes = await FileUpload.distinct('fileType', { isPublic: true, isActive: true });

    res.json({
      categories,
      fileTypes
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router; 