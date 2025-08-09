const express = require('express');
const multer = require('multer');
const cors = require('cors');
const exifr = require('exifr');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
require('dotenv').config();

// Debugging configuration
const DEBUG_MODE = process.env.DEBUG_MODE === 'true' || process.env.NODE_ENV === 'development';
const USE_DOCKER_DEBUG = process.env.USE_DOCKER_DEBUG === 'true';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Add this for form data parsing
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

// Edge detection endpoint
app.post('/api/edge-detection', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }

        const imagePath = req.file.path;
        console.log(`Processing edge detection for: ${imagePath}`);

        // Run Python edge detection script
        const results = await runEdgeDetection(imagePath);
        
        if (results.success) {
            res.json({
                success: true,
                filename: req.file.filename,
                edgePointsCount: results.edge_points_count,
                visualization: results.visualization,
                filledImagePath: results.filled_image_path,
                imageShape: results.image_shape
            });
        } else {
            res.status(500).json({
                success: false,
                error: results.error || 'Edge detection failed'
            });
        }

    } catch (error) {
        console.error('Error in edge detection:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to process edge detection',
            details: error.message 
        });
    }
});

// Upload and process image
app.post('/api/upload', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }

        const imagePath = req.file.path;
        console.log(`Processing image: ${imagePath}`);

        // Get manual input values if provided
        const manualFocalLength = req.body.manualFocalLength ? parseFloat(req.body.manualFocalLength) : null;
        const manualPixelSize = req.body.manualPixelSize ? parseFloat(req.body.manualPixelSize) : null;
        const planetaryRadius = req.body.planetaryRadius ? parseFloat(req.body.planetaryRadius) : null;

        // Extract EXIF data with better Apple support
        const exifData = await extractExifData(imagePath);
        console.log('EXIF data extracted:', exifData);

        // Extract camera specifications
        const cameraSpecs = extractCameraSpecs(exifData, manualFocalLength, manualPixelSize);
        
        // Always return camera specs even if incomplete for manual input
        const response = {
            filename: req.file.filename,
            cameraSpecs: cameraSpecs,
            exifRaw: exifData
        };

        // Check if we have minimum required data
        if (!cameraSpecs.focalLength || !cameraSpecs.pixelSize) {
            return res.json({ 
                success: false,
                ...response,
                needsManualInput: true,
                planetaryRadius: planetaryRadius,
                error: 'Unable to extract required camera specifications from image. Please provide manual input.'
            });
        }

        // First run edge detection
        let edgeResults = null;
        try {
            console.log('🔍 Running edge detection first...');
            edgeResults = await runEdgeDetection(imagePath);
            console.log(`✅ Edge detection completed: ${edgeResults.edge_points_count} points found`);
        } catch (edgeError) {
            console.warn('⚠️ Edge detection failed:', edgeError.message);
            // Continue without edge detection results
        }

        // Run FOUND binary with edge detection results (if available)
        try {
            const distance = await runFoundBinary(imagePath, cameraSpecs, planetaryRadius, edgeResults);
            
            res.json({
                success: true,
                ...response,
                distance: distance,
                planetaryRadius: planetaryRadius,
                edgeDetection: edgeResults ? {
                    pointsCount: edgeResults.edge_points_count,
                    visualization: edgeResults.visualization,
                    edgePointsFile: edgeResults.edge_points_file
                } : null,
                message: `Distance calculated: ${distance} meters`
            });
        } catch (foundError) {
            // Special handling for FOUND binary errors
            res.json({
                success: false,
                ...response,
                distance: null,
                planetaryRadius: planetaryRadius,
                edgeDetection: edgeResults ? {
                    pointsCount: edgeResults.edge_points_count,
                    visualization: edgeResults.visualization,
                    edgePointsFile: edgeResults.edge_points_file
                } : null,
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

// Manual calculation endpoint for when EXIF data is insufficient
app.post('/api/calculate-manual', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }

        const { focalLength, pixelSize, planetaryRadius } = req.body;
        
        if (!focalLength || !pixelSize) {
            return res.status(400).json({ 
                error: 'Both focal length and pixel size are required for manual calculation' 
            });
        }

        const imagePath = req.file.path;
        const cameraSpecs = {
            focalLength: parseFloat(focalLength),
            pixelSize: parseFloat(pixelSize),
            make: 'Manual Input',
            model: 'Manual Input',
            source: 'manual'
        };

        const parsedPlanetaryRadius = planetaryRadius ? parseFloat(planetaryRadius) : null;

        console.log(`Manual calculation for ${imagePath} with specs:`, cameraSpecs, `planetary radius: ${parsedPlanetaryRadius}`);

        // First run edge detection
        let edgeResults = null;
        try {
            console.log('🔍 Running edge detection for manual calculation...');
            edgeResults = await runEdgeDetection(imagePath);
            console.log(`✅ Edge detection completed: ${edgeResults.edge_points_count} points found`);
        } catch (edgeError) {
            console.warn('⚠️ Edge detection failed:', edgeError.message);
            // Continue without edge detection results
        }

        try {
            const distance = await runFoundBinary(imagePath, cameraSpecs, parsedPlanetaryRadius, edgeResults);
            
            res.json({
                success: true,
                filename: req.file.filename,
                cameraSpecs: cameraSpecs,
                distance: distance,
                planetaryRadius: parsedPlanetaryRadius,
                edgeDetection: edgeResults ? {
                    pointsCount: edgeResults.edge_points_count,
                    visualization: edgeResults.visualization,
                    edgePointsFile: edgeResults.edge_points_file
                } : null,
                message: `Distance calculated: ${distance} meters`
            });
        } catch (foundError) {
            res.json({
                success: false,
                filename: req.file.filename,
                cameraSpecs: cameraSpecs,
                distance: null,
                planetaryRadius: parsedPlanetaryRadius,
                edgeDetection: edgeResults ? {
                    pointsCount: edgeResults.edge_points_count,
                    visualization: edgeResults.visualization,
                    edgePointsFile: edgeResults.edge_points_file
                } : null,
                error: foundError.message,
                message: foundError.message
            });
        }

    } catch (error) {
        console.error('Error in manual calculation:', error);
        res.status(500).json({ 
            error: 'Failed to process manual calculation',
            details: error.message 
        });
    }
});

