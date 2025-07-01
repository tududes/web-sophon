# WebSophon - Chrome Extension

A quantum-inspired web observer that exists simultaneously across all dimensions of your browsing experience. WebSophon unfolds from a simple extension into an omnipresent monitoring system, capable of perceiving truth at the most fundamental level of web interactions.

Like a subatomic particle that can expand to observe entire systems, WebSophon monitors your web environment with quantum precision, evaluating reality against your defined truths, and triggering cascading events when those truths manifest. It transforms passive observation into active intelligence, bridging the gap between what you see and what you need to know.

## The Observer Effect in Action

WebSophon doesn't just watch—it understands. By defining fields of truth, you create quantum observers that collapse possibilities into certainties. When truth is detected, WebSophon can instantly trigger events across any system, creating a web of intelligent automation that responds to the changing state of your digital reality.

## 🚀 Key Features

### Core Capabilities
- **🤖 AI-Powered Analysis**: Supports any vision-capable LLM (GPT-4V, Claude, Gemini, Qwen, etc.)
- **☁️ Cloud Runner**: Offload captures to remote headless browsers for 24/7 monitoring
- **🔄 Webhooks**: Trigger external actions with confidence-based filtering
- **📊 SAPIENT Protocol**: Structured AI response format for reliable parsing
- **🎯 Smart Field System**: Define unlimited criteria with confidence thresholds
- **⏰ Flexible Scheduling**: From 10 seconds to daily intervals, or manual-only
- **🔐 Secure Authentication**: CAPTCHA-based token system for cloud runner access

### Cloud Runner (v3.0+)
- **Remote Execution**: Run captures on dedicated servers without keeping browser open
- **Token-Based Access**: Secure authentication with 24-hour tokens via CAPTCHA
- **Quota Management**: Track recurring domains (10) and manual captures (2)
- **Job Synchronization**: Automatic sync between local extension and cloud jobs
- **Persistent Monitoring**: Captures continue even when your computer is off
- **Easy Deployment**: Docker-based setup with security hardening scripts
- **Result Caching**: Cloud stores results until extension retrieves them

### Advanced Field & Webhook System
- **Confidence Thresholds**: Set minimum confidence (0-100%) for TRUE results
- **Webhook Triggers**: Fire on TRUE, FALSE, or both conditions
- **Custom Payloads**: Template system with field values and metadata
- **Masked URLs**: Security-conscious display of webhook endpoints
- **Per-Field Configuration**: Each field has independent webhook settings
- **Confidence Filtering**: Low-confidence TRUE results demoted to FALSE
- **Smart Retry Logic**: Automatic retries for failed webhook calls

### SAPIENT Protocol Support
- **Structured Responses**: AI responses in standardized format for reliability
- **Natural Summaries**: Human-readable explanations alongside field results
- **Multi-Model Support**: Works with GPT-4, Claude, Gemini, and others
- **Automatic Detection**: Seamlessly handles both JSON and SAPIENT responses
- **Enhanced Parsing**: Robust handling of truncated or malformed responses

### Capture Configuration
- **Full-Page Screenshots**: Optional capture of entire page vs viewport only
- **Page Refresh**: Optionally refresh before capture with configurable delay
- **Previous Context**: Share previous results with AI for change detection
- **Manual Override**: Test captures before enabling automation
- **Smart Validation**: Prevents invalid configurations before starting

### Job Management & Active Captures
- **Live Status Display**: See all active capture jobs in one place
- **Pause/Resume**: Temporarily pause interval captures without losing config
- **Error Recovery**: Automatic restart options for failed jobs
- **Cloud/Local Indicators**: Visual distinction between capture types
- **One-Click Actions**: Stop, pause, resume, or delete jobs instantly
- **Run Statistics**: Track successful runs and error counts
- **Domain Navigation**: Quick links to monitored domains
- **Manual Sync**: Force sync with cloud runner to update job status

### Preset System
- **Save Configurations**: Store field setups as reusable presets
- **Quick Loading**: Apply saved configurations with one click
- **Domain-Specific**: Presets stored per domain for organization
- **Validation**: Ensures preset integrity before saving
- **Management UI**: Easy preset selection and deletion

