# Troubleshooting Guide

## LLM API Connection Issues

If your LLM requests are failing, follow these steps:

### 1. Verify API Configuration
- Open Settings tab in extension popup
- Ensure API URL and API Key are correctly entered
- Use "Test Configuration" button to verify connection
- Check console logs (F12) for detailed error messages

### 2. Check API URL Format
Your API URL should be properly formatted:
- ✅ `https://api.openai.com/v1/chat/completions`
- ✅ `https://your-api-gateway.com/v1/chat/completions`
- ❌ `api.openai.com/v1/chat/completions` (missing protocol)
- ❌ `https://api.openai.com` (incomplete endpoint)

### 3. API Key Validation
- Ensure your API key has proper permissions
- Check if the key has been deactivated or expired
- Verify billing/quota limits haven't been exceeded
- Test the key with a simple curl request

### 4. Network and CORS Issues
- Extension requests go directly to your API endpoint
- No CORS configuration needed for WebSophon
- Check if corporate firewall is blocking API requests
- Verify the API endpoint is accessible from your browser

### 5. Check Extension Permissions
Make sure the extension has proper permissions:
- Host permissions for your API domain
- Active tab permission for screenshots
- Storage permission for saving settings

## Common Error Messages

### "Request failed: Network error"
- Check internet connection
- Verify API endpoint is accessible
- Check if endpoint requires authentication headers

### "API returned 401 Unauthorized"
- Invalid or expired API key
- Check API key configuration in Settings tab
- Verify the key has proper permissions

### "API returned 429 Too Many Requests"
- Rate limit exceeded
- Wait before retrying
- Check your API plan limits

### "Request timeout after 300 seconds"
- LLM processing took too long
- Try with fewer or simpler field criteria
- Check if API endpoint is overloaded

### "Invalid JSON response"
- API returned malformed response
- Check API endpoint compatibility
- Enable debug mode to see full response

## Screenshot Issues

### Screenshots Not Capturing
1. **Check domain consent**: Toggle "Enable for this domain" in Capture tab
2. **Page restrictions**: Some pages block screenshot APIs (chrome://, about:, etc.)
3. **Permission issues**: Extension needs activeTab permission
4. **Browser compatibility**: Requires Chrome Manifest V3 support

### Screenshots Empty or Black
1. **Full-page capture**: Try toggling full-page capture option
2. **Page not loaded**: Add capture delay in settings
3. **Dynamic content**: Try refreshing page before capture
4. **CSS issues**: Some pages hide content during capture

## Field Evaluation Issues

### Fields Always Return False
1. **Field criteria**: Make descriptions more specific and measurable
2. **Image quality**: Check if screenshots capture relevant content
3. **API model**: Ensure using vision-capable model (e.g., gpt-4-vision-preview)
4. **Token limits**: Check if responses are being truncated

### Fields Not Updating
1. **Check event history**: View History tab to see capture attempts
2. **API errors**: Look for error messages in field status
3. **Response format**: Verify API returns expected JSON structure
4. **Field naming**: Check for duplicate or invalid field names

## Performance Issues

### Slow Response Times
1. **Model selection**: Some models are faster than others
2. **Image size**: Large screenshots take longer to process
3. **Field count**: Too many fields increase processing time
4. **API load**: Check if your API endpoint is overloaded

### High Memory Usage
1. **Screenshot cleanup**: Extension automatically removes old images
2. **History size**: Clear history if it becomes too large
3. **Storage quota**: Check Chrome storage usage

## Debug Mode

Enable debug mode for detailed troubleshooting:

```javascript
// In Chrome DevTools console
localStorage.setItem('websophon-debug', 'true');
// Reload extension popup to see debug features
```

Debug mode provides:
- Detailed console logging
- Test event generation
- Enhanced error messages
- Performance metrics

## Storage Issues

### Settings Not Saving
1. **Chrome storage**: Check if storage permission is granted
2. **Storage quota**: Clear old data if storage is full
3. **Sync conflicts**: Settings sync across Chrome instances

### History Not Loading
1. **Background service**: Check if service worker is running
2. **Storage corruption**: Clear extension storage and reconfigure
3. **Race condition**: Refresh popup if history appears empty

## Getting Help

If issues persist:

1. **Check console logs**: Open DevTools (F12) on extension popup
2. **Enable debug mode**: See debug instructions above
3. **Test with simple fields**: Start with basic, clear criteria
4. **Verify API independently**: Test your API with curl or Postman
5. **Extension reload**: Disable and re-enable the extension
6. **Browser restart**: Sometimes Chrome service workers need restart

## Common Solutions Summary

| Issue | Quick Fix |
|-------|-----------|
| No API response | Check API key and URL |
| Fields always false | Make criteria more specific |
| Empty history | Refresh popup or check background service |
| Screenshots black | Enable full-page capture |
| Slow responses | Reduce field count or try different model |
| Settings not saving | Check Chrome storage permissions |

Remember: WebSophon uses direct LLM API integration - no external services or webhooks required!

## Extension Issues

### Popup Not Opening
- Check if the extension icon is visible in the toolbar
- Try reloading the extension from chrome://extensions/
- Check browser console for errors

### Settings Not Saving
- Ensure you have proper permissions
- Check if browser is in incognito mode
- Try clearing extension storage and reconfiguring

## URL Preservation in Cloud Runner

### Issue: URLs Changing Between Interval Captures
Some websites (like TradingView) may change the URL during a session (e.g., chart IDs changing from `/chart/mh0DEi5f/` to `/chart/op5q2lIL/`). This can cause issues with interval captures if not handled properly.

### Solution: Automatic URL Preservation
The cloud runner automatically preserves the original URL that was submitted when creating a job. When the extension updates session data (cookies, localStorage, etc.), the original URL is maintained.

## Context Preservation in Interval Jobs

### Issue: Previous Evaluation Context Lost Between Runs
Interval jobs need to maintain context from previous captures to track state changes (e.g., position states, entry/exit signals). If results are purged after each sync, the cloud runner loses this context.

### Solution: Smart Result Management
The extension now intelligently manages cloud runner results with a "smart purge" approach:

**For Interval Jobs:**
- Keeps the **last result** on the cloud runner for context
- Purges older results that have already been synced to save memory
- Ensures the next capture always has access to the previous evaluation

**For One-time Jobs:**
- Purges all results after sync to maximize memory efficiency
- No context needed since these jobs don't recur

**Benefits:**
- Minimal memory usage on the cloud runner
- Context is always available for state tracking
- All historical results are preserved in the extension

This ensures that interval jobs can properly track state transitions like:
- Position states (long_position_state, short_position_state)
- Entry/exit conditions that depend on previous state
- Any field that requires knowledge of previous evaluations

### Debugging Context Issues
If you suspect context is not being passed correctly:
1. Check cloud runner logs for "previousEvaluation" messages
2. Look for "Smart purge: removed X old results, kept last 1" in extension logs
3. Verify the purge endpoint is being called with `keepLast: 1` for interval jobs
4. Check that interval jobs show "Job has 1 previous results" before each capture

**Logs indicating URL preservation:**
```
[jobId] Updating session data for domain www.tradingview.com, preserving original URL: https://www.tradingview.com/chart/mh0DEi5f/
[jobId] Note: Incoming session data had different URL (https://www.tradingview.com/chart/op5q2lIL/), but keeping original URL (https://www.tradingview.com/chart/mh0DEi5f/)
```

This ensures that interval captures always use the same page, even if the browser tab navigates to a different URL variant. 