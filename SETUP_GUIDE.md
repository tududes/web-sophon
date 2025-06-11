# WebSophon - Quick Setup Guide

## Quick Start

1. **Generate Icons** (optional):
   ```bash
   pip install Pillow
   python generate_icons.py
   ```
   Or create three PNG files manually: icon-16.png, icon-48.png, icon-128.png

2. **Install Extension**:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select this folder

3. **Configure n8n**:
   - Import `n8n-workflow-example.json` into n8n
   - Activate the workflow
   - Copy the webhook URL

4. **Use Extension**:
   - Click extension icon
   - Paste webhook URL
   - Test with "📸 Capture Screenshot Now" button
   - Select interval for automatic capture
   - Toggle ON for continuous capture

## Testing the Extension

### Test 1: Basic Functionality
1. Navigate to any website (e.g., google.com)
2. Open the extension popup
3. Enter a test webhook URL (use webhook.site for testing)
4. Enable capture
5. Check that screenshots are being sent to the webhook

### Test 2: Navigation Detection
1. Enable capture on a domain
2. Navigate to a different domain
3. Verify capture stops automatically

### Test 3: Interval Changes
1. Start capture with 5-second interval
2. Change to 30 seconds while capturing
3. Verify the new interval takes effect

## Architecture Overview

```
User Interface (popup.html/js)
    ↓
Background Service Worker (background.js)
    ↓
Screenshot Capture (Chrome API)
    ↓
Webhook POST (multipart/form-data)
    ↓
n8n Webhook Node → Processing → LLM → External Tool
```

## Security Notes

- Extension only captures visible tab content
- Requires explicit user consent per domain
- No data stored externally
- All settings stored locally in browser

## Debugging

- Check Chrome DevTools console for the extension
- Background script logs can be viewed at chrome://extensions/ → "service worker"
- Use Chrome's Network tab to monitor webhook requests

## Next Steps

1. Customize the LLM question in the n8n workflow
2. Configure your external tool endpoint
3. Add custom icon designs
4. Deploy n8n instance if testing locally 