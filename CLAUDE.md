# VenDrop Chrome Extension - Project Context

## Project Overview

This Chrome extension allows users to quickly add products from Sam's Club and Costco to their VenDrop vending management catalog. It integrates with an existing Next.js application that handles the actual product scraping and database storage.

## Architecture

### Components

1. **Manifest V3 Extension** (`manifest.json`)
   - Modern Chrome extension using Manifest V3
   - Permissions for activeTab, storage, and host access to localhost and retailer sites
   - Declares content scripts, popup, and background service worker

2. **Popup UI** (`popup.html`, `popup.css`, `popup.js`)
   - User interface shown when clicking the extension icon
   - Three views:
     - Settings view: Configure catalog maintainer token and API URL
     - Main view: Shows product preview and "Add to Catalog" button
     - Not supported view: Shown on non-supported pages
   - Features:
     - Real-time product preview extraction
     - Loading states and status messages
     - Persistent settings storage

3. **Content Script** (`content.js`)
   - Runs on Sam's Club and Costco product pages
   - Extracts product information (name, image, price) from the DOM
   - Communicates with popup to provide product preview
   - Multiple extraction strategies for reliability

4. **Background Service Worker** (`background.js`)
   - Handles extension lifecycle events
   - Detects when user navigates to supported pages
   - Sets default configuration on installation

## Integration with Next.js App

### API Endpoint
- **Base URL:** `http://localhost:3000` (configurable)
- **Endpoint:** `POST /api/catalog`  — adds to the **shared, app-maintained catalog** (`standard_products`), NOT a single org's products.
- **Located at:** `/Users/raygrant/Documents/simple-vendrop/simple-vending-app/src/app/api/catalog/route.ts`
- **Auth:** `Authorization: Bearer <token>` where the token equals `CATALOG_ADMIN_SECRET` in the app's env. There is no `organizationId` — the catalog is global.

> Note: the catalog is region-aware and read-only to owners; owners "pick" a catalog product to clone it into their own org (`POST /api/catalog/pick`). The importer only writes to the catalog.

### API Contract
```typescript
Request headers:
{
  "Content-Type": "application/json",
  "Authorization": "Bearer <CATALOG_ADMIN_SECRET>"
}

Request body:
{
  name: string;                          // Required
  image: string;                         // Required
  caseCost: number;                      // Required (> 0)
  caseSize: number;                      // Required (> 0)
  vendorSku?: string;                    // Optional (used for idempotent dedupe)
  barcode?: string;                      // Optional
  vendorLink?: string;                   // Optional
  category?: string;                     // Optional: Default "Snacks"
  region?: string | null;                // Optional: null = all regions
  shelfLifeDays?: number | null;         // Optional
  recommendedPrice?: number;             // Optional: overrides computed price
  recommendedPriceMultiplier?: number;   // Optional: Default 1.5 (price = caseCost/caseSize * multiplier)
}

Response:
{
  success: boolean;
  action: "created" | "exists";   // "exists" = a catalog row with this vendorSku+region already existed
  product: {
    id: string;
    name: string;
    recommendedPrice: number;
    category: string;
    image: string;
    vendorSku?: string;
    barcode?: string;
    caseCost: number;
    caseSize: number;
    shelfLifeDays?: number;
    region?: string;
  };
}
```

### Database Schema
- **ORM:** Drizzle ORM
- **Database:** PostgreSQL
- **Table:** `products`
- **Schema location:** `/Users/raygrant/Documents/simple-vendrop/simple-vending-app/src/infrastructure/database/schema.ts`

### Scraper Implementation
- **Sam's Club:** `/Users/raygrant/Documents/simple-vendrop/simple-vending-app/src/lib/scrapers/samsclub-scraper.ts`
- **Costco:** `/Users/raygrant/Documents/simple-vendrop/simple-vending-app/src/lib/scrapers/costco-scraper.ts`
- Uses Puppeteer/Browserbase to bypass bot detection
- Multiple extraction strategies for robustness

## User Flow

1. User installs the extension and opens popup
2. First-time setup: User enters their catalog maintainer token and API URL
3. User navigates to a Sam's Club or Costco product page
4. Extension content script automatically extracts product info
5. User clicks extension icon to see product preview
6. User clicks "Add to Catalog" button
7. Extension sends POST request to Next.js API
8. API scrapes full product details and saves to database
9. Extension shows success/error message

## Development Setup

