#!/usr/bin/env python3
"""
Edge detection module for FOUND website
Implements adaptive edge detection algorithms based on image source:
- Uses color-based detection for phone camera photos (better for distinct colored objects)
- Uses Canny edge detection for uploaded images (traditional edge detection)
Automatically detects phone camera photos using EXIF data and image characteristics.
"""

import numpy as np
import cv2
import sys
import json
import base64
import os
from io import BytesIO
import matplotlib.pyplot as plt
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend

def canny_edge_detection(image):
    """
    Optimized Canny edge detection using OpenCV
    """
    # Resize image if too large for faster processing
    height, width = image.shape
    max_dim = 1000
    if max(height, width) > max_dim:
        scale = max_dim / max(height, width)
        new_width = int(width * scale)
        new_height = int(height * scale)
        image = cv2.resize(image, (new_width, new_height))
        scale_factor = 1.0 / scale
    else:
        scale_factor = 1.0
    
    # Apply Gaussian blur to reduce noise
    blurred = cv2.GaussianBlur(image, (5, 5), 1.4)
    
    # Use OpenCV's Canny edge detection
    edges = cv2.Canny(blurred, 50, 150)
    
    # Find contours (which gives us connected components)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    
    if not contours:
        return []
    
    # Find the largest contour (assuming it's the planetary horizon)
    largest_contour = max(contours, key=cv2.contourArea)
    
    # Convert contour points to list of (x, y) tuples and scale back to original size
    edge_points = []
    for point in largest_contour:
        x, y = point[0]
        if scale_factor != 1.0:
            x = int(x * scale_factor)
            y = int(y * scale_factor)
        edge_points.append((x, y))
    
    return edge_points

