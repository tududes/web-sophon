# WebSophon - Field Evaluation Guide

## Overview

WebSophon provides advanced field-based screenshot evaluation. You can define custom fields with specific criteria, and the extension will evaluate each field against the screenshot using AI, returning true/false results with confidence scores.

## Key Features

### 1. **Field Management** (v2.1)
- **Friendly Names**: Enter any name - automatically converted to safe field names
- **Field Description**: Detailed criteria for evaluation (properly escaped)
- **Dynamic Results**: Green/red indicators with probability scores
- **Unlimited Fields**: Add as many evaluation fields as needed
- **Backend Names**: Shows sanitized field name (lowercase + underscores)

### 2. **Preset System**
- **Save Presets**: Store field configurations for reuse
- **Load Presets**: Quickly switch between different evaluation sets
- **Sync Across Devices**: Presets sync with your Chrome account

### 3. **Conditional Webhooks** (v2.1)
- **Per-Field Actions**: Each field can trigger its own webhook
- **TRUE-only Triggers**: Webhooks fire only when field evaluates to true
- **Custom Payloads**: Define JSON payloads for each webhook
- **URL Security**: Webhook URLs are masked by default (show/hide toggle)
- **Persistent Storage**: Webhook settings saved even when disabled
- **Sequential Firing**: Multiple webhooks fire in sequence with minimal delay
- **Logging**: Last 50 webhook calls logged with status, duration, and errors

### 4. **Event History & Notifications** (v2.2)
- **Badge Counter**: Extension icon shows count of unread TRUE events
- **History View**: Access last 100 capture events directly in the popup
- **Smart Filtering**: Toggle to show only events containing TRUE results
- **Visual Indicators**: Unread TRUE events highlighted in green
- **Time Display**: Human-readable timestamps ("2 hours ago")
- **Quick Clear**: Clear all history with one click
- **Automatic Updates**: History refreshes when new captures complete

## How to Use

### Step 1: Configure Capture Interval

Choose from expanded interval options:
- 10 seconds to 1 minute for rapid monitoring
- 5 minutes to 1 hour for regular checks
- 4 hours to 1 day for long-term monitoring

### Step 2: Define Fields

1. Click "➕ Add Field"
2. Enter a friendly name (e.g., "Login Form Present")
3. Backend name auto-converts to: `login_form_present`
4. Write evaluation criteria:
   ```
   Check if the page contains a login form with username 
   and password fields visible
   ```

### Step 3: Configure Webhooks (Optional)

1. Toggle "Fire webhook on TRUE result"
2. Enter webhook URL (automatically masked for security)
3. Click 👁️ to show/hide the full URL
4. Define JSON payload:
   ```json
   {
     "alert": "login_detected",
     "timestamp": "{{timestamp}}",
     "url": "{{url}}"
   }
   ```
5. View logs with 📋 button to see webhook history

### Step 4: Save as Preset

1. Configure all needed fields
2. Click "💾 Save as Preset"
3. Name your preset (e.g., "Login Detection")

### Step 5: Capture & Evaluate

1. Click "📸 Capture Screenshot Now"
2. Results appear next to each field:
   - 🟢 TRUE (95.5%)
   - 🔴 FALSE (98.2%)
3. TRUE results trigger webhooks sequentially
4. Check Event History section for all captures
5. Extension badge shows count of new TRUE events

## Example Field Configurations

### E-commerce Monitoring
```
Field: checkout_button_visible
Criteria: Is there a visible checkout or "buy now" button on the page?

Field: price_change_detected  
Criteria: Has the price displayed changed from the last known value of $99.99?

Field: out_of_stock
Criteria: Does the page show "out of stock" or "unavailable" message?
```

### Security Monitoring
```
Field: login_form_present
Criteria: Is there a login form with username and password fields?

Field: captcha_required
Criteria: Is there a CAPTCHA challenge visible on the page?

Field: security_warning
Criteria: Are there any security warnings or certificate errors displayed?
```

### Content Monitoring
```
Field: video_playing
Criteria: Is there a video element currently playing on the page?

Field: popup_displayed
Criteria: Is there a modal popup or overlay covering the main content?

Field: ad_banner_present
Criteria: Are there advertising banners visible on the page?
```

## n8n Integration

### Expected Request Format
The extension sends:
```json
{
  "screenshot": "[binary data]",
  "domain": "example.com",
  "timestamp": "2024-01-01T12:00:00Z",
  "url": "https://example.com/page",
  "fields": [
    {
      "name": "field_name",
      "criteria": "evaluation criteria"
    }
  ]
}
```

### Expected Response Format
Your n8n workflow should return:
```json
{
  "fields": {
    "field_name": {
      "boolean": true,
      "probability": 0.95
    }
  },
  "reason": "Brief explanation of what was detected"
}
```

### Using the Provided Workflow

1. Import `n8n-workflow-fields.json`
2. Configure your OpenAI API key
3. Activate the workflow
4. Use the webhook URL in the extension

## Best Practices

### Field Naming
- Use descriptive names: `form_submitted` not `field1`
- Use underscores: `user_logged_in` not `user-logged-in`
- Be consistent: `is_loading`, `is_error`, `is_success`

### Criteria Writing
- Be specific and unambiguous
- Reference visual elements clearly
- Include context when needed
- Avoid subjective criteria

### Webhook Configuration
- Use HTTPS endpoints
- Include authentication tokens in payload
- Test webhooks independently first
- Handle failures gracefully

## Troubleshooting

### Fields Not Evaluating
- Check field has a name AND description
- Ensure n8n workflow is active
- Verify webhook URL is correct
- Check browser console for errors

### Webhooks Not Firing
- Confirm field evaluated to TRUE
- Check webhook URL is valid
- Verify JSON payload is valid
- Test webhook endpoint separately

### Results Not Displaying
- Wait for response (may take 2-5 seconds)
- Check n8n workflow logs
- Ensure response format matches expected structure
- Verify OpenAI API is working

## Advanced Usage

### Dynamic Criteria
You can reference previous values in criteria:
```
Has the stock price changed from the last known value of $150.25?
```

### Multi-Condition Fields
```
Field: ready_to_purchase
Criteria: Is the item in stock AND is the price below $50 AND is there an "Add to Cart" button visible?
```

### Time-Based Monitoring
```
Field: content_updated
Criteria: Has the "Last Updated" timestamp on the page changed in the last hour?
```

## Privacy & Security

- Fields and presets are stored locally and in Chrome sync
- Webhook URLs and payloads are encrypted at rest
- Screenshots are only sent to your configured endpoints
- No data is stored on external servers 