// Enhanced EXIF extraction with better Apple camera support
async function extractExifData(imagePath) {
    try {
        // Use exifr with comprehensive options for better Apple camera support
        const exifData = await exifr.parse(imagePath, {
            ifd0: true,        // Basic camera info
            ifd1: true,        // Thumbnail info  
            exif: true,        // EXIF data
            gps: true,         // GPS data
            interop: true,     // Interoperability
            makerNote: true,   // Manufacturer specific data (important for Apple)
            userComment: true, // User comments
            translateKeys: false, // Keep original key names
            translateValues: false, // Keep original values
            reviveValues: false,   // Don't convert values automatically
            sanitize: false,       // Keep all data
            mergeOutput: true      // Merge all IFDs into single object
        });
        
        return exifData || {};
    } catch (error) {
        console.warn('EXIF extraction failed:', error.message);
        return {};
    }
}

// Extract camera specifications from EXIF data
function extractCameraSpecs(exifData, manualFocalLength = null, manualPixelSize = null) {
    const specs = {
        focalLength: manualFocalLength,
        pixelSize: manualPixelSize,
        make: null,
        model: null,
        imageWidth: null,
        imageHeight: null,
        source: 'manual',
        raw: exifData
    };

    if (exifData && Object.keys(exifData).length > 0) {
        // Extract make and model with various key variations
        specs.make = exifData.Make || exifData.make || 
                    exifData['0th']?.Make || exifData['Image Make'] || null;
        specs.model = exifData.Model || exifData.model || 
                     exifData['0th']?.Model || exifData['Image Model'] || null;

        // Extract image dimensions
        specs.imageWidth = exifData.ImageWidth || exifData['Image Width'] || 
                          exifData.ExifImageWidth || exifData['EXIF ExifImageWidth'] || null;
        specs.imageHeight = exifData.ImageHeight || exifData['Image Length'] || 
                           exifData.ExifImageHeight || exifData['EXIF ExifImageHeight'] || null;

        // Extract focal length if not manually provided
        if (!specs.focalLength) {
            specs.focalLength = exifData.FocalLength || exifData['EXIF FocalLength'] ||
                               exifData.FocalLengthIn35mmFormat || exifData['EXIF FocalLengthIn35mmFormat'] ||
                               exifData['0th']?.FocalLength || null;
            if (specs.focalLength) {
                specs.source = 'exif';
            }
        }

        // Extract or estimate pixel size if not manually provided
        if (!specs.pixelSize) {
            // Try to get from EXIF first
            specs.pixelSize = exifData.FocalPlaneXResolution ? 
                calculatePixelSizeFromResolution(exifData) : null;
            
            // If not found, estimate from make/model
            if (!specs.pixelSize && specs.make && specs.model) {
                specs.pixelSize = estimatePixelSize(specs.make, specs.model);
                if (specs.pixelSize && specs.source === 'exif') {
                    specs.source = 'exif+database';
                } else if (specs.pixelSize) {
                    specs.source = 'database';
                }
            }

            // Last resort: estimate from image dimensions
            if (!specs.pixelSize && specs.imageWidth && specs.imageHeight) {
                specs.pixelSize = estimatePixelSizeFromDimensions(specs.imageWidth, specs.imageHeight);
                if (specs.source === 'exif' || specs.source === 'exif+database') {
                    specs.source += '+dimensions';
                } else {
                    specs.source = 'dimensions';
                }
            }
        }
    }

    return specs;
}

