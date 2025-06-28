# WebSophon Webhook Architecture

## Overview

WebSophon has a consolidated webhook firing system that ensures webhooks are fired consistently whether running locally in the Chrome extension or remotely on the cloud runner. This document explains the architecture and implementation.

## Shared Webhook Utility

The webhook functionality is implemented in a shared utility module that exists in both environments:

- **Extension**: `/utils/webhook-utils.js`
- **Cloud Runner**: `/cloud_runner/utils/webhook-utils.js`

Both files contain identical functionality but use different module systems (ES6 for extension, ES6 for cloud runner).

## Key Functions

### `fireFieldWebhook(fieldName, webhookUrl, customPayload, fieldResult, context)`

Fires a single webhook for a field result. Features:
- Supports both GET and POST requests
- Automatic Discord webhook detection and formatting
- Custom JSON payload support
- 30-second timeout protection

### `fireFieldWebhooks(jobId, domain, responseData, fields)`

Processes multiple field configurations and fires webhooks based on:
- Field evaluation results (true/false)
- Webhook trigger settings (fire on TRUE or FALSE)
- Minimum confidence thresholds
- Webhook enabled status

### `testDiscordWebhook(webhookUrl, testMessage)`

Utility function to test Discord webhook connectivity with a formatted test message.

## Discord Integration

When a Discord webhook URL is detected (contains `discord.com/api/webhooks`), the system automatically formats the payload with:

- Rich embeds with color coding (green for TRUE, red for FALSE)
- Field result and confidence display
- Domain and timestamp information
- Proper Discord username and avatar

## Usage Locations

### Local Extension
- **LLMService.js**: Fires webhooks after LLM analysis
- **WebhookService.js**: Fires webhooks after webhook-only captures

### Cloud Runner
- **server.js**: Fires webhooks server-side after LLM analysis

## Data Flow

1. **Configuration**: Field webhook settings are stored with each field:
   - `webhookEnabled`: Whether to fire webhooks for this field
   - `webhookUrl`: The webhook endpoint
   - `webhookPayload`: Optional custom JSON payload
   - `webhookTrigger`: Fire on TRUE (default) or FALSE
   - `webhookMinConfidence`: Minimum confidence threshold (default 75%)

2. **Evaluation**: After LLM analysis, results are in format:
   ```javascript
   {
     evaluation: {
       "field_name": [boolean_result, confidence_probability]
     }
   }
   ```

3. **Webhook Firing**: The shared utility:
   - Checks if webhook should fire based on result and trigger settings
   - Validates confidence threshold
   - Formats payload (Discord-specific or custom)
   - Fires webhook with timeout protection
   - Returns detailed result for history tracking

4. **History Tracking**: Webhook results are stored in event history:
   - Request details (URL, method, payload)
   - Response details (status, body)
   - Success/failure status
   - Error messages if any

## Testing

Use the test script to verify webhook functionality:

```bash
node tools/test-webhook.js
```

This tests:
- Basic Discord connectivity
- Field webhooks with TRUE/FALSE results
- Custom payload formatting

## Example Discord Webhook URL

```
https://discord.com/api/webhooks/1234567890/abcdefghijklmnop
```

The webhook utility automatically detects this format and sends properly formatted Discord messages. 