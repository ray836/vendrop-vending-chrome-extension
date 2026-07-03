# Getting Started with VenDrop Chrome Extension

## Quick Start Guide

This 5-minute guide will get you up and running with the VenDrop Chrome Extension.

## Prerequisites Checklist

Before you begin, make sure you have:

- [ ] Chrome browser installed
- [ ] VenDrop Next.js app cloned and set up
- [ ] Node.js and npm installed
- [ ] PostgreSQL database running
- [ ] Your Organization ID from the database

## Step 1: Start Your VenDrop API (2 minutes)

```bash
# Navigate to your Next.js app
cd /Users/raygrant/Documents/simple-vendrop/simple-vending-app

# Install dependencies (if not already done)
npm install

# Start the development server
npm run dev

# You should see: "Ready on http://localhost:3000"
```

Leave this terminal running - don't close it!

## Step 2: Load the Extension (1 minute)

1. Open Chrome
2. Go to `chrome://extensions/`
3. Turn ON "Developer mode" (top right toggle)
4. Click "Load unpacked"
5. Select this folder: `/Users/raygrant/Documents/simple-vendrop/vending-chrome-extention`
6. You should see "VenDrop Product Importer" in your extensions list

## Step 3: Configure Extension (1 minute)

1. Click the extension icon in Chrome toolbar (puzzle piece → VenDrop)
2. Enter your **Organization ID**
   - Find it by querying your database: `SELECT id FROM organizations;`
   - Or create one if needed in your VenDrop app
3. Confirm API URL is `http://localhost:3000`
4. Click "Save Settings"

## Step 4: Test It! (1 minute)

1. Go to this test product page:
   ```
   https://www.samsclub.com/p/lays-potato-chips/13626865899
   ```

2. Click the VenDrop extension icon

3. You should see:
   - Product preview with image and price
   - "Add to Catalog" button enabled

4. Click "Add to Catalog"

5. Wait for success message: "✓ Successfully added..."

6. Verify in your VenDrop app:
   - Go to http://localhost:3000/products (or wherever products are listed)
   - You should see the Lay's Potato Chips product

## Success!

If you see the product in your catalog, you're all set! 🎉

## What's Next?

### Try More Products

**Sam's Club:**
- Snacks: https://www.samsclub.com/b/snacks-crackers/3006
- Beverages: https://www.samsclub.com/b/beverages/2306

**Costco:**
- Any product page on www.costco.com

### Customize Settings

Click "Settings" in the extension popup to:
- Change Organization ID (to switch orgs)
- Update API URL (if running on different port)

## Troubleshooting

### "Not Supported" Message

**Issue:** Extension shows "This page is not supported"

**Fix:** Make sure you're on a product page, not a category/search page
- ✅ Good: `samsclub.com/p/product-name/123456`
- ❌ Bad: `samsclub.com/b/snacks/3006`

### "Failed to Add Product" Error

**Check 1: Is the API running?**
```bash
# In your terminal, you should see:
# ▲ Next.js 14.x.x
# - Local:        http://localhost:3000
```

**Check 2: Is your Organization ID correct?**
```sql
-- Run in your PostgreSQL client
SELECT id, name FROM organizations;
```

**Check 3: Any errors in the terminal?**
- Look for red error messages in the terminal where you ran `npm run dev`

### Need More Help?

1. **Check the logs:**
   - Right-click extension icon → "Inspect popup"
   - Look for errors in the Console tab

2. **Check the API logs:**
   - Look at your terminal where `npm run dev` is running
   - Watch for `[Sam's Club Scraper]` messages

3. **Read the docs:**
   - `README.md` - Complete user guide
   - `CLAUDE.md` - Developer documentation
   - `API_DOCS.md` - API reference (in Next.js app)

## Pro Tips

### Speed Up Your Workflow

1. **Pin the extension:**
   - Click puzzle piece icon in Chrome
   - Pin VenDrop extension to toolbar

2. **Use keyboard shortcuts:**
   - `Alt+Shift+E` opens extension popup (Chrome default)
   - Customize in `chrome://extensions/shortcuts`

3. **Keep API running:**
   - Use `screen` or `tmux` to keep terminal session alive
   - Or run in background: `npm run dev &`

### Avoid Common Mistakes

❌ **Don't:** Close the terminal running `npm run dev`
✅ **Do:** Keep it running while using the extension

❌ **Don't:** Click "Add to Catalog" multiple times
✅ **Do:** Wait for success message (may take 5-10 seconds)

❌ **Don't:** Use on product listing pages
✅ **Do:** Use only on individual product pages

## File Reference

Quick reference to key files:

```
Extension Files:
  /vending-chrome-extention/manifest.json    - Extension config
  /vending-chrome-extention/popup.html       - UI layout
  /vending-chrome-extention/popup.js         - UI logic
  /vending-chrome-extention/content.js       - Page scraping

Next.js API:
  /simple-vending-app/src/app/api/scrape-product/route.ts  - API endpoint
  /simple-vending-app/src/lib/scrapers/samsclub-scraper.ts - Scraper logic
  /simple-vending-app/src/infrastructure/database/schema.ts - Database schema

Documentation:
  /vending-chrome-extention/README.md        - User guide
  /vending-chrome-extention/CLAUDE.md        - Developer docs
  /simple-vending-app/API_DOCS.md           - API reference
```

## Development Workflow

Making changes to the extension?

1. Edit the file (e.g., `popup.js`)
2. Go to `chrome://extensions/`
3. Click refresh icon (↻) under VenDrop
4. Reload any open product pages (to refresh content script)
5. Test your changes

## Next Steps

Now that you're set up:

1. ✅ Add more products from Sam's Club and Costco
2. ✅ Explore the extension code (start with `popup.js`)
3. ✅ Read `CLAUDE.md` for architecture details
4. ✅ Check `API_DOCS.md` for API capabilities
5. ✅ Consider improvements (see Roadmap in README.md)

---

**Questions?** Check the Troubleshooting section in README.md

**Ready to customize?** See CLAUDE.md for developer docs

**Need API details?** Check API_DOCS.md in the Next.js app