def color_based_edge_detection(image_bgr):
    """
    Color-based edge detection using HSV color space and morphological operations.
    This method is better for detecting objects with distinct color characteristics.
    """
    # Resize image if too large for faster processing
    height, width = image_bgr.shape[:2]
    max_dim = 1000
    if max(height, width) > max_dim:
        scale = max_dim / max(height, width)
        new_width = int(width * scale)
        new_height = int(height * scale)
        image_bgr = cv2.resize(image_bgr, (new_width, new_height))
        scale_factor = 1.0 / scale
    else:
        scale_factor = 1.0
    
    # Convert to HSV color space for better color detection
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    
    # Create multiple color masks for different dominant colors
    masks = []
    
    # Red color detection (spans around 0° and 180°)
    lower_red1 = np.array([0, 120, 70])
    upper_red1 = np.array([10, 255, 255])
    mask_red1 = cv2.inRange(hsv, lower_red1, upper_red1)
    
    lower_red2 = np.array([170, 120, 70])
    upper_red2 = np.array([180, 255, 255])
    mask_red2 = cv2.inRange(hsv, lower_red2, upper_red2)
    
    mask_red = mask_red1 | mask_red2
    masks.append(mask_red)
    
    # Blue color detection
    lower_blue = np.array([100, 150, 70])
    upper_blue = np.array([130, 255, 255])
    mask_blue = cv2.inRange(hsv, lower_blue, upper_blue)
    masks.append(mask_blue)
    
    # Green color detection
    lower_green = np.array([35, 100, 70])
    upper_green = np.array([85, 255, 255])
    mask_green = cv2.inRange(hsv, lower_green, upper_green)
    masks.append(mask_green)
    
    # Brown/orange color detection (for planetary surfaces)
    lower_brown = np.array([10, 100, 50])
    upper_brown = np.array([25, 255, 200])
    mask_brown = cv2.inRange(hsv, lower_brown, upper_brown)
    masks.append(mask_brown)
    
    # Combine all color masks
    combined_mask = np.zeros_like(mask_red)
    for mask in masks:
        combined_mask = cv2.bitwise_or(combined_mask, mask)
    
    # Morphological operations to clean up the mask
    kernel = np.ones((5, 5), np.uint8)
    combined_mask = cv2.morphologyEx(combined_mask, cv2.MORPH_CLOSE, kernel)
    combined_mask = cv2.morphologyEx(combined_mask, cv2.MORPH_OPEN, kernel)
    
    # Apply Gaussian blur to smooth the mask
    combined_mask = cv2.GaussianBlur(combined_mask, (3, 3), 0)
    
    # Find contours from the color-based mask
    contours, _ = cv2.findContours(combined_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    if not contours:
        return []
    
    # Find the largest contour (assuming it's the main object/planetary body)
    largest_contour = max(contours, key=cv2.contourArea)
    
    # Convert contour points to list of (x, y) tuples and scale back to original size
    edge_points = []
    for point in largest_contour:
        x, y = point[0]
        if scale_factor != 1.0:
            x = int(x * scale_factor)
            y = int(y * scale_factor)
        edge_points.append((x, y))
    
    return edge_points

def count_connected_components(binary_image, value):
    """
    Count the number of connected components with a specific value
    """
    height, width = binary_image.shape
    visited = np.zeros_like(binary_image, dtype=bool)
    component_count = 0
    
    directions = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    
    def flood_fill_count(start_y, start_x):
        stack = [(start_y, start_x)]
        
        while stack:
            y, x = stack.pop()
            
            if (y < 0 or y >= height or x < 0 or x >= width or 
                visited[y, x] or binary_image[y, x] != value):
                continue
                
            visited[y, x] = True
            
            for dy, dx in directions:
                ny, nx = y + dy, x + dx
                if (0 <= ny < height and 0 <= nx < width and 
                    not visited[ny, nx] and binary_image[ny, nx] == value):
                    stack.append((ny, nx))
    
    for y in range(height):
        for x in range(width):
            if not visited[y, x] and binary_image[y, x] == value:
                flood_fill_count(y, x)
                component_count += 1
    
    return component_count

def create_visualization(image, edge_points, image_name):
    """
    Create visualization showing original image with edge points overlay
    """
    plt.figure(figsize=(8, 6))
    plt.title(f'Edge Points of Planetary Body - {image_name}')
    plt.imshow(image, cmap='gray')
    
    if edge_points:
        x_coords, y_coords = zip(*edge_points)
        plt.scatter(x_coords, y_coords, color='blue', s=1, alpha=0.7)
    
    plt.axis('off')
    
    # Save to buffer
    buffer = BytesIO()
    plt.savefig(buffer, format='png', bbox_inches='tight', dpi=150)
    buffer.seek(0)
    
    # Convert to base64
    image_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
    plt.close()
    
    return image_base64

def save_edge_points_to_file(edge_points, output_path):
    """
    Save edge points to text file in FOUND binary format
    Format: X Y (one point per line, whitespace separated)
    """
    with open(output_path, 'w') as f:
        for x, y in edge_points:
            f.write(f"{x} {y}\n")

def is_phone_camera_photo(image_path, image_bgr):
    """
    Determine if the input is likely a photo taken from a phone camera.
    Uses file characteristics, EXIF data patterns, and image properties.
    """
    try:
        # Import PIL to read EXIF data
        from PIL import Image
        from PIL.ExifTags import TAGS
        
        # Try to read EXIF data
        try:
            with Image.open(image_path) as img:
                exif_data = img._getexif()
                if exif_data:
                    # Convert EXIF data to readable format
                    exif = {TAGS.get(tag, tag): value for tag, value in exif_data.items()}
                    
                    # Check for phone camera indicators
                    make = exif.get('Make', '').lower()
                    model = exif.get('Model', '').lower()
                    
                    # Common phone manufacturers and models
                    phone_indicators = [
                        'iphone', 'apple', 'samsung', 'galaxy', 'pixel', 'huawei', 
                        'xiaomi', 'oneplus', 'lg', 'htc', 'motorola', 'nokia',
                        'android', 'sm-', 'gt-', 'sgh-', 'sch-'
                    ]
                    
                    # Check if make or model contains phone indicators
                    for indicator in phone_indicators:
                        if indicator in make or indicator in model:
                            return True
                    
                    # Check for typical phone camera characteristics
                    focal_length = exif.get('FocalLength')
                    if focal_length and isinstance(focal_length, (int, float, tuple)):
                        if isinstance(focal_length, tuple):
                            focal_length = focal_length[0] / focal_length[1] if focal_length[1] != 0 else focal_length[0]
                        
                        # Phone cameras typically have focal lengths between 1-10mm (35mm equivalent: 12-50mm)
                        if 1.0 <= focal_length <= 10.0:
                            return True
                    
                    # Check for GPS data (common in phone photos)
                    gps_info = exif.get('GPSInfo')
                    if gps_info:
                        return True
        
        except Exception:
            # If EXIF reading fails, fall back to other methods
            pass
        
        # Check file characteristics
        file_ext = os.path.splitext(image_path)[1].lower()
        
        # Phone cameras typically save as .jpg or .heic
        if file_ext in ['.jpg', '.jpeg', '.heic']:
            # Check image dimensions - phone photos are typically high resolution
            height, width = image_bgr.shape[:2]
            
            # Modern phone cameras typically produce images with these characteristics:
            # - High resolution (usually > 1MP)
            # - Common aspect ratios (4:3, 16:9, 3:2)
            total_pixels = height * width
            aspect_ratio = max(width, height) / min(width, height)
            
            if total_pixels > 1000000 and 1.2 <= aspect_ratio <= 2.0:  # > 1MP and reasonable aspect ratio
                # Check for typical phone photo characteristics
                if len(image_bgr.shape) == 3:  # Color image
                    # Phone photos typically have good color saturation
                    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
                    saturation = hsv[:, :, 1]
                    avg_saturation = np.mean(saturation)
                    
                    # Phone cameras typically produce well-saturated images
                    if avg_saturation > 80:  # Good saturation indicates phone camera
                        return True
        
        return False
        
    except Exception:
        # If any error occurs, default to False (use Canny algorithm)
        return False

def is_photograph(image_path, image_bgr):
    """
    Determine if the input is likely a photograph vs other image types.
    Uses file extension and image characteristics to make this determination.
    """
    # Check file extension
    photo_extensions = ['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp', '.heic']
    file_ext = os.path.splitext(image_path)[1].lower()
    
    if file_ext not in photo_extensions:
        return False
    
    # Check image characteristics
    # Photos typically have more color variety and complexity
    if len(image_bgr.shape) == 3:  # Color image
        # Calculate color variance across channels
        color_variance = np.var(image_bgr, axis=(0, 1))
        avg_color_variance = np.mean(color_variance)
        
        # Calculate image complexity (edge density)
        gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, 50, 150)
        edge_density = np.sum(edges > 0) / (edges.shape[0] * edges.shape[1])
        
        # Heuristics: photos typically have higher color variance and moderate edge density
        if avg_color_variance > 1000 and 0.02 < edge_density < 0.3:
            return True
    
    return True  # Default to treating as photograph for safety

