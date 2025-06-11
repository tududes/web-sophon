# WebSophon - Chrome Extension

A quantum-inspired web observer that exists simultaneously across all dimensions of your browsing experience. WebSophon unfolds from a simple extension into an omnipresent monitoring system, capable of perceiving truth at the most fundamental level of web interactions.

Like a subatomic particle that can expand to observe entire systems, WebSophon monitors your web environment with quantum precision, evaluating reality against your defined truths, and triggering cascading events when those truths manifest. It transforms passive observation into active intelligence, bridging the gap between what you see and what you need to know.

## The Observer Effect in Action

WebSophon doesn't just watch—it understands. By defining fields of truth, you create quantum observers that collapse possibilities into certainties. When truth is detected, WebSophon can instantly trigger events across any system, creating a web of intelligent automation that responds to the changing state of your digital reality.

## Features

### Core Features
- **Domain-based consent**: Enable/disable screenshot capture per domain
- **Configurable intervals**: Choose from 5 seconds to 10 minutes
- **Manual capture**: Click button to capture screenshot on-demand
- **Automatic stop on navigation**: Captures stop when you navigate away from the consented domain

### Advanced Field Evaluation (v2.0)
- **Custom Fields**: Define unlimited evaluation criteria with no-spaces field names
- **AI-Powered Analysis**: Each field is evaluated to true/false with confidence scores
- **Visual Results**: Green/red indicators show results with probability percentages
- **Preset Management**: Save and load field configurations as named presets
- **Cross-Device Sync**: Settings and presets sync across Chrome instances
- **Conditional Webhooks**: Each field can trigger its own webhook on TRUE results
- **Custom Payloads**: Define JSON payloads for each field's webhook

### Event History & Notifications (v2.2)
- **Badge Notifications**: Shows count of unread TRUE events on extension icon
- **Complete Event History**: View ALL capture attempts (success, failure, errors)
- **Expandable Event Details**: Click events to see full details including URLs and errors
- **Smart Filtering**: Toggle to show only events with TRUE results
- **Unread Indicators**: Highlights new TRUE events until viewed
- **Time-based Display**: Shows human-readable timestamps ("5 minutes ago")
- **Clear History**: Option to clear all stored events

### Domain Management (v2.3)
- **Domain-Specific Settings**: Each domain maintains its own fields and configuration
- **Known Domains Section**: View all domains with saved configurations
- **Quick Domain Access**: Click to open any configured domain in a new tab
- **Domain Cleanup**: Delete all settings for a domain with one click

### Enhanced Debugging (v2.4)
- **Field Last Results**: Each field shows its last evaluation result with timestamp
- **Click to History**: Click any field's last result to jump to that event in history
- **Screenshot Storage**: Captured screenshots are stored with events for review
- **Request/Response Logs**: Full request and response data available for debugging
- **Visual Zoom**: Click screenshots in history to zoom in for detail
- **Smart Highlighting**: Events are highlighted when accessed from field results

### Long-Running Request Support (v2.5)
- **No Timeouts**: Webhook requests can run for up to 5 minutes (300 seconds)
- **Pending Status**: Events show "⏳ Waiting for response..." while webhook processes
- **Real-time Updates**: Events update automatically when responses arrive
- **Concurrent Requests**: Multiple captures can run simultaneously without blocking
- **Progressive Loading**: See screenshots and request data immediately, response data when ready
- **Resilient Design**: Failed requests properly update pending events with error details

### Enhanced User Control (v2.6)
- **Request Cancellation**: Cancel pending webhook requests mid-flight with cancel button
- **Smart Response Display**: JSON responses formatted properly, raw text shown for non-JSON
- **Screenshot Downloads**: Download any captured screenshot with timestamped filename
- **Advanced Image Zoom**: Mouse-following 2x zoom to explore all areas of screenshots
- **Cancelled Request Tracking**: Cancelled requests properly logged in history with status

### Developer Features
- **Clean, modern UI**: Intuitive interface for field management
- **Webhook integration**: Sends screenshots and fields to n8n workflows
- **Debug logging**: Comprehensive console logs for troubleshooting
- **Flexible Response Handling**: Process complex AI responses

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select this directory
5. The extension icon will appear in your toolbar

## Setup

1. Click the extension icon to open the popup
2. Enter your n8n webhook URL (e.g., `https://your-n8n-instance.com/webhook/abc123`)
3. Select your desired capture interval
4. Toggle the switch to enable capture for the current domain

## Documentation

📁 **[Complete Documentation](docs/)** - All guides, examples, and technical documentation have been organized in the `docs/` directory:

- **[Setup Guide](docs/SETUP_GUIDE.md)** - Complete installation and configuration instructions
- **[Field Evaluation Guide](docs/FIELD_EVALUATION_GUIDE.md)** - Comprehensive guide for creating effective evaluation criteria
- **[Interaction Guide](docs/INTERACTION_GUIDE.md)** - User interface and workflow guide
- **[Troubleshooting Guide](docs/TROUBLESHOOTING.md)** - Common issues and solutions
- **[Debug Steps](docs/DEBUG_STEPS.md)** - Developer debugging procedures
- **[Modular Architecture](docs/MODULAR_ARCHITECTURE.md)** - Technical architecture documentation
- **[N8N Workflow Examples](docs/)** - Sample workflows for integration
- **[Icon Generation](docs/ICON_GENERATION_PROMPT.md)** - Creating extension icons

## Usage

