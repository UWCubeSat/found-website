const express = require('express');
const multer = require('multer');
const cors = require('cors');
const exifr = require('exifr');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${uuidv4()}-${file.originalname}`;
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.'));
        }
    }
});

// Routes

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint for Render
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Upload and process image
app.post('/api/upload', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }

        const imagePath = req.file.path;
        console.log(`Processing image: ${imagePath}`);

        // Extract EXIF data
        const exifData = await exifr.parse(imagePath);
        console.log('EXIF data extracted:', exifData);

        // Extract camera specifications
        const cameraSpecs = extractCameraSpecs(exifData);
        
        if (!cameraSpecs.focalLength || !cameraSpecs.pixelSize) {
            return res.status(400).json({ 
                error: 'Unable to extract required camera specifications from image',
                availableData: cameraSpecs
            });
        }

        // Run FOUND binary (if it exists)
        try {
            const distance = await runFoundBinary(imagePath, cameraSpecs);
            
            res.json({
                success: true,
                filename: req.file.filename,
                cameraSpecs: cameraSpecs,
                distance: distance,
                message: `Distance calculated: ${distance} meters`
            });
        } catch (foundError) {
            // Special handling for FOUND binary errors
            res.json({
                success: false,
                filename: req.file.filename,
                cameraSpecs: cameraSpecs,
                distance: null,
                error: foundError.message,
                message: foundError.message
            });
        }

    } catch (error) {
        console.error('Error processing image:', error);
        res.status(500).json({ 
            error: 'Failed to process image',
            details: error.message 
        });
    }
});

// Extract camera specifications from EXIF data
function extractCameraSpecs(exifData) {
    const specs = {
        focalLength: null,
        pixelSize: null,
        make: null,
        model: null,
        raw: exifData
    };

    if (exifData) {
        // Extract focal length (in mm)
        if (exifData.FocalLength) {
            specs.focalLength = exifData.FocalLength;
        } else if (exifData.FocalLengthIn35mmFormat) {
            specs.focalLength = exifData.FocalLengthIn35mmFormat;
        }

        // Extract pixel size (this is tricky and often requires camera model lookup)
        // For now, we'll use common values or try to calculate from resolution
        if (exifData.Make && exifData.Model) {
            specs.make = exifData.Make;
            specs.model = exifData.Model;
            specs.pixelSize = estimatePixelSize(exifData.Make, exifData.Model);
        }

        // If we can't get pixel size from model, try to estimate from image dimensions
        if (!specs.pixelSize && exifData.ImageWidth && exifData.ImageHeight) {
            specs.pixelSize = estimatePixelSizeFromDimensions(exifData.ImageWidth, exifData.ImageHeight);
        }
    }

    return specs;
}

// Estimate pixel size based on camera make/model
function estimatePixelSize(make, model) {
    // Common pixel sizes for popular cameras (in micrometers)
    const cameraDatabase = {
        'iPhone': {
            'iPhone 12': 1.7,
            'iPhone 13': 1.9,
            'iPhone 14': 1.9,
            'iPhone 15': 1.9
        },
        'Samsung': {
            'Galaxy S21': 1.8,
            'Galaxy S22': 1.8,
            'Galaxy S23': 1.8
        },
        'Canon': {
            'EOS R5': 4.4,
            'EOS R6': 6.0
        }
    };

    const makeKey = Object.keys(cameraDatabase).find(key => 
        make.toLowerCase().includes(key.toLowerCase())
    );

    if (makeKey) {
        const modelKey = Object.keys(cameraDatabase[makeKey]).find(key =>
            model.toLowerCase().includes(key.toLowerCase())
        );
        if (modelKey) {
            return cameraDatabase[makeKey][modelKey];
        }
    }

    // Default fallback for smartphones
    return 1.8;
}

// Estimate pixel size from image dimensions (rough approximation)
function estimatePixelSizeFromDimensions(width, height) {
    // This is a very rough estimation
    // Most modern smartphones have pixel sizes between 1.0-2.0 micrometers
    if (width > 3000 && height > 2000) {
        return 1.8; // High-resolution smartphone
    } else if (width > 2000 && height > 1500) {
        return 2.0; // Mid-range smartphone
    } else {
        return 2.2; // Lower resolution or older device
    }
}

// Run the FOUND binary
async function runFoundBinary(imagePath, cameraSpecs) {
    return new Promise((resolve, reject) => {
        const foundBinaryPath = './build/bin/found';
        
        // Check if binary exists
        if (!fs.existsSync(foundBinaryPath)) {
            console.log('FOUND binary not found');
            reject(new Error('you couldn\'t be found'));
            return;
        }

        const args = [
            'distance',
            '--image', imagePath,
            '--reference-as-orientation',
            '--camera-focal-length', cameraSpecs.focalLength.toString(),
            '--camera-pixel-size', cameraSpecs.pixelSize.toString(),
            '--reference-orientation', '0,0,0'
        ];

        console.log(`Running: ${foundBinaryPath} ${args.join(' ')}`);

        const child = spawn(foundBinaryPath, args);
        let output = '';
        let errorOutput = '';

        // Set a timeout for the binary execution (30 seconds)
        const timeout = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error('you couldn\'t be found'));
        }, 30000);

        child.stdout.on('data', (data) => {
            output += data.toString();
        });

        child.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        child.on('close', (code) => {
            clearTimeout(timeout);
            if (code === 0) {
                // Parse the distance from output
                const distance = parseDistanceFromOutput(output);
                resolve(distance);
            } else {
                console.error(`FOUND binary exited with code ${code}: ${errorOutput}`);
                reject(new Error('you couldn\'t be found'));
            }
        });

        child.on('error', (error) => {
            clearTimeout(timeout);
            console.error('Error running FOUND binary:', error);
            reject(new Error('you couldn\'t be found'));
        });
    });
}

// Parse distance from FOUND binary output
function parseDistanceFromOutput(output) {
    // This will need to be updated based on the actual output format
    // For now, assume the output contains a number followed by "meters"
    const match = output.match(/(\d+\.?\d*)\s*meters?/i);
    return match ? parseFloat(match[1]) : null;
}

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
        }
    }
    res.status(500).json({ error: error.message });
});

app.listen(PORT, () => {
    console.log(`FOUND Website server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
