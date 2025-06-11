# WebSophon - Troubleshooting Guide

## Screenshots Not Reaching n8n

If your screenshots aren't reaching n8n, follow these steps:

### 1. Check Browser Console

Open the extension's background script console:
1. Go to `chrome://extensions/`
2. Find "WebSophon"
3. Click "service worker" link
4. Check the console for logs

You should see logs like:
```
Attempting to capture screenshot for tab 123, domain: example.com, webhook: https://...
Capturing visible tab...
Screenshot captured, size: 123456
Blob created, size: 78910
Sending to webhook: https://...
Screenshot sent to webhook (no-cors mode)
```

### 2. Test with Manual Capture

Use the new "📸 Capture Screenshot Now" button to test:
1. Enter your webhook URL
2. Click the capture button
3. Check for success/error messages

### 3. Common Issues

#### CORS Issues
The extension now uses `no-cors` mode to avoid CORS problems. However, this means:
- The extension can't read the response status
- n8n must be configured to accept requests without CORS headers

#### Webhook URL Format
Ensure your webhook URL is complete:
- ✅ `https://your-n8n.com/webhook/abc123`
- ❌ `/webhook/abc123` (missing domain)
- ❌ `your-n8n.com/webhook/abc123` (missing protocol)

#### n8n Configuration
1. Import `n8n-workflow-simple.json` for testing
2. Activate the workflow
3. Use the production webhook URL (not test URL)
4. Ensure n8n webhook accepts multipart/form-data

### 4. Test with Alternative Webhook

Test with webhook.site to verify the extension works:
1. Visit https://webhook.site
2. Copy your unique URL
3. Use it in the extension
4. Check if data appears on webhook.site

### 5. Check n8n Webhook Settings

In your n8n workflow:
- Set HTTP Method: POST
- Response Mode: "Immediately"
- Enable "Binary Data" in options
- Don't use authentication initially (for testing)

### 6. Network Debugging

1. Open Chrome DevTools (F12)
2. Go to Network tab
3. Click the capture button
4. Look for the webhook request
5. Check request headers and payload

### 7. Extension Permissions

Verify the extension has proper permissions:
- Should show camera icon when capturing
- Should have access to the current tab
- Try on a simple HTTP/HTTPS site (not chrome:// pages)

## Still Not Working?

1. **Check n8n logs**: Look for incoming webhook requests
2. **Try without SSL**: Test with HTTP if using self-hosted n8n
3. **Firewall/Network**: Ensure n8n is accessible from your browser
4. **Browser restrictions**: Some corporate networks block certain requests

## Working Example

A working request should contain:
- `screenshot`: Binary PNG file
- `domain`: Current domain (e.g., "google.com")
- `timestamp`: ISO timestamp
- `tabId`: Tab ID number
- `url`: Full page URL
- `isManual`: "true" or "false" 