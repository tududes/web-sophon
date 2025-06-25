# WebSophon Setup Guide

## Quick Start

1. **Install Extension**:
   - Load unpacked extension in Chrome
   - Enable developer mode first

2. **Configure LLM API**:
   - Open extension popup
   - Go to Settings tab
   - Enter your LLM API URL and key
   - Test the configuration

3. **Define Fields**:
   - Go to Fields tab
   - Add evaluation criteria
   - Be specific and measurable

4. **Enable Capture**:
   - Go to Capture tab
   - Toggle "Enable for this domain"
   - Set capture interval or use manual

5. **View Results**:
   - Check History tab for events
   - Click events to see details

## Detailed Configuration

### LLM API Setup

#### OpenAI (Recommended)
```
API URL: https://api.openai.com/v1/chat/completions
API Key: sk-your-openai-api-key-here
Model: gpt-4-vision-preview (or gpt-4o)
```

#### Custom API Endpoints
Any OpenAI-compatible API can be used:
```
API URL: https://your-api-gateway.com/v1/chat/completions
API Key: your-custom-api-key
Model: your-model-name
```

#### Configuration Testing
1. Enter your API details in Settings tab
2. Click "Test Configuration" button
3. Check for success/error messages
4. View console logs for detailed diagnostics

### Field Definition

#### Best Practices
- **Be specific**: "Red error message visible" not "There's an error"
- **Measurable criteria**: "Price below $100" not "Good deal"
- **Single responsibility**: One concept per field
- **Clear language**: Avoid ambiguous terms

#### Example Fields
```
Field: "Login Required"
Criteria: "A login form or login button is visible on the page"

Field: "Price Alert"
Criteria: "The price is displayed and is less than $50"

Field: "Error State"
Criteria: "An error message or warning is displayed in red text"
```

### Domain Management

#### Domain-Specific Settings
- Each domain maintains its own field configuration
- Settings don't transfer between domains
- Use "Known Domains" section to manage multiple sites

#### Current Domain vs Others
- Extension always shows current domain in popup
- Configure fields for the site you're currently viewing
- Switch between domains using Known Domains section

### Capture Options

#### Manual vs Automatic
- **Manual**: Click "Capture Now" button when needed
- **Automatic**: Set interval (5 seconds to 10 minutes)
- **Page Refresh**: Optionally refresh page before capture
- **Capture Delay**: Wait time after refresh before screenshot

#### Screenshot Options
- **Viewport**: Capture visible area only
- **Full Page**: Capture entire page (slower but more complete)
- **Quality**: Automatically optimized for LLM processing

### Storage and Privacy

#### Local Storage
- All data stored locally in Chrome
- Settings sync across Chrome instances
- No external data transmission except to your LLM API

#### Data Management
- Events automatically cleaned up to prevent storage overflow
- Manual history clearing available
- Screenshots compressed for efficient storage

## Integration Patterns

### Workflow Example
```
1. User defines "Cart Total" field
2. Extension captures page screenshot
3. LLM analyzes image for cart total
4. Result stored in event history
5. User reviews results in History tab
```

### API Response Format
Your LLM API should return JSON like this:
```json
{
  "fields": {
    "cart_total": {
      "boolean": true,
      "probability": 0.95
    },
    "login_required": {
      "boolean": false,
      "probability": 0.12
    }
  },
  "reason": "Cart total of $45.99 is visible in the top right corner"
}
```

## Advanced Configuration

### Performance Tuning
- **Model Selection**: Faster models for simple criteria
- **Field Count**: Fewer fields = faster processing
- **Image Size**: Full page vs viewport affects speed
- **Parallel Processing**: Multiple captures supported

### Debug Mode
Enable for detailed troubleshooting:
```javascript
localStorage.setItem('websophon-debug', 'true');
```

### Bulk Field Management
- Save field sets as presets
- Load presets across different sessions
- Export/import configurations (manual copy)

## Common Use Cases

### E-commerce Monitoring
```
Fields:
- "Price Drop": "The price is lower than usual or marked as on sale"
- "Stock Available": "The item shows as in stock or available"
- "Free Shipping": "Free shipping is offered for this item"
```

### Website Health Monitoring
```
Fields:
- "Page Load Error": "A 404, 500, or other error page is displayed"
- "Login Issues": "Login failed or authentication error message visible"
- "Slow Performance": "Loading spinners or 'please wait' messages visible"
```

### Content Monitoring
```
Fields:
- "New Article": "A new blog post or article published today"
- "Comment Activity": "New comments or replies visible"
- "Update Available": "Software update or new version notice"
```

## Security Considerations

### API Key Protection
- Store API keys securely in Chrome storage
- Never share API keys or include in screenshots
- Regularly rotate API keys
- Monitor API usage for unusual activity

### Permission Management
- Extension only accesses current tab when activated
- No background monitoring without user consent
- All screenshots processed by your chosen LLM API
- No data transmitted to third parties

## Troubleshooting

### Common Issues
- **API Errors**: Check key validity and URL format
- **Empty Results**: Verify field criteria specificity
- **Storage Issues**: Clear history if quota exceeded
- **Permission Errors**: Reload extension if needed

### Getting Help
1. Enable debug mode for detailed logs
2. Test API configuration independently
3. Start with simple, clear field criteria
4. Check browser console for error messages

For detailed troubleshooting, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md). 