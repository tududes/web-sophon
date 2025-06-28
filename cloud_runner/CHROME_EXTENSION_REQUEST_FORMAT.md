# Chrome Extension Request Format Documentation

## Overview
This document describes the exact request format used by the WebSophon Chrome extension when communicating with the cloud runner, based on captured real-world requests.

## Key Differences from API Documentation

### Authentication
- **Header**: Uses `Authorization: Bearer <token>` (NOT `X-Token`)
- **Format**: `Authorization: Bearer wst_739c06278824b58a63c35675a9f8e22b87f2eebcc35bf0a0871ee5e685f7ce4a`

### Headers
The extension sends these headers:
```
Authorization: Bearer <token>
Accept: */*
Accept-Encoding: gzip, deflate, br, zstd
Accept-Language: en-US,en;q=0.9
Content-Type: application/json
DNT: 1
Origin: chrome-extension://oiikgdchicbkiijccechdniphgffbpbm
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0
```

### Request Body Structure

#### Job Submission (`POST /job`)
```json
{
  "url": "https://www.tradingview.com/chart/mh0DEi5f/",
  "domain": "www.tradingview.com",
  "sessionData": {
    "localStorage": { /* Large object with site data */ },
    "sessionStorage": { /* Session storage data */ },
    "url": "https://www.tradingview.com/chart/mh0DEi5f/",
    "userAgent": "Mozilla/5.0...",
    "viewport": {
      "deviceScaleFactor": 2,
      "height": 776,
      "width": 1488
    },
    "cookies": [ /* Array of cookie objects */ ]
  },
  "llmConfig": {
    "provider": "anthropic",
    "model": "claude-3-5-sonnet-20241022",
    "apiKey": "sk-..."
  },
  "fields": [
    {
      "id": "field_id",
      "name": "Field Name",
      "criteria": "Evaluation criteria",
      "webhookEnabled": true,
      "webhookUrl": "https://discord.com/api/webhooks/...",
      "webhookPayload": "",
      "webhookTrigger": true,
      "webhookMinConfidence": 80
    }
  ],
  "previousEvaluation": null,
  "captureSettings": {
    "refreshPageToggle": false,
    "captureDelay": "0",
    "fullPageCaptureToggle": false
  }
}
```

### Request Flow

1. **Authentication Check**
   ```
   GET /auth/token/stats
   Authorization: Bearer <token>
   ```

2. **Job Submission**
   ```
   POST /job
   Authorization: Bearer <token>
   Body: { ...job data... }
   ```

3. **Status Polling**
   ```
   GET /job/{jobId}
   Authorization: Bearer <token>
   ```

4. **Result Retrieval**
   ```
   GET /job/{jobId}/results
   Authorization: Bearer <token>
   ```

## Test Scripts

### Using Captured Token
```bash
# Test with the captured token
./test-chrome-extension.sh
```

### Key Observations

1. **Large Request Size**: The extension sends ~78KB of data due to including full session data
2. **Discord Webhooks**: The user has Discord webhooks configured for certain fields
3. **Browser Headers**: Includes browser-specific headers like `Origin: chrome-extension://...`
4. **Token Format**: Tokens start with `wst_` prefix

## Testing

To test the cloud runner with Chrome extension format:

1. Use `Authorization: Bearer <token>` header (not X-Token)
2. Include all browser headers for authenticity
3. Provide minimal sessionData if not testing with real page data
4. Include llmConfig with valid API key for LLM analysis
5. Configure fields with webhook settings as needed

## Example Minimal Request

See `test-chrome-extension.sh` for a working example that simulates the Chrome extension's behavior. 