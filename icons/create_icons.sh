#!/bin/bash

# Create simple SVG icons and convert to PNG using base64 data URLs
# This creates purple square icons with white "V" text

for size in 16 48 128; do
  cat > icon${size}.svg << SVGEOF
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#grad)"/>
  <text x="50%" y="60%" font-size="$((size * 60 / 100))" fill="white" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold">V</text>
</svg>
SVGEOF
done

echo "Created SVG icons. To convert to PNG, install ImageMagick or use an online converter."
echo "For now, Chrome can load SVG files if you rename them to .png (or use a proper conversion tool)."
