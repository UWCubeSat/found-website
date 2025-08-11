const express = require('express');
const multer = require('multer');
const cors = require('cors');
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
            console.log('Uploading image:', {
                originalname: file.originalname,
                mimetype: file.mimetype
            });
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

// Camera database - moved from reader.py for frontend use
const CAMERA_DATABASE = {
    "Apple iPhone 14 Pro": { pixelSize: 1.22, sensorDiagonal: 6.15 },
    "Apple iPhone 14": { pixelSize: 1.9, sensorDiagonal: 6.15 },
    "Apple iPhone 13 Pro": { pixelSize: 1.9, sensorDiagonal: 6.15 },
    "Apple iPhone 13": { pixelSize: 1.7, sensorDiagonal: 6.15 },
    "Samsung Galaxy S23 Ultra": { pixelSize: 0.8, sensorDiagonal: 6.15 },
    "Samsung Galaxy S22": { pixelSize: 1.08, sensorDiagonal: 6.15 },
    "Samsung Galaxy S21": { pixelSize: 1.8, sensorDiagonal: 6.15 },
    "Google Pixel 7 Pro": { pixelSize: 1.2, sensorDiagonal: 6.15 },
    "Google Pixel 7": { pixelSize: 1.22, sensorDiagonal: 6.15 },
    "Google Pixel 6": { pixelSize: 1.2, sensorDiagonal: 6.15 },
    "Xiaomi 13 Ultra": { pixelSize: 1.6, sensorDiagonal: 6.15 },
    "Huawei P50 Pro": { pixelSize: 1.22, sensorDiagonal: 6.15 }
};

// Calculate actual focal length from 35mm equivalent (from reader.py)
function calculateActualFocalLength(f35, dSensor, d35 = Math.sqrt(36**2 + 24**2)) {
    if (f35 && dSensor) {
        return f35 * (dSensor / d35);
    }
    return null;
}

// Get camera specs from frontend data
function getCameraSpecs(frontendData) {
    const specs = {
        make: null,
        model: null,
        focalLength: null,
        pixelSize: null,
        f35: null,
        sensorDiagonal: 6.15, // Default smartphone sensor diagonal
        source: 'frontend'
    };

    if (frontendData.make) specs.make = frontendData.make;
    if (frontendData.model) specs.model = frontendData.model;
    if (frontendData.focalLength) specs.focalLength = parseFloat(frontendData.focalLength);
    if (frontendData.pixelSize) specs.pixelSize = parseFloat(frontendData.pixelSize);
    if (frontendData.f35) specs.f35 = parseFloat(frontendData.f35);

    // Get pixel size from database if make/model provided but no pixel size
    if (frontendData.make && frontendData.model && !specs.pixelSize) {
        const fullModel = `${frontendData.make} ${frontendData.model}`;
        const dbEntry = CAMERA_DATABASE[fullModel];
        if (dbEntry) {
            specs.pixelSize = dbEntry.pixelSize;
            specs.sensorDiagonal = dbEntry.sensorDiagonal;
            specs.source = 'frontend+database';
            console.log(`Using database pixel size: ${specs.pixelSize} μm for ${fullModel}`);
        }
    }

    return specs;
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
                
                const distanceMatch = output.match(/distance[:\s]+([0-9.]+(?:e[+-]?[0-9]+)?)/i) || 
                                    output.match(/([0-9.]+(?:e[+-]?[0-9]+)?)\s*m(?:eters?)?/i) ||
                                    output.match(/([0-9.]+(?:e[+-]?[0-9]+)?)/);
                
                if (distanceMatch) {
                    const distance = parseFloat(distanceMatch[1]);
                    resolve({ distance, fullOutput: output });
                } else {
                    if (stderr.toLowerCase().includes("you couldn't be found") || 
                        stdout.toLowerCase().includes("you couldn't be found")) {
                        resolve({ error: "you couldn't be found", fullOutput: stdout + stderr });
                    } else {
                        reject(new Error(`Could not parse distance from output: ${output}`));
                    }
                }
            } else {
                const fullOutput = stdout + stderr;
                
                if (stderr.includes('GLIBCXX_') || stderr.includes('GLIBC_') || stderr.includes('libstdc++')) {
                    resolve({ 
                        error: "Binary compatibility issue detected.",
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

// Routes

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint for image processing with frontend-provided data
app.post('/api/calculate', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ 
                success: false, 
                error: 'No image file provided' 
            });
        }

        console.log('Processing image:', req.file.filename);

        const imagePath = req.file.path;
        // Default radius of red ball: 19.25/(2π) × 0.025 = 0.0765933164 meters
        const planetaryRadius = parseFloat(req.body.planetaryRadius) || 0.0765933164;

        // Get camera specifications from frontend
        const frontendData = {
            make: req.body.cameraMake || null,
            model: req.body.cameraModel || null,
            focalLength: req.body.focalLength ? parseFloat(req.body.focalLength) : null,
            pixelSize: req.body.pixelSize ? parseFloat(req.body.pixelSize) : null,
            f35: req.body.f35 ? parseFloat(req.body.f35) : null
        };

        console.log('Frontend camera data:', frontendData);

        // Get camera specifications
        const cameraSpecs = getCameraSpecs(frontendData);

        // Calculate actual focal length if f35 is provided
        let finalFocalLength = cameraSpecs.focalLength;
        if (cameraSpecs.f35 && cameraSpecs.sensorDiagonal) {
            const calculatedFocalLength = calculateActualFocalLength(
                cameraSpecs.f35, 
                cameraSpecs.sensorDiagonal
            );
            if (calculatedFocalLength) {
                finalFocalLength = calculatedFocalLength;
                console.log(`Using calculated focal length from f35: ${finalFocalLength}mm (f35: ${cameraSpecs.f35}mm)`);
            }
        }

        // Validate that we have enough data
        if (!finalFocalLength || !cameraSpecs.pixelSize) {
            return res.json({
                success: false,
                needsManualInput: true,
                message: 'Please provide complete camera specifications (focal length and pixel size).',
                cameraSpecs: {
                    ...cameraSpecs,
                    focalLength: finalFocalLength
                },
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

        // Run FOUND binary with calculated focal length
        console.log('Running FOUND binary...');
        const foundOptions = {
            edgePointsFile: edgeDetectionResult.edge_points_file,
            focalLength: finalFocalLength,
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
                focalLength: finalFocalLength,
                calculatedFromF35: Boolean(cameraSpecs.f35 && finalFocalLength !== cameraSpecs.focalLength)
            },
            edgeDetection: {
                pointsCount: edgeDetectionResult.edge_points_count,
                visualization: edgeDetectionResult.visualization,
                algorithm: edgeDetectionResult.algorithm_used || 'adaptive'
            },
            planetaryRadius,
            message: foundResult.error ? null : `Distance calculated successfully using ${cameraSpecs.source} data.`
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
    console.log(`Frontend-only mode: Uses frontend EXIF reader and calculate_actual_focal_length`);
    
    // Check if FOUND binary exists
    const foundBinaryPath = path.join(__dirname, 'build', 'bin', 'found');
    if (fs.existsSync(foundBinaryPath)) {
        console.log('✓ FOUND binary found at:', foundBinaryPath);
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
