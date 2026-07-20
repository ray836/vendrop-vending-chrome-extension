# VenDrop Chrome Extension

Quick-add products from Sam's Club and Costco to your VenDrop vending management catalog with a single click.

## Add an order to Sam's Club

On the VenDrop **Orders** page, click **Add to Sam's Cart**. This is a **replace cart** action: after the user confirms the warning, the extension removes all existing Sam's Club cart items and verifies the cart is empty. It then adds one of each ordered product, returns to the cart, sets every product to the requested case quantity, verifies the total case count, and leaves the finished tab on the Sam's Club cart page. If the old cart or final quantities cannot be verified, the run stops and returns the VenDrop order to draft. Checkout and payment always remain manual.

If a product is unavailable, a page cannot be read, or Chrome interrupts the run, the extension stops instead of replaying uncertain cart clicks. Review any partial cart before trying again.

## Features

- **One-Click Import:** Add products while browsing Sam's Club or Costco
- **Live Preview:** See product details before adding to your catalog
- **Automatic Extraction:** Automatically detects and extracts product information
- **Smart Pricing:** Calculates recommended vending prices with configurable markup
- **Multi-Retailer Support:** Works with both Sam's Club and Costco product pages

## Prerequisites

Before installing the extension, ensure you have:

1. **VenDrop Next.js App** running locally
   - Location: `/Users/raygrant/Documents/simple-vendrop/simple-vending-app`
   - Running on: `http://localhost:3000`
   - Start with: `npm run dev`

2. **Catalog Maintainer Token**
   - A shared secret that must equal `CATALOG_ADMIN_SECRET` in the app's environment
   - Grants write access to the **shared, app-wide product catalog** (not a single org)

3. **Chrome Browser** (or Chromium-based browser)

## Installation

### Step 1: Load the Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle switch in top right corner)
3. Click **"Load unpacked"** button
4. Navigate to and select the extension directory:
   ```
   /Users/raygrant/Documents/simple-vendrop/vending-chrome-extention
   ```
5. The extension should now appear in your extensions list

### Step 2: Configure Settings

1. Click the VenDrop extension icon in your Chrome toolbar
2. On first launch, you'll see the settings screen
3. Enter your **Catalog Maintainer Token** (must equal `CATALOG_ADMIN_SECRET` on the server)
4. Confirm the **API URL** (default: `http://localhost:3000`)
5. Click **"Save Settings"**

> Products you import go into the **shared catalog** that all owners can pick from — they are not tied to any single organization.

## Usage

### Adding Products from Any Sam's Club Page

1. **Start your VenDrop API server:**
   ```bash
   cd /Users/raygrant/Documents/simple-vendrop/simple-vending-app
   npm run dev
   ```

2. **Open any Sam's Club page**
   - Search results, category pages, the homepage, carousels, and recommendation cards are supported
   - Product detail pages still support the single-product preview flow

3. **Check the products you want to add**
   - VenDrop places a checkbox on each product card
   - The toolbar badge shows how many products are selected

4. **Click the VenDrop extension icon**
   - The popup lists the selected products

5. **Click "Add Selected to Catalog"**
   - The extension visits each product page to read the full product details
   - Each product is added or safely matched to its existing catalog entry
   - Progress and assortment-analysis results appear in the popup

6. **Verify in your VenDrop app**
   - For variety cases, click **Open product details** in the confirmed assortment card
   - The app opens the matching product for your signed-in organization
   - If your organization has not picked the shared catalog item yet, the app directs you to Products instead

## Supported Retailers

### Sam's Club
- ✅ Product pages: `samsclub.com/p/...`
- ✅ Product pages: `samsclub.com/ip/...`
- ✅ Product cards across search, category, homepage, carousel, and recommendation views
- Extracts: name, image, price, case size, SKU, barcode

### Costco
- ✅ Product pages: `costco.com/...product...`
- Extracts: name, image, price, case size, SKU

## Troubleshooting

