import os
import sys
import json
from PIL import Image
import exifread
import math

# smartphone_pixel_size_db.py
# Pixel size in micrometers (µm)
# Values from manufacturer specs or trusted teardowns

SMARTPHONE_PIXEL_SIZE_DB = {
    # Apple
    "Apple iPhone 14 Pro": {
        "main": 1.22,           # 1.22 µm (48 MP sensor, binning to 2.44 µm)
        "ultrawide": 1.4,       # 1.4 µm
        "telephoto": 1.0        # 1.0 µm
    },
    "Apple iPhone 14": {
        "main": 1.9,            # 1.9 µm
        "ultrawide": 1.4        # 1.4 µm
        # no dedicated telephoto
    },
    "Apple iPhone 13 Pro": {
        "main": 1.9,            # 1.9 µm
        "ultrawide": 1.0,       # 1.0 µm
        "telephoto": 1.0        # 1.0 µm
    },
    "Apple iPhone 13": {
        "main": 1.7,            # 1.7 µm
        "ultrawide": 1.0        # 1.0 µm
    },

    # Samsung
    "Samsung Galaxy S23 Ultra": {
        "main": 0.8,            # 0.8 µm (200 MP sensor)
        "ultrawide": 1.4,       # 1.4 µm
        "telephoto_3x": 1.12,   # 1.12 µm
        "telephoto_10x": 1.12   # 1.12 µm
    },
    "Samsung Galaxy S22": {
        "main": 1.08,           # 1.08 µm
        "ultrawide": 1.4,       # 1.4 µm
        "telephoto": 1.0        # 1.0 µm
    },
    "Samsung Galaxy S21": {
        "main": 1.8,            # 1.8 µm
        "ultrawide": 1.4,       # 1.4 µm
        "telephoto": 1.0        # 1.0 µm
    },

    # Google
    "Google Pixel 7 Pro": {
        "main": 1.2,            # 1.2 µm
        "ultrawide": 1.25,      # 1.25 µm
        "telephoto": 1.28       # 1.28 µm
    },
    "Google Pixel 7": {
        "main": 1.22,           # 1.22 µm
        "ultrawide": 1.25       # 1.25 µm
    },
    "Google Pixel 6": {
        "main": 1.2,            # 1.2 µm
        "ultrawide": 1.25       # 1.25 µm
        # no dedicated telephoto
    },

    # Xiaomi
    "Xiaomi 13 Ultra": {
        "main": 1.6,            # 1.6 µm
        "ultrawide": 1.12,      # 1.12 µm
        "telephoto_3x": 1.6,    # same as main
        "telephoto_5x": 1.12    # same as ultrawide
    },

    # Huawei
    "Huawei P50 Pro": {
        "main": 1.22,           # 1.22 µm
        "ultrawide": 1.4,       # 1.4 µm
        "telephoto": 1.12       # 1.12 µm
    }
}

def get_exif_data(image_path):
    """Extract EXIF data from image"""
    try:
        with open(image_path, 'rb') as f:
            tags = exifread.process_file(f)
        return tags
    except Exception as e:
        return None

def get_camera_model(exif_tags):
    """Extract camera make and model from EXIF data"""
    if not exif_tags:
        return None, None
        
    make = exif_tags.get('Image Make')
    model = exif_tags.get('Image Model')
    
    make_str = str(make).strip() if make else None
    model_str = str(model).strip() if model else None
    
    if make_str and model_str:
        full_model = f"{make_str} {model_str}"
        return make_str, model_str, full_model
    
    return make_str, model_str, None

def get_pixel_size_from_db(camera_model, lens_type="main"):
    """Get pixel size from the database based on camera model"""
    if not camera_model:
        return None
    
    # Try exact match first
    if camera_model in SMARTPHONE_PIXEL_SIZE_DB:
        camera_data = SMARTPHONE_PIXEL_SIZE_DB[camera_model]
        return camera_data.get(lens_type, camera_data.get("main"))
    
    # Try partial match (in case EXIF has slightly different formatting)
    for db_model in SMARTPHONE_PIXEL_SIZE_DB:
        if camera_model.lower() in db_model.lower() or db_model.lower() in camera_model.lower():
            camera_data = SMARTPHONE_PIXEL_SIZE_DB[db_model]
            return camera_data.get(lens_type, camera_data.get("main"))
    
    return None

def get_exif_f35(exif_data):
    """Extract 35mm equivalent focal length from EXIF data"""
    if exif_data is None:
        return None
    
    possible_fields = [
        'EXIF FocalLengthIn35mmFilm',
        'FocalLengthIn35mmFormat',
        'FocalLengthIn35mmFilm', 
        'FocalLength35mm',
        'EquivalentFocalLength',
        'FocalLengthIn35mmEquiv'
    ]
    
    for field in possible_fields:
        if field in exif_data:
            value = exif_data[field]
            if hasattr(value, 'values') and len(value.values) > 0:
                try:
                    return float(value.values[0])
                except (ValueError, TypeError):
                    continue
            elif isinstance(value, (int, float)):
                return float(value)
    return None

