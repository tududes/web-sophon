# WebSophon - Chrome Extension

A quantum-inspired web observer that exists simultaneously across all dimensions of your browsing experience. WebSophon unfolds from a simple extension into an omnipresent monitoring system, capable of perceiving truth at the most fundamental level of web interactions.

Like a subatomic particle that can expand to observe entire systems, WebSophon monitors your web environment with quantum precision, evaluating reality against your defined truths, and triggering cascading events when those truths manifest. It transforms passive observation into active intelligence, bridging the gap between what you see and what you need to know.

## The Observer Effect in Action

WebSophon doesn't just watch—it understands. By defining fields of truth, you create quantum observers that collapse possibilities into certainties. When truth is detected, WebSophon can instantly trigger events across any system, creating a web of intelligent automation that responds to the changing state of your digital reality.

## Features

### Core Features (v2.0+)
- **LLM-Powered Analysis**: Advanced AI evaluation using OpenAI GPT-4 Vision or compatible models
- **Domain-based Management**: Each domain maintains its own independent field configurations
- **Intelligent Field Evaluation**: Define unlimited custom criteria evaluated with confidence scores
- **Manual & Automated Capture**: On-demand capture with configurable intervals (5 seconds to 10 minutes)
- **Full-Page Screenshots**: Optional full-page capture using Chrome DevTools Protocol (CDP)
- **Page Refresh Control**: Optionally refresh pages before capture with configurable delays

### Advanced Field System (v2.0+)
- **Custom Fields**: Define unlimited evaluation criteria with human-friendly names
- **AI-Powered Analysis**: Each field evaluated to true/false with confidence percentages
- **Visual Results**: Green/red indicators show results with probability scores
- **Real-time Status**: Live pending/success/error states for each field
- **Field History Integration**: Click field results to jump to corresponding events
- **Smart Field Naming**: Automatic sanitization of field names for API compatibility
- **Validation System**: Comprehensive validation prevents duplicate or invalid fields

### Event History & Notifications (v2.2+)
- **Badge Notifications**: Extension icon shows count of unread TRUE events
- **Complete Event Tracking**: ALL capture attempts logged (success, failure, errors)
- **Expandable Event Details**: Click events to see full details including URLs and errors
- **Smart Filtering**: Toggle to show only events with TRUE results
- **Unread Management**: Highlights new TRUE events until viewed in history
- **Time-based Display**: Human-readable timestamps ("5 minutes ago")
- **Persistent Storage**: Events stored locally with automatic cleanup
- **Clear History**: Option to clear all stored events

### Domain Management (v2.3+)
- **Domain-Specific Configuration**: Each domain maintains independent settings and fields
- **Known Domains Dashboard**: View all configured domains with statistics
- **Domain Statistics**: Shows last run time and total event count per domain
- **Quick Domain Access**: Click to open any configured domain in new tab
- **Domain Cleanup**: Delete all settings and history for a domain
- **Current Domain Highlighting**: Visual indication of currently active domain

### Enhanced Debugging (v2.4+)
- **Field Status Tracking**: Each field shows last evaluation result with timestamp
- **History Integration**: Click field results to navigate to corresponding events
- **Screenshot Storage**: Captured screenshots stored with events for review
- **Request/Response Logs**: Full request and response data for debugging
- **Visual Screenshot Tools**: Click to zoom, mouse-following 2x magnification
- **Smart Event Highlighting**: Events highlighted when accessed from field results
- **Debug Mode**: Enable additional testing features and detailed logging

### Long-Running Request Support (v2.5+)
- **Extended Timeouts**: LLM requests can run up to 5 minutes (300 seconds)
- **Pending Status Tracking**: Events show "⏳ Waiting for response..." during processing
- **Real-time Updates**: Events update automatically when responses arrive
- **Concurrent Processing**: Multiple captures can run simultaneously
- **Progressive Loading**: Screenshots visible immediately, responses when ready
- **Resilient Design**: Failed requests properly update with error details

