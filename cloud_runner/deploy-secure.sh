#!/bin/bash

# WebSophon Cloud Runner Secure Deployment Script
# This script helps deploy the hardened cloud runner with proper security configuration

set -e

echo "🔐 WebSophon Cloud Runner Secure Deployment"
echo "============================================="

# Check dependencies
echo "Checking dependencies..."

if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ and try again."
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm and try again."
    exit 1
fi

if ! command -v openssl &> /dev/null; then
    echo "❌ OpenSSL is not installed. Please install OpenSSL and try again."
    exit 1
fi

echo "✅ All dependencies found"

# Generate security credentials
echo ""
echo "🔑 Generating Security Credentials..."

MASTER_KEY="ws_master_$(openssl rand -hex 32)"
SIGNING_SECRET="$(openssl rand -hex 64)"

echo "✅ Master Key generated: ${MASTER_KEY:0:16}..."
echo "✅ Signing Secret generated: ${SIGNING_SECRET:0:16}..."

# Get SSL/ACME email for Caddy
echo ""
echo "🔐 SSL Certificate Configuration"
echo "================================"
echo "Caddy will automatically obtain SSL certificates from Let's Encrypt."
echo "This requires a valid email address for ACME registration."
echo ""

read -p "Enter your email for SSL certificates (ACME): " ACME_EMAIL

if [ -z "$ACME_EMAIL" ]; then
    echo "⚠️  No email provided. Using default (you should change this!)"
    ACME_EMAIL="admin@example.com"
fi

