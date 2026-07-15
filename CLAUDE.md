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
  images?: string[];                     // Optional: the vendor's whole photo gallery (see below)
}

Response:
{
  success: boolean;
  action: "created" | "updated" | "exists";
  // "created" = new catalog row
  // "updated" = a row with this vendorSku+region existed and its case cost changed;
  //             caseCost/caseSize are refreshed and recommendedPrice is recomputed
  //             preserving the row's existing markup ratio (same rule as PATCH)
  // "exists"  = the row existed and nothing changed
  previousCaseCost?: number;      // present when the row already existed
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

## Product Image Capture (for machine-photo slot matching)

A vending slot holds a **single unit** (one 2 oz bag), but a warehouse retailer's
hero image is the **case** (a 40-pack carton). The two look nothing alike, so the
catalog's `image` field is useless as a visual reference when identifying products
in a photo of a stocked machine.

**Flow:**
1. `content.js` `collectGalleryImages()` scrapes the page's whole photo gallery —
   the hero (`img[id^="hero-image-default-"]` on Sam's), the carousel, and any
   JSON-LD image array — deduped by asset path, capped at 8.
2. The importer posts them as `images: string[]` to `POST /api/catalog`.
3. The route calls `src/lib/classifyProductImages.ts` (Claude vision), which tags
   each image `unit_front | case_front | nutrition_label | back_panel | lifestyle
   | other` and picks the best **`unit_front`** as the recognition image. Nutrition
   panels, ingredient text, and back-of-box shots are filtered out here — they
   can't be told apart by URL or alt text.
4. Stored on `standard_products` as `images` (jsonb) + `recognition_image` (text).
   `image` is left untouched, so existing UI is unaffected.

Classification failures are non-fatal: the URLs are still stored, tagged `other`.
Re-importing a product that predates this backfills its images.

**Consumer:** `POST /api/ai/analyze-machine` with `analysisType: "slot_layout"`
maps a machine photo to catalog products. It now sends each product's
`recognition_image` as a labeled reference photo alongside the machine photo, so
matching is visual rather than a guess from the product name (names + aliases are
still sent, and are the fallback for products with no reference photo).

Two details in that request are deliberate:
- **Reference photos are downscaled, the machine photo is not.** The vendor CDN
  serves 1500x1500 originals (~3,000 image tokens each); `thumbnail()` appends
  `?odnWidth=320&odnHeight=320`, which costs ~180 tokens. The machine photo stays
  full-resolution — that's what makes the shelf labels legible.
- **The reference block is prompt-cached** (`cache_control` on the last reference
  image, machine photo after it). The catalog is identical across every machine
  setup, so only the first run pays for it. Note Opus 4.8 has a 4,096-token
  minimum cacheable prefix: with fewer than ~25 reference products the cache
  silently won't engage. That's harmless, just not yet a saving.

## Catalog Refresh ("Refresh Catalog")

One-click job that re-scrapes every catalog item's vendor page and writes back
**anything that changed** — price, name, description, images, barcode — then scans
for duplicates. (This replaced a price-only sweep; the old `PATCH /api/catalog`
price-only endpoint still exists but the refresh job no longer uses it.)

**Flow:**
1. Popup sends `START_CATALOG_UPDATE` and polls `GET_UPDATE_PROGRESS` (progress is
   persisted in `chrome.storage.local` under `catalogUpdate`, so closing/reopening
   the popup is safe). `CANCEL_CATALOG_UPDATE` requests a stop.
2. Background worker `GET`s the whole catalog with the maintainer Bearer token.
3. For each item with a Sam's/Costco `vendorLink`, it navigates a **single reused
   foreground tab** to the page, re-scrapes via the content script, and `POST`s the
   result to `/api/catalog` **keyed by `id`** — see the gotcha below.
4. The API's `refreshExisting()` diffs each field, writes only what moved, and
   returns `changedFields`. Pricing recomputes `recommendedPrice` **preserving the
   item's existing markup ratio**, so an owner's hand-tuned sell price survives a
   cost change. Fields the scrape couldn't read are left alone — a failed scrape
   must never null out good data.
5. Afterwards it calls `GET /api/catalog?duplicates=1` and shows any groups.

> ⚠️ **Refresh targets rows by `id`, never by `vendorSku`.** Legacy seed rows have
> no `vendorSku`, so a SKU-keyed write would miss them and *create a second row*
> instead of updating the one being refreshed. Refreshing a row that has no SKU also
> heals it — the scraped SKU is written in, so it starts deduping on future imports.

**Import and refresh share one server code path** (`createStandardProduct` →
`refreshExisting`), so they cannot drift apart.

### Duplicate detection

`findCatalogDuplicates()` flags a pair only when **the barcodes match exactly**, or
**one name contains the other AND the case sizes are equal**.

Name similarity alone is not enough, and this is not hypothetical: "Jack Link's
Original Beef Sticks, 0.92 oz." (20 ct) and "Jack Link's Original Tender Style Beef
Steak" (15 ct) share a name prefix but are *different products*. Requiring an equal
case size rejects them — the same size-variant hazard `generateProductAliases.ts`
guards against.

Duplicates are **flagged, never auto-deleted**: a false positive would destroy a real
product, so the maintainer picks which row to keep.

### Deleting a duplicate

`DELETE /api/catalog { id, mergeIntoId? }`. Org products cloned from a catalog row
FK-reference it (`products.sourceStandardId`), so a naive delete throws. The handler
**repoints those clones onto `mergeIntoId` (the row you kept) before deleting**, so
no owner's stocked product is lost. Omit `mergeIntoId` and the clones simply lose
their catalog link and become standalone custom products.

**Requires** the `tabs` permission to open/close tabs and detect load completion.

**Limitations:** if the MV3 service worker is killed mid-run the in-memory loop
stops; on next load a stale `running` state is reconciled to `interrupted`. Prices
that render only after login/club-selection rely on the user's own browser session.