// Calculate pixel size from EXIF resolution data
function calculatePixelSizeFromResolution(exifData) {
    try {
        const xRes = exifData.FocalPlaneXResolution || exifData['EXIF FocalPlaneXResolution'];
        const yRes = exifData.FocalPlaneYResolution || exifData['EXIF FocalPlaneYResolution'];
        const resUnit = exifData.FocalPlaneResolutionUnit || exifData['EXIF FocalPlaneResolutionUnit'] || 2;
        
        if (xRes && yRes) {
            // Convert to micrometers
            const conversionFactor = resUnit === 3 ? 10000 : 25400; // 3=cm, 2=inches
            const pixelSizeX = conversionFactor / xRes;
            const pixelSizeY = conversionFactor / yRes;
            return (pixelSizeX + pixelSizeY) / 2; // Average of X and Y
        }
    } catch (error) {
        console.warn('Failed to calculate pixel size from resolution:', error.message);
    }
    return null;
}

// Estimate pixel size based on camera make/model (enhanced database)
function estimatePixelSize(make, model) {
    // Comprehensive pixel sizes for popular cameras (in micrometers)
    const cameraDatabase = {
        'Apple': {
            // iPhone models
            'iPhone 15 Pro Max': 1.12,
            'iPhone 15 Pro': 1.22,
            'iPhone 15 Plus': 1.26,
            'iPhone 15': 1.26,
            'iPhone 14 Pro Max': 1.22,
            'iPhone 14 Pro': 1.22,
            'iPhone 14 Plus': 1.26,
            'iPhone 14': 1.26,
            'iPhone 13 Pro Max': 1.9,
            'iPhone 13 Pro': 1.9,
            'iPhone 13 mini': 1.7,
            'iPhone 13': 1.7,
            'iPhone 12 Pro Max': 1.7,
            'iPhone 12 Pro': 1.4,
            'iPhone 12 mini': 1.4,
            'iPhone 12': 1.4,
            'iPhone 11 Pro Max': 1.0,
            'iPhone 11 Pro': 1.0,
            'iPhone 11': 1.4,
            'iPhone SE': 1.22,
            'iPhone XS Max': 1.4,
            'iPhone XS': 1.4,
            'iPhone XR': 1.4,
            'iPhone X': 1.22,
            'iPhone 8 Plus': 1.22,
            'iPhone 8': 1.22,
            'iPhone 7 Plus': 1.22,
            'iPhone 7': 1.22
        },
        'Samsung': {
            'Galaxy S24 Ultra': 1.4,
            'Galaxy S24+': 1.4,
            'Galaxy S24': 1.4,
            'Galaxy S23 Ultra': 1.4,
            'Galaxy S23+': 1.4,
            'Galaxy S23': 1.4,
            'Galaxy S22 Ultra': 1.8,
            'Galaxy S22+': 1.8,
            'Galaxy S22': 1.8,
            'Galaxy S21 Ultra': 1.8,
            'Galaxy S21+': 1.8,
            'Galaxy S21': 1.8,
            'Galaxy Note 20 Ultra': 1.8,
            'Galaxy Note 20': 1.8
        },
        'Google': {
            'Pixel 8 Pro': 1.2,
            'Pixel 8': 1.2,
            'Pixel 7 Pro': 1.2,
            'Pixel 7': 1.2,
            'Pixel 6 Pro': 1.2,
            'Pixel 6': 1.2,
            'Pixel 5': 1.4,
            'Pixel 4': 1.4,
            'Pixel 3': 1.4
        },
        'Canon': {
            'EOS R5': 4.4,
            'EOS R6': 6.0,
            'EOS R': 5.4,
            'EOS 5D Mark IV': 5.4,
            'EOS 6D Mark II': 6.5,
            'EOS 90D': 3.2,
            'EOS M50': 3.7
        },
        'Nikon': {
            'D850': 4.3,
            'D780': 5.9,
            'D750': 5.9,
            'Z7': 4.3,
            'Z6': 5.9,
            'Z5': 5.9
        },
        'Sony': {
            'A7R V': 3.8,
            'A7 IV': 5.9,
            'A7R IV': 3.8,
            'A7R III': 4.3,
            'A7 III': 5.9,
            'A6700': 3.9,
            'A6600': 3.9,
            'A6400': 3.9
        }
    };

    // Clean up make and model strings
    const cleanMake = make.trim();
    const cleanModel = model.trim();

    // Find matching make (case insensitive)
    const makeKey = Object.keys(cameraDatabase).find(key => 
        cleanMake.toLowerCase().includes(key.toLowerCase()) ||
        key.toLowerCase().includes(cleanMake.toLowerCase())
    );

    if (makeKey) {
        // Find matching model
        const modelKey = Object.keys(cameraDatabase[makeKey]).find(key => {
            const keyLower = key.toLowerCase();
            const modelLower = cleanModel.toLowerCase();
            
            // Exact match
            if (keyLower === modelLower) return true;
            
            // Model contains the key
            if (modelLower.includes(keyLower)) return true;
            
            // Key contains the model
            if (keyLower.includes(modelLower)) return true;
            
            // For iPhones, handle version matching
            if (makeKey === 'Apple') {
                const modelParts = modelLower.replace(/[^\w\s]/g, '').split(/\s+/);
                const keyParts = keyLower.replace(/[^\w\s]/g, '').split(/\s+/);
                
                // Check if key parts are contained in model parts
                return keyParts.every(keyPart => 
                    modelParts.some(modelPart => 
                        modelPart.includes(keyPart) || keyPart.includes(modelPart)
                    )
                );
            }
            
            return false;
        });
        
        if (modelKey) {
            console.log(`Found pixel size for ${cleanMake} ${cleanModel}: ${cameraDatabase[makeKey][modelKey]}μm`);
            return cameraDatabase[makeKey][modelKey];
        }
    }

    // Fallback values based on make
    const fallbacks = {
        'Apple': 1.4,      // Average iPhone pixel size
        'Samsung': 1.6,    // Average Samsung flagship
        'Google': 1.3,     // Average Pixel
        'Canon': 5.0,      // Average Canon DSLR/mirrorless
        'Nikon': 5.0,      // Average Nikon DSLR/mirrorless  
        'Sony': 4.5,       // Average Sony mirrorless
        'Huawei': 1.6,     // Average Huawei flagship
        'OnePlus': 1.6,    // Average OnePlus
        'Xiaomi': 1.6      // Average Xiaomi flagship
    };

    const fallback = Object.keys(fallbacks).find(key => 
        cleanMake.toLowerCase().includes(key.toLowerCase())
    );

    if (fallback) {
        console.log(`Using fallback pixel size for ${cleanMake}: ${fallbacks[fallback]}μm`);
        return fallbacks[fallback];
    }

    // Last resort: general smartphone default
    console.log(`Using default pixel size for unknown camera: ${cleanMake} ${cleanModel}`);
    return 1.6;
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

// Run edge detection Python script
async function runEdgeDetection(imagePath) {
    return new Promise((resolve, reject) => {
        const pythonScript = path.join(__dirname, 'edge_detection.py');
        
        // Check if Python script exists
        if (!fs.existsSync(pythonScript)) {
            console.log('Edge detection script not found');
            reject(new Error('Edge detection functionality not available'));
            return;
        }

        // Use virtual environment Python if available, otherwise fall back to system python3
        const venvPython = path.join(__dirname, '.venv', 'bin', 'python3');
        // In production (like Render.com), use system python3 since venv won't exist
        const pythonCommand = fs.existsSync(venvPython) && process.env.NODE_ENV !== 'production' 
            ? venvPython 
            : 'python3';

        if (DEBUG_MODE) {
            console.log(`🔍 Running edge detection: ${pythonCommand} ${pythonScript} ${imagePath}`);
            if (pythonCommand === venvPython) {
                console.log('✅ Using virtual environment Python');
            } else {
                console.log('⚠️  Using system Python (virtual environment not found)');
            }
        }

        const child = spawn(pythonCommand, [pythonScript, imagePath]);
        let output = '';
        let errorOutput = '';

        // Set a timeout for the edge detection (60 seconds)
        const timeout = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error('Edge detection timeout'));
        }, 60000);

        child.stdout.on('data', (data) => {
            output += data.toString();
        });

        child.stderr.on('data', (data) => {
            errorOutput += data.toString();
            if (DEBUG_MODE) {
                console.error('📤 Edge detection STDERR:', data.toString().trim());
            }
        });

        child.on('close', (code) => {
            clearTimeout(timeout);
            if (DEBUG_MODE) {
                console.log(`🏁 Edge detection finished with code: ${code}`);
            }
            
            if (code === 0) {
                try {
                    const results = JSON.parse(output);
                    resolve(results);
                } catch (parseError) {
                    if (DEBUG_MODE) {
                        console.error('❌ Failed to parse edge detection output:', output);
                    }
                    reject(new Error('Failed to parse edge detection results'));
                }
            } else {
                if (DEBUG_MODE) {
                    console.error(`❌ Edge detection failed with code ${code}`);
                    console.error('📋 Error output:', errorOutput);
                    console.log('📋 Standard output:', output);
                }
                reject(new Error('Edge detection script failed'));
            }
        });

        child.on('error', (error) => {
            clearTimeout(timeout);
            if (DEBUG_MODE) {
                console.error('❌ Error running edge detection script:', error);
            }
            reject(new Error('Failed to run edge detection script'));
        });
    });
}