# Validate email format (basic)
if [[ ! "$ACME_EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
    echo "⚠️  Email format looks invalid, but continuing..."
fi

echo "✅ ACME email set: $ACME_EMAIL"

# Get CAPTCHA credentials
echo ""
echo "🔐 CAPTCHA Configuration"
echo "========================"
echo "This system uses hCaptcha for human verification and token generation."
echo "You need to register at https://www.hcaptcha.com/ to get:"
echo "  1. Site Key (for frontend)"
echo "  2. Secret Key (for backend verification)"
echo ""

read -p "Enter your hCaptcha Site Key: " CAPTCHA_SITE_KEY
read -p "Enter your hCaptcha Secret Key: " CAPTCHA_SECRET_KEY

if [ -z "$CAPTCHA_SITE_KEY" ] || [ -z "$CAPTCHA_SECRET_KEY" ]; then
    echo "⚠️  No CAPTCHA keys provided. Using development defaults."
    CAPTCHA_SITE_KEY="dev_captcha_site_key"
    CAPTCHA_SECRET_KEY="dev_captcha_secret"
fi

# Create environment file
echo ""
echo "📝 Creating Environment Configuration..."

cat > .env << EOF
# WebSophon Cloud Runner Security Configuration
# Generated on $(date)

# Required: SSL/ACME Configuration for Caddy
ACME_EMAIL=${ACME_EMAIL}

# Required: CAPTCHA-based Authentication
WEBSOPHON_MASTER_KEY=${MASTER_KEY}
WEBSOPHON_SIGNING_SECRET=${SIGNING_SECRET}

# Required: CAPTCHA Configuration (hCaptcha)
CAPTCHA_SITE_KEY=${CAPTCHA_SITE_KEY}
CAPTCHA_SECRET_KEY=${CAPTCHA_SECRET_KEY}

# Optional: IP Whitelisting (comma-separated IPs, leave empty to allow all)
# ALLOWED_IPs=192.168.1.100,10.0.0.50

# Optional: Usage Quotas
# MAX_CONCURRENT_DOMAINS=10
# MAX_CONCURRENT_MANUAL=2
# MAX_REQUESTS_PER_MINUTE=60

# Optional: Job Limits
# MAX_TOTAL_JOBS=500
# MAX_RESULTS_PER_JOB=1000

# Server Configuration
PORT=7113
NODE_ENV=production
EOF

echo "✅ Environment file created: .env"

# Create extension configuration info
echo ""
echo "🔧 Extension Configuration Info..."

cat > extension-info.txt << EOF
WebSophon Extension Setup Information
====================================

✅ NO MANUAL CONFIGURATION REQUIRED!

The WebSophon extension now automatically handles authentication 
through the cloud runner's web interface. Users simply:

1. Open WebSophon extension → Settings tab
2. Set Cloud Runner URL to: https://your-domain.com
3. Click "🔐 Authenticate with Cloud Runner"
4. Complete CAPTCHA on the opened page
5. Authentication token is automatically saved

Server Details:
- Master Key: ${MASTER_KEY}
- hCaptcha Site Key: ${CAPTCHA_SITE_KEY}
- Token Validity: 24 hours
- Quotas: 10 recurring domains, 2 manual captures per token

The extension automatically retrieves tokens from the authentication
page without requiring any manual key configuration.
EOF

echo "✅ Extension info created: extension-info.txt"

# Install dependencies
echo ""
echo "📦 Installing Dependencies..."
npm install

echo "✅ Dependencies installed"

# Create systemd service file (if on Linux)
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo ""
    echo "🔧 Creating Systemd Service..."
    
    CURRENT_DIR=$(pwd)
    USER=$(whoami)
    
    cat > websophon-runner.service << EOF
[Unit]
Description=WebSophon Cloud Runner
After=network.target

[Service]
Type=simple
User=${USER}
WorkingDirectory=${CURRENT_DIR}
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=websophon-runner
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

    echo "✅ Systemd service file created: websophon-runner.service"
    echo ""
    echo "To install the service, run:"
    echo "  sudo cp websophon-runner.service /etc/systemd/system/"
    echo "  sudo systemctl daemon-reload"
    echo "  sudo systemctl enable websophon-runner"
    echo "  sudo systemctl start websophon-runner"
fi

# Create Docker Compose override for security
echo ""
echo "🐳 Creating Docker Security Configuration..."

cat > docker-compose.override.yml << EOF
version: '3.8'
services:
  websophon-runner:
    environment:
      - WEBSOPHON_MASTER_KEY=${MASTER_KEY}
      - WEBSOPHON_SIGNING_SECRET=${SIGNING_SECRET}
      - CAPTCHA_SITE_KEY=${CAPTCHA_SITE_KEY}
      - CAPTCHA_SECRET_KEY=${CAPTCHA_SECRET_KEY}
      - NODE_ENV=production
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:7113/"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
EOF

echo "✅ Docker override created: docker-compose.override.yml"

# Create startup script
echo ""
echo "🚀 Creating Startup Scripts..."

cat > start-secure.sh << 'EOF'
#!/bin/bash
echo "🔐 Starting WebSophon Cloud Runner (Secure Mode)"
echo "================================================"

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | xargs)
    echo "✅ Environment loaded"
else
    echo "❌ .env file not found. Run deploy-secure.sh first."
    exit 1
fi

# Verify security configuration
if [ -z "$WEBSOPHON_API_KEY" ] || [ -z "$WEBSOPHON_SIGNING_SECRET" ]; then
    echo "❌ Security credentials not configured properly"
    exit 1
fi

echo "✅ Security credentials loaded"
echo "🌐 Starting server on port ${PORT:-7113}..."

node server.js
EOF

chmod +x start-secure.sh

cat > start-docker.sh << 'EOF'
#!/bin/bash
echo "🐳 Starting WebSophon Cloud Runner (Docker Secure Mode)"
echo "======================================================"

# Check if override file exists
if [ ! -f docker-compose.override.yml ]; then
    echo "❌ docker-compose.override.yml not found. Run deploy-secure.sh first."
    exit 1
fi

echo "✅ Docker configuration found"
echo "🌐 Starting Docker services..."

docker-compose up -d
echo "✅ WebSophon Cloud Runner started in Docker"
echo ""
echo "To view logs: docker-compose logs -f"
echo "To stop: docker-compose down"
EOF

chmod +x start-docker.sh

echo "✅ Startup scripts created: start-secure.sh, start-docker.sh"

# Security verification script
cat > verify-security.sh << 'EOF'
#!/bin/bash
echo "🔍 WebSophon Security Verification"
echo "=================================="

# Load environment
if [ -f .env ]; then
    export $(cat .env | xargs)
else
    echo "❌ .env file not found"
    exit 1
fi

SERVER_URL=${1:-"http://localhost:7113"}

echo "Testing server: $SERVER_URL"
echo ""

# Test 1: Unauthenticated request (should fail)
echo "Test 1: Unauthenticated request to /test"
response=$(curl -s -w "%{http_code}" -X POST "$SERVER_URL/test" -H "Content-Type: application/json" -d '{"test": "data"}' -o /dev/null)
if [ "$response" = "401" ]; then
    echo "✅ Correctly rejected unauthenticated request (401)"
else
    echo "❌ Security issue: unauthenticated request returned $response (expected 401)"
fi

# Test 2: Invalid API key (should fail)
echo ""
echo "Test 2: Invalid API key"
response=$(curl -s -w "%{http_code}" -X POST "$SERVER_URL/test" \
    -H "X-API-Key: invalid_key" \
    -H "Content-Type: application/json" \
    -d '{"test": "data"}' -o /dev/null)
if [ "$response" = "401" ]; then
    echo "✅ Correctly rejected invalid API key (401)"
else
    echo "❌ Security issue: invalid API key returned $response (expected 401)"
fi

# Test 3: Valid API key with signature (should succeed)
echo ""
echo "Test 3: Valid API key with signature"
timestamp=$(date +%s000)
payload='{"testData": "ping"}'
signature=$(echo -n "${payload}${timestamp}" | openssl dgst -sha256 -hmac "$WEBSOPHON_SIGNING_SECRET" -hex | cut -d' ' -f2)

response=$(curl -s -w "%{http_code}" -X POST "$SERVER_URL/test" \
    -H "X-API-Key: $WEBSOPHON_API_KEY" \
    -H "X-Signature: $signature" \
    -H "X-Timestamp: $timestamp" \
    -H "Content-Type: application/json" \
    -d "$payload" -o /dev/null)

if [ "$response" = "200" ]; then
    echo "✅ Correctly accepted valid authenticated request (200)"
else
    echo "❌ Security issue: valid request returned $response (expected 200)"
fi

# Test 4: Attack pattern detection
echo ""
echo "Test 4: Attack pattern detection"
response=$(curl -s -w "%{http_code}" -X GET "$SERVER_URL/.env" -o /dev/null)
if [ "$response" = "404" ]; then
    echo "✅ Correctly blocked suspicious request (404)"
else
    echo "❌ Security issue: suspicious request returned $response (expected 404)"
fi

echo ""
echo "🔐 Security verification complete"
EOF

chmod +x verify-security.sh

echo "✅ Security verification script created: verify-security.sh"

# Final instructions
echo ""
echo "🎉 Deployment Complete!"
echo "======================="
echo ""
echo "Next steps:"
echo ""
echo "1. ✅ Extension Ready - No Manual Configuration Needed!"
echo "   - Users just need to set the Cloud Runner URL in settings"
echo "   - Authentication is handled automatically through web interface"
echo ""
echo "2. 🚀 Start the server:"
echo "   ./start-secure.sh            # Native Node.js"
echo "   ./start-docker.sh            # Docker"
echo ""
echo "3. 🔍 Verify security:"
echo "   ./verify-security.sh         # Test security features"
echo ""
echo "4. 📊 Monitor logs:"
echo "   tail -f logs/websophon.log   # If using file logging"
echo "   docker-compose logs -f       # If using Docker"
echo ""
echo "⚠️  IMPORTANT SECURITY NOTES:"
echo "   - Keep your .env file secure and never commit it to version control"
echo "   - Use HTTPS in production (configure reverse proxy/load balancer)"
echo "   - Consider setting up IP whitelisting if needed"
echo "   - Monitor logs for security events"
echo "   - Rotate API keys periodically"
echo ""
echo "📚 For detailed security information, see docs/SECURITY_GUIDE.md"
echo ""
echo "📧 Your ACME Email: ${ACME_EMAIL}"
echo "🔑 Your Master Key: ${MASTER_KEY:0:20}..."
echo "🔐 Your Signing Secret: ${SIGNING_SECRET:0:20}..."
echo "🔑 Your hCaptcha Site Key: ${CAPTCHA_SITE_KEY:0:20}..."
echo ""
echo "Happy secure deployment! 🚀" 