- **Start capturing**: Toggle the switch ON after entering a webhook URL
- **Stop capturing**: Toggle the switch OFF or navigate to a different domain
- **Change interval**: Select a new interval from the dropdown (takes effect immediately if capturing)
- **View status**: Status messages appear at the bottom of the popup

## Webhook Payload

The extension sends a POST request to your webhook with the following multipart/form-data:

```
screenshot: [PNG file] - The captured screenshot
domain: [string] - The domain where the screenshot was taken
timestamp: [ISO 8601 string] - When the screenshot was captured
tabId: [string] - The browser tab ID
url: [string] - The full URL of the page
isManual: [string] - "true" or "false"
fields: [JSON string] - Array of field definitions (v2.0+)
```

### Field Format (v2.0+)
```json
[
  {
    "name": "field_name",
    "criteria": "Description of what to evaluate"
  }
]
```

### Expected Response Format (v2.0+)
```json
{
  "fields": {
    "field_name": {
      "boolean": true,
      "probability": 0.95
    }
  },
  "reason": "Explanation of what was detected"
}
```

## n8n Workflow Setup

### Basic Setup (v1.0)
1. Create a new workflow in n8n
2. Add a **Webhook** node:
   - Set to POST method
   - Copy the webhook URL to the extension
3. The webhook will receive the screenshot and metadata
4. Process as needed (image analysis, LLM integration, etc.)

### Field Evaluation Setup (v2.0)
1. Import `n8n-workflow-fields.json` for field evaluation
2. Configure your OpenAI API credentials
3. The workflow will:
   - Receive screenshot and field definitions
   - Use GPT-4 Vision to evaluate each field
   - Return results in the expected JSON format
4. See [Field Evaluation Guide](docs/FIELD_EVALUATION_GUIDE.md) for detailed instructions

## Icon Generation

To generate the required PNG icons, you'll need to create or obtain 16x16, 48x48, and 128x128 pixel PNG images. Name them:
- `icon-16.png`
- `icon-48.png`
- `icon-128.png`

You can use any image editor or online tool to create these icons.

## Privacy & Security

- Screenshots are only captured for domains you explicitly consent to
- All data is sent directly to your specified webhook URL
- No data is stored or transmitted elsewhere
- Settings are stored locally in your browser

## Troubleshooting

- **"Please enter a webhook URL first"**: Make sure to enter a valid webhook URL before enabling capture
- **Screenshots not sending**: Check the browser console for errors and verify your webhook URL is accessible
- **Capture stops unexpectedly**: This happens when navigating to a different domain or closing the tab
- **No events showing in history**: 
  - All capture attempts are now logged (success or failure)
  - Check that you have fields configured for the domain
  - Use the test page `test-events.html` to verify event logging
  - Open Chrome DevTools and check the console for error messages
  - Enable debug mode: `localStorage.setItem('websophon-debug', 'true')` in console, then reload extension
- **Settings appear on wrong domain**: Settings are now domain-specific, check the "Known Domains" section
- **Debugging failed captures**:
  - Click on any event in history to see full details
  - View the stored screenshot to verify what was captured
  - Download screenshots with the 💾 Download button
  - Hover over screenshots to zoom in with mouse-following 2x magnification
  - Check Request Data to see what was sent to the webhook
  - Check Response Data - properly formatted JSON or raw text for failed responses
  - Each field shows its last result - click to jump to that event
  - Cancel long-running requests with the Cancel Request button
- **Storage quota exceeded**: The extension automatically removes old screenshots if storage is full
- **History not clearing permanently**: Fixed - now clears both memory and storage
- **Responses not updating events**: Fixed - events now update in real-time when webhook responses arrive

### Debug Mode
To enable debug mode and access additional testing features:
1. Open Chrome DevTools (F12) on any page
2. Go to Console tab
3. Type: `localStorage.setItem('websophon-debug', 'true')`
4. Reload the WebSophon extension popup
5. You'll see a "🧪 Test Events" button in the Event History section
6. This creates sample events with different statuses for testing the interface

### Debug Storage Inspector
For advanced debugging of storage issues, load the debug script:
1. Copy the contents of `debug-storage.js`
2. Paste into Chrome DevTools console
3. Use the available functions:
   - `inspectWebSophonStorage()` - View all stored data
   - `clearWebSophonStorage()` - Clear all data (use carefully!)
   - `enableDebugMode()` / `disableDebugMode()` - Toggle debug features

## Development

The extension consists of:
- `manifest.json` - Extension configuration (v2.1)
- `popup.html/js/css` - Enhanced UI with field management
- `background.js` - Service worker handling captures and responses
- `content.js` - Page navigation monitoring
- `n8n-workflow-fields.json` - Field evaluation workflow template
- `FIELD_EVALUATION_GUIDE.md` - Comprehensive field usage guide

### Key Classes (v2.1)
- `FieldManager` - Handles field definitions, presets, and results
- Storage uses `chrome.storage.sync` for cross-device synchronization

To modify the extension, edit these files and reload the extension in Chrome.

## Future Features (TODO)

### Premium Features
- **Background Monitoring**: Premium users will be able to:
  - Toggle an option to create background jobs that run independently
  - Include or exclude cookies from their current session
  - Monitor public-facing sites without authentication
  - Set frequencies as low as 5 seconds for both live checks and background jobs
  - Receive continuous monitoring results from the AI agent deployed in the background
  - Flag in requests to distinguish between live and background captures 