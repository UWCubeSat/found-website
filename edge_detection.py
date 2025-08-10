#!/usr/bin/env python3
"""
Edge detection module for FOUND website
Implements Canny edge detection with filled binary image generation
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

def process_image(image_path):
    """
    Main processing function
    """
    try:
        # Load image as grayscale
        image_rgb = cv2.imread(image_path, cv2.IMREAD_COLOR)
        image_rgb_2 = cv2.cvtColor(image_rgb, cv2.COLOR_BGR2RGB)
        red_channel = image_rgb_2[:, :, 0]  # In RGB, index 0 is red

        if image_rgb is None:
            raise ValueError(f"Could not load image: {image_path}")
        
        # Extract filename
        image_name = os.path.basename(image_path)
        
        # Run Canny edge detection
        edge_points = canny_edge_detection(red_channel)

        # Save edge points to text file for FOUND binary
        edge_points_path = image_path.replace('.', '_horizon_points.')
        edge_points_path = edge_points_path.replace(os.path.splitext(edge_points_path)[1], '.txt')
        save_edge_points_to_file(edge_points, edge_points_path)
        
        # Create visualization
        visualization_base64 = create_visualization(image_rgb, edge_points, image_name)
        
        # Return results
        results = {
            'success': True,
            'edge_points_count': len(edge_points),
            'edge_points_file': edge_points_path,
            'width': image.shape[1],
            'height': image.shape[0],
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
