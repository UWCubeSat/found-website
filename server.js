const express = require('express');
const multer = require('multer');
const cors = require('cors');
const exifr = require('exifr');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueId = uuidv4();
        const ext = path.extname(file.originalname);
        cb(null, `${uniqueId}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

// Camera specifications database for common devices
const cameraDatabase = {
    'iPhone': {
        '13': { focalLength: 26, pixelSize: 1.7 },
        '13 Pro': { focalLength: 26, pixelSize: 1.9 },
        '14': { focalLength: 26, pixelSize: 1.7 },
        '14 Pro': { focalLength: 24, pixelSize: 1.22 },
        '15': { focalLength: 26, pixelSize: 1.7 },
        '15 Pro': { focalLength: 24, pixelSize: 1.22 },
        'default': { focalLength: 26, pixelSize: 1.4 }
    },
    'Samsung': {
        'Galaxy S21': { focalLength: 26, pixelSize: 1.8 },
        'Galaxy S22': { focalLength: 24, pixelSize: 1.8 },
        'Galaxy S23': { focalLength: 24, pixelSize: 1.4 },
        'Galaxy S24': { focalLength: 24, pixelSize: 1.4 },
        'default': { focalLength: 26, pixelSize: 1.4 }
    },
    'Google': {
        'Pixel 6': { focalLength: 25.7, pixelSize: 1.2 },
        'Pixel 7': { focalLength: 25, pixelSize: 1.22 },
        'Pixel 8': { focalLength: 25, pixelSize: 1.12 },
        'default': { focalLength: 25, pixelSize: 1.2 }
    },
    'default': { focalLength: 26, pixelSize: 1.4 }
};

// Helper function to run Python reader script for enhanced EXIF extraction
function runReaderScript(imagePath) {
    return new Promise((resolve, reject) => {
        const pythonProcess = spawn('python3', ['reader.py', imagePath], {
            cwd: __dirname
        });

        let stdout = '';
        let stderr = '';

        pythonProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        pythonProcess.on('close', (code) => {
            if (code === 0) {
                try {
                    // Parse the reader output to extract camera specs
                    const result = parseReaderOutput(stdout);
                    resolve(result);
                } catch (error) {
                    reject(new Error(`Failed to parse reader.py output: ${error.message}`));
                }
            } else {
                reject(new Error(`reader.py script failed with code ${code}: ${stderr}`));
            }
        });

        pythonProcess.on('error', (error) => {
            reject(new Error(`Failed to start reader.py process: ${error.message}`));
        });
    });
}

// Helper function to parse reader.py output
function parseReaderOutput(output) {
    try {
        // Parse JSON output from reader.py
        const result = JSON.parse(output.trim());
        
        if (!result.success) {
            throw new Error(result.error || 'Reader script failed');
        }

        return {
            pixelSize: result.pixel_size_um,  // Already in µm
            focalLength: result.actual_focal_length_mm,
            f35FocalLength: result.f35_focal_length_mm,
            cameraMake: result.camera_make,
            cameraModel: result.camera_model,
            fullCameraModel: result.full_camera_model,
            lensType: result.lens_type,
            source: 'reader_script'
        };
    } catch (error) {
        throw new Error(`Failed to parse reader.py JSON output: ${error.message}`);
    }
}

// Helper function to extract camera specifications
async function extractCameraSpecs(imagePath, exifData) {
    let specs = {
        make: null,
        model: null,
        focalLength: null,
        pixelSize: null,
        imageWidth: null,
        imageHeight: null,
        source: null
    };

    let sources = [];

    // First try reader.py for enhanced camera database lookup
    try {
        console.log('Running reader.py for enhanced EXIF extraction...');
        const readerResult = await runReaderScript(imagePath);
        
        if (readerResult.pixelSize) {
            specs.pixelSize = readerResult.pixelSize;
            sources.push('reader_script');
        }
        
        if (readerResult.focalLength) {
            specs.focalLength = readerResult.focalLength;
            sources.push('reader_script');
        }
        
        // Use camera info from reader.py if available
        if (readerResult.cameraMake) {
            specs.make = readerResult.cameraMake;
        }
        if (readerResult.cameraModel) {
            specs.model = readerResult.cameraModel;
        }
        
        console.log('Reader.py results:', readerResult);
    } catch (error) {
        console.warn('Reader.py failed, falling back to standard extraction:', error.message);
    }

    // Try to get basic image dimensions
    try {
        const imageData = await exifr.parse(imagePath, { 
            ifd0: true, 
            exif: true,
            gps: false,
            ifd1: false,
            interop: false 
        });
        
        if (imageData) {
            specs.imageWidth = imageData.ImageWidth || imageData.ExifImageWidth;
            specs.imageHeight = imageData.ImageHeight || imageData.ExifImageHeight;
            
            if (specs.imageWidth && specs.imageHeight) {
                sources.push('dimensions');
            }
        }
    } catch (error) {
        console.warn('Could not extract image dimensions:', error.message);
    }

    // Extract EXIF data for camera make/model and fallback values
    if (exifData) {
        if (exifData.Make) {
            specs.make = exifData.Make.trim();
            sources.push('exif');
        }
        if (exifData.Model) {
            specs.model = exifData.Model.trim();
        }
        
        // Use EXIF focal length only if reader.py didn't provide one
        if (!specs.focalLength && (exifData.FocalLength || exifData.FocalLengthIn35mmFormat)) {
            specs.focalLength = exifData.FocalLength || exifData.FocalLengthIn35mmFormat;
            sources.push('exif');
        }
        
        // Try to calculate pixel size from EXIF data if reader.py didn't provide one
        if (!specs.pixelSize && exifData.FocalPlaneXResolution && exifData.FocalPlaneResolutionUnit) {
            const resolutionUnit = exifData.FocalPlaneResolutionUnit;
            let conversionFactor = 1;
            
            if (resolutionUnit === 2) { // Inches
                conversionFactor = 25400; // micrometers per inch
            } else if (resolutionUnit === 3) { // Centimeters
                conversionFactor = 10000; // micrometers per cm
            }
            
            specs.pixelSize = conversionFactor / exifData.FocalPlaneXResolution;
            sources.push('exif');
        }
    }

    // Fallback to built-in camera database only if we still don't have specs
    if ((!specs.focalLength || !specs.pixelSize) && specs.make && specs.model) {
        const make = specs.make.toLowerCase();
        let dbSpecs = null;

        for (const [dbMake, models] of Object.entries(cameraDatabase)) {
            if (make.includes(dbMake.toLowerCase())) {
                // Try exact model match first
                if (models[specs.model]) {
                    dbSpecs = models[specs.model];
                } else {
                    // Try partial model match
                    for (const [modelName, modelSpecs] of Object.entries(models)) {
                        if (specs.model.toLowerCase().includes(modelName.toLowerCase()) && modelName !== 'default') {
                            dbSpecs = modelSpecs;
                            break;
                        }
                    }
                    // Fall back to default for this make
                    if (!dbSpecs && models.default) {
                        dbSpecs = models.default;
                    }
                }
                break;
            }
        }

        // If no make-specific data found, use global default
        if (!dbSpecs) {
            dbSpecs = cameraDatabase.default;
        }

        // Fill in missing specs from database
        if (dbSpecs) {
            if (!specs.focalLength && dbSpecs.focalLength) {
                specs.focalLength = dbSpecs.focalLength;
                sources.push('database');
            }
            if (!specs.pixelSize && dbSpecs.pixelSize) {
                specs.pixelSize = dbSpecs.pixelSize;
                sources.push('database');
            }
        }
    }

    // Set source information
    if (sources.length > 0) {
        specs.source = [...new Set(sources)].join('+');
    }

    return specs;
}

// Helper function to run Python edge detection script
function runEdgeDetection(imagePath) {
    return new Promise((resolve, reject) => {
        const pythonProcess = spawn('python3', ['edge_detection.py', imagePath], {
            cwd: __dirname
        });

        let stdout = '';
        let stderr = '';

        pythonProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        pythonProcess.on('close', (code) => {
            if (code === 0) {
                try {
                    const result = JSON.parse(stdout);
                    resolve(result);
                } catch (error) {
                    reject(new Error(`Failed to parse Python output: ${error.message}`));
                }
            } else {
                reject(new Error(`Python script failed with code ${code}: ${stderr}`));
            }
        });

        pythonProcess.on('error', (error) => {
            reject(new Error(`Failed to start Python process: ${error.message}`));
        });
    });
}

// Helper function to run FOUND binary
function runFoundBinary(options) {
    return new Promise((resolve, reject) => {
        const {
            edgePointsFile,
            focalLength,
            pixelSize,
            planetaryRadius,
            imageWidth,
            imageHeight
        } = options;

        // Construct the command arguments
        const args = [
            'edge-distance',
            '--reference-as-orientation',
            '--camera-focal-length', (focalLength * 1e-3).toString(),
            '--camera-pixel-size', (pixelSize * 1e-6).toString(),
            '--reference-orientation', '0,0,0',
            '--image-width', imageWidth.toString(),
            '--image-height', imageHeight.toString(),
            '--edge-points', edgePointsFile,
            '--planetary-radius', planetaryRadius.toString()
        ];

        // Path to the FOUND binary
        const foundBinaryPath = path.join(__dirname, 'build', 'bin', 'found');

        console.log(`Running FOUND binary: ${foundBinaryPath} ${args.join(' ')}`);

        const foundProcess = spawn(foundBinaryPath, args, {
            cwd: __dirname
        });

        let stdout = '';
        let stderr = '';

        foundProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        foundProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        foundProcess.on('close', (code) => {
            console.log(`FOUND binary exited with code ${code}`);
            console.log('STDOUT:', stdout);
            console.log('STDERR:', stderr);

            if (code === 0) {
                // Parse the output to extract distance
                const output = stdout.trim();
                
                // Look for distance in the output (including scientific notation)
                const distanceMatch = output.match(/distance[:\s]+([0-9.]+(?:e[+-]?[0-9]+)?)/i) || 
                                    output.match(/([0-9.]+(?:e[+-]?[0-9]+)?)\s*m(?:eters?)?/i) ||
                                    output.match(/([0-9.]+(?:e[+-]?[0-9]+)?)/);
                
                if (distanceMatch) {
                    const distance = parseFloat(distanceMatch[1]);
                    resolve({ distance, fullOutput: output });
                } else {
                    // If no distance found in stdout, check if stderr contains "you couldn't be found"
                    if (stderr.toLowerCase().includes("you couldn't be found") || 
                        stdout.toLowerCase().includes("you couldn't be found")) {
                        resolve({ error: "you couldn't be found", fullOutput: stdout + stderr });
                    } else {
                        reject(new Error(`Could not parse distance from output: ${output}`));
                    }
                }
            } else {
                // Check for specific error messages
                const fullOutput = stdout + stderr;
                
                // Check for library compatibility issues
                if (stderr.includes('GLIBCXX_') || stderr.includes('GLIBC_') || stderr.includes('libstdc++')) {
                    resolve({ 
                        error: "Binary compatibility issue detected. The FOUND binary requires a newer Linux environment. Please contact support for a compatible binary version.",
                        fullOutput,
                        binaryError: true
                    });
                } else if (fullOutput.toLowerCase().includes("you couldn't be found")) {
                    resolve({ error: "you couldn't be found", fullOutput });
                } else {
                    reject(new Error(`FOUND binary failed with code ${code}: ${stderr || stdout}`));
                }
            }
        });

        foundProcess.on('error', (error) => {
            reject(new Error(`Failed to start FOUND binary: ${error.message}`));
        });
    });
}

// Routes

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint for automatic image processing
app.post('/api/upload', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ 
                success: false, 
                error: 'No image file provided' 
            });
        }

        console.log('Processing uploaded image:', req.file.filename);

        const imagePath = req.file.path;
        const planetaryRadius = parseFloat(req.body.planetaryRadius) || 6371008.7714;

        // Extract EXIF data
        let exifData = null;
        try {
            exifData = await exifr.parse(imagePath, { 
                ifd0: true, 
                exif: true,
                gps: false 
            });
        } catch (error) {
            console.warn('Could not extract EXIF data:', error.message);
        }

        // Extract camera specifications
        const cameraSpecs = await extractCameraSpecs(imagePath, exifData);

        // Check if we have enough data to proceed
        if (!cameraSpecs.focalLength || !cameraSpecs.pixelSize) {
            return res.json({
                success: false,
                needsManualInput: true,
                message: 'Camera specifications incomplete. Please provide manual input.',
                cameraSpecs,
                planetaryRadius
            });
        }

        // Run edge detection
        console.log('Running edge detection...');
        const edgeDetectionResult = await runEdgeDetection(imagePath);

        if (!edgeDetectionResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Edge detection failed: ' + edgeDetectionResult.error
            });
        }

        console.log('Edge detection completed. Points found:', edgeDetectionResult.edge_points_count);

        // Run FOUND binary
        console.log('Running FOUND binary...');
        const foundOptions = {
            edgePointsFile: edgeDetectionResult.edge_points_file,
            focalLength: cameraSpecs.focalLength,
            pixelSize: cameraSpecs.pixelSize,
            planetaryRadius,
            imageWidth: edgeDetectionResult.width,
            imageHeight: edgeDetectionResult.height
        };

        const foundResult = await runFoundBinary(foundOptions);

        // Clean up uploaded file
        fs.unlink(imagePath, (err) => {
            if (err) console.warn('Could not delete uploaded file:', err);
        });

        // Prepare response
        const response = {
            success: true,
            distance: foundResult.distance || null,
            error: foundResult.error || null,
            cameraSpecs: {
                ...cameraSpecs,
                focalLength: cameraSpecs.focalLength,
                pixelSize: cameraSpecs.pixelSize
            },
            edgeDetection: {
                pointsCount: edgeDetectionResult.edge_points_count,
                visualization: edgeDetectionResult.visualization,
                edgePointsFile: path.basename(edgeDetectionResult.edge_points_file)
            },
            planetaryRadius,
            message: foundResult.error ? null : `Distance calculated successfully using ${cameraSpecs.source || 'available'} camera data.`
        };

        res.json(response);

    } catch (error) {
        console.error('Error processing image:', error);
        
        // Clean up uploaded file on error
        if (req.file) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.warn('Could not delete uploaded file:', err);
            });
        }

        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// API endpoint for manual camera specification input
app.post('/api/calculate-manual', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ 
                success: false, 
                error: 'No image file provided' 
            });
        }

        console.log('Processing image with manual specs:', req.file.filename);

        const imagePath = req.file.path;
        const focalLength = parseFloat(req.body.focalLength);
        const pixelSize = parseFloat(req.body.pixelSize);
        const planetaryRadius = parseFloat(req.body.planetaryRadius) || 6371008.7714;

        // Validate manual input
        if (!focalLength || !pixelSize || focalLength <= 0 || pixelSize <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid focal length or pixel size provided'
            });
        }

        // Extract basic camera info for display
        let exifData = null;
        try {
            exifData = await exifr.parse(imagePath, { 
                ifd0: true, 
                exif: true,
                gps: false 
            });
        } catch (error) {
            console.warn('Could not extract EXIF data:', error.message);
        }

        const cameraSpecs = await extractCameraSpecs(imagePath, exifData);
        
        // Override with manual values
        cameraSpecs.focalLength = focalLength;
        cameraSpecs.pixelSize = pixelSize;
        cameraSpecs.source = 'manual';

        // Run edge detection
        console.log('Running edge detection...');
        const edgeDetectionResult = await runEdgeDetection(imagePath);

        if (!edgeDetectionResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Edge detection failed: ' + edgeDetectionResult.error
            });
        }

        console.log('Edge detection completed. Points found:', edgeDetectionResult.edge_points_count);

        // Run FOUND binary
        console.log('Running FOUND binary with manual specs...');
        const foundOptions = {
            edgePointsFile: edgeDetectionResult.edge_points_file,
            focalLength,
            pixelSize,
            planetaryRadius,
            imageWidth: edgeDetectionResult.width,
            imageHeight: edgeDetectionResult.height
        };

        const foundResult = await runFoundBinary(foundOptions);

        // Clean up uploaded file
        fs.unlink(imagePath, (err) => {
            if (err) console.warn('Could not delete uploaded file:', err);
        });

        // Prepare response
        const response = {
            success: true,
            distance: foundResult.distance || null,
            error: foundResult.error || null,
            cameraSpecs: {
                ...cameraSpecs,
                focalLength,
                pixelSize
            },
            edgeDetection: {
                pointsCount: edgeDetectionResult.edge_points_count,
                visualization: edgeDetectionResult.visualization,
                edgePointsFile: path.basename(edgeDetectionResult.edge_points_file)
            },
            planetaryRadius,
            message: foundResult.error ? null : 'Distance calculated successfully using manual camera specifications.'
        };

        res.json(response);

    } catch (error) {
        console.error('Error processing image with manual specs:', error);
        
        // Clean up uploaded file on error
        if (req.file) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.warn('Could not delete uploaded file:', err);
            });
        }

        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                success: false,
                error: 'File too large. Maximum size is 50MB.'
            });
        }
    }
    
    console.error('Unhandled error:', error);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found'
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`FOUND Website server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Uploads directory: ${uploadsDir}`);
    
    // Check if FOUND binary exists and test compatibility
    const foundBinaryPath = path.join(__dirname, 'build', 'bin', 'found');
    if (fs.existsSync(foundBinaryPath)) {
        console.log('✓ FOUND binary found at:', foundBinaryPath);
        
        // Test binary compatibility by running a simple command
        const testProcess = spawn(foundBinaryPath, ['--help'], { 
            timeout: 5000,
            stdio: 'pipe'
        });
        
        let testStderr = '';
        testProcess.stderr.on('data', (data) => {
            testStderr += data.toString();
        });
        
        testProcess.on('close', (code) => {
            if (testStderr.includes('GLIBCXX_') || testStderr.includes('GLIBC_') || testStderr.includes('libstdc++')) {
                console.error('⚠ FOUND binary compatibility issue detected:');
                console.error('  The binary requires newer library versions than available on this system.');
                console.error('  Users will receive appropriate error messages when attempting calculations.');
                console.error('  Consider recompiling the binary for this environment or updating the system libraries.');
            } else if (code === 0 || code === 1) {
                // Code 1 might be expected for --help on some binaries
                console.log('✓ FOUND binary appears compatible with system libraries');
            }
        });
        
        testProcess.on('error', (error) => {
            console.warn('⚠ Could not test FOUND binary compatibility:', error.message);
        });
    } else {
        console.warn('⚠ FOUND binary not found at:', foundBinaryPath);
    }
    
    // Check if Python script exists
    const pythonScriptPath = path.join(__dirname, 'edge_detection.py');
    if (fs.existsSync(pythonScriptPath)) {
        console.log('✓ Edge detection script found at:', pythonScriptPath);
    } else {
        console.warn('⚠ Edge detection script not found at:', pythonScriptPath);
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received. Shutting down gracefully...');
    process.exit(0);
});
