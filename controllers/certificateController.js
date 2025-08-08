const express = require('express');
const Certificate = require('../model/certificateModel');
const Student = require('../model/studentModel');
const Admin = require('../model/adminModel');
const { uploadMiddleware, deleteFileFromS3 } = require('../utils/multerConfig');
const { s3Client, bucketName, getPublicUrl } = require('../utils/s3Config');
const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const puppeteer = require('puppeteer');

const router = express.Router();

// Middleware to verify student
const verifyStudent = async (req, res, next) => {
  try {
    const { emailOrPhone } = req.body;
    if (!emailOrPhone) {
      return res.status(400).json({ message: 'Email or phone is required' });
    }
    
    const student = await Student.findOne({
      $or: [{ email: emailOrPhone }, { phone: emailOrPhone }]
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

// Middleware to verify admin
const verifyAdmin = async (req, res, next) => {
  try {
    const { emailOrPhone } = req.body;
    if (!emailOrPhone) {
      return res.status(400).json({ message: 'Email or phone is required' });
    }
    
    const admin = await Admin.findOne({
      $or: [{ email: emailOrPhone }, { phone: emailOrPhone }]
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

// Get student's certificate status
router.post('/student/status', verifyStudent, async (req, res) => {
  try {
    const certificate = await Certificate.findOne({ studentId: req.student._id });
    
    if (!certificate) {
      return res.json({
        hasCertificate: false,
        message: 'No certificate found'
      });
    }
    
    res.json({
      hasCertificate: true,
      certificate: {
        certificateNumber: certificate.certificateNumber,
        isGenerated: certificate.isGenerated,
        isAllowedByAdmin: certificate.isAllowedByAdmin,
        issueDate: certificate.issueDate,
        completionDate: certificate.completionDate,
        certificateUrl: certificate.certificateUrl,
        previewUrl: `/api/certificates/preview/${certificate._id}`
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Request certificate generation (student)
router.post('/student/request', verifyStudent, async (req, res) => {
  try {
    // Check if certificate already exists
    let certificate = await Certificate.findOne({ studentId: req.student._id });
    
    if (certificate) {
      return res.status(400).json({ message: 'Certificate already requested' });
    }
    
    // Create new certificate request
    const year = new Date().getFullYear();
    const randomNum = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    const certificateNumber = `CERT-${year}-${randomNum}`;
    
    certificate = new Certificate({
      studentId: req.student._id,
      studentName: req.student.fullName || 'Student',
      program: req.student.program || '24-session',
      completionDate: new Date(),
      certificateNumber: certificateNumber
    });
    
    await certificate.save();
    
    res.json({
      message: 'Certificate request submitted successfully',
      certificateNumber: certificate.certificateNumber
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Generate certificate HTML and convert to PDF
const generateCertificateHTML = async (certificate, student) => {
  try {
    // Create HTML content with dynamic data
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>India Educates Certificate</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            padding: 20px;
        }

        .certificate {
            width: 900px;
            height: 650px;
            background: linear-gradient(145deg, #ffffff 0%, #f8f9fa 100%);
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.1);
            position: relative;
            overflow: hidden;
            border-radius: 15px;
        }

        .certificate::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grain" width="100" height="100" patternUnits="userSpaceOnUse"><circle cx="50" cy="50" r="1" fill="%23f0f0f0" opacity="0.3"/></pattern></defs><rect width="100" height="100" fill="url(%23grain)"/></svg>');
            pointer-events: none;
            z-index: 1;
        }

        /* Header Section */
        .header {
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 50%, #1e3c72 100%);
            height: 140px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0 50px;
            position: relative;
            z-index: 2;
        }

        .header::after {
            content: '';
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: linear-gradient(90deg, #ffd700, #ffed4e, #ffd700);
        }

        .header-left {
            display: flex;
            align-items: center;
            gap: 20px;
        }

        .curly-braces {
            color: #ffd700;
            font-size: 28px;
            font-weight: bold;
            writing-mode: vertical-rl;
            text-orientation: mixed;
            line-height: 1.2;
            text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            animation: glow 2s ease-in-out infinite alternate;
        }

        @keyframes glow {
            from { text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3); }
            to { text-shadow: 0 2px 8px rgba(255, 215, 0, 0.6); }
        }

        .camp-title {
            color: white;
            font-size: 16px;
            font-weight: bold;
            text-align: center;
            line-height: 1.4;
            text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            letter-spacing: 1px;
        }

        .header-right {
            display: flex;
            align-items: center;
            gap: 15px;
        }

        .codechef-text {
            color: white;
            font-size: 20px;
            font-weight: bold;
            text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            letter-spacing: 2px;
        }

        .unacademy-logo {
            display: flex;
            align-items: center;
            gap: 8px;
            background: rgba(255, 255, 255, 0.1);
            padding: 8px 12px;
            border-radius: 20px;
            backdrop-filter: blur(10px);
        }

        .unacademy-text {
            color: #0066cc;
            font-size: 14px;
            font-weight: bold;
        }

        .triangle {
            width: 0;
            height: 0;
            border-left: 8px solid #0066cc;
            border-top: 4px solid transparent;
            border-bottom: 4px solid transparent;
        }

        /* Main Body */
        .main-body {
            padding: 50px;
            position: relative;
            height: calc(100% - 140px - 70px);
            z-index: 2;
        }

        .background-graphic {
            position: absolute;
            right: 30px;
            top: 50%;
            transform: translateY(-50%);
            width: 150px;
            height: 150px;
            background: linear-gradient(45deg, #e3f2fd, #bbdefb);
            border-radius: 50%;
            opacity: 0.4;
            z-index: 1;
            box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.1);
        }

        .background-graphic::before {
            content: '';
            position: absolute;
            top: 20px;
            left: 20px;
            right: 20px;
            bottom: 20px;
            border: 2px dashed rgba(33, 150, 243, 0.3);
            border-radius: 50%;
        }

        .certificate-content {
            position: relative;
            z-index: 2;
        }

        .certificate-title {
            font-size: 36px;
            font-weight: 800;
            color: #1a237e;
            text-align: center;
            margin-bottom: 15px;
            text-transform: uppercase;
            letter-spacing: 3px;
            text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .title-underline {
            width: 250px;
            height: 3px;
            background: linear-gradient(90deg, transparent, #1a237e, transparent);
            margin: 0 auto 50px;
            border-radius: 2px;
        }

        .certificate-text {
            font-size: 18px;
            color: #37474f;
            line-height: 2;
            text-align: center;
            margin-bottom: 40px;
            font-weight: 400;
        }

        .participant-name {
            font-size: 28px;
            font-weight: 700;
            color: #1a237e;
            margin: 15px 0;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
            letter-spacing: 1px;
        }

        .camp-dates {
            font-weight: 700;
            color: #1a237e;
            background: linear-gradient(45deg, #e8f5e8, #f1f8e9);
            padding: 5px 15px;
            border-radius: 20px;
            display: inline-block;
            margin-top: 10px;
        }

        .bottom-section {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            margin-top: 50px;
        }

        .issue-date {
            font-size: 16px;
            color: #37474f;
            background: linear-gradient(45deg, #f5f5f5, #eeeeee);
            padding: 15px 25px;
            border-radius: 25px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        }

        .issue-date strong {
            font-weight: 700;
            color: #1a237e;
        }

        .signature-section {
            text-align: right;
        }

        .signature {
            width: 140px;
            height: 50px;
            background: linear-gradient(45deg, #37474f, #546e7a);
            margin-bottom: 15px;
            border-radius: 5px;
            position: relative;
            overflow: hidden;
        }

        .signature::before {
            content: '';
            position: absolute;
            top: 50%;
            left: 20px;
            right: 20px;
            height: 2px;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
            transform: translateY(-50%);
        }

        .signature::after {
            content: '';
            position: absolute;
            top: 30%;
            left: 30px;
            right: 30px;
            height: 1px;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
        }

        .signature-name {
            font-size: 16px;
            font-weight: 700;
            color: #1a237e;
            margin-bottom: 3px;
        }

        .signature-title {
            font-size: 13px;
            color: #546e7a;
            font-weight: 500;
        }

        /* Footer */
        .footer {
            background: linear-gradient(135deg, #f5f5f5, #eeeeee);
            padding: 20px 50px;
            font-size: 12px;
            color: #546e7a;
            line-height: 1.6;
            border-top: 1px solid #e0e0e0;
            z-index: 2;
            position: relative;
        }

        .verification-link {
            color: #1976d2;
            text-decoration: none;
            font-weight: 600;
            transition: color 0.3s ease;
        }

        .verification-link:hover {
            color: #0d47a1;
            text-decoration: underline;
        }

        /* Decorative elements */
        .corner-decoration {
            position: absolute;
            width: 60px;
            height: 60px;
            border: 3px solid #e3f2fd;
            opacity: 0.6;
        }

        .corner-decoration.top-left {
            top: 20px;
            left: 20px;
            border-right: none;
            border-bottom: none;
        }

        .corner-decoration.top-right {
            top: 20px;
            right: 20px;
            border-left: none;
            border-bottom: none;
        }

        .corner-decoration.bottom-left {
            bottom: 20px;
            left: 20px;
            border-right: none;
            border-top: none;
        }

        .corner-decoration.bottom-right {
            bottom: 20px;
            right: 20px;
            border-left: none;
            border-top: none;
        }

        /* Responsive design */
        @media (max-width: 768px) {
            .certificate {
                width: 95%;
                height: auto;
                min-height: 600px;
            }
            
            .header {
                padding: 0 20px;
                height: 120px;
            }
            
            .main-body {
                padding: 30px 20px;
            }
            
            .certificate-title {
                font-size: 28px;
            }
            
            .participant-name {
                font-size: 24px;
            }
        }
    </style>
</head>
<body>
    <div class="certificate">
        <!-- Decorative corners -->
        <div class="corner-decoration top-left"></div>
        <div class="corner-decoration top-right"></div>
        <div class="corner-decoration bottom-left"></div>
        <div class="corner-decoration bottom-right"></div>

        <!-- Header Section -->
        <div class="header">
            <div class="header-left">
                <div class="curly-braces">{}</div>
                <div class="camp-title">
                    INDIA<br>EDUCATES<br>PROGRAM
                </div>
            </div>
            <div class="header-right">
                <div class="codechef-text">INDIA EDUCATES</div>
                <div class="unacademy-logo">
                    <div class="unacademy-text">Certificate</div>
                    <div class="triangle"></div>
                </div>
            </div>
        </div>

        <!-- Main Body -->
        <div class="main-body">
            <div class="background-graphic"></div>
            <div class="certificate-content">
                <div class="certificate-title">Certificate of Completion</div>
                <div class="title-underline"></div>
                
                <div class="certificate-text">
                    This is to certify that<br>
                    <div class="participant-name">${student.fullName || 'Student Name'}</div>
                    has successfully completed the<br>
                    <span class="camp-dates">${certificate.program} Program</span><br>
                    conducted by India Educates
                </div>

                <div class="bottom-section">
                    <div class="issue-date">
                        Date : <strong>${new Date(certificate.issueDate).toLocaleDateString()}</strong>
                    </div>
                    <div class="signature-section">
                        <div class="signature"></div>
                        <div class="signature-name">India Educates</div>
                        <div class="signature-title">Certificate Authority</div>
                        <div class="signature-title">Certificate ID: ${certificate.certificateNumber}</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Footer -->
        <div class="footer">
            For certificate verification, please visit: 
            <a href="https://indiaeducates.com/verify" class="verification-link">https://indiaeducates.com/verify</a><br>
            Certificate id: ${certificate.certificateNumber} | Student: ${student.fullName || 'Student'}
        </div>
    </div>
</body>
</html>`;
      
      // Convert HTML to PDF directly from string
      const pdfBuffer = await convertHTMLToPDFBuffer(htmlContent, certificate.certificateNumber);
      return pdfBuffer;
      
    } catch (error) {
      throw error;
    }
  };

// Convert HTML to PDF using Puppeteer (returns buffer)
const convertHTMLToPDFBuffer = async (htmlContent, certificateNumber) => {
  try {
    // Check if puppeteer is available
    if (!puppeteer) {
      throw new Error('Puppeteer is not installed. Please run: npm install puppeteer');
    }
    
    const browser = await puppeteer.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Set HTML content directly
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    // Set viewport for A4 landscape
    await page.setViewport({ width: 1200, height: 800 });
    
    // Generate PDF as buffer
    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: {
        top: '0.5in',
        right: '0.5in',
        bottom: '0.5in',
        left: '0.5in'
      }
    });
    
    await browser.close();
    return pdfBuffer;
    
  } catch (error) {
    console.error('Error converting HTML to PDF:', error);
    // If PDF conversion fails, return HTML content as buffer
    console.log('Falling back to HTML certificate');
    return Buffer.from(htmlContent, 'utf8');
  }
};

// Upload certificate to S3
const uploadCertificateToS3 = async (fileBuffer, certificateNumber, fileType = 'pdf') => {
  try {
    const key = `certificates/${certificateNumber}.${fileType}`;
    
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: fileType === 'pdf' ? 'application/pdf' : 'text/html',
      ContentDisposition: 'inline',
      Metadata: {
        'certificate-number': certificateNumber,
        'file-type': fileType
      }
    }));
    
    return getPublicUrl(key);
    
  } catch (error) {
    console.error('Error uploading certificate to S3:', error);
    throw error;
  }
};

// Download certificate from S3
const downloadCertificateFromS3 = async (certificateNumber, fileType = 'pdf') => {
  try {
    const key = `certificates/${certificateNumber}.${fileType}`;
    
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key
    });
    
    const response = await s3Client.send(command);
    return response.Body;
    
  } catch (error) {
    console.error('Error downloading certificate from S3:', error);
    throw error;
  }
};

// Generate certificate (admin approved)
router.post('/student/generate', verifyStudent, async (req, res) => {
  try {
    const certificate = await Certificate.findOne({ studentId: req.student._id });
    
    if (!certificate) {
      return res.status(404).json({ message: 'Certificate not found' });
    }
    
    if (!certificate.isAllowedByAdmin) {
      return res.status(403).json({ message: 'Certificate generation not allowed by admin yet' });
    }
    
    if (certificate.isGenerated && certificate.certificateUrl) {
      return res.json({
        message: 'Certificate already generated',
        certificateUrl: certificate.certificateUrl
      });
    }
    
    // Generate HTML Certificate and convert to PDF
    const certificateBuffer = await generateCertificateHTML(certificate, req.student);
    
    // Determine file type based on buffer content
    const fileType = certificateBuffer[0] === 0x25 && certificateBuffer[1] === 0x50 && certificateBuffer[2] === 0x44 && certificateBuffer[3] === 0x46 ? 'pdf' : 'html';
    
    // Upload to S3
    const s3Url = await uploadCertificateToS3(certificateBuffer, certificate.certificateNumber, fileType);
    
    // Set URLs for certificate
    const certificateUrl = `/api/certificates/download/${certificate._id}`;
    const previewUrl = `/api/certificates/preview/${certificate._id}`;
    
    certificate.isGenerated = true;
    certificate.certificateUrl = certificateUrl;
    certificate.s3Url = s3Url; // Store S3 URL for reference
    await certificate.save();
    
    res.json({
      message: 'Certificate generated successfully',
      certificateUrl: certificateUrl,
      previewUrl: previewUrl
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Download certificate
router.get('/download/:id', async (req, res) => {
  try {
    const certificate = await Certificate.findById(req.params.id);
    
    if (!certificate) {
      return res.status(404).json({ message: 'Certificate not found' });
    }
    
    if (!certificate.isGenerated) {
      return res.status(400).json({ message: 'Certificate not generated yet' });
    }
    
    // Try to download from S3
    try {
      let fileType = 'pdf';
      let certificateStream;
      
      try {
        certificateStream = await downloadCertificateFromS3(certificate.certificateNumber, 'pdf');
      } catch (error) {
        // If PDF not found, try HTML
        certificateStream = await downloadCertificateFromS3(certificate.certificateNumber, 'html');
        fileType = 'html';
      }
      
      const contentType = fileType === 'pdf' ? 'application/pdf' : 'text/html';
      const downloadName = `certificate-${certificate.certificateNumber}.${fileType}`;
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
      
      certificateStream.pipe(res);
      
    } catch (s3Error) {
      return res.status(404).json({ message: 'Certificate file not found in S3' });
    }
    
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Preview certificate (without download headers)
router.get('/preview/:id', async (req, res) => {
  try {
    const certificate = await Certificate.findById(req.params.id);
    
    if (!certificate) {
      return res.status(404).json({ message: 'Certificate not found' });
    }
    
    if (!certificate.isGenerated) {
      return res.status(400).json({ message: 'Certificate not generated yet' });
    }
    
    // Try to download from S3
    try {
      let fileType = 'pdf';
      let certificateStream;
      
      try {
        certificateStream = await downloadCertificateFromS3(certificate.certificateNumber, 'pdf');
      } catch (error) {
        // If PDF not found, try HTML
        certificateStream = await downloadCertificateFromS3(certificate.certificateNumber, 'html');
        fileType = 'html';
      }
      
      const contentType = fileType === 'pdf' ? 'application/pdf' : 'text/html';
      
      // Set headers for preview (no download)
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      
      certificateStream.pipe(res);
      
    } catch (s3Error) {
      return res.status(404).json({ message: 'Certificate file not found in S3' });
    }
    
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Admin: Get all certificate requests
router.post('/admin/requests', verifyAdmin, async (req, res) => {
  try {
    const certificates = await Certificate.find()
      .populate('studentId', 'fullName email phone program')
      .sort({ createdAt: -1 });
    
    res.json(certificates);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Admin: Allow certificate generation
router.post('/admin/allow/:id', verifyAdmin, async (req, res) => {
  try {
    const certificate = await Certificate.findById(req.params.id);
    
    if (!certificate) {
      return res.status(404).json({ message: 'Certificate not found' });
    }
    
    certificate.isAllowedByAdmin = true;
    certificate.adminApprovalDate = new Date();
    certificate.adminApprovedBy = req.admin._id;
    await certificate.save();
    
    res.json({
      message: 'Certificate generation allowed',
      certificate: certificate
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Admin: Deny certificate generation
router.post('/admin/deny/:id', verifyAdmin, async (req, res) => {
  try {
    const certificate = await Certificate.findById(req.params.id);
    
    if (!certificate) {
      return res.status(404).json({ message: 'Certificate not found' });
    }
    
    certificate.isAllowedByAdmin = false;
    certificate.adminApprovalDate = new Date();
    certificate.adminApprovedBy = req.admin._id;
    await certificate.save();
    
    res.json({
      message: 'Certificate generation denied',
      certificate: certificate
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
