# FOUND Website
Demonstration website for Husky-SAT Lab's software: FOUND

## Overview
This web application allows users to upload pictures or take photos with their phone to calculate distances using the FOUND binary. The website extracts camera specifications from image EXIF data and processes them through the FOUND distance calculation engine.

## Features
- 📱 **Mobile-friendly interface** - Take photos directly with your phone camera
- 📁 **File upload support** - Upload existing images from your device
- 🖱️ **Drag & drop functionality** - Easy image upload experience
- 🔍 **EXIF data extraction** - Automatically extracts camera specifications
- 📏 **Distance calculation** - Integrates with FOUND binary for precise measurements
- 🎨 **Modern UI** - Clean, responsive design optimized for all devices

## Technology Stack
- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Backend**: Node.js with Express
- **Image Processing**: ExifR for EXIF data extraction
- **File Handling**: Multer for multipart/form-data
- **Deployment**: Optimized for Render.com

## FOUND Binary Integration
The backend interfaces with the FOUND binary using the following command structure:

```bash
./build/bin/found distance \
    --image "image submitted by user" \
    --reference-as-orientation \
    --camera-focal-length [extracted from EXIF] \
    --camera-pixel-size [extracted from EXIF] \
    --reference-orientation "0,0,0"
```

**Note**: The FOUND binary is not included in this repository and should be added to `./build/bin/found` before deployment.

## Local Development

### Prerequisites
- Node.js (version 18 or higher)
- npm or yarn

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/j4lando/found-website.git
   cd found-website
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open your browser and navigate to `http://localhost:3000`

## Deployment on Render.com

### Prerequisites for Deployment
This project uses both Node.js and Python, requiring proper setup of both runtimes:
- Node.js for the web server
- Python 3 for edge detection processing

### Quick Setup
1. Push your code to GitHub (ensure `requirements.txt` is included)
2. Connect your repository to Render.com
3. The `render.yaml` file will automatically configure the deployment
4. Your app will be live at `https://your-app-name.onrender.com`

**📖 For detailed deployment instructions, see [DEPLOYMENT.md](DEPLOYMENT.md)**

### Python Dependencies
The edge detection feature requires the following Python packages (specified in `requirements.txt`):
- opencv-python==4.12.0.88
- numpy==2.0.2  
- matplotlib==3.9.4
- scipy==1.13.1
- pillow==11.3.0

### Method 2: Manual Setup
1. Create a new Web Service on Render.com
2. Connect your GitHub repository
3. Use the following settings:
   - **Environment**: Node
   - **Build Command**: 
     ```bash
     npm install && python3 -m pip install --upgrade pip && python3 -m pip install -r requirements.txt
     ```
   - **Start Command**: `npm start`
   - **Node Version**: 18 or higher

### Environment Variables
Set the following environment variables in Render.com:
- `NODE_ENV`: `production`
- `PORT`: `3000` (automatically set by Render)
- `PYTHONPATH`: `/opt/render/project/src`

## Project Structure
```
found-website/
├── public/
│   └── index.html          # Frontend interface
├── uploads/                # Uploaded images (created automatically)
├── server.js              # Express server and API
├── package.json           # Dependencies and scripts
├── render.yaml            # Render.com deployment config
├── .gitignore            # Git ignore rules
└── README.md             # This file
```

## API Endpoints

### `POST /api/upload`
Uploads an image and processes it through the FOUND pipeline.

**Request**: Multipart form data with image file
**Response**: 
```json
{
  "success": true,
  "filename": "uuid-filename.jpg",
  "cameraSpecs": {
    "focalLength": 26,
    "pixelSize": 1.8,
    "make": "Apple",
    "model": "iPhone 15"
  },
  "distance": 45.67,
  "message": "Distance calculated: 45.67 meters"
}
```

### `GET /health`
Health check endpoint for monitoring.

## Camera Specifications
The application automatically extracts the following camera specifications from uploaded images:
- **Focal Length**: Extracted from EXIF data (in mm)
- **Pixel Size**: Estimated based on camera make/model or image dimensions (in μm)
- **Camera Make/Model**: Used for accurate pixel size determination

## Browser Support
- ✅ Chrome (recommended)
- ✅ Firefox
- ✅ Safari
- ✅ Edge
- ✅ Mobile browsers (iOS Safari, Chrome Mobile)

## Contributing
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License
MIT License - see LICENSE file for details

## Support
For questions or issues, please contact the Husky-SAT Lab team. 