### Extension shows "Not Supported"

**Problem:** Popup displays "This page is not supported"

**Solutions:**
- Verify you're on a Sam's Club or Costco page
- Refresh the page if you just navigated to it
- Check that the URL includes `samsclub.com` or `costco.com`

### Product preview not loading

**Problem:** Preview section doesn't show product info

**Solutions:**
- Wait for the page to fully load
- Open browser console (F12) and check for content script errors
- Some products may have different page structures - the scraper will still work when clicking "Add to Catalog"

### "Add to Catalog" button fails

**Problem:** Error message appears after clicking button

**Solutions:**

1. **Check API is running:**
   ```bash
   cd simple-vending-app
   npm run dev
   # Should show: Ready on http://localhost:3000
   ```

2. **Verify Catalog Maintainer Token:**
   - Click "Settings" in extension popup
   - Confirm the token matches `CATALOG_ADMIN_SECRET` in the app's env
   - A 401 error means the token is missing or wrong

3. **Check for CORS errors:**
   - Open extension popup inspector (right-click icon → Inspect)
   - Look for CORS errors in console
   - If present, add CORS headers to API (see below)

4. **Review API logs:**
   - Check your Next.js terminal
   - Look for error messages from the scraper
   - Check `simple-vending-app/public/debug/screenshots/` for failed scrape screenshots

### CORS

CORS is already handled by the catalog route (`simple-vending-app/src/app/api/catalog/route.ts`) — it responds to `OPTIONS` and returns `Access-Control-Allow-*` headers (including `Authorization`). No changes needed for local development.

## Configuration

### Changing API URL

If your VenDrop app runs on a different port:

1. Click extension icon
2. Click "Settings" link at bottom
3. Update "API URL" field
4. Click "Save Settings"

### Changing Maintainer Token

1. Click extension icon
2. Click "Settings" link
3. Update "Catalog Maintainer Token" field
4. Click "Save Settings"

### Variety-case contract

Imports and catalog refreshes send the vendor description and full image gallery to
`POST /api/catalog`. The app analyzes whether the parent is a variety case and returns:

```json
{
  "product": {
    "assortmentStatus": "confirmed",
    "components": [
      {
        "id": "stdcmp-...",
        "name": "Ruffles Queso",
        "aliases": ["Queso Ruffles"],
        "quantityPerCase": 10,
        "recognitionImages": [],
        "active": true
      }
    ]
  }
}
```

`confirmed` means all active component quantities sum exactly to `caseSize`.
Otherwise the API returns `needs_review`; the popup displays the extracted components
and links directly to the app-owner review dialog. That dialog edits the sellable case
size and per-component package quantities, requires the totals to balance, and then
marks the assortment confirmed. Components remain hidden children of the one catalog
product. Refresh preserves their IDs and marks missing components inactive. When a
retailer title contains both an inner piece count and an outer pack count (for example,
`15 pc., 18 pk.`), the outer package count is used as the catalog case size.

The API also returns the source-fingerprint decision for every import or refresh.
The popup shows `No AI · analysis unchanged` when existing analysis was reused,
or an `AI used` badge identifying data-only versus image analysis. Bulk job summaries
total both outcomes so the savings are visible after a catalog refresh. Completed
summaries also show elapsed job time, estimated AI spend, model-call count, cumulative
AI time, and a per-provider calls/tokens/cost breakdown. Failed responses that trigger
a paid fallback are included in these totals.
If any provider attempt fails validation or returns an API error, the completed
summary includes a collapsible list with the product, provider, analysis step, and
reason—even when another provider recovered and the product itself refreshed.
Daily Gemini quotas open a model-specific circuit for the rest of that bulk job:
later products skip the exhausted model immediately while other Gemini models and
fallback providers remain available. The summary names any model skipped this way.

### Location-aware refresh

An organization can add one or more Sam's Club purchasing clubs under
**Settings → Organization → Purchasing Clubs** and choose a default. The extension's
Refresh Catalog panel lists only clubs actively used by at least one organization;
clubs with no active organization link are never scanned.

