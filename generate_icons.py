#!/usr/bin/env python3
"""
Generate placeholder PNG icons for the WebSophon Chrome extension.
This creates simple eye-themed icons in the required sizes.
"""

from PIL import Image, ImageDraw

def create_eye_icon(size):
    """Create a simple eye icon at the specified size."""
    # Create a new image with transparent background
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Calculate proportions
    center = size // 2
    outer_radius = int(size * 0.45)
    inner_radius = int(size * 0.25)
    pupil_radius = int(size * 0.12)
    
    # Draw outer circle (eye outline) - green
    draw.ellipse(
        [center - outer_radius, center - outer_radius, 
         center + outer_radius, center + outer_radius],
        fill=(76, 175, 80, 255),  # Material Design green
        outline=(69, 160, 73, 255),
        width=1
    )
    
    # Draw inner circle (iris) - white
    draw.ellipse(
        [center - inner_radius, center - inner_radius,
         center + inner_radius, center + inner_radius],
        fill=(255, 255, 255, 255)
    )
    
    # Draw pupil - green
    draw.ellipse(
        [center - pupil_radius, center - pupil_radius,
         center + pupil_radius, center + pupil_radius],
        fill=(76, 175, 80, 255)
    )
    
    return img

def main():
    """Generate icons in all required sizes."""
    sizes = [16, 32, 48, 128, 256]
    
    for size in sizes:
        icon = create_eye_icon(size)
        filename = f'icon_{size}.png'
        icon.save(filename, 'PNG')
        print(f'Created {filename}')
    
    print('\nIcons generated successfully!')
    print('You can now load the extension in Chrome.')

if __name__ == '__main__':
    try:
        main()
    except ImportError:
        print("Error: Pillow library not installed.")
        print("Install it with: pip install Pillow")
        print("\nAlternatively, create the PNG icons manually using any image editor.") 