// Run the FOUND binary (with optional Docker debugging)
async function runFoundBinary(imagePath, cameraSpecs, planetaryRadius = null, edgeResults = null) {
    if (USE_DOCKER_DEBUG && DEBUG_MODE) {
        console.log('🐳 Running FOUND binary in Docker debug mode');
        return runFoundBinaryInDocker(imagePath, cameraSpecs, planetaryRadius, edgeResults);
    } else {
        return runFoundBinaryNative(imagePath, cameraSpecs, planetaryRadius, edgeResults);
    }
}

// Run the FOUND binary in Docker container for debugging
async function runFoundBinaryInDocker(imagePath, cameraSpecs, planetaryRadius = null, edgeResults = null) {
    return new Promise((resolve, reject) => {
        // Check if Docker is available
        const dockerCheck = spawn('docker', ['--version']);
        
        dockerCheck.on('error', (error) => {
            console.error('❌ Docker not found. Falling back to native execution.');
            runFoundBinaryNative(imagePath, cameraSpecs, planetaryRadius, edgeResults)
                .then(resolve)
                .catch(reject);
            return;
        });

        dockerCheck.on('close', (code) => {
            if (code !== 0) {
                console.error('❌ Docker not available. Falling back to native execution.');
                runFoundBinaryNative(imagePath, cameraSpecs, planetaryRadius, edgeResults)
                    .then(resolve)
                    .catch(reject);
                return;
            }

            // Docker is available, proceed with containerized execution
            executeInDockerContainer(imagePath, cameraSpecs, planetaryRadius, edgeResults, resolve, reject);
        });
    });
}