def process_image(image_path):
    """
    Main processing function
    """
    try:
        # Load image in color mode
        image_bgr = cv2.imread(image_path, cv2.IMREAD_COLOR)
        
        if image_bgr is None:
            raise ValueError(f"Could not load image: {image_path}")
        
        # Convert BGR to RGB for proper display
        image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
        
        # Extract filename
        image_name = os.path.basename(image_path)
        
        # Determine if this is a phone camera photo and choose appropriate algorithm
        if is_phone_camera_photo(image_path, image_bgr):
            # Use color-based edge detection for phone camera photos
            edge_points = color_based_edge_detection(image_bgr)
            algorithm_used = "color-based (phone camera detected)"
        else:
            # Use traditional Canny edge detection for uploaded images
            red_channel = image_rgb[:, :, 0]  # Extract red channel for edge detection
            edge_points = canny_edge_detection(red_channel)
            algorithm_used = "canny (uploaded image)"

        # Save edge points to text file for FOUND binary
        edge_points_path = image_path.replace('.', '_horizon_points.')
        edge_points_path = edge_points_path.replace(os.path.splitext(edge_points_path)[1], '.txt')
        save_edge_points_to_file(edge_points, edge_points_path)
        
        # Create visualization using RGB image
        visualization_base64 = create_visualization(image_rgb, edge_points, image_name)
        
        # Return results
        results = {
            'success': True,
            'edge_points_count': len(edge_points),
            'edge_points_file': edge_points_path,
            'width': image_rgb.shape[1],
            'height': image_rgb.shape[0],
            'algorithm_used': algorithm_used,
            'visualization': visualization_base64,
        }
        
        return results
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps({'success': False, 'error': 'Usage: python edge_detection.py <image_path>'}))
        sys.exit(1)
    
    image_path = sys.argv[1]
    results = process_image(image_path)
    
    print(json.dumps(results))
