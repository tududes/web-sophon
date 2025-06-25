# Debug Steps Guide

## Extension Debugging

### 1. Background Script Console

Check the service worker logs:
1. Go to `chrome://extensions/`
2. Find "WebSophon"
3. Click "service worker" link
4. Check console for errors

Expected logs:
```
Initializing WebSophon background services...
WebSophon background services initialized successfully
LLM request initiated for domain: example.com
Screenshot captured successfully
LLM response received: {...}
```

### 2. Popup Console

Debug the popup interface:
1. Right-click on extension popup
2. Select "Inspect"
3. Check Console tab for errors

### 3. Enable Debug Mode

Enable detailed logging:
```javascript
// In Chrome DevTools console
localStorage.setItem('websophon-debug', 'true');
// Reload extension popup
```

Debug features include:
- Test event generation
- Detailed request/response logging
- Performance metrics
- Enhanced error messages

## LLM API Debugging

### 1. Test API Configuration

Use the built-in configuration test:
1. Open Settings tab in extension
2. Enter API URL and key
3. Click "Test Configuration"
4. Check console for detailed results

### 2. Manual API Testing

Test your API independently:
```bash
curl -X POST "https://api.openai.com/v1/chat/completions" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4-vision-preview",
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "What do you see in this image?"
          }
        ]
      }
    ]
  }'
```

### 3. Check API Response Format

Verify your API returns the expected format:
```json
{
  "fields": {
    "field_name": {
      "boolean": true,
      "probability": 0.95
    }
  },
  "reason": "Explanation of evaluation"
}
```

## Common Issues

### API Connection Failed

**Symptoms:**
- Test configuration fails
- No responses in event history
- Console shows network errors

**Solutions:**
1. Verify API URL format
2. Check API key validity
3. Test network connectivity
4. Check corporate firewall settings

### Invalid Response Format

**Symptoms:**
- Fields show as pending indefinitely
- Console shows parsing errors
- "Invalid JSON response" errors

**Solutions:**
1. Check API model compatibility
2. Verify response structure
3. Test with different LLM model
4. Enable debug mode for full response

### Screenshot Issues

**Symptoms:**
- Black or empty screenshots
- "Screenshot failed" errors
- Partial page captures

**Solutions:**
1. Try full-page capture toggle
2. Add capture delay
3. Test on different pages
4. Check Chrome permissions

### Permission Errors

**Symptoms:**
- "Permission denied" errors
- Extension icon grayed out
- Screenshots not capturing

**Solutions:**
1. Reload extension
2. Check activeTab permission
3. Test on HTTP/HTTPS sites only
4. Restart browser if needed

## Network Debugging

### 1. Chrome DevTools

Monitor API requests:
1. Open DevTools (F12)
2. Go to Network tab
3. Trigger capture
4. Check for API requests
5. Examine request/response details

### 2. Request Headers

Verify proper headers are sent:
```
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
User-Agent: Chrome Extension WebSophon
```

### 3. Response Analysis

Check response status codes:
- `200`: Success
- `401`: Invalid API key
- `429`: Rate limit exceeded
- `500`: Server error

## Storage Debugging

### 1. Chrome Storage Inspector

Check stored data:
```javascript
// In DevTools console
chrome.storage.local.get(null, console.log);
chrome.storage.sync.get(null, console.log);
```

### 2. Clear Storage

Reset extension state:
```javascript
// Clear all extension data
chrome.storage.local.clear();
chrome.storage.sync.clear();
```

### 3. Storage Quota

Check usage limits:
```javascript
chrome.storage.local.getBytesInUse(null, bytes => {
  console.log('Local storage used:', bytes, 'bytes');
});
```

## Performance Debugging

### 1. Timing Analysis

Monitor request duration:
- Check event history for timing info
- Look for timeouts (>300 seconds)
- Monitor for memory usage spikes

### 2. Memory Management

Track resource usage:
- Screenshot size optimization
- Event history cleanup
- Background service memory

### 3. Concurrent Requests

Test multiple simultaneous captures:
- Each should process independently
- No blocking between requests
- Proper status tracking per request

## Field Evaluation Debugging

### 1. Criteria Testing

Debug field criteria:
1. Start with simple, obvious criteria
2. Test on pages with known results
3. Monitor confidence scores
4. Refine based on results

### 2. Image Quality

Verify screenshot quality:
- Check if relevant content is visible
- Test full-page vs viewport capture
- Ensure text is readable in screenshots

### 3. Response Mapping

Verify field name mapping:
- "Login Required" → "login_required"
- Check for duplicate names
- Verify sanitization process

## Extension Lifecycle

### 1. Service Worker Issues

If background script stops:
1. Check service worker status
2. Look for uncaught errors
3. Restart from chrome://extensions/
4. Check Chrome version compatibility

### 2. Popup State

If popup behaves oddly:
1. Close and reopen popup
2. Check for JavaScript errors
3. Verify DOM elements load
4. Test tab switching

### 3. Content Script

If page detection fails:
1. Check content script injection
2. Verify navigation events
3. Test on different page types
4. Check console for content script errors

## Advanced Debugging

### 1. Custom Logging

Add detailed logging:
```javascript
// Enable verbose logging
localStorage.setItem('websophon-verbose', 'true');
```

### 2. Mock Responses

Test with mock data:
```javascript
// Simulate API response
const mockResponse = {
  fields: {
    test_field: { boolean: true, probability: 0.95 }
  }
};
```

### 3. Error Reproduction

Create minimal test cases:
1. Isolate problematic scenarios
2. Create step-by-step reproduction
3. Test across different domains
4. Verify with fresh extension install

## Getting Help

### 1. Information to Gather

Before reporting issues:
- Chrome version
- Extension version
- Console error logs
- API endpoint being used
- Steps to reproduce

### 2. Debug Information Export

Export debug info:
```javascript
// Get system info
const debugInfo = {
  version: chrome.runtime.getManifest().version,
  userAgent: navigator.userAgent,
  timestamp: new Date().toISOString()
};
console.log('Debug Info:', debugInfo);
```

### 3. Test Environment

Create clean test environment:
1. Fresh Chrome profile
2. Clean extension install
3. Basic field configuration
4. Known working API endpoint

Remember: Most issues are related to API configuration, field criteria specificity, or network connectivity. Start with the basics and work systematically through each component. 