def get_actual_focal_length(exif_data):
    """Extract actual focal length from EXIF data"""
    if exif_data is None:
        return None
    
    focal_length_field = exif_data.get('EXIF FocalLength')
    if focal_length_field:
        if hasattr(focal_length_field, 'values') and len(focal_length_field.values) > 0:
            try:
                # Handle fractional values
                if '/' in str(focal_length_field.values[0]):
                    num, den = str(focal_length_field.values[0]).split('/')
                    return float(num) / float(den)
                else:
                    return float(focal_length_field.values[0])
            except (ValueError, TypeError):
                pass
    return None

def calculate_actual_focal_length(f_35, d_sensor, d_35=math.sqrt(36**2 + 24**2)):
    """Calculate actual focal length from 35mm equivalent"""
    if f_35 and d_sensor:
        return f_35 * (d_sensor / d_35)
    return None

def determine_lens_type_from_f35(f35):
    """Determine likely lens type based on 35mm equivalent focal length"""
    if f35 is None:
        return "main"
    
    if f35 <= 18:
        return "ultrawide"
    elif f35 >= 70:
        return "telephoto"
    else:
        return "main"

def process_image(image_path):
    """Process a single image and extract relevant information"""
    result = {
        "success": True,
        "camera_make": None,
        "camera_model": None,
        "full_camera_model": None,
        "pixel_size_um": None,
        "actual_focal_length_mm": None,
        "f35_focal_length_mm": None,
        "lens_type": "main",
        "error": None
    }
    
    try:
        # Get EXIF data
        exif_tags = get_exif_data(image_path)
        
        if exif_tags is None:
            result["error"] = "No EXIF data found"
            return result
        
        # Get camera model
        make, model, full_model = get_camera_model(exif_tags)
        result["camera_make"] = make
        result["camera_model"] = model
        result["full_camera_model"] = full_model
        
        # Get 35mm equivalent from EXIF
        f35_from_exif = get_exif_f35(exif_tags)
        result["f35_focal_length_mm"] = f35_from_exif
        
        # Get actual focal length from EXIF
        actual_focal = get_actual_focal_length(exif_tags)
        result["actual_focal_length_mm"] = actual_focal
        
        # Determine likely lens type based on focal length
        lens_type = determine_lens_type_from_f35(f35_from_exif)
        result["lens_type"] = lens_type
        
        # Get pixel size from database for the specific lens
        pixel_size_um = get_pixel_size_from_db(full_model, lens_type)
        result["pixel_size_um"] = pixel_size_um
        
        # If we don't have actual focal length but have f35, try to calculate it
        if not actual_focal and f35_from_exif and pixel_size_um:
            # Estimate sensor diagonal based on pixel size and typical phone sensor sizes
            if pixel_size_um <= 1.5:  # Likely smartphone
                d_sensor = 6.15  # mm (approximate for modern smartphones)
            else:  # Likely larger sensor camera
                d_sensor = 28.4  # mm (APS-C approximation)
            
            d_35 = math.sqrt(36**2 + 24**2)  # ~43.27 mm
            calculated_focal = calculate_actual_focal_length(f35_from_exif, d_sensor, d_35)
            if calculated_focal:
                result["actual_focal_length_mm"] = calculated_focal
        
        return result
        
    except Exception as e:
        result["success"] = False
        result["error"] = str(e)
        return result

def main():
    """Main function - can process single image from command line or all images in directory"""
    if len(sys.argv) > 1:
        # Process single image from command line argument
        image_path = sys.argv[1]
        if not os.path.exists(image_path):
            print(json.dumps({"success": False, "error": f"Image file not found: {image_path}"}))
            return
        
        result = process_image(image_path)
        print(json.dumps(result))
    else:
        # Process all images in current directory (original behavior)
        image_extensions = ['.jpg', '.jpeg', '.JPG', '.JPEG']
        image_files = []
        
        for file in os.listdir('.'):
            if any(file.endswith(ext) for ext in image_extensions):
                image_files.append(file)
        
        if not image_files:
            print(json.dumps({"success": False, "error": "No image files found in current directory"}))
            return
        
        # Process each image
        results = []
        for image_file in sorted(image_files):
            result = process_image(image_file)
            result["filename"] = image_file
            results.append(result)
        
        print(json.dumps({"success": True, "images": results}))

if __name__ == "__main__":
    main()