### Enhanced User Control (v2.6+)
- **Request Cancellation**: Cancel pending LLM requests with cancel button
- **Smart Response Display**: JSON responses formatted, raw text for non-JSON
- **Screenshot Downloads**: Download screenshots with timestamped filenames
- **Advanced Image Zoom**: Mouse-following 2x zoom for detailed screenshot inspection
- **Cancelled Request Tracking**: Properly logs cancelled requests in history
- **Improved Error Handling**: Better error messages and status reporting

### Developer Features
- **Clean, Modern UI**: Intuitive tabbed interface for all functionality
- **LLM Integration**: Direct integration with OpenAI or compatible APIs
- **Comprehensive Logging**: Detailed console logs for troubleshooting
- **Modular Architecture**: Clean separation of concerns across services
- **Cross-Extension Sync**: Settings sync across Chrome instances via chrome.storage

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select this directory
5. The extension icon will appear in your toolbar

## Quick Setup

1. **Configure LLM API**: Enter your OpenAI API URL and key in Settings tab
2. **Test Configuration**: Use "Test Configuration" button to verify connection
3. **Define Fields**: Add evaluation criteria in Fields tab with descriptions
4. **Enable Domain**: Toggle "Enable for this domain" in Capture tab
5. **Capture**: Click "Capture Now" to test or enable automatic intervals

## Architecture

### Core Components

**Entry Points:**
- `manifest.json` - Extension configuration (v3)
- `background-main.js` - Service worker initialization
- `popup.html` - Main interface
- `popup-main.js` - Main controller and embedded FieldManagerLLM class
- `content.js` - Page navigation monitoring

**Background Services:**
- `services/CaptureService.js` - Screenshot capture using Chrome DevTools Protocol
- `services/LLMService.js` - LLM API integration and response processing
- `services/EventService.js` - Event tracking and history management
- `services/MessageService.js` - Inter-component communication
- `services/WebhookService.js` - Legacy webhook support (unused in LLM mode)

**UI Components:**
- `components/HistoryManager.js` - Event history display and interaction
- `components/UIManager.js` - UI state management and field rendering
- `utils/formatters.js` - Date formatting, data display utilities

**Assets:**
- `assets/styles.css` - Complete styling (consolidated from inline styles)
- `assets/icon_*.png` - Extension icons (16, 32, 48, 128, 256px)

### Data Flow

1. **Field Definition**: Users define evaluation criteria in Fields tab
2. **Capture Trigger**: Manual capture or automatic intervals
3. **Screenshot Capture**: Full-page or viewport screenshots via CDP
4. **LLM Analysis**: Screenshots and field criteria sent to configured LLM API
5. **Result Processing**: LLM responses parsed and field results updated
6. **Event Storage**: All capture attempts stored in local history
7. **UI Updates**: Real-time status updates across all tabs

## LLM API Configuration

### Supported APIs
- **OpenAI GPT-4 Vision** (recommended)
- **Any OpenAI-compatible API** with vision capabilities
- **Custom deployments** following OpenAI message format

### API Response Format
WebSophon expects responses in this JSON format:
```json
{
  "fields": {
    "field_name_1": {
      "boolean": true,
      "probability": 0.95
    },
    "field_name_2": {
      "boolean": false,
      "probability": 0.23
    }
  },
  "reason": "Optional explanation of what was detected"
}
```

### Field Name Mapping
Field names are automatically sanitized for API compatibility:
- `"Stock Price Alert"` → `"stock_price_alert"`
- `"Login Page Detected"` → `"login_page_detected"`
- Special characters converted to underscores, duplicates prevented

## Usage Guide

### Basic Workflow
1. **Open popup** on the target website
2. **Switch to Fields tab**, add evaluation criteria
3. **Switch to Capture tab**, enable for domain
4. **Configure LLM settings** in Settings tab
5. **Test with manual capture** or enable automatic intervals
6. **View results** in History tab

### Field Definition Best Practices
- **Be specific**: "Red error message visible" vs "There's an error"
- **Use measurable criteria**: "Price below $100" vs "Good deal"
- **Single responsibility**: One concept per field
- **Clear language**: Avoid ambiguous terms

