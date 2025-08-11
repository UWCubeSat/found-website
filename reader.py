import math

# Smartphone pixel size database
# Pixel size in micrometers (µm) and sensor diagonal in mm
# Values from manufacturer specs or trusted teardowns

SMARTPHONE_PIXEL_SIZE_DB = {
    # Apple
    "Apple iPhone 14 Pro": {
        "pixelSize": 1.22,           # 1.22 µm (48 MP sensor, binning to 2.44 µm)
        "sensorDiagonal": 6.15       # mm (approximate for modern smartphones)
    },
    "Apple iPhone 14": {
        "pixelSize": 1.9,            # 1.9 µm
        "sensorDiagonal": 6.15
    },
    "Apple iPhone 13 Pro": {
        "pixelSize": 1.9,            # 1.9 µm
        "sensorDiagonal": 6.15
    },
    "Apple iPhone 13": {
        "pixelSize": 1.7,            # 1.7 µm
        "sensorDiagonal": 6.15
    },

    # Samsung
    "Samsung Galaxy S23 Ultra": {
        "pixelSize": 0.8,            # 0.8 µm (200 MP sensor)
        "sensorDiagonal": 6.15
    },
    "Samsung Galaxy S22": {
        "pixelSize": 1.08,           # 1.08 µm
        "sensorDiagonal": 6.15
    },
    "Samsung Galaxy S21": {
        "pixelSize": 1.8,            # 1.8 µm
        "sensorDiagonal": 6.15
    },

    # Google
    "Google Pixel 7 Pro": {
        "pixelSize": 1.2,            # 1.2 µm
        "sensorDiagonal": 6.15
    },
    "Google Pixel 7": {
        "pixelSize": 1.22,           # 1.22 µm
        "sensorDiagonal": 6.15
    },
    "Google Pixel 6": {
        "pixelSize": 1.2,            # 1.2 µm
        "sensorDiagonal": 6.15
    },

    # Xiaomi
    "Xiaomi 13 Ultra": {
        "pixelSize": 1.6,            # 1.6 µm
        "sensorDiagonal": 6.15
    },

    # Huawei
    "Huawei P50 Pro": {
        "pixelSize": 1.22,           # 1.22 µm
        "sensorDiagonal": 6.15
    }
}

def calculate_actual_focal_length(f_35, d_sensor, d_35=math.sqrt(36**2 + 24**2)):
    """
    Calculate actual focal length from 35mm equivalent
    
    Args:
        f_35 (float): 35mm equivalent focal length in mm
        d_sensor (float): Sensor diagonal in mm
        d_35 (float): Full frame sensor diagonal (default: ~43.27mm)
    
    Returns:
        float: Actual focal length in mm, or None if calculation fails
    """
    if f_35 and d_sensor:
        return f_35 * (d_sensor / d_35)
    return None

def get_camera_specs(make, model):
    """
    Get camera specifications from database
    
    Args:
        make (str): Camera manufacturer
        model (str): Camera model
    
    Returns:
        dict: Camera specifications or None if not found
    """
    if not make or not model:
        return None
    
    full_model = f"{make} {model}"
    
    # Try exact match first
    if full_model in SMARTPHONE_PIXEL_SIZE_DB:
        return SMARTPHONE_PIXEL_SIZE_DB[full_model]
    
    # Try partial match
    for db_model, specs in SMARTPHONE_PIXEL_SIZE_DB.items():
        if (make.lower() in db_model.lower() and 
            model.lower() in db_model.lower()):
            return specs
    
    return None

def main():
    """
    Simple command line interface for focal length calculation
    Usage: python3 reader.py <f35> <sensor_diagonal>
    """
    import sys
    
    if len(sys.argv) < 3:
        print("Usage: python3 reader.py <f35_mm> <sensor_diagonal_mm>")
        print("Example: python3 reader.py 26 6.15")
        return
    
    try:
        f35 = float(sys.argv[1])
        d_sensor = float(sys.argv[2])
        
        actual_focal = calculate_actual_focal_length(f35, d_sensor)
        
        if actual_focal:
            print(f"Calculated actual focal length: {actual_focal:.3f}mm")
            print(f"Input: f35={f35}mm, sensor_diagonal={d_sensor}mm")
        else:
            print("Error: Could not calculate focal length")
            
    except ValueError:
        print("Error: Invalid numeric input")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()