The first selected club receives a full refresh. For every later club, the extension
checks 10 deterministic sentinel products first, prioritizing sale and existing
location-offer rows. If every offer signature matches the first club, the remaining
offers are stored as `inferred` from that club and the retailer-page loop ends early.
Any mismatch—or any product without a successful primary observation in the same
run—forces a full exact-club scan. Both observed and inferred decisions are appended
to the offer history with a refresh-run ID. Current product and order reads resolve
against the organization's default club, while each order snapshots the purchasing
club and fulfillment mode it used.

## Development

### File Structure

```
vending-chrome-extention/
├── manifest.json           # Extension configuration (Manifest V3)
├── popup.html             # Extension popup UI
├── popup.css              # Popup styles
├── popup.js               # Popup logic and API calls
├── content.js             # Product extraction from web pages
├── background.js          # Background service worker
├── icons/                 # Extension icons (placeholder)
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── README.md             # This file
└── CLAUDE.md             # Developer documentation
```

### Debugging

**Popup Console:**
- Right-click extension icon → "Inspect popup"
- View popup.js logs and API responses

**Content Script Console:**
- Open DevTools on product page (F12)
- Look for `[VenDrop]` prefixed logs

**Background Script Console:**
- Visit `chrome://extensions/`
- Click "Service worker" link under VenDrop
- View background.js logs

**Product Diagnostic History:**
- App owners can open **Catalog Source → Import diagnostics** on a product.
- Recent imports and refreshes retain the matched vendor-status evidence, AI
  decisions, and component crop rejection reasons for that catalog row.

### Making Changes

After modifying extension files:

1. Go to `chrome://extensions/`
2. Click refresh icon (↻) under VenDrop extension
3. Reload any open product pages
4. Test your changes

## Known Issues

1. **No Offline Support:** Extension requires internet connection
   - Failed requests are not queued

2. **Limited Error Recovery:** No automatic retry on failure
   - Must manually retry if scraping fails

## Roadmap

### Future Features
- [ ] Support for additional retailers
- [ ] Offline queue
- [ ] Price history tracking

## API Documentation

For detailed API documentation, see:
- `simple-vending-app/API_DOCS.md`

For developer context, see:
- `CLAUDE.md` in this directory

## Support

### Common Questions

**Q: Can I use this extension on multiple computers?**
A: Yes, but you'll need to load the unpacked extension on each computer and configure it with your catalog maintainer token.

**Q: Does this work in production?**
A: Currently designed for local development. For production, update the API URL to your production server and publish the extension to Chrome Web Store.

**Q: Can I add products from other retailers?**
A: Not yet. Currently supports Sam's Club and Costco only. Use "Manual Entry" in the VenDrop app for other retailers.

**Q: Will this slow down my browsing?**
A: No. The content script is lightweight and only runs on Sam's Club and Costco pages.

### Getting Help

If you encounter issues:

1. Check this README's Troubleshooting section
2. Review browser console for errors
3. Check Next.js terminal for API logs
4. Review `CLAUDE.md` for technical details

## License

Proprietary - VenDrop Internal Tool

## Version

**Current Version:** 1.0.0

**Last Updated:** 2025-10-24

## Updating Catalog Prices (bulk)

Keep the shared catalog current in one click:

1. Open the extension popup (from any page).
2. Click **"Update Catalog Prices"**.
3. The extension opens each catalog item's product page in a quiet background tab,
   re-reads its case cost, and updates the catalog when the price changed
   (recommended price is recomputed keeping the same markup). A progress bar shows
   `done/total`; **Cancel** stops it.
4. When finished you get a summary including Updated / Unchanged / Skipped / Failed
   plus AI used / No AI (analysis same).

The sweep runs in the background service worker, so it keeps going even if you
close the popup — reopen it to see live progress. Requires the `tabs` permission.
