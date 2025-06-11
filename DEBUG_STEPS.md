# Debug Steps for WebSophon

## Step 1: Update the Extension
1. Go to `chrome://extensions/`
2. Find "WebSophon"
3. Click the **refresh icon** (↻) on the extension card
4. Close and reopen the extension popup

## Step 2: Check Background Script Console
1. Go to `chrome://extensions/`
2. Click "service worker" link under WebSophon
3. Keep this console open while testing
4. Clear the console (Ctrl+L or Cmd+K)

## Step 3: Test Manual Capture
1. Go to a regular website (like google.com or tradingview.com)
2. Open the extension popup
3. Click "Capture Screenshot Now"
4. Watch the console for these logs:
   - `Manual capture requested:`
   - `Attempting to capture screenshot for tab`
   - `Capturing visible tab...`
   - `Screenshot captured, size:`

## Step 4: Common Issues & Solutions

### Issue: "Capturing..." gets stuck
**Possible causes:**
1. **Wrong page type**: Can't capture on chrome://, edge://, or extension pages
2. **Permission issues**: Extension needs tab access
3. **Window minimized**: Window must be visible
4. **Network error**: Webhook unreachable

### Issue: CORS Error
Look for: `Access to fetch at 'https://...' from origin 'chrome-extension://...' has been blocked by CORS`

**Solution**: Your n8n instance needs to allow CORS from chrome-extension:// origins

### Issue: "Cannot read properties of undefined"
This means the tab info is not available. Try:
1. Refresh the page you're capturing
2. Reopen the extension popup

## Step 5: Test with Simple Server
Test if the extension works at all:
1. Use https://webhook.site for testing
2. Copy the unique URL
3. Paste in extension
4. Try manual capture
5. Check if data appears on webhook.site

## Step 6: Check Permissions
In the console, run:
```javascript
chrome.permissions.getAll((perms) => console.log(perms));
```

Should show:
- `activeTab`
- `storage`
- `tabs`
- `scripting`

## Step 7: Enable Verbose Logging
If still not working, check all console outputs:
1. Extension popup console (right-click popup → Inspect)
2. Background script console
3. Current page console (F12)

## What to Look For
✅ Success logs:
- "Screenshot captured, size: [number]"
- "Blob created, size: [number]"
- "Webhook response status: 200"

❌ Error indicators:
- "Cannot capture screenshot on URL"
- "Screenshot capture failed"
- "Webhook returned [error status]"
- CORS errors
- Network timeouts 