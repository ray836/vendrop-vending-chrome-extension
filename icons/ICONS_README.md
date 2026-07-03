# Extension Icons

This folder should contain the extension icons in the following sizes:
- `icon16.png` - 16x16 pixels
- `icon48.png` - 48x48 pixels
- `icon128.png` - 128x128 pixels

## Temporary Placeholder Icons

For development, you can create simple colored squares as placeholder icons.

### Quick way to create placeholder icons:

**Option 1: Using online tools**
- Visit https://www.favicon-generator.org/
- Upload any image or create a simple design
- Generate and download 16x16, 48x48, and 128x128 PNG files

**Option 2: Using ImageMagick (command line)**
```bash
# Create purple gradient placeholder icons
convert -size 16x16 gradient:'#667eea-#764ba2' icons/icon16.png
convert -size 48x48 gradient:'#667eea-#764ba2' icons/icon48.png
convert -size 128x128 gradient:'#667eea-#764ba2' icons/icon128.png
```

**Option 3: Using Python with PIL**
```python
from PIL import Image, ImageDraw

def create_icon(size, filename):
    img = Image.new('RGB', (size, size), color='#667eea')
    draw = ImageDraw.Draw(img)
    # Add a simple "V" text
    draw.text((size//4, size//4), 'V', fill='white')
    img.save(filename)

create_icon(16, 'icons/icon16.png')
create_icon(48, 'icons/icon48.png')
create_icon(128, 'icons/icon128.png')
```

## Design Guidelines

For production icons, consider:
- Use the VenDrop brand colors (purple gradient: #667eea to #764ba2)
- Include a recognizable symbol (shopping cart, vending machine, or "V" letter)
- Ensure icons are clear and recognizable at all sizes
- Use transparent backgrounds or solid colors
- Follow Chrome Web Store icon guidelines
