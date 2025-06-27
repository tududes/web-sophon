# WebSophon Cloud Runner Security Guide

## Overview

The WebSophon Cloud Runner implements enterprise-grade security with CAPTCHA-based human verification and comprehensive usage quotas. This system prevents automated abuse while ensuring legitimate users have fair access to resources.

## Security Architecture

### Multi-Layer Security Stack
1. **IP Whitelisting** (optional)
2. **Attack Pattern Detection** (automatic blocking)
3. **Rate Limiting** (60 requests/minute per client)
4. **CAPTCHA Verification** (human validation)
5. **Token Authentication** (Bearer token required)
6. **Usage Quotas** (per-token resource limits)
7. **Job Ownership** (token-based isolation)

## CAPTCHA-Based Authentication System

### Token Generation Process
1. User requests CAPTCHA challenge from extension
2. User completes hCaptcha verification
3. Server validates CAPTCHA response
4. Server issues 24-hour access token
5. Extension uses token for all subsequent requests

### Token Format
- **Prefix**: `wst_` (WebSophon Token)
- **Length**: 64-character hexadecimal string
- **Lifetime**: 24 hours with automatic expiry
- **Scope**: Isolated per user with individual quotas

### Usage Quotas
Each token includes resource limits:
- **Recurring Domains**: 10 concurrent monitoring jobs
- **Manual Captures**: 2 concurrent one-time captures
- **Total Active Jobs**: 12 maximum per token

## API Endpoints

### CAPTCHA & Authentication
```
GET /captcha/challenge
- Returns hCaptcha site key for client-side widget
- No authentication required

POST /captcha/verify
- Verifies CAPTCHA response and issues token
- Body: { "captchaResponse": "hcaptcha_response_token" }
- Returns: { "token": "wst_...", "expiresAt": "ISO_date" }

GET /auth/token/stats
- Returns current quota usage for authenticated token
- Requires: Authorization: Bearer wst_...
- Returns: { "quotas": {...}, "usage": {...}, "expiresAt": "..." }
```

### Job Management (Token Required)
```
POST /job
- Create or update recurring/manual capture jobs
- Requires: Authorization: Bearer wst_...
- Enforces quota limits before job creation

GET /job/:id
GET /job/:id/results  
POST /job/:id/purge
DELETE /job/:id
- All job operations require valid Bearer token
- Jobs are isolated per token (no cross-token access)
```

### Public Endpoints
```
GET /
- Health check with minimal server information
- No authentication required
```

## Configuration

### Environment Variables

**Required for CAPTCHA:**
```bash
# hCaptcha Configuration
export CAPTCHA_SITE_KEY="your_hcaptcha_site_key"
export CAPTCHA_SECRET_KEY="your_hcaptcha_secret_key"

# Security Keys
export WEBSOPHON_MASTER_KEY="$(openssl rand -hex 32)"
export WEBSOPHON_SIGNING_SECRET="$(openssl rand -hex 64)"
```

**Optional Configuration:**
```bash
# IP Whitelisting (comma-separated)
export ALLOWED_IPS="192.168.1.100,10.0.0.50"

# Rate Limiting
export MAX_REQUESTS_PER_MINUTE=60
export MAX_JOBS_PER_CLIENT=12

# Quota Limits
export QUOTA_RECURRING_DOMAINS=10
export QUOTA_MANUAL_CAPTURES=2

# Token Lifecycle
export TOKEN_EXPIRY_HOURS=24
```

### Extension Configuration

The extension automatically handles CAPTCHA authentication through the Settings tab. No manual configuration needed for basic operation.

**For advanced configuration (optional):**
```javascript
// services/MessageService.js
this.cloudConfig = {
    baseUrl: 'https://your-runner.com',
    // CAPTCHA and tokens handled automatically
};
```

## hCaptcha Setup