### History Management
- **View all events**: Complete capture history with status indicators
- **Filter by success**: Toggle "Show only TRUE results"
- **Event details**: Click events to expand full information
- **Field navigation**: Click field results to jump to corresponding events
- **Screenshot review**: Click screenshots to zoom and inspect details

## Storage & Privacy

- **Local Storage**: All data stored locally in browser
- **No External Transmission**: Data only sent to your configured LLM API
- **Domain Isolation**: Each domain's settings stored separately
- **Automatic Cleanup**: Old events automatically pruned to prevent storage overflow
- **User Control**: Complete control over data retention and deletion

## Documentation

📁 **[Complete Documentation](docs/)** - Comprehensive guides and technical documentation:

- **[Setup Guide](docs/SETUP_GUIDE.md)** - Installation and configuration
- **[Field Evaluation Guide](docs/FIELD_EVALUATION_GUIDE.md)** - Creating effective evaluation criteria
- **[Interaction Guide](docs/INTERACTION_GUIDE.md)** - UI workflows and best practices
- **[Troubleshooting Guide](docs/TROUBLESHOOTING.md)** - Common issues and solutions
- **[Debug Guide](docs/DEBUG_STEPS.md)** - Developer debugging procedures
- **[Architecture Guide](docs/MODULAR_ARCHITECTURE.md)** - Technical implementation details

## Development

### File Organization
```
tv-eyes/
├── manifest.json                    # Extension configuration
├── background-main.js              # Service worker entry point
├── popup.html                      # Main interface
├── popup-main.js                   # Main controller + FieldManagerLLM
├── content.js                      # Navigation monitoring
├── components/
│   ├── HistoryManager.js          # Event history management
│   └── UIManager.js               # UI state management
├── services/
│   ├── CaptureService.js          # Screenshot capture
│   ├── LLMService.js              # LLM API integration
│   ├── EventService.js            # Event tracking
│   └── MessageService.js          # Communication
├── utils/
│   └── formatters.js              # Utilities
└── assets/
    ├── styles.css                 # Complete styling
    └── icon_*.png                 # Extension icons
```

### Key Classes
- **CleanPopupController** (popup-main.js): Main application controller
- **FieldManagerLLM** (popup-main.js): Field definition and result management  
- **HistoryManager**: Event history display and interaction
- **UIManager**: Field rendering and status display
- **CaptureService**: Screenshot capture via Chrome DevTools Protocol
- **LLMService**: LLM API communication and response processing
- **EventService**: Event storage and retrieval

### Debug Mode
Enable additional debugging features:
```javascript
// In Chrome DevTools console
localStorage.setItem('websophon-debug', 'true');
// Reload extension popup to see debug features
```

## Troubleshooting

### Common Issues
- **"No fields configured"**: Add field definitions in Fields tab
- **"Please configure LLM API"**: Set API URL and key in Settings tab
- **"Request failed"**: Check API credentials and internet connection
- **Empty history**: Ensure background service worker is running
- **Settings not saving**: Check Chrome storage permissions

### Debug Steps
1. **Check console logs**: Open DevTools on extension popup
2. **Verify API**: Use "Test Configuration" button
3. **Enable debug mode**: See debug mode instructions above
4. **Clear storage**: Reset extension state if needed
5. **Check background script**: Inspect service worker in chrome://extensions

### Performance Notes
- **Storage Management**: Automatic cleanup prevents storage overflow
- **Concurrent Requests**: Multiple captures supported simultaneously
- **Memory Efficient**: Screenshots stored compressed in Chrome storage
- **Timeout Handling**: 5-minute maximum for LLM requests

## Version History

- **v2.6+**: Enhanced user controls, request cancellation, screenshot downloads
- **v2.5**: Long-running request support, real-time updates
- **v2.4**: Enhanced debugging, field-history integration
- **v2.3**: Domain management, statistics tracking
- **v2.2**: Event history, notifications, filtering
- **v2.0**: LLM integration, advanced field system
- **v1.0**: Basic screenshot capture and webhook support

## License & Privacy

- **Local Processing**: All data processing occurs locally or via your configured APIs
- **No Telemetry**: No usage data collected or transmitted
- **Open Source**: Full source code available for review
- **User Control**: Complete control over data storage and API usage 