# WebSophon Modular Architecture

## Overview
The WebSophon extension has been refactored from large monolithic files (`popup.js` 1325 lines, `background.js` 615 lines) into a clean modular architecture for better maintainability, testability, and development efficiency.

## Benefits
- **Faster LLM edits** - smaller, focused files process quicker
- **Better separation of concerns** - each module has a single responsibility
- **Easier testing** - components can be tested individually
- **Improved readability** - easier to find and understand specific functionality
- **Reduced merge conflicts** - changes to different features won't conflict

## File Structure

### Core Files
- `manifest.json` - Updated to support ES6 modules
- `popup.html` - Updated to load modular popup script
- `content.js` - Unchanged
- `styles.css` - Unchanged

### Popup Architecture
- **`popup-main.js`** (377 lines) - Main coordination and initialization
- **`components/`** - UI and business logic components
  - `FieldManager.js` (238 lines) - Field CRUD, validation, storage
  - `HistoryManager.js` (354 lines) - Event history, filtering, rendering
  - `UIManager.js` (286 lines) - DOM manipulation, event listeners
  - `DomainManager.js` (89 lines) - Domain-specific settings and operations
- **`utils/`** - Shared utility functions
  - `formatters.js` (89 lines) - Time formatting, response formatting

### Background Architecture
- **`background-main.js`** (19 lines) - Service worker initialization
- **`services/`** - Background processing services
  - `CaptureService.js` (180 lines) - Screenshot capture logic
  - `WebhookService.js` (232 lines) - HTTP requests, response handling
  - `EventService.js` (232 lines) - Event tracking, storage, notifications
  - `MessageService.js` (127 lines) - Chrome runtime message routing

### Backup Files
- `popup-original.js` - Original monolithic popup file
- `background-original.js` - Original monolithic background file

## Module Dependencies

### Popup Dependencies
```
popup-main.js
├── components/FieldManager.js
├── components/HistoryManager.js
│   └── utils/formatters.js
├── components/UIManager.js
│   └── utils/formatters.js
└── components/DomainManager.js
```

### Background Dependencies
```
background-main.js
├── services/CaptureService.js
├── services/WebhookService.js
├── services/EventService.js
└── services/MessageService.js
```

## Key Features Preserved
- All existing functionality remains identical
- Field management and presets
- Event history and tracking
- Domain-specific settings
- Screenshot capture and webhook integration
- Real-time status updates
- Request cancellation
- Progressive loading for long requests

## ES6 Module Support
The extension now uses ES6 modules with:
- `import/export` statements
- `type: "module"` in manifest.json
- Proper module loading in popup.html

## Development Impact
- **Faster edits**: Each file is now 89-377 lines instead of 615-1325 lines
- **Clearer responsibilities**: Each module has a single, well-defined purpose
- **Better testing**: Individual components can be unit tested
- **Easier debugging**: Issues are isolated to specific modules
- **Parallel development**: Multiple developers can work on different modules simultaneously

## Compatibility
- Full backward compatibility with existing data and storage
- All user settings and history preserved
- Identical user interface and functionality
- Same Chrome extension APIs and permissions 

## Core Services

## Shared Utilities

The project uses shared utility functions between the Chrome extension and the cloud runner to maintain DRY principles:

### Utils Directory Structure
- `utils/` - Main shared utilities directory
  - `prompt-formatters.js` - LLM prompt formatting functions (single source of truth)
  - `webhook-utils.js` - Webhook handling utilities
  - `formatters.js` - General formatting utilities
  - `sapient-parser.js` - SAPIENT protocol parser

- `cloud_runner/utils/` - Cloud runner specific utilities
  - `webhook-utils.js` - Cloud-specific version with additional logging
  - `sapient-parser.js` - Cloud-specific parser implementation

### Important Architecture Decision
To avoid code duplication while supporting both local development and Docker deployment:
- The main `utils/prompt-formatters.js` is the single source of truth
- Cloud runner imports use relative paths (`../utils/prompt-formatters.js`)
- The Docker build maintains the directory structure properly with cloud_runner as a subdirectory
- This approach maintains consistency while avoiding duplicate code maintenance

**Note**: The webhook-utils.js files are intentionally different between the extension and cloud runner:
- Extension version (`utils/webhook-utils.js`): Uses direct ES6 export syntax, optimized for browser environment
- Cloud runner version (`cloud_runner/utils/webhook-utils.js`): Includes additional logging for debugging, uses export block at the end for Node.js compatibility

## Component Architecture 