// Execute FOUND binary inside Docker container
function executeInDockerContainer(imagePath, cameraSpecs, planetaryRadius, edgeResults, resolve, reject) {
    const workspaceDir = path.resolve(__dirname);
    const containerImagePath = `/workspace${imagePath.replace(workspaceDir, '')}`;
    const containerBinaryPath = '/workspace/build/bin/found';

    const args = [
        'run', '--rm',
        '--platform', 'linux/amd64',
        '-v', `${workspaceDir}:/workspace`,
        '-w', '/workspace',
        'ubuntu:latest',
        'bash', '-c', [
            '# Set non-interactive frontend and timezone',
            'export DEBIAN_FRONTEND=noninteractive',
            'export TZ=UTC',
            '',
            '# Quick install of essential debugging tools only',
            'apt-get update -qq > /dev/null 2>&1',
            'apt-get install -y -qq --no-install-recommends file strace > /dev/null 2>&1 || echo "Some tools failed to install"',
            '',
            '# Check binary and dependencies',
            'echo "🔍 Binary info:"',
            `file ${containerBinaryPath} 2>/dev/null || echo "❌ Binary type unknown"`,
            `ls -la ${containerBinaryPath} || echo "❌ Binary not accessible"`,
            '',
            '# Check if binary is executable',
            `if [ -x "${containerBinaryPath}" ]; then`,
            '    echo "✅ Binary is executable"',
            '    echo "🔍 Checking dependencies:"',
            `    ldd ${containerBinaryPath} 2>&1 || echo "⚠️  Could not check dependencies (likely static binary)"`,
            'else',
            '    echo "❌ Binary is not executable"',
            '    exit 1',
            'fi',
            '',
            '# Check input image',
            'echo "🔍 Input image info:"',
            `file ${containerImagePath} 2>/dev/null || echo "❌ Image file type unknown"`,
            `ls -la ${containerImagePath} || echo "❌ Image not accessible"`,
            '',
            '# Run the FOUND binary',
            'echo "🚀 Running FOUND binary..."',
            'echo "Command line arguments:"',
            `echo "${buildFoundCommand(containerBinaryPath, containerImagePath, cameraSpecs, planetaryRadius, edgeResults)}"`,
            '',
            '# Execute the binary',
            'echo "📊 Executing binary..."',
            `${buildFoundCommand(containerBinaryPath, containerImagePath, cameraSpecs, planetaryRadius, edgeResults)}`
        ].join('\n')
    ];

    console.log('🐳 Starting Docker container for debugging...');
    console.log(`📁 Mounting workspace: ${workspaceDir} -> /workspace`);
    console.log(`🖼️  Image path in container: ${containerImagePath}`);
    console.log(`🔧 Binary path in container: ${containerBinaryPath}`);

    const child = spawn('docker', args);
    let output = '';
    let errorOutput = '';

    // Set a longer timeout for Docker execution (60 seconds)
    const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        console.error('⏰ Docker execution timeout');
        reject(new Error('Docker execution timeout - check if the binary is hanging'));
    }, 60000);

    child.stdout.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        if (DEBUG_MODE) {
            console.log('🐳 STDOUT:', chunk.trim());
        }
    });

    child.stderr.on('data', (data) => {
        const chunk = data.toString();
        errorOutput += chunk;
        if (DEBUG_MODE) {
            console.error('🐳 STDERR:', chunk.trim());
        }
    });

    child.on('close', (code) => {
        clearTimeout(timeout);
        console.log(`🐳 Docker container exited with code: ${code}`);
        
        if (code === 0) {
            // Parse the distance from output
            const distance = parseDistanceFromOutput(output);
            if (distance !== null) {
                console.log(`✅ Successfully parsed distance: ${distance} meters`);
                resolve(distance);
            } else {
                console.error('❌ Could not parse distance from output');
                console.log('📋 Full output:', output);
                reject(new Error('Could not parse distance from FOUND output'));
            }
        } else {
            console.error(`❌ Docker execution failed with code ${code}`);
            console.error('📋 Error output:', errorOutput);
            console.log('📋 Full output:', output);
            reject(new Error(`FOUND binary execution failed in Docker (exit code: ${code})`));
        }
    });

    child.on('error', (error) => {
        clearTimeout(timeout);
        console.error('❌ Docker spawn error:', error);
        reject(new Error(`Docker execution error: ${error.message}`));
    });
}