### Enhanced UI & Storage
- **📦 Storage Management**: Monitor space usage with cleanup tools
- **🎨 Theme Support**: Light/dark mode with system preference detection
- **📊 Domain Dashboard**: Statistics and management for all configured domains
- **🔍 History Search**: Filter events by TRUE results or other criteria
- **📸 Screenshot Tools**: Zoom, download, and inspect captured images
- **⚡ Real-time Updates**: Live status updates during captures
- **🎯 Smart Defaults**: Suggests free Qwen model for new users

## 📦 Installation

### Extension Installation
1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select this directory
5. The extension icon will appear in your toolbar

### Cloud Runner Setup (Optional)
1. **Deploy Server**: Use `cloud_runner/deploy-secure.sh` on your server
2. **Configure Security**: Set up CAPTCHA keys and authentication
3. **Get Token**: Complete CAPTCHA in extension settings
4. **Start Monitoring**: Cloud captures work even when browser is closed

See [Cloud Runner Documentation](cloud_runner/README.md) for detailed setup.

## 🎯 Quick Start Guide

### Basic Setup (Local Captures)
1. **Configure LLM**: Settings → Enter OpenRouter API key
2. **Define Fields**: Fields tab → Add evaluation criteria
3. **Enable Domain**: Capture tab → Toggle domain consent
4. **Test Capture**: Click "Capture Screenshot Now"
5. **View Results**: Check History tab for results

### Cloud Runner Setup
1. **Set URL**: Settings → Cloud Runner URL (or use default)
2. **Authenticate**: Click "🔐 Authenticate with Cloud Runner"
3. **Complete CAPTCHA**: Token valid for 24 hours
4. **Enable Cloud**: Capture tab → Toggle "☁️ Use Cloud Runner"
5. **Start Capture**: Works even after closing browser

### Webhook Configuration
1. **Enable Webhook**: Toggle webhook for specific field
2. **Set Trigger**: Choose TRUE, FALSE, or both
3. **Enter URL**: Your webhook endpoint
4. **Set Confidence**: Minimum confidence threshold (default 75%)
5. **Custom Payload**: Optional JSON template with variables

## 🏗️ Architecture

### Extension Components
```
tv-eyes/
├── manifest.json                    # Chrome extension v3 manifest
├── background-main.js              # Service worker entry
├── popup.html                      # Main UI
├── popup-main.js                   # Controller + FieldManagerLLM
├── content.js                      # Page monitoring
├── components/
│   ├── HistoryManager.js          # Event history UI
│   └── UIManager.js               # Field rendering
├── services/
│   ├── CaptureService.js          # CDP screenshot capture
│   ├── LLMService.js              # AI integration
│   ├── EventService.js            # Event storage
│   ├── MessageService.js          # IPC + cloud sync
│   ├── WebhookService.js          # Webhook execution
│   └── JobManager.js              # Active job tracking
├── utils/
│   ├── formatters.js              # Display utilities
│   ├── prompt-formatters.js       # AI prompt generation
│   ├── sapient-parser.js          # SAPIENT protocol parser
│   └── webhook-utils.js           # Webhook templating
└── assets/                         # Icons and styles
```

### Cloud Runner Components
```
cloud_runner/
├── server.js                       # Express server with auth
├── Dockerfile                      # Container definition
├── docker-compose.yaml            # Service orchestration
├── deploy-secure.sh               # Security setup script
├── Caddyfile                      # HTTPS reverse proxy
└── utils/                         # Shared utilities
```

### Data Flow

1. **Configuration** → User defines fields with webhooks
2. **Scheduling** → Manual trigger or interval timer
3. **Capture** → Local Chrome or cloud Puppeteer
4. **Analysis** → LLM evaluates against criteria
5. **Filtering** → Confidence thresholds applied
6. **Webhooks** → External actions triggered
7. **Storage** → Results saved with context
8. **Display** → Real-time UI updates

## 🧠 Advanced Features

### Confidence System
```javascript
// Example: Field with 75% confidence threshold
{
  "price_below_100": {
    result: true,      // LLM says TRUE
    confidence: 0.72,  // 72% confident
    filtered: false    // Below 75% threshold → FALSE
  }
}
```

### Webhook Variables
Available in custom payload templates:
- `{{domain}}` - Current domain
- `{{url}}` - Full page URL  
- `{{timestamp}}` - ISO timestamp
- `{{field_name}}` - Triggering field
- `{{field_value}}` - Boolean result
- `{{confidence}}` - Confidence score
- `{{eventId}}` - Unique event ID