### 1. Create hCaptcha Account
1. Visit [https://hcaptcha.com](https://hcaptcha.com)
2. Sign up for a free account
3. Create a new site configuration

### 2. Configure Site Settings
- **Site Domain**: Your cloud runner domain
- **Challenge Type**: Checkbox (recommended)
- **Difficulty**: Normal
- **Theme**: Light or Dark (matches extension)

### 3. Obtain Keys
- **Site Key**: Public key for client-side widget
- **Secret Key**: Private key for server-side verification

### 4. Test Configuration
Use the extension's Settings tab to test CAPTCHA functionality and token generation.

## Security Features

### Attack Protection
**Automatic blocking of suspicious requests:**
- `.env` and configuration files
- `.git` repositories and version control
- WordPress admin panels (`wp-admin`, `wp-login`)
- SSH keys and certificates
- Database dumps and backups
- Common attack vectors

**Example blocked patterns:**
```
/.env
/.git/config
/wp-admin/
/admin/config.php
/id_rsa
/database.sql
```

### Rate Limiting
- **Global**: 60 requests per minute per client
- **Job Creation**: Enforced by quota system
- **Token Generation**: 1 CAPTCHA challenge per 5 minutes
- **Automatic Recovery**: Limits reset after time window

### Client Identification
Each client gets unique ID based on:
- IP address hash
- User-Agent fingerprint
- Prevents cross-client interference
- Enables precise tracking and limits

### Token Security
- **Cryptographically secure**: Generated using crypto.randomBytes
- **Time-limited**: 24-hour automatic expiry
- **Isolated**: Each token has independent quotas
- **Revocable**: Tokens can be manually cleared
- **Audit trail**: All token operations logged

## Usage Monitoring

### Extension Integration
The Settings tab displays real-time quota information:
- **Token Status**: Valid/Expired/Missing
- **Quota Usage**: Visual progress bars
- **Expiry Warning**: Alerts before token expires
- **One-click Actions**: Generate, clear, test tokens

### Server-Side Monitoring
Comprehensive logging includes:
- Token generation and expiry events
- Quota usage and violations  
- Security events and attack attempts
- Performance metrics and job statistics

### Log Examples

**Token Generation:**
```
[2024-01-15T10:30:00.000Z] Token generated for client abc123: wst_a1b2c3... (expires: 2024-01-16T10:30:00.000Z)
```

**Quota Enforcement:**
```
[2024-01-15T10:35:00.000Z] Quota exceeded for token wst_a1b2c3...: recurring_domains (10/10)
```

**Security Events:**
```
[SECURITY] Suspicious request blocked: GET /.env from 192.168.1.100
[SECURITY] Invalid token used: wst_expired... from client abc123
[SECURITY] Rate limit exceeded for client abc123 (60 requests/minute)
```

## Deployment Guide

### 1. hCaptcha Setup
```bash
# Interactive deployment script handles this
./deploy-secure.sh
```

### 2. Manual Setup
```bash
# Generate security keys
export WEBSOPHON_MASTER_KEY="$(openssl rand -hex 32)"
export WEBSOPHON_SIGNING_SECRET="$(openssl rand -hex 64)"

# Set hCaptcha keys (from hCaptcha dashboard)
export CAPTCHA_SITE_KEY="your_site_key_here"
export CAPTCHA_SECRET_KEY="your_secret_key_here"

# Optional: Configure limits
export QUOTA_RECURRING_DOMAINS=10
export QUOTA_MANUAL_CAPTURES=2
export TOKEN_EXPIRY_HOURS=24
```

### 3. Verification
Test the complete authentication flow:
1. Extension Settings → Generate Token
2. Complete CAPTCHA challenge
3. Verify quota display
4. Test job creation
5. Monitor server logs

## Troubleshooting

### Common Issues

**CAPTCHA Not Loading:**
- Check `CAPTCHA_SITE_KEY` is set correctly
- Verify domain matches hCaptcha configuration
- Check network connectivity and firewall rules

**Token Generation Fails:**
- Verify `CAPTCHA_SECRET_KEY` is correct
- Check hCaptcha dashboard for errors
- Ensure server can reach hCaptcha API

**Quota Exceeded:**
- Check current usage in Settings tab
- Wait for jobs to complete (recurring domains)
- Token expires in 24 hours, resets quotas

**Authentication Errors:**
```bash
# Test token validation
curl -X GET https://your-runner.com/auth/token/stats \
  -H "Authorization: Bearer wst_your_token_here"
```

### Debug Commands

**Check Token Status:**
```bash
# From extension console
chrome.runtime.sendMessage({
  action: 'getTokenStats'
}, response => console.log(response));
```

**Server Health Check:**
```bash
curl -X GET https://your-runner.com/
# Should return server status without authentication
```

**CAPTCHA Challenge Test:**
```bash
curl -X GET https://your-runner.com/captcha/challenge
# Should return site key
```

## Security Best Practices

### Server Security
- **HTTPS Only**: Never deploy without SSL/TLS
- **Firewall Rules**: Restrict unnecessary ports
- **Regular Updates**: Keep all dependencies current
- **Log Monitoring**: Set up alerts for security events
- **Backup Strategy**: Regular configuration backups

### CAPTCHA Management
- **Key Rotation**: Rotate hCaptcha keys periodically
- **Domain Restrictions**: Limit to specific domains
- **Rate Limiting**: Monitor for unusual CAPTCHA volume
- **Analytics**: Review hCaptcha dashboard regularly

### Token Lifecycle
- **Automatic Expiry**: 24-hour limit enforced
- **Quota Monitoring**: Track usage patterns
- **Abuse Detection**: Monitor for quota violations
- **Clean Revocation**: Provide user control over tokens

### Network Security
- **CDN/Proxy**: Use Cloudflare or similar for DDoS protection
- **IP Filtering**: Implement geographic restrictions if needed
- **VPN Access**: Consider VPN for sensitive deployments
- **Monitoring**: Real-time traffic analysis

## Migration Guide

### From API Key System
If upgrading from the previous API key authentication:

1. **Deploy New Server**: Update cloud runner with CAPTCHA system
2. **Configure hCaptcha**: Set up account and keys
3. **Update Extension**: Users get CAPTCHA authentication automatically
4. **Test Thoroughly**: Verify all functionality works
5. **Monitor Migration**: Watch logs for any issues

### Rollback Plan
If issues occur:
1. Keep old API key system deployed as backup
2. Update DNS to point back to old system
3. Revert extension to previous version
4. Investigate and fix issues
5. Re-attempt migration

## Compliance & Privacy

### Data Handling
- **Minimal Data**: Only necessary information stored
- **No Personal Data**: CAPTCHA responses not retained
- **Automatic Cleanup**: Expired tokens purged automatically
- **Audit Logs**: Security events logged (no personal data)

### CAPTCHA Privacy
- **hCaptcha**: Privacy-focused alternative to reCAPTCHA
- **No Tracking**: Minimal user profiling
- **Transparent**: Clear privacy policy available
- **User Control**: CAPTCHA completion is user-initiated

This comprehensive security system provides enterprise-grade protection while maintaining a smooth user experience through the browser extension interface. 