// Build the FOUND command string
function buildFoundCommand(binaryPath, imagePath, cameraSpecs, planetaryRadius, edgeResults = null) {
    // Convert units for FOUND binary:
    // - Focal length: mm → meters (multiply by 1e-3)
    // - Pixel size: μm → meters (multiply by 1e-6)
    const focalLengthInMeters = cameraSpecs.focalLength * 1e-3;
    const pixelSizeInMeters = cameraSpecs.pixelSize * 1e-6;
    
    const args = [
        binaryPath,
        'edge-distance',
        '--image', imagePath,
        '--reference-as-orientation',
        '--camera-focal-length', focalLengthInMeters.toString(),
        '--camera-pixel-size', pixelSizeInMeters.toString(),
        '--reference-orientation', '0,0,0'
    ];

    // Add edge detection results if available
    if (edgeResults && edgeResults.success) {
        args.push('--edge-points', edgeResults.edge_points_file);
        args.push('--image-width', edgeResults.width.toString());
        args.push('--image-height', edgeResults.height.toString());
    }

    // Add planetary radius if provided
    if (planetaryRadius && planetaryRadius > 0) {
        args.push('--planetary-radius', planetaryRadius.toString());
    }

    return args.join(' ');
}

// Run the FOUND binary natively (original implementation)
async function runFoundBinaryNative(imagePath, cameraSpecs, planetaryRadius = null, edgeResults = null) {
    return new Promise((resolve, reject) => {
        const foundBinaryPath = './build/bin/found';
        
        // Check if binary exists
        if (!fs.existsSync(foundBinaryPath)) {
            console.log('❌ FOUND binary not found at:', foundBinaryPath);
            if (DEBUG_MODE) {
                console.log('🔍 Checking for binary in different locations...');
                const alternativePaths = [
                    './found',
                    './bin/found',
                    path.join(__dirname, 'found'),
                    path.join(__dirname, 'bin', 'found'),
                    path.join(__dirname, 'build', 'found')
                ];
                
                alternativePaths.forEach(altPath => {
                    if (fs.existsSync(altPath)) {
                        console.log(`✅ Found binary at alternative location: ${altPath}`);
                    }
                });
            }
            reject(new Error('you couldn\'t be found'));
            return;
        }

        const args = [
            'edge-distance',
            '--image', imagePath,
            '--reference-as-orientation',
            '--camera-focal-length', (cameraSpecs.focalLength * 1e-3).toString(),
            '--camera-pixel-size', (cameraSpecs.pixelSize * 1e-6).toString(),
            '--reference-orientation', '0,0,0'
        ];

        // Add edge detection results if available
        if (edgeResults && edgeResults.success) {
            args.push('--edge-points', edgeResults.edge_points_file);
            args.push('--image-width', edgeResults.width.toString());
            args.push('--image-height', edgeResults.height.toString());
        }

        // Add planetary radius if provided
        if (planetaryRadius && planetaryRadius > 0) {
            args.push('--planetary-radius', planetaryRadius.toString());
        }

        if (DEBUG_MODE) {
            console.log(`🔧 Running natively: ${foundBinaryPath} ${args.join(' ')}`);
            console.log(`📁 Working directory: ${process.cwd()}`);
            console.log(`🖼️  Image path: ${imagePath}`);
            console.log(`📷 Camera specs:`, cameraSpecs);
            if (planetaryRadius) {
                console.log(`🌍 Planetary radius: ${planetaryRadius}`);
            }
            if (edgeResults) {
                console.log(`🔍 Edge detection: ${edgeResults.edge_points_count} points`);
            }
        }

        const child = spawn(foundBinaryPath, args);
        let output = '';
        let errorOutput = '';

        // Set a timeout for the binary execution (30 seconds)
        const timeout = setTimeout(() => {
            child.kill('SIGKILL');
            console.error('⏰ Native execution timeout');
            reject(new Error('you couldn\'t be found'));
        }, 30000);

        child.stdout.on('data', (data) => {
            const chunk = data.toString();
            output += chunk;
            if (DEBUG_MODE) {
                console.log('📤 Native STDOUT:', chunk.trim());
            }
        });

        child.stderr.on('data', (data) => {
            const chunk = data.toString();
            errorOutput += chunk;
            if (DEBUG_MODE) {
                console.error('📤 Native STDERR:', chunk.trim());
            }
        });

        child.on('close', (code) => {
            clearTimeout(timeout);
            if (DEBUG_MODE) {
                console.log(`🏁 Native execution finished with code: ${code}`);
            }
            
            if (code === 0) {
                // Parse the distance from output
                const distance = parseDistanceFromOutput(output);
                if (distance !== null) {
                    resolve(distance);
                } else {
                    if (DEBUG_MODE) {
                        console.error('❌ Could not parse distance from output:', output);
                    }
                    reject(new Error('Could not parse distance from FOUND output'));
                }
            } else {
                if (DEBUG_MODE) {
                    console.error(`❌ FOUND binary exited with code ${code}`);
                    console.error('📋 Error output:', errorOutput);
                    console.log('📋 Standard output:', output);
                }
                reject(new Error('you couldn\'t be found'));
            }
        });

        child.on('error', (error) => {
            clearTimeout(timeout);
            if (DEBUG_MODE) {
                console.error('❌ Error running FOUND binary:', error);
            }
            reject(new Error('you couldn\'t be found'));
        });
    });
}

// Parse distance from FOUND binary output
function parseDistanceFromOutput(output) {
    // Parse the actual output format: "Distance from Earth: 1.04562e+07 m"
    const match = output.match(/Distance from Earth:\s*([\d\.e\+\-]+)\s*m/i);
    if (match) {
        const distance = parseFloat(match[1]);
        console.log(`Parsed distance: ${distance} meters`);
        return distance;
    }
    
    // Fallback: try to find any scientific notation number followed by 'm'
    const fallbackMatch = output.match(/([\d\.e\+\-]+)\s*m(?:\s|$)/i);
    if (fallbackMatch) {
        const distance = parseFloat(fallbackMatch[1]);
        console.log(`Parsed distance (fallback): ${distance} meters`);
        return distance;
    }
    
    console.warn('Could not parse distance from output:', output);
    return null;
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
    if (DEBUG_MODE) {
        console.log('🐛 Debug mode enabled');
        if (USE_DOCKER_DEBUG) {
            console.log('🐳 Docker debugging enabled');
        }
    }
});