### Prerequisites
- Chrome browser (or Chromium-based browser)
- Next.js vending app running on localhost:3000
- Catalog maintainer token (equals `CATALOG_ADMIN_SECRET` in the app's env)

### Loading the Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the extension directory: `/Users/raygrant/Documents/simple-vendrop/vending-chrome-extention`
5. Extension should now appear in your extensions list

### Configuration

1. Click the extension icon in Chrome toolbar
2. Enter your Catalog Maintainer Token (must equal `CATALOG_ADMIN_SECRET` in the app's env)
3. Enter API URL (default: `http://localhost:3000`)
4. Click "Save Settings"

### Testing

1. Ensure Next.js app is running: `cd simple-vending-app && npm run dev`
2. Navigate to a test product:
   - Sam's Club: https://www.samsclub.com/p/lays-potato-chips/13626865899
   - Costco: Any product page on costco.com
3. Click the extension icon
4. Verify product preview appears
5. Click "Add to Catalog"
6. Check Next.js console for scraping logs
7. Verify product was added to database

## Known Limitations

1. **Icons:** Currently using basic placeholder icons
   - Replace with branded icons before production
   - See `icons/ICONS_README.md` for guidelines

2. **CORS:** Already handled by `/api/catalog/route.ts` (OPTIONS + `Access-Control-Allow-*` incl. `Authorization`). No changes needed for local development.

3. **Error Handling:**
   - Extension assumes localhost:3000 is reachable
   - No offline queue for failed requests
   - No retry mechanism

4. **Product Detection:**
   - Content script may fail if retailer changes page structure
   - Preview extraction is best-effort (missing data is graceful)

5. **Authentication:**
   - Uses a shared maintainer secret sent as `Authorization: Bearer <token>` (matches `CATALOG_ADMIN_SECRET`)
   - This is an admin/maintainer tool — the token grants write access to the global catalog, so keep it private
   - No per-user auth or rate limiting

## File Structure

```
vending-chrome-extention/
├── manifest.json           # Extension configuration
├── popup.html             # Extension popup UI
├── popup.css              # Popup styles
├── popup.js               # Popup logic and API calls
├── content.js             # Content script for product extraction
├── background.js          # Background service worker
├── icons/                 # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   ├── icon128.png
│   └── ICONS_README.md
├── CLAUDE.md             # This file
└── README.md             # Installation and usage guide
```

## Future Improvements

### Short-term
- [ ] Add CORS configuration to API route
- [ ] Create branded extension icons
- [ ] Add error recovery and retry logic
- [ ] Implement loading states for slow networks
- [ ] Add product duplicate detection

### Medium-term
- [ ] Token-based authentication
- [ ] Offline queue with sync
- [ ] Category selection in extension
- [ ] Price multiplier configuration
- [ ] Product edit before saving
- [ ] Bulk import support

### Long-term
- [ ] Support for additional retailers (Amazon, Walmart, etc.)
- [ ] AI-powered category suggestions
- [ ] Price history tracking
- [ ] Competitor price comparison
- [ ] Browser action badge for import count
- [ ] Options page for advanced settings

## Debugging

### Extension Console
- Right-click extension icon → "Inspect popup"
- Console shows popup.js logs and errors
- Network tab shows API requests

### Content Script Console
- Open DevTools on the product page (F12)
- Console shows content.js logs
- Look for "[VenDrop]" prefixed messages

### Background Script Console
- Go to `chrome://extensions/`
- Click "Service worker" under the extension
- Console shows background.js logs

### API Logs
- Check Next.js terminal for API logs
- Look for "[Sam's Club Scraper]" or "[Costco Scraper]" messages
- Check `public/debug/screenshots/` for failed scrape screenshots

## Troubleshooting

**Extension popup shows "Not Supported":**
- Verify you're on a Sam's Club or Costco product page
- Check the URL includes `samsclub.com` or `costco.com`
- Reload the page if just navigated

**Product preview not showing:**
- Open DevTools console on product page
- Check for content script errors
- Verify product information is present on page
- Product may be loaded dynamically - wait for page to fully load

**"Add to Catalog" fails:**
- Verify Next.js app is running on localhost:3000
- Check organizationId is valid (exists in database)
- Check API endpoint URL in settings
- Look for CORS errors in extension console
- Review Next.js API logs for scraper errors

**Product added but missing fields:**
- Check API response in extension console
- Review scraper logs in Next.js terminal
- Check screenshot saved in `public/debug/screenshots/`
- Retailer may have changed page structure

## Contributing

When modifying this extension:
1. Test on both Sam's Club and Costco pages
2. Verify all three popup views work correctly
3. Check console for errors
4. Test with invalid organizationId
5. Test with API server offline
6. Verify settings persistence across browser restarts

## Resources

- Chrome Extension Docs: https://developer.chrome.com/docs/extensions/
- Manifest V3 Guide: https://developer.chrome.com/docs/extensions/mv3/intro/
- Content Scripts: https://developer.chrome.com/docs/extensions/mv3/content_scripts/
- Message Passing: https://developer.chrome.com/docs/extensions/mv3/messaging/
- Storage API: https://developer.chrome.com/docs/extensions/reference/storage/

## API Documentation

See also: `/Users/raygrant/Documents/simple-vendrop/simple-vending-app/API_DOCS.md`

## Bulk Price Sweep ("Update Catalog Prices")

One-click job that keeps the shared catalog's prices current. Lives in the popup
panel (visible on the main and "not supported" views, since it can run from any
page).

**Flow:**
1. Popup sends `START_CATALOG_UPDATE` to the background service worker and polls
   `GET_UPDATE_PROGRESS` (progress is persisted in `chrome.storage.local` under
   `catalogUpdate`, so closing/reopening the popup is safe). `CANCEL_CATALOG_UPDATE`
   requests a stop.
2. Background worker `GET`s the whole catalog: `GET /api/catalog` with
   `Authorization: Bearer <token>` (maintainer path returns the raw list incl.
   `id` + `vendorLink`; the Clerk/owner path still returns the org-scoped view).
3. For each item with a Sam's Club/Costco `vendorLink`, it opens the page as a
   **quiet inactive background tab**, waits for load, re-scrapes via the content
   script (`GET_PRODUCT_INFO`), closes the tab, and compares `case_cost`.
4. If the case cost changed (≥ $0.01), it calls
   `PATCH /api/catalog { id, caseCost }`, which updates `caseCost` and recomputes
   `recommendedPrice` **preserving the item's existing markup ratio**.
5. Tabs are processed sequentially with a short delay (polite; avoids bot-blocks).
   A summary reports Updated / Unchanged / Skipped (no vendor link) / Failed.

**Requires** the `tabs` permission (added to `manifest.json`) to open/close tabs
and detect load completion.

**Limitations:** if the MV3 service worker is killed mid-sweep the in-memory loop
stops; on next load a stale `running` state is reconciled to `interrupted`. Prices
that render only after login/club-selection rely on the user's own browser session.