### SAPIENT Protocol Example
```
::SAPIENT v:1.0 from:gpt-4 to:websophon trace:eval-123::
The login button is clearly visible in the top right corner
of the page, displayed in blue with white text.

::DATA:response format:json::
{
  "login_button_visible": [true, 0.95],
  "error_message_shown": [false, 0.88]
}
::END:response::
::END:SAPIENT::
```

## 💾 Storage Schema

### Domain-Specific Keys
```javascript
consent_${domain}              // Domain enabled
interval_${domain}             // Capture interval
fields_${domain}               // Field definitions
presets_${domain}              // Saved presets
previousEvaluation_${domain}   // Context data
cloud_job_${domain}            // Cloud job ID
```

### Global Keys
```javascript
llmConfig_global              // LLM settings
cloudRunnerUrl                // Cloud runner URL
websophon_auth_token          // Auth token
websophon_token_expires       // Token expiry
recentEvents                  // Event history
includePremiumModels          // Model filter
theme                         // UI theme
```

## 🤖 API Configuration

### Supported LLM Providers
- **OpenRouter** (recommended) - Access to 100+ models
- **OpenAI** - GPT-4 Vision models
- **Anthropic** - Claude with vision
- **Google** - Gemini models
- **Local** - Ollama, LM Studio, etc.

### Model Selection
- Default suggestion: `qwen/qwen2.5-vl-72b-instruct:free`
- Premium models available with toggle
- Custom model input for unlisted options
- Temperature: 0.1 (low for consistency)
- Max tokens: 5000 (supports detailed analysis)

## 🔧 Troubleshooting

### Common Issues

**"No fields configured"**
- Add at least one field in Fields tab
- Ensure field has name and description

**"Authentication required"**
- Complete CAPTCHA for cloud runner
- Token expires after 24 hours

**"Webhook failed"**
- Check webhook URL is accessible
- Verify payload format is valid JSON
- Review webhook logs in console

**Empty History**
- Wait for background service to initialize
- Check if domain is enabled
- Verify LLM configuration

**Cloud Job Not Syncing**
- Ensure valid authentication token
- Check cloud runner URL is correct
- Verify network connectivity

### Debug Mode
```javascript
// Enable in Chrome console
localStorage.setItem('websophon-debug', 'true');
// Reload extension
```

### Performance Tips
- Use appropriate intervals (avoid < 30s for API limits)
- Enable page refresh only when needed
- Set reasonable confidence thresholds
- Clean up old events periodically
- Monitor storage usage in settings

## 🔒 Security & Privacy

- **Local First**: Data stays in browser unless using cloud runner
- **Token Security**: CAPTCHA-based authentication
- **No Telemetry**: Zero tracking or analytics
- **Webhook Privacy**: URLs masked in UI
- **Secure Storage**: Chrome's encrypted storage
- **User Control**: Complete data ownership

## 📚 Documentation

📁 **[Complete Documentation](docs/)** - Detailed guides:

- **[Setup Guide](docs/SETUP_GUIDE.md)** - Installation and configuration
- **[Cloud Runner Guide](cloud_runner/README.md)** - Remote execution setup
- **[Field Evaluation Guide](docs/FIELD_EVALUATION_GUIDE.md)** - Writing effective criteria
- **[Webhook Guide](docs/WEBHOOK_ARCHITECTURE.md)** - Webhook system details
- **[Security Guide](docs/SECURITY_GUIDE.md)** - Security best practices
- **[Troubleshooting](docs/TROUBLESHOOTING.md)** - Common issues
- **[Architecture](docs/MODULAR_ARCHITECTURE.md)** - Technical details

## 📈 Version History

- **v3.0**: Cloud runner, CAPTCHA auth, job management
- **v2.9**: Webhook system, confidence thresholds, SAPIENT protocol
- **v2.8**: Preset system, storage management, UI improvements
- **v2.7**: Previous evaluation context, organized UI
- **v2.6**: Enhanced controls, cancellation, downloads
- **v2.5**: Long-running requests, real-time updates
- **v2.0**: LLM integration, advanced field system
- **v1.0**: Basic screenshot and webhook support

## 📄 License

MIT License - See LICENSE file for details

---

*WebSophon - Where observation becomes intelligence* 