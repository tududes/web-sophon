import express from 'express';
import bodyParser from 'body-parser';
import { v4 as uuidv4 } from 'uuid';
import puppeteer from 'puppeteer';
import cors from 'cors';
import crypto from 'crypto';
import sharp from 'sharp';
import { getSystemPrompt } from '../utils/prompt-formatters.js';
import { parseSAPIENTResponse } from '../utils/sapient-parser.js';
import { fireFieldWebhooks } from './utils/webhook-utils.js';

const app = express();
const port = process.env.PORT || 7113;

// Security Configuration
const SECURITY_CONFIG = {
    // Master API Key for CAPTCHA verification (should be set via environment variable)
    MASTER_API_KEY: process.env.WEBSOPHON_MASTER_KEY || 'ws_master_dev_key_change_in_production',
    // Secret for HMAC signing (should be set via environment variable)
    SIGNING_SECRET: process.env.WEBSOPHON_SIGNING_SECRET || 'dev_signing_secret_change_in_production',
    // CAPTCHA Configuration
    CAPTCHA_SECRET: process.env.CAPTCHA_SECRET_KEY || 'dev_captcha_secret',
    CAPTCHA_SITE_KEY: process.env.CAPTCHA_SITE_KEY || 'dev_captcha_site_key',
    // Token Configuration
    TOKEN_EXPIRY: 24 * 60 * 60 * 1000, // 24 hours
    TOKEN_CLEANUP_INTERVAL: 60 * 60 * 1000, // 1 hour
    // Usage Quotas
    MAX_CONCURRENT_DOMAINS: 10, // Max domains with recurring jobs
    MAX_CONCURRENT_MANUAL: 2,   // Max concurrent manual captures
    // Rate limiting
    MAX_REQUESTS_PER_MINUTE: 60, // Increased for token-based auth
    MAX_PAYLOAD_SIZE: '50mb',
    // IP Whitelisting (empty = allow all)
    ALLOWED_IPS: process.env.ALLOWED_IPS ? process.env.ALLOWED_IPS.split(',') : [],
    // Job limits
    MAX_TOTAL_JOBS: 500, // Increased for multi-tenant
    MAX_RESULTS_PER_JOB: 1000
};

// In-memory stores
const jobs = {}; // jobId -> job data
const authTokens = new Map(); // token -> { clientId, expiresAt, quotas, createdAt }
const clientMetrics = new Map(); // clientId -> { requests: [], lastSeen: timestamp }
const blockedIPs = new Set();
const blockedClients = new Set();
const jobDeletionTimeouts = new Map(); // Track deletion timeouts for jobs

// Token and quota management
class TokenManager {
    constructor() {
        this.tokens = authTokens;
        // Start cleanup interval
        setInterval(() => this.cleanupExpiredTokens(), SECURITY_CONFIG.TOKEN_CLEANUP_INTERVAL);
    }

    generateToken() {
        return `wst_${crypto.randomBytes(32).toString('hex')}`;
    }

    createToken(clientId, captchaResponse) {
        const token = this.generateToken();
        const now = Date.now();

        const tokenData = {
            clientId: clientId,
            createdAt: now,
            expiresAt: now + SECURITY_CONFIG.TOKEN_EXPIRY,
            captchaResponse: captchaResponse, // Store for audit
            quotas: {
                recurringDomains: new Set(), // Active recurring job domains
                manualCaptures: 0, // Current concurrent manual captures
                totalRequests: 0,
                lastRequestTime: now
            },
            stats: {
                totalJobs: 0,
                totalManualCaptures: 0,
                totalRecurringJobs: 0
            }
        };

        this.tokens.set(token, tokenData);
        console.log(`[TOKEN] Created token for client ${clientId}: ${token.substring(0, 16)}...`);
        return token;
    }

    validateToken(token) {
        const tokenData = this.tokens.get(token);
        if (!tokenData) {
            console.log(`[TOKEN] Validation failed - token not found: ${token.substring(0, 16)}...`);
            console.log(`[TOKEN] Available tokens: ${Array.from(this.tokens.keys()).map(t => t.substring(0, 16) + '...').join(', ')}`);
            return { valid: false, reason: 'Token not found' };
        }

        if (Date.now() > tokenData.expiresAt) {
            console.log(`[TOKEN] Token expired: ${token.substring(0, 16)}... (expired ${new Date(tokenData.expiresAt).toISOString()})`);
            this.tokens.delete(token);
            return { valid: false, reason: 'Token expired' };
        }

        console.log(`[TOKEN] Token validated successfully: ${token.substring(0, 16)}... (expires ${new Date(tokenData.expiresAt).toISOString()})`);
        return { valid: true, data: tokenData };
    }

    checkQuotas(token, operationType, domain = null) {
        const validation = this.validateToken(token);
        if (!validation.valid) {
            return { allowed: false, reason: validation.reason };
        }

        const tokenData = validation.data;
        const quotas = tokenData.quotas;

        switch (operationType) {
            case 'recurring_job':
                if (quotas.recurringDomains.size >= SECURITY_CONFIG.MAX_CONCURRENT_DOMAINS) {
                    return {
                        allowed: false,
                        reason: `Quota exceeded: Maximum ${SECURITY_CONFIG.MAX_CONCURRENT_DOMAINS} concurrent recurring domains allowed`,
                        current: quotas.recurringDomains.size,
                        limit: SECURITY_CONFIG.MAX_CONCURRENT_DOMAINS
                    };
                }
                break;

            case 'manual_capture':
                if (quotas.manualCaptures >= SECURITY_CONFIG.MAX_CONCURRENT_MANUAL) {
                    return {
                        allowed: false,
                        reason: `Quota exceeded: Maximum ${SECURITY_CONFIG.MAX_CONCURRENT_MANUAL} concurrent manual captures allowed`,
                        current: quotas.manualCaptures,
                        limit: SECURITY_CONFIG.MAX_CONCURRENT_MANUAL
                    };
                }
                break;
        }

        return { allowed: true, data: tokenData };
    }

    updateQuotas(token, operation, domain = null) {
        const tokenData = this.tokens.get(token);
        if (!tokenData) return false;

        const quotas = tokenData.quotas;
        const stats = tokenData.stats;

        switch (operation.type) {
            case 'start_recurring':
                quotas.recurringDomains.add(domain);
                stats.totalRecurringJobs++;
                break;
            case 'stop_recurring':
                quotas.recurringDomains.delete(domain);
                break;
            case 'start_manual':
                quotas.manualCaptures++;
                stats.totalManualCaptures++;
                break;
            case 'finish_manual':
                quotas.manualCaptures = Math.max(0, quotas.manualCaptures - 1);
                break;
        }

        quotas.totalRequests++;
        quotas.lastRequestTime = Date.now();
        stats.totalJobs++;

        console.log(`[QUOTA] Updated quotas for token ${token.substring(0, 16)}...: recurring=${quotas.recurringDomains.size}, manual=${quotas.manualCaptures}`);
        return true;
    }

    getTokenStats(token) {
        const tokenData = this.tokens.get(token);
        if (!tokenData) return null;

        return {
            clientId: tokenData.clientId,
            createdAt: tokenData.createdAt,
            expiresAt: tokenData.expiresAt,
            quotas: {
                recurringDomains: tokenData.quotas.recurringDomains.size,
                maxRecurringDomains: SECURITY_CONFIG.MAX_CONCURRENT_DOMAINS,
                manualCaptures: tokenData.quotas.manualCaptures,
                maxManualCaptures: SECURITY_CONFIG.MAX_CONCURRENT_MANUAL,
                activeDomains: Array.from(tokenData.quotas.recurringDomains)
            },
            stats: tokenData.stats,
            timeRemaining: tokenData.expiresAt - Date.now()
        };
    }

    cleanupExpiredTokens() {
        const now = Date.now();
        let cleanedCount = 0;

        for (const [token, data] of this.tokens.entries()) {
            if (now > data.expiresAt) {
                this.tokens.delete(token);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            console.log(`[CLEANUP] Removed ${cleanedCount} expired tokens`);
        }
    }
}

const tokenManager = new TokenManager();

// Temporary storage for authentication jobs (jobId -> {token, expiresAt, timestamp})
const authJobs = new Map();

// Clean up expired auth jobs every 10 minutes
setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [jobId, authJob] of authJobs.entries()) {
        const jobAge = now - authJob.timestamp;
        if (jobAge > 5 * 60 * 1000) { // 5 minutes max lifetime
            authJobs.delete(jobId);
            cleanedCount++;
        }
    }

    if (cleanedCount > 0) {
        console.log(`[CLEANUP] Removed ${cleanedCount} expired auth jobs`);
    }
}, 10 * 60 * 1000); // Run every 10 minutes

// CAPTCHA verification utility
async function verifyCaptcha(captchaResponse, clientIP) {
    // In development, skip actual CAPTCHA verification
    if (process.env.NODE_ENV !== 'production') {
        console.log(`[CAPTCHA] Development mode: accepting test CAPTCHA for ${clientIP}`);
        return { success: true, challenge_ts: new Date().toISOString() };
    }

    try {
        // Use hCaptcha or reCAPTCHA verification
        const verifyUrl = 'https://hcaptcha.com/siteverify'; // or https://www.google.com/recaptcha/api/siteverify
        const response = await fetch(verifyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                secret: SECURITY_CONFIG.CAPTCHA_SECRET,
                response: captchaResponse,
                remoteip: clientIP
            })
        });

        const result = await response.json();
        return result;
    } catch (error) {
        console.error('[CAPTCHA] Verification error:', error);
        return { success: false, 'error-codes': ['verification-failed'] };
    }
}

// Attack pattern detection
const suspiciousPatterns = [
    /\.env/i, /\.git/i, /\.ssh/i, /\.aws/i, /\.vscode/i, /\.svn/i,
    /wp-admin/i, /wp-config/i, /phpinfo/i, /config\.(php|yml|yaml|xml|json)/i,
    /secrets/i, /backup/i, /dump\.sql/i, /database/i, /server\.key/i,
    /id_rsa/i, /id_ecdsa/i, /id_ed25519/i, /credentials/i, /setup-config/i,
    /server-status/i, /schema\.rb/i, /web\.config/i, /docker-compose/i
];

// Utility functions
function generateClientId(req) {
    const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
    const userAgent = req.headers['user-agent'] || '';
    return crypto.createHash('sha256').update(`${ip}:${userAgent}`).digest('hex').substring(0, 16);
}

function verifyMasterKey(apiKey) {
    return apiKey === SECURITY_CONFIG.MASTER_API_KEY;
}

function verifyHMACSignature(payload, signature, secret) {
    if (!signature) return false;
    const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSignature, 'hex'));
}

// Rate limiting utility functions
function isRateLimited(clientId) {
    const now = Date.now();
    const client = clientMetrics.get(clientId) || { requests: [], lastSeen: now };

    // Clean old requests (older than 1 minute)
    client.requests = client.requests.filter(time => now - time < 60000);

    // Check rate limits
    if (client.requests.length >= SECURITY_CONFIG.MAX_REQUESTS_PER_MINUTE) {
        return true;
    }

    // Update metrics
    client.requests.push(now);
    client.lastSeen = now;
    clientMetrics.set(clientId, client);

    return false;
}

// Authentication middleware for different security levels
function requireMasterKey(req, res, next) {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;

    if (!apiKey || !verifyMasterKey(apiKey)) {
        console.warn(`[SECURITY] Invalid master key from ${req.clientIP} (${req.clientId})`);
        return res.status(401).json({ error: 'Master API key required' });
    }

    next();
}

function requireValidToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.warn(`[SECURITY] Missing token from ${req.clientIP} (${req.clientId})`);
        return res.status(401).json({ error: 'Authentication token required' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    const validation = tokenManager.validateToken(token);

    if (!validation.valid) {
        console.warn(`[SECURITY] Invalid token from ${req.clientIP} (${req.clientId}): ${validation.reason}`);
        return res.status(401).json({ error: validation.reason });
    }

    req.authToken = token;
    req.tokenData = validation.data;
    next();
}

// IP Whitelisting middleware
app.use((req, res, next) => {
    if (SECURITY_CONFIG.ALLOWED_IPS.length > 0) {
        const clientIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
        if (!SECURITY_CONFIG.ALLOWED_IPS.includes(clientIP)) {
            console.warn(`[SECURITY] Rejected request from non-whitelisted IP: ${clientIP}`);
            return res.status(403).json({ error: 'IP not whitelisted' });
        }
    }
    next();
});

// Enhanced security middleware
app.use((req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
    const clientId = generateClientId(req);
    const userAgent = req.headers['user-agent'] || '';

    // Block already identified malicious IPs/clients
    if (blockedIPs.has(clientIP) || blockedClients.has(clientId)) {
        console.warn(`[SECURITY] Blocked request from banned client: ${clientIP} (${clientId})`);
        return res.status(403).json({ error: 'Forbidden' });
    }

    // Check for suspicious path patterns
    const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(req.path));

    if (isSuspicious) {
        console.warn(`[SECURITY] Suspicious request detected from ${clientIP}: ${req.method} ${req.path}`);
        console.warn(`[SECURITY] User-Agent: ${userAgent}`);

        // Ban suspicious clients immediately
        blockedIPs.add(clientIP);
        blockedClients.add(clientId);
        console.warn(`[SECURITY] IP ${clientIP} and client ${clientId} banned for suspicious activity`);

        return res.status(404).json({ error: 'Not Found' });
    }

    // Rate limiting check
    if (isRateLimited(clientId)) {
        console.warn(`[SECURITY] Rate limit exceeded for client ${clientId} from ${clientIP}`);
        return res.status(429).json({
            error: 'Rate limit exceeded',
            retryAfter: 60
        });
    }

    // Add client info to request
    req.clientId = clientId;
    req.clientIP = clientIP;

    next();
});

// API Key authentication middleware for protected endpoints
function requireAPIKey(req, res, next) {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;

    if (!apiKey) {
        console.warn(`[SECURITY] Missing API key from ${req.clientIP} (${req.clientId})`);
        return res.status(401).json({ error: 'API key required' });
    }

    if (!verifyAPIKey(apiKey)) {
        console.warn(`[SECURITY] Invalid API key from ${req.clientIP} (${req.clientId}): ${apiKey}`);
        blockedClients.add(req.clientId);
        return res.status(401).json({ error: 'Invalid API key' });
    }

    next();
}

// HMAC signature verification middleware for sensitive operations
function requireSignature(req, res, next) {
    const signature = req.headers['x-signature'];
    const timestamp = req.headers['x-timestamp'];

    if (!signature || !timestamp) {
        console.warn(`[SECURITY] Missing signature or timestamp from ${req.clientIP} (${req.clientId})`);
        return res.status(400).json({ error: 'Signature and timestamp required' });
    }

    // Check timestamp (prevent replay attacks)
    const now = Date.now();
    const requestTime = parseInt(timestamp);
    if (Math.abs(now - requestTime) > 300000) { // 5 minutes tolerance
        console.warn(`[SECURITY] Request timestamp too old/future from ${req.clientIP} (${req.clientId})`);
        return res.status(400).json({ error: 'Request timestamp invalid' });
    }

    // Verify signature
    const payload = JSON.stringify(req.body) + timestamp;
    if (!verifyHMACSignature(payload, signature, SECURITY_CONFIG.SIGNING_SECRET)) {
        console.warn(`[SECURITY] Invalid signature from ${req.clientIP} (${req.clientId})`);
        blockedClients.add(req.clientId);
        return res.status(401).json({ error: 'Invalid signature' });
    }

    next();
}

// Whitelist only specific endpoints we actually use
const allowedEndpoints = [
    '/',
    '/auth',
    '/auth-success',
    '/captcha/challenge',
    '/captcha/verify',
    '/auth/token/stats',
    '/job',
    '/jobs',
    '/test',
    /^\/job\/[a-f0-9-]+$/,
    /^\/job\/[a-f0-9-]+\/results$/,
    /^\/job\/[a-f0-9-]+\/purge$/,
    /^\/job\/[a-f0-9-]+\/session$/,
    /^\/auth\/job\/auth_[0-9]+_[a-z0-9]+$/
];

app.use((req, res, next) => {
    const isAllowed = allowedEndpoints.some(endpoint => {
        if (typeof endpoint === 'string') {
            return req.path === endpoint;
        } else {
            return endpoint.test(req.path);
        }
    });

    if (!isAllowed) {
        console.log(`[SECURITY] Blocked access to unauthorized endpoint: ${req.method} ${req.path}`);
        return res.status(404).json({ error: 'Endpoint not found' });
    }

    next();
});

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Server', 'WebSophon-Runner');
    next();
});

// Add a simple logger middleware to see legitimate requests only
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.clientId} - ${req.method} ${req.url}`);
    next();
});

app.use(cors());
app.use(bodyParser.json({ limit: SECURITY_CONFIG.MAX_PAYLOAD_SIZE }));

// --- CAPTCHA and Authentication Endpoints ---

/**
 * Endpoint to get CAPTCHA challenge information
 * No authentication required - this is the entry point
 */
app.get('/captcha/challenge', (req, res) => {
    console.log(`[CAPTCHA] Challenge requested by ${req.clientId}`);
    res.status(200).json({
        siteKey: SECURITY_CONFIG.CAPTCHA_SITE_KEY,
        service: 'hcaptcha', // or 'recaptcha'
        message: 'Complete the CAPTCHA to obtain an authentication token'
    });
});

/**
 * Endpoint to verify CAPTCHA and issue authentication token
 * Called server-side from auth page (no authentication required)
 */
app.post('/captcha/verify', async (req, res) => {
    const { captchaResponse, jobId } = req.body;

    if (!captchaResponse) {
        return res.status(400).json({ error: 'CAPTCHA response required' });
    }

    try {
        console.log(`[CAPTCHA] Verification requested by ${req.clientId}, jobId: ${jobId || 'none'}`);

        // Verify CAPTCHA with the service
        const verification = await verifyCaptcha(captchaResponse, req.clientIP);

        if (!verification.success) {
            console.warn(`[CAPTCHA] Failed verification for ${req.clientId}: ${verification['error-codes']}`);
            return res.status(400).json({
                error: 'CAPTCHA verification failed',
                details: verification['error-codes']
            });
        }

        // Create authentication token
        const token = tokenManager.createToken(req.clientId, captchaResponse);
        const tokenStats = tokenManager.getTokenStats(token);

        // If jobId provided, store token for job-based retrieval
        if (jobId) {
            authJobs.set(jobId, {
                token: token,
                expiresAt: tokenStats.expiresAt,
                quotas: tokenStats.quotas,
                timestamp: Date.now(),
                clientId: req.clientId
            });
            console.log(`[CAPTCHA] Token stored for job ${jobId}`);
        }

        console.log(`[CAPTCHA] Successfully verified and issued token for ${req.clientId}`);

        res.status(200).json({
            success: true,
            message: 'Authentication token issued successfully',
            jobId: jobId || null
        });

    } catch (error) {
        console.error(`[CAPTCHA] Error during verification for ${req.clientId}:`, error);
        res.status(500).json({ error: 'CAPTCHA verification service error' });
    }
});

/**
 * Endpoint to serve authentication page with CAPTCHA
 * No authentication required - this is the entry point
 */
app.get('/auth', (req, res) => {
    const jobId = req.query.jobId || '';
    console.log(`[AUTH] Authentication page requested by ${req.clientId}, jobId: ${jobId}`);

    const authPageHTML = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WebSophon Cloud Runner Authentication</title>
        <script src="https://js.hcaptcha.com/1/api.js" async defer></script>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }
            
            .auth-container {
                background: white;
                border-radius: 12px;
                box-shadow: 0 20px 40px rgba(0,0,0,0.1);
                padding: 40px;
                max-width: 500px;
                width: 100%;
                text-align: center;
            }
            
            .logo {
                font-size: 2.5rem;
                font-weight: bold;
                color: #667eea;
                margin-bottom: 10px;
            }
            
            .subtitle {
                color: #666;
                margin-bottom: 30px;
                font-size: 1.1rem;
            }
            
            .captcha-container {
                margin: 30px 0;
                display: flex;
                justify-content: center;
            }
            
            .status-message {
                margin: 20px 0;
                padding: 15px;
                border-radius: 8px;
                font-weight: 500;
                display: none;
            }
            
            .status-success {
                background-color: #d4edda;
                color: #155724;
                border: 1px solid #c3e6cb;
            }
            
            .status-error {
                background-color: #f8d7da;
                color: #721c24;
                border: 1px solid #f5c6cb;
            }
            
            .status-info {
                background-color: #d1ecf1;
                color: #0c5460;
                border: 1px solid #bee5eb;
            }
            
            .auth-button {
                background: #667eea;
                color: white;
                border: none;
                padding: 12px 30px;
                border-radius: 8px;
                font-size: 1rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
                margin: 10px 0;
            }
            
            .auth-button:hover {
                background: #5a6fd8;
                transform: translateY(-2px);
            }
            
            .auth-button:disabled {
                background: #ccc;
                cursor: not-allowed;
                transform: none;
            }
            
            .instructions {
                background: #f8f9fa;
                border-radius: 8px;
                padding: 20px;
                margin: 20px 0;
                color: #666;
                font-size: 0.9rem;
                line-height: 1.5;
            }
        </style>
    </head>
    <body>
        <div class="auth-container">
            <div class="logo">🔐 WebSophon</div>
            <div class="subtitle">Cloud Runner Authentication</div>
            
            <div class="instructions">
                Complete the CAPTCHA below to obtain an authentication token for WebSophon Cloud Runner access.
            </div>
            
            <div class="captcha-container">
                <div id="hcaptcha-widget"></div>
            </div>
            
            <div id="status-message" class="status-message"></div>
            
            <script>
                let hcaptchaWidgetId = null;
                
                // Initialize hCaptcha when page loads
                window.addEventListener('load', function() {
                    if (window.hcaptcha) {
                        initializeCaptcha();
                    } else {
                        // Wait for hCaptcha to load
                        window.hcaptchaOnLoad = initializeCaptcha;
                    }
                });
                
                function initializeCaptcha() {
                    // Check if we're in development mode
                    const isDevelopment = '${SECURITY_CONFIG.CAPTCHA_SITE_KEY}' === 'dev_captcha_site_key';
                    
                    if (isDevelopment) {
                        // Development mode - show bypass button
                        const widget = document.getElementById('hcaptcha-widget');
                        widget.innerHTML = \`
                            <div style="padding: 20px; border: 2px dashed #667eea; border-radius: 8px; background: #f8f9ff;">
                                <h3 style="color: #667eea; margin-bottom: 10px;">🔧 Development Mode</h3>
                                <p style="color: #666; margin-bottom: 15px; font-size: 0.9rem;">
                                    CAPTCHA verification is bypassed in development mode.
                                </p>
                                <button id="dev-auth-btn" style="background: #28a745; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: 600;">
                                    🚀 Get Development Token
                                </button>
                            </div>
                        \`;
                        
                        document.getElementById('dev-auth-btn').onclick = function() {
                            onCaptchaSuccess('dev_bypass_token');
                        };
                        
                        showStatus('Development mode active - click the button below to get a token', 'info');
                    } else {
                        // Production mode - use real hCaptcha
                        hcaptchaWidgetId = hcaptcha.render('hcaptcha-widget', {
                            sitekey: '${SECURITY_CONFIG.CAPTCHA_SITE_KEY}',
                            theme: 'light',
                            callback: onCaptchaSuccess,
                            'error-callback': onCaptchaError,
                            'expired-callback': onCaptchaExpired
                        });
                        
                        showStatus('Complete the CAPTCHA to get your authentication token', 'info');
                    }
                }
                
                async function onCaptchaSuccess(token) {
                    showStatus('Verifying CAPTCHA...', 'info');
                    
                    try {
                        const urlParams = new URLSearchParams(window.location.search);
                        const jobId = urlParams.get('jobId') || '';
                        
                        const response = await fetch('/captcha/verify', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                captchaResponse: token,
                                jobId: jobId
                            })
                        });
                        
                        const result = await response.json();
                        
                        if (result.success) {
                            showStatus('✅ Authentication successful! Token will be automatically detected by the extension.', 'success');
                            
                            // Redirect to success page after a short delay
                            setTimeout(() => {
                                window.location.href = '/auth-success';
                            }, 2000);
                            
                        } else {
                            showStatus('❌ Authentication failed: ' + result.error, 'error');
                            if (hcaptchaWidgetId !== null) {
                                hcaptcha.reset(hcaptchaWidgetId);
                            }
                        }
                        
                    } catch (error) {
                        showStatus('❌ Error during authentication: ' + error.message, 'error');
                        if (hcaptchaWidgetId !== null) {
                            hcaptcha.reset(hcaptchaWidgetId);
                        }
                    }
                }
                
                function onCaptchaError(error) {
                    showStatus('❌ CAPTCHA error. Please try again.', 'error');
                }
                
                function onCaptchaExpired() {
                    showStatus('⏰ CAPTCHA expired. Please solve it again.', 'info');
                }
                
                function showStatus(message, type) {
                    const statusEl = document.getElementById('status-message');
                    statusEl.textContent = message;
                    statusEl.className = 'status-message status-' + type;
                    statusEl.style.display = 'block';
                }
            </script>
        </div>
    </body>
    </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(authPageHTML);
});

/**
 * Endpoint to retrieve authentication token by job ID (one-time use)
 * No authentication required - this is the retrieval endpoint
 */
app.get('/auth/job/:jobId', (req, res) => {
    const jobId = req.params.jobId;

    if (!jobId) {
        return res.status(400).json({ error: 'Job ID required' });
    }

    const authJob = authJobs.get(jobId);

    if (!authJob) {
        return res.status(404).json({ error: 'Authentication job not found or already claimed' });
    }

    // Check if job is expired (5 minutes max lifetime)
    const jobAge = Date.now() - authJob.timestamp;
    if (jobAge > 5 * 60 * 1000) {
        authJobs.delete(jobId);
        return res.status(410).json({ error: 'Authentication job expired' });
    }

    // Return token data and immediately delete the job (one-time use)
    const tokenData = {
        token: authJob.token,
        expiresAt: authJob.expiresAt,
        quotas: authJob.quotas
    };

    authJobs.delete(jobId);
    console.log(`[AUTH] Token retrieved for job ${jobId} by ${req.clientId}, job deleted`);

    res.status(200).json({
        success: true,
        ...tokenData
    });
});

/**
 * Endpoint for successful authentication redirect
 * No authentication required
 */
app.get('/auth-success', (req, res) => {
    console.log(`[AUTH] Success page requested by ${req.clientId}`);

    const successPageHTML = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Authentication Successful - WebSophon</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0;
                padding: 20px;
            }
            
            .success-container {
                background: white;
                border-radius: 12px;
                box-shadow: 0 20px 40px rgba(0,0,0,0.1);
                padding: 40px;
                max-width: 500px;
                width: 100%;
                text-align: center;
            }
            
            .success-icon {
                font-size: 4rem;
                margin-bottom: 20px;
            }
            
            .success-title {
                font-size: 2rem;
                color: #28a745;
                margin-bottom: 20px;
                font-weight: bold;
            }
            
            .success-message {
                color: #666;
                font-size: 1.1rem;
                line-height: 1.6;
                margin-bottom: 30px;
            }
            
            .instructions {
                background: #f8f9fa;
                border: 2px solid #e9ecef;
                border-radius: 8px;
                padding: 20px;
                margin: 20px 0;
                font-size: 1rem;
                color: #495057;
                line-height: 1.5;
            }
            
            .instructions strong {
                color: #212529;
                font-weight: 600;
            }
            
            .auto-detect-note {
                font-size: 0.9rem;
                color: #6c757d;
                margin-top: 15px;
                font-style: italic;
            }
        </style>
    </head>
    <body>
        <div class="success-container">
            <div class="success-icon">✅</div>
            <div class="success-title">Authentication Successful!</div>
            <div class="success-message">
                Your authentication token has been created and saved successfully.
            </div>
            <div class="instructions">
                <strong>✅ Authentication Complete!</strong><br><br>
                🔄 <strong>Automatic Detection:</strong> Your token is being detected automatically<br>
                🏠 <strong>Return to Extension:</strong> Go back to the WebSophon popup<br>
                🗂️ <strong>Close This Tab:</strong> You can close this tab manually when ready
                <div class="auto-detect-note">
                    💡 The extension polls for your token every 3 seconds for 5 minutes. No manual action needed!
                </div>
            </div>
        </div>
        
        <script>
            // Try to notify the extension that authentication is complete
            try {
                const urlParams = new URLSearchParams(window.location.search);
                const jobId = urlParams.get('jobId') || localStorage.getItem('auth_job_id');
                
                if (jobId && window.chrome && window.chrome.runtime) {
                    // Try to send a message to the extension
                    window.chrome.runtime.sendMessage('YOUR_EXTENSION_ID', {
                        action: 'authComplete',
                        jobId: jobId
                    }, function(response) {
                        if (window.chrome.runtime.lastError) {
                            console.log('Extension not available:', window.chrome.runtime.lastError.message);
                        } else {
                            console.log('Successfully notified extension');
                        }
                    });
                }
            } catch (error) {
                console.log('Could not notify extension:', error);
            }
        </script>
        </div>
    </body>
    </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(successPageHTML);
});

/**
 * Endpoint to get current token statistics and quota usage
 * Requires valid authentication token
 */
app.get('/auth/token/stats', requireValidToken, (req, res) => {
    const stats = tokenManager.getTokenStats(req.authToken);
    if (!stats) {
        return res.status(404).json({ error: 'Token statistics not found' });
    }

    console.log(`[TOKEN] Stats requested by ${req.clientId} for token ${req.authToken.substring(0, 16)}...`);
    res.status(200).json(stats);
});

// --- NEW: Internal Scheduler ---
// This will run jobs on the server according to their schedule.
const jobScheduler = {
    intervalId: null,
    start: () => {
        if (jobScheduler.intervalId) return;
        console.log('[Scheduler] Starting job scheduler...');
        jobScheduler.intervalId = setInterval(async () => {
            const now = Date.now();
            for (const jobId in jobs) {
                const job = jobs[jobId];
                if (job.interval && job.status !== 'running') {
                    const lastRunTime = job.lastRun ? new Date(job.lastRun).getTime() : 0;
                    if (now - lastRunTime >= job.interval * 1000) {
                        console.log(`[Scheduler] Job ${jobId} is due. Last run was at ${job.lastRun || 'never'}.`);
                        job.lastRun = new Date().toISOString(); // Store as ISO string
                        // Don't await this, let it run in the background
                        processJob(jobId, job.jobData);
                    }
                }
            }
        }, 5000); // Check every 5 seconds for due jobs
    },
    stop: () => {
        if (jobScheduler.intervalId) {
            clearInterval(jobScheduler.intervalId);
            jobScheduler.intervalId = null;
            console.log('[Scheduler] Stopped job scheduler.');
        }
    }
};

/**
 * Endpoint to submit or update a capture job.
 * If an interval is provided, it creates a recurring job.
 * Requires valid authentication token and enforces quotas.
 */
app.post('/job', requireValidToken, (req, res) => {
    // Check global job limits
    if (Object.keys(jobs).length >= SECURITY_CONFIG.MAX_TOTAL_JOBS) {
        console.warn(`[SECURITY] Job limit exceeded - total jobs: ${Object.keys(jobs).length}`);
        return res.status(429).json({ error: 'Server job limit exceeded. Try again later.' });
    }

    const {
        sessionData,
        llmConfig,
        fields,
        previousEvaluation,
        interval = null,
        domain,
        captureSettings = {} // NEW: Include capture settings
    } = req.body;

    if (!sessionData || !sessionData.url) {
        return res.status(400).json({ error: 'Session data with a URL is required' });
    }
    if (!llmConfig || !fields) {
        return res.status(400).json({ error: 'LLM config and fields are required' });
    }
    if (!domain) {
        return res.status(400).json({ error: 'Domain is required for job identification' });
    }

    // Security: Validate payload size and content
    if (JSON.stringify(req.body).length > 1024 * 1024) { // 1MB limit for job payload
        return res.status(413).json({ error: 'Job payload too large' });
    }

    // Determine operation type and check quotas
    const operationType = interval ? 'recurring_job' : 'manual_capture';
    const quotaCheck = tokenManager.checkQuotas(req.authToken, operationType, domain);

    if (!quotaCheck.allowed) {
        console.warn(`[QUOTA] ${req.clientId} quota exceeded: ${quotaCheck.reason}`);
        return res.status(429).json({
            error: quotaCheck.reason,
            current: quotaCheck.current,
            limit: quotaCheck.limit,
            quotaType: operationType
        });
    }

    // Check if a job for this domain already exists
    let jobId = Object.keys(jobs).find(id => jobs[id].domain === domain && jobs[id].authToken === req.authToken);
    const jobExists = !!jobId;

    if (!jobExists) {
        jobId = uuidv4();
        jobs[jobId] = {
            id: jobId,
            domain: domain,
            status: 'idle', // Job is waiting for its interval
            interval: interval,
            createdAt: new Date().toISOString(),
            lastRun: 0,
            clientId: req.clientId, // Track which client created this job
            authToken: req.authToken, // Track which token owns this job
            jobData: { sessionData, llmConfig, fields, previousEvaluation, captureSettings },
            results: [], // Array to store results from each run
            error: null,
        };

        // Update quotas based on operation type
        if (interval) {
            tokenManager.updateQuotas(req.authToken, { type: 'start_recurring' }, domain);
        } else {
            tokenManager.updateQuotas(req.authToken, { type: 'start_manual' });
        }

        console.log(`[${jobId}] New ${operationType} job created by ${req.clientId} for domain ${domain}`);
        console.log(`[${jobId}] Capture settings:`, captureSettings);
    } else {
        // Security: Only allow the token owner to update their job
        const existingJob = jobs[jobId];
        if (existingJob.authToken !== req.authToken) {
            console.warn(`[SECURITY] Token ${req.authToken.substring(0, 16)}... attempted to modify job ${jobId} owned by different token`);
            return res.status(403).json({ error: 'Unauthorized to modify this job' });
        }

        // Cancel any pending deletion timeout for this job
        if (jobDeletionTimeouts.has(jobId)) {
            clearTimeout(jobDeletionTimeouts.get(jobId));
            jobDeletionTimeouts.delete(jobId);
            console.log(`[${jobId}] Cancelled pending deletion due to job update`);
        }

        // Update existing job
        const job = jobs[jobId];
        const wasRecurring = !!job.interval;
        const willBeRecurring = !!interval;

        job.interval = interval;
        job.jobData = { sessionData, llmConfig, fields, previousEvaluation, captureSettings };
        job.status = 'idle';

        // Update quotas if job type changed
        if (wasRecurring && !willBeRecurring) {
            // Recurring -> Manual
            tokenManager.updateQuotas(req.authToken, { type: 'stop_recurring' }, domain);
            tokenManager.updateQuotas(req.authToken, { type: 'start_manual' });
        } else if (!wasRecurring && willBeRecurring) {
            // Manual -> Recurring
            tokenManager.updateQuotas(req.authToken, { type: 'finish_manual' });
            tokenManager.updateQuotas(req.authToken, { type: 'start_recurring' }, domain);
        }

        console.log(`[${jobId}] Existing job for domain ${domain} updated by ${req.clientId}`);
        console.log(`[${jobId}] Updated capture settings:`, captureSettings);
    }

    // If it's a one-off job (no interval), run it immediately.
    if (!interval) {
        console.log(`[${jobId}] Manual job for ${domain} starting immediately.`);
        processJob(jobId, { sessionData, llmConfig, fields, previousEvaluation, captureSettings });
        res.status(202).json({
            jobId,
            message: "Manual job started.",
            operationType: 'manual_capture'
        });
    } else {
        res.status(201).json({
            jobId,
            message: `Recurring job ${jobExists ? 'updated' : 'created'}.`,
            operationType: 'recurring_job'
        });
    }
});

/**
 * Endpoint to get the status and accumulated results of a job.
 * Requires valid authentication token.
 */
app.get('/job/:id', requireValidToken, (req, res) => {
    const jobId = req.params.id;
    const job = jobs[jobId];

    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }

    // Security: Only allow the token owner to access their job
    if (job.authToken !== req.authToken) {
        console.warn(`[SECURITY] Token ${req.authToken.substring(0, 16)}... attempted to access job ${jobId} owned by different token`);
        return res.status(403).json({ error: 'Unauthorized to access this job' });
    }

    // Return a summary of the job, not the full result data here
    const jobSummary = {
        id: job.id,
        domain: job.domain,
        status: job.status,
        interval: job.interval,
        operationType: job.interval ? 'recurring_job' : 'manual_capture',
        createdAt: job.createdAt,
        lastRun: job.lastRun,
        resultCount: job.results.length,
    };
    console.log(`[${jobId}] Status check by ${req.clientId}: ${job.status}, ${job.results.length} results pending.`);
    res.status(200).json(jobSummary);
});


/**
 * NEW: Endpoint to stop and delete a recurring job.
 * Requires valid authentication token.
 */
app.delete('/job/:id', requireValidToken, (req, res) => {
    const jobId = req.params.id;
    const job = jobs[jobId];

    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }

    // Security: Only allow the token owner to delete their job
    if (job.authToken !== req.authToken) {
        console.warn(`[SECURITY] Token ${req.authToken.substring(0, 16)}... attempted to delete job ${jobId} owned by different token`);
        return res.status(403).json({ error: 'Unauthorized to delete this job' });
    }

    // Browser cleanup no longer needed - we create fresh browser per capture

    // Update quotas when deleting job
    if (job.interval) {
        // Recurring job
        tokenManager.updateQuotas(req.authToken, { type: 'stop_recurring' }, job.domain);
    } else {
        // Manual job
        tokenManager.updateQuotas(req.authToken, { type: 'finish_manual' });
    }

    // Cancel any pending deletion timeout
    if (jobDeletionTimeouts.has(jobId)) {
        clearTimeout(jobDeletionTimeouts.get(jobId));
        jobDeletionTimeouts.delete(jobId);
    }

    delete jobs[jobId];
    console.log(`[${jobId}] Job deleted by ${req.clientId}, quotas updated.`);
    res.status(200).json({ message: 'Job deleted successfully.' });
});

/**
 * NEW: Endpoint to fetch all accumulated results for a job.
 * Requires valid authentication token.
 */
app.get('/job/:id/results', requireValidToken, (req, res) => {
    const jobId = req.params.id;

    try {
        console.log(`[RESULTS] Starting results fetch for job ${jobId} by client ${req.clientId}`);

        const job = jobs[jobId];
        console.log(`[RESULTS] Job exists: ${!!job}`);

        if (!job) {
            console.log(`[RESULTS] Job ${jobId} not found. Available jobs: ${Object.keys(jobs)}`);
            return res.status(404).json({ error: 'Job not found' });
        }

        console.log(`[RESULTS] Job security check...`);
        // Security: Only allow the token owner to access their job results
        if (job.authToken !== req.authToken) {
            console.warn(`[SECURITY] Token ${req.authToken.substring(0, 16)}... attempted to access job ${jobId} owned by different token`);
            return res.status(403).json({ error: 'Forbidden' });
        }

        console.log(`[RESULTS] Job ${jobId} has ${job.results.length} total results`);

        console.log(`[RESULTS] Filtering results...`);
        // Filter results to only include those not yet retrieved by this client
        const resultsToReturn = job.results.filter(r => {
            // Ensure retrievedBy exists (for backward compatibility with error results)
            if (!r.retrievedBy) {
                r.retrievedBy = [];
            }
            return !r.retrievedBy.includes(req.clientId);
        });

        console.log(`[RESULTS] ${resultsToReturn.length} new results for client ${req.clientId}`);

        if (resultsToReturn.length > 0) {
            console.log(`[${jobId}] Fetching ${resultsToReturn.length} new results for ${req.clientId}.`);

            console.log(`[RESULTS] Marking results as retrieved...`);
            // Mark these results as retrieved for this client
            resultsToReturn.forEach(r => {
                const resultInJob = job.results.find(br => br.resultId === r.resultId);
                if (resultInJob) {
                    resultInJob.retrievedBy.push(req.clientId);
                }
            });

            console.log(`[RESULTS] Preparing response payload...`);
            const responsePayload = { results: resultsToReturn };

            console.log(`[${jobId}] Sending results payload to ${req.clientId}:`);
            try {
                // Create sanitized version for logging (without large screenshotData)
                const sanitizedPayload = JSON.parse(JSON.stringify(responsePayload));
                if (sanitizedPayload.results) {
                    sanitizedPayload.results.forEach(result => {
                        if (result.screenshotData) {
                            result.screenshotData = `[SCREENSHOT DATA - ${result.screenshotData.length} chars]`;
                        }
                    });
                }
                console.log(JSON.stringify(sanitizedPayload, null, 2));
            } catch (jsonError) {
                console.error(`[RESULTS] JSON stringify error:`, jsonError);
                console.log(`[RESULTS] Payload structure:`, typeof responsePayload, Object.keys(responsePayload));
                console.log(`[RESULTS] Results array length:`, resultsToReturn.length);
            }

            console.log(`[RESULTS] Sending response...`);
            res.status(200).json(responsePayload);
        } else {
            // No new results for this client
            console.log(`[RESULTS] No new results for client ${req.clientId}, sending empty array`);
            res.status(200).json({ results: [] });
        }

        console.log(`[RESULTS] Results endpoint completed successfully for job ${jobId}`);
    } catch (error) {
        console.error(`[RESULTS] ERROR in results endpoint for job ${jobId}:`, error);
        console.error(`[RESULTS] Error stack:`, error.stack);
        res.status(500).json({ error: error.message });
    }
});

/**
 * NEW: Endpoint to purge results after the extension has synced them.
 * Supports selective purging with keepLast parameter for interval jobs.
 * Requires valid authentication token.
 */
app.post('/job/:id/purge', requireValidToken, (req, res) => {
    const jobId = req.params.id;
    const { keepLast = 0 } = req.body || {}; // New parameter to keep last N results

    const job = jobs[jobId];
    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }

    // Security: Only allow the token owner to purge their job results
    if (job.authToken !== req.authToken) {
        console.warn(`[SECURITY] Token ${req.authToken.substring(0, 16)}... attempted to purge results for job ${jobId} owned by different token`);
        return res.status(403).json({ error: 'Unauthorized to purge this job' });
    }

    const totalResults = job.results.length;

    if (keepLast > 0 && totalResults > keepLast) {
        // Selective purge: keep only the last N results
        const resultsToPurge = totalResults - keepLast;
        job.results.splice(0, resultsToPurge); // Remove from beginning, keep end
        console.log(`[${jobId}] Selectively purged ${resultsToPurge} results, kept last ${keepLast} for ${req.clientId}.`);
        res.status(200).json({
            message: `Purged ${resultsToPurge} results, kept last ${keepLast}.`,
            purged: resultsToPurge,
            kept: keepLast,
            remaining: job.results.length
        });
    } else if (keepLast === 0) {
        // Full purge: clear all results
        const purgedCount = job.results.length;
        job.results = []; // Clear the results array
        console.log(`[${jobId}] Purged all ${purgedCount} results for ${req.clientId}.`);
        res.status(200).json({
            message: `Purged ${purgedCount} results.`,
            purged: purgedCount,
            kept: 0,
            remaining: 0
        });
    } else {
        // Nothing to purge
        console.log(`[${jobId}] No results to purge (total: ${totalResults}, keepLast: ${keepLast}).`);
        res.status(200).json({
            message: 'No results to purge.',
            purged: 0,
            kept: totalResults,
            remaining: totalResults
        });
    }
});

/**
 * Endpoint to get all jobs for the authenticated token
 * Used for synchronization between extension and cloud runner
 */
app.get('/jobs', requireValidToken, (req, res) => {
    try {
        // Filter jobs that belong to this token
        const userJobs = Object.values(jobs).filter(job => job.authToken === req.authToken);

        // Include all active jobs: interval jobs and running manual jobs
        const activeJobs = userJobs.filter(job => {
            // Always include interval jobs
            if (job.interval && job.interval > 0) {
                return true;
            }
            // Include manual jobs that are still running
            if (!job.interval && job.status === 'running') {
                return true;
            }
            return false;
        });

        // Return simplified job data for synchronization
        const jobsData = activeJobs.map(job => ({
            id: job.id,
            domain: job.domain,
            status: job.status,
            interval: job.interval || 0,  // Default to 0 for manual jobs
            createdAt: job.createdAt,
            lastRun: job.lastRun,
            runCount: job.results?.length || 0,
            nextRun: job.nextRun,
            error: job.error,
            url: job.jobData?.sessionData?.url || `https://${job.domain}`,
            isManual: !job.interval  // Add flag to identify manual jobs
        }));

        console.log(`[SYNC] Returning ${jobsData.length} active jobs for client ${req.tokenData.clientId} (filtered from ${userJobs.length} total)`);
        res.json({ jobs: jobsData });

    } catch (error) {
        console.error('[SYNC] Error getting jobs:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * Root endpoint - minimal information disclosure
 */
app.get('/', (req, res) => {
    res.status(200).json({
        service: 'WebSophon Cloud Runner',
        status: 'operational',
        version: '1.0.0',
        jobsActive: Object.keys(jobs).length,
        totalClients: clientMetrics.size
    });
});

/**
 * Endpoint to test the cloud runner connection.
 * Requires valid authentication token.
 */
app.post('/test', requireValidToken, (req, res) => {
    console.log(`[TEST] Token test by client ${req.clientId}`);
    const tokenStats = tokenManager.getTokenStats(req.authToken);
    res.status(200).json({
        success: true,
        message: 'Cloud runner is running with valid token.',
        clientId: req.clientId,
        timestamp: new Date().toISOString(),
        quotas: tokenStats ? tokenStats.quotas : null
    });
});

/**
 * Compresses a screenshot buffer using Sharp for storage optimization
 * @param {Buffer} screenshotBuffer - Original PNG screenshot buffer
 * @returns {Buffer} Compressed JPEG buffer
 */
async function compressScreenshot(screenshotBuffer) {
    try {
        // Compress to JPEG with optimized settings for storage
        const compressedBuffer = await sharp(screenshotBuffer)
            .resize(1920, 1080, {
                fit: 'inside',           // Keep aspect ratio, don't crop
                withoutEnlargement: true // Don't upscale if smaller
            })
            .jpeg({
                quality: 85,             // Good balance of quality vs size
                progressive: true,       // Progressive JPEG for better loading
                mozjpeg: true           // Use mozjpeg encoder for better compression
            })
            .toBuffer();

        return compressedBuffer;
    } catch (error) {
        console.error('Error compressing screenshot:', error);
        // Fallback: return original buffer if compression fails
        return screenshotBuffer;
    }
}

/**
 * Processes the capture job using Puppeteer.
 * This function now appends results to the job's results array.
 */
async function processJob(jobId, jobData) {
    const job = jobs[jobId];
    if (!job) {
        console.error(`[${jobId}] Tried to process a job that does not exist.`);
        return;
    }

    // Prevent concurrent runs for the same job
    if (job.status === 'running') {
        console.warn(`[${jobId}] Job is already running. Skipping this execution.`);
        return;
    }

    // ALWAYS use the latest jobData from the job object, not the parameter
    // This ensures we get fresh session data if the job was updated
    const latestJobData = job.jobData || jobData;
    const { sessionData, llmConfig, fields, previousEvaluation, captureSettings = {} } = latestJobData;

    console.log(`[${jobId}] Using ${latestJobData === job.jobData ? 'latest' : 'provided'} job data`);
    if (previousEvaluation) {
        console.log(`[${jobId}] Initial previousEvaluation provided:`, previousEvaluation);
    }

    let browser;

    try {
        console.log(`[${jobId}] Starting job processing...`);
        job.status = 'running';

        // ALWAYS create a fresh browser for reliable session handling
        console.log(`[${jobId}] Launching new Puppeteer instance...`);
        browser = await puppeteer.launch({
            headless: true,
            executablePath: '/usr/bin/google-chrome',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();

        console.log(`[${jobId}] Setting up browser environment...`);

        if (sessionData.userAgent) await page.setUserAgent(sessionData.userAgent);
        if (sessionData.viewport) await page.setViewport(sessionData.viewport);

        // Set cookies
        if (sessionData.cookies && sessionData.cookies.length > 0) {
            await page.setCookie(...sessionData.cookies);
            console.log(`[${jobId}] Set ${sessionData.cookies.length} cookies`);
        }

        // Set local/session storage
        await page.evaluateOnNewDocument((storage) => {
            // Wrap in try-catch as some pages block localStorage access
            if (storage.localStorage) {
                try {
                    for (const [key, value] of Object.entries(storage.localStorage)) {
                        window.localStorage.setItem(key, value);
                    }
                } catch (e) {
                    console.log('localStorage access denied on new document:', e.message);
                }
            }
            if (storage.sessionStorage) {
                try {
                    for (const [key, value] of Object.entries(storage.sessionStorage)) {
                        window.sessionStorage.setItem(key, value);
                    }
                } catch (e) {
                    console.log('sessionStorage access denied on new document:', e.message);
                }
            }
        }, { localStorage: sessionData.localStorage, sessionStorage: sessionData.sessionStorage });

        console.log(`[${jobId}] Navigating to ${sessionData.url}...`);

        // Use less strict wait conditions - just wait for basic page load
        // Sites like TradingView continuously stream data, so networkidle0 will never complete
        await page.goto(sessionData.url, {
            waitUntil: ['load', 'networkidle2'],  // Wait for load and network to mostly settle
            timeout: 120000 // 120 second timeout for slow sites
        });

        console.log(`[${jobId}] Page loaded`);

        // Additional wait for JavaScript-heavy sites to render
        console.log(`[${jobId}] Waiting 5 seconds for JavaScript rendering...`);
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Handle page refresh if enabled
        if (captureSettings.refreshPageToggle && job.lastRun) {
            console.log(`[${jobId}] Refreshing page before capture (refresh enabled)...`);
            await page.reload({
                waitUntil: ['load', 'networkidle2'],
                timeout: 120000
            });
            console.log(`[${jobId}] Page refresh completed`);
        }

        // Apply capture delay if specified
        const captureDelay = parseInt(captureSettings.captureDelay || '0');
        if (captureDelay > 0) {
            console.log(`[${jobId}] Waiting ${captureDelay} seconds before capture...`);
            await new Promise(resolve => setTimeout(resolve, captureDelay * 1000));
            console.log(`[${jobId}] Capture delay completed`);
        }

        console.log(`[${jobId}] Taking screenshot...`);
        // Respect full page capture setting
        const fullPageCapture = captureSettings.fullPageCaptureToggle || false;
        const screenshotBuffer = await page.screenshot({
            fullPage: fullPageCapture,
            type: 'png'
        });
        console.log(`[${jobId}] Screenshot captured (full page: ${fullPageCapture}), original size: ${screenshotBuffer.length} bytes`);

        // Compress the screenshot using Sharp for storage optimization
        console.log(`[${jobId}] Compressing screenshot...`);
        const compressedBuffer = await compressScreenshot(screenshotBuffer);
        const screenshotData = `data:image/jpeg;base64,${compressedBuffer.toString('base64')}`;
        console.log(`[${jobId}] Screenshot compressed: ${screenshotBuffer.length} → ${compressedBuffer.length} bytes (${Math.round((1 - compressedBuffer.length / screenshotBuffer.length) * 100)}% reduction)`);

        console.log(`[${jobId}] Sending to LLM...`);
        // Use the job's last result as context for the next one
        let previousEvaluation = latestJobData.previousEvaluation; // Start with initial context

        // Log initial context if provided
        if (previousEvaluation) {
            console.log(`[${jobId}] Initial previousEvaluation from job creation:`, previousEvaluation);
        }

        if (job.results.length > 0) {
            console.log(`[${jobId}] Job has ${job.results.length} previous results, using latest for context`);
            const lastResult = job.results[job.results.length - 1];
            if (lastResult.llmResponse && lastResult.llmResponse.evaluation) {
                // Apply confidence threshold filtering before passing to next iteration
                const filteredEvaluation = {};

                for (const field of fields) {
                    const fieldName = field.name;
                    const fieldResult = lastResult.llmResponse.evaluation[fieldName];

                    if (fieldResult && Array.isArray(fieldResult) && fieldResult.length >= 1) {
                        const result = fieldResult[0]; // boolean result
                        const probability = fieldResult.length > 1 ? fieldResult[1] : 0.8;

                        // Apply confidence threshold filtering (using webhookMinConfidence for consistency)
                        const minConfidence = field.webhookMinConfidence !== undefined ? field.webhookMinConfidence : 75;
                        const confidencePercent = probability * 100;

                        let filteredResult = result;
                        if (result === true && confidencePercent < minConfidence) {
                            filteredResult = false; // Demote low-confidence TRUE to FALSE
                            console.log(`[${jobId}] Previous evaluation: Field "${fieldName}" TRUE demoted to FALSE (${confidencePercent.toFixed(1)}% < ${minConfidence}%)`);
                        }

                        // Only pass the boolean value, not the confidence score
                        filteredEvaluation[fieldName] = filteredResult;
                    }
                }

                // Pass only filtered boolean values as context
                previousEvaluation = {
                    results: filteredEvaluation
                };
                console.log(`[${jobId}] Filtered previous evaluation for context:`, filteredEvaluation);
            }
        } else {
            console.log(`[${jobId}] No previous results in job history, using initial context if provided`);
        }

        // Also ensure the initial previousEvaluation from frontend is in the correct format
        if (previousEvaluation && !previousEvaluation.results && typeof previousEvaluation === 'object') {
            // If frontend sent the old format with full field data, convert it
            const filteredResults = {};

            Object.keys(previousEvaluation).forEach(fieldName => {
                const fieldData = previousEvaluation[fieldName];
                if (fieldData && typeof fieldData.result === 'boolean') {
                    filteredResults[fieldName] = fieldData.result;
                } else if (typeof fieldData === 'boolean') {
                    filteredResults[fieldName] = fieldData;
                }
            });

            previousEvaluation = Object.keys(filteredResults).length > 0
                ? { results: filteredResults }
                : null;
        }

        // Use original uncompressed screenshot for LLM analysis (better quality)
        // but store the compressed version for storage efficiency
        console.log(`[${jobId}] Calling LLM service with previousEvaluation:`, previousEvaluation ? JSON.stringify(previousEvaluation) : 'none');
        const { response, requestPayload, rawContent } = await callLlmService(screenshotBuffer.toString('base64'), llmConfig, fields, previousEvaluation);

        // Fire field-level webhooks if response contains evaluation data
        let fieldWebhooks = [];
        // For SAPIENT responses, fields are at the top level. For legacy responses, they're in response.evaluation
        const hasEvaluationData = response && (response.evaluation || fields.some(f => f.name in response));

        if (hasEvaluationData) {
            try {
                console.log(`[${jobId}] About to fire webhooks with domain: ${job.domain}`);
                // Wrap SAPIENT responses in evaluation property for webhook firing
                const webhookResponse = response.evaluation ? response : { evaluation: response };
                fieldWebhooks = await fireFieldWebhooks(jobId, job.domain, webhookResponse, fields);
                console.log(`[${jobId}] Webhooks fired successfully, results: ${fieldWebhooks.length} webhooks`);
            } catch (webhookError) {
                console.error(`[${jobId}] Error firing webhooks:`, webhookError);
                console.error(`[${jobId}] Webhook error stack:`, webhookError.stack);
                // Don't fail the job for webhook errors, just log them and continue
                fieldWebhooks = [{
                    fieldName: 'webhook_error',
                    error: `Webhook firing failed: ${webhookError.message}`,
                    success: false,
                    request: null,
                    response: null,
                    httpStatus: null
                }];
            }
        } else {
            console.log(`[${jobId}] No evaluation data found, skipping webhook firing`);
        }

        // Add webhook results to the SAPIENT response if present
        if (fieldWebhooks.length > 0) {
            if (!response.webhooks) {
                response.webhooks = fieldWebhooks;
            }
        }

        // Normalize response structure for storage (ensure evaluation property exists)
        // For SAPIENT responses, separate the summary from field evaluations
        let normalizedResponse;
        if (response.evaluation) {
            // Response already has evaluation wrapper
            normalizedResponse = response;
        } else {
            // SAPIENT response - separate summary from field evaluations
            const { summary, ...fieldEvaluations } = response;
            normalizedResponse = {
                evaluation: fieldEvaluations,
                summary: summary || ''
            };
        }

        // Add webhook results to the normalized response if present
        if (fieldWebhooks.length > 0) {
            normalizedResponse.webhooks = fieldWebhooks;
        }

        // Add the new result to the job's history
        job.results.push({
            resultId: uuidv4(),
            timestamp: new Date().toISOString(),
            screenshotData: screenshotData,
            llmRequestPayload: { ...requestPayload, messages: requestPayload.messages.map(m => (m.role === 'user' ? { ...m, content: [{ type: 'text', text: 'Please analyze this screenshot.' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,REDACTED' } }] } : m)) },
            llmResponse: normalizedResponse, // This now includes webhook results and normalized structure
            llmRawResponse: rawContent, // Store the raw SAPIENT response
            error: null,
            captureSettings: captureSettings, // Store settings used for this capture
            retrievedBy: [] // Initialize retrievedBy array
        });

        job.status = job.interval ? 'idle' : 'complete'; // Reset to idle for next interval
        job.lastRun = new Date().toISOString(); // Update lastRun timestamp

        // Update quotas when manual job completes
        if (!job.interval && job.authToken) {
            tokenManager.updateQuotas(job.authToken, { type: 'finish_manual' });
            console.log(`[${jobId}] Manual job completed, quota updated`);
        }

        console.log(`[${jobId}] Job run completed successfully. Total results: ${job.results.length}`);
        if (fieldWebhooks.length > 0) {
            console.log(`[${jobId}] Fired ${fieldWebhooks.length} field webhooks`);
        }

    } catch (error) {
        console.error(`[${jobId}] Error processing job:`, error);
        job.status = 'failed';
        job.error = error.message;

        // Update quotas even on failure for manual jobs
        if (!job.interval && job.authToken) {
            tokenManager.updateQuotas(job.authToken, { type: 'finish_manual' });
            console.log(`[${jobId}] Manual job failed, quota updated`);
        }

        // Also add error to results history
        job.results.push({
            resultId: uuidv4(),
            timestamp: new Date().toISOString(),
            error: error.message,
            captureSettings: captureSettings,
            retrievedBy: [] // Initialize retrievedBy array for error results too
        });
    } finally {
        // ALWAYS close the browser after each capture
        if (browser) {
            await browser.close();
            console.log(`[${jobId}] Browser closed`);
        }

        // If it was a one-off job that's done, clean it up after a while
        if (job && !job.interval) {
            // Clean up failed jobs faster than successful ones
            const cleanupDelay = job.status === 'failed' ? 60000 : 60000 * 15; // 1 minute for failed, 15 minutes for completed

            const timeoutId = setTimeout(() => {
                if (jobs[jobId]) {
                    console.log(`[${jobId}] Deleting completed one-off job (status: ${job.status}).`);
                    delete jobs[jobId];
                    jobDeletionTimeouts.delete(jobId);
                }
            }, cleanupDelay);

            // Store the timeout ID so we can cancel it if needed
            jobDeletionTimeouts.set(jobId, timeoutId);
        }
    }
}

async function callLlmService(base64Image, llmConfig, fields, previousEvaluation) {
    const modelName = llmConfig.model || 'gpt-4-vision-preview';
    const systemPrompt = getSystemPrompt(fields, previousEvaluation, modelName);
    const requestPayload = {
        model: modelName,
        messages: [
            { role: 'system', content: systemPrompt },
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Please analyze this screenshot.' },
                    { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}` } }
                ]
            }
        ],
        max_tokens: llmConfig.maxTokens || 5000,
        temperature: llmConfig.temperature || 0.1,
    };

    const response = await fetch(llmConfig.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${llmConfig.apiKey}` },
        body: JSON.stringify(requestPayload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM API Error ${response.status}: ${errorText}`);
    }

    const responseData = await response.json();
    let finalResponse;
    let rawContent = ''; // Store the raw LLM response content

    if (responseData.choices && responseData.choices[0] && responseData.choices[0].message) {
        // Store the raw content BEFORE any processing
        rawContent = responseData.choices[0].message.content;
        console.log('[Cloud Runner] Raw LLM content:', rawContent);

        let content = responseData.choices[0].message.content.replace(/^```json\s*|```\s*$/g, '');

        // Check if response was truncated
        const finishReason = responseData.choices[0].finish_reason;
        if (finishReason === 'length') {
            console.warn('LLM response was truncated due to max_tokens limit. Consider increasing max_tokens.');
            // Try to salvage partial JSON by adding closing braces
            if (content.includes('{') && !content.trim().endsWith('}')) {
                console.log('Attempting to repair truncated JSON...');
                const openBraces = (content.match(/\{/g) || []).length;
                const closeBraces = (content.match(/\}/g) || []).length;
                const missingBraces = openBraces - closeBraces;

                // Add missing closing braces
                for (let i = 0; i < missingBraces; i++) {
                    content += '}';
                }
                console.log('Added', missingBraces, 'closing braces to repair JSON');
            }
        }

        // Check if this is a SAPIENT response
        const sapientData = parseSAPIENTResponse(content);
        if (sapientData) {
            console.log('Detected SAPIENT protocol response');

            // The shared parser already returns normalized format
            finalResponse = sapientData;
            console.log('Successfully parsed SAPIENT response');
        } else {
            // Try to parse as JSON (legacy format)
            try {
                const parsedContent = JSON.parse(content);
                // Normalize the response to ensure consistent format
                finalResponse = normalizeCloudLLMResponse(parsedContent, fields);
                console.log('Successfully parsed JSON LLM response');
            } catch (e) {
                console.error('JSON parsing failed:', e.message);
                console.error('Raw content length:', content.length);
                console.error('Raw content preview:', content.substring(0, 200) + '...');

                // Return both the error and the raw content for debugging
                finalResponse = {
                    raw_content: content,
                    parse_error: e.message,
                    finish_reason: finishReason,
                    content_length: content.length,
                    truncated: finishReason === 'length'
                };
            }
        }
    } else {
        finalResponse = responseData;
    }

    return { response: finalResponse, requestPayload: requestPayload, rawContent: rawContent };
}

// Normalize cloud LLM response to match local parsing logic
function normalizeCloudLLMResponse(rawResponse, fields) {
    console.log('Cloud runner normalizing LLM response:', rawResponse);

    // Handle responses with "evaluation" wrapper (newer format)
    let dataToProcess = rawResponse;
    if (rawResponse.evaluation && typeof rawResponse.evaluation === 'object') {
        dataToProcess = rawResponse.evaluation;
        console.log('Cloud runner: Found evaluation wrapper, processing inner data');
    }

    const normalized = { evaluation: {} };
    const fieldNames = fields.map(f => f.name);

    for (const fieldName of fieldNames) {
        const fieldData = dataToProcess[fieldName];
        let result = null;
        let probability = null;

        if (fieldData !== undefined) {
            // Handle LLM array format: [boolean, probability]
            if (Array.isArray(fieldData) && fieldData.length >= 1) {
                result = fieldData[0];
                probability = fieldData.length > 1 ? fieldData[1] : 0.8;
            }
            // Handle {result: boolean, confidence: number} format from Gemini and other LLMs
            else if (typeof fieldData === 'object' && fieldData.result !== undefined) {
                result = fieldData.result;
                probability = fieldData.confidence || fieldData.probability || 0.8;
            }
            // Handle legacy {boolean: boolean, probability: number} format
            else if (typeof fieldData === 'object' && fieldData.boolean !== undefined) {
                result = fieldData.boolean;
                probability = fieldData.probability || 0.8;
            }
            // Handle direct boolean
            else if (typeof fieldData === 'boolean') {
                result = fieldData;
                probability = 0.8;
            }

            if (result !== null) {
                // Convert to our standard array format
                normalized.evaluation[fieldName] = [result, probability];
                console.log(`Cloud runner normalized field "${fieldName}": [${result}, ${probability}]`);
            }
        }
    }

    // Preserve summary field (from summary or reason)
    if (rawResponse.summary) {
        normalized.summary = rawResponse.summary;
    } else if (rawResponse.reason) {
        normalized.summary = rawResponse.reason;
    }

    console.log('Cloud runner final normalized response:', normalized);
    return normalized;
}

// Cleanup function for expired jobs and client metrics
function cleanup() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    // Clean up old client metrics
    for (const [clientId, client] of clientMetrics.entries()) {
        if (now - client.lastSeen > maxAge) {
            clientMetrics.delete(clientId);
            console.log(`[CLEANUP] Removed expired client metrics for ${clientId}`);
        }
    }

    // Clean up completed one-off jobs older than 1 hour
    const jobCleanupAge = 60 * 60 * 1000; // 1 hour
    for (const [jobId, job] of Object.entries(jobs)) {
        if (!job.interval && job.status === 'complete') {
            const jobAge = now - new Date(job.createdAt).getTime();
            if (jobAge > jobCleanupAge) {
                delete jobs[jobId];
                console.log(`[CLEANUP] Removed expired job ${jobId}`);
            }
        }
    }

    // Clear blocked IPs periodically (reset every 24 hours)
    if (Math.random() < 0.01) { // 1% chance each cleanup
        blockedIPs.clear();
        blockedClients.clear();
        console.log(`[CLEANUP] Reset blocked IPs and clients`);
    }
}

// Run cleanup every 10 minutes
setInterval(cleanup, 10 * 60 * 1000);

// Global error handlers
process.on('uncaughtException', (error) => {
    console.error('[UNCAUGHT EXCEPTION]', error);
    console.error('[UNCAUGHT EXCEPTION] Stack:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[UNHANDLED REJECTION] At:', promise, 'reason:', reason);
    console.error('[UNHANDLED REJECTION] Stack:', reason?.stack);
});

app.listen(port, () => {
    console.log(`Cloud runner listening on port ${port}`);
    jobScheduler.start();
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    jobScheduler.stop();

    app.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

/**
 * Endpoint to update session data for an existing job
 * Used by extension to refresh session data before interval captures
 */
app.put('/job/:id/session', requireValidToken, async (req, res) => {
    const jobId = req.params.id;
    const { sessionData } = req.body;

    const job = jobs[jobId];
    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }

    // Security: Only allow the token owner to update their job
    if (job.authToken !== req.authToken) {
        console.warn(`[SECURITY] Token ${req.authToken.substring(0, 16)}... attempted to update session for job ${jobId} owned by different token`);
        return res.status(403).json({ error: 'Unauthorized to update this job' });
    }

    if (!sessionData) {
        return res.status(400).json({ error: 'Session data required' });
    }

    // Preserve the original URL while updating other session data
    const originalUrl = job.jobData.sessionData.url;
    console.log(`[${jobId}] Updating session data for domain ${job.domain}, preserving original URL: ${originalUrl}`);

    // Log if the incoming session data had a different URL
    if (sessionData.url && sessionData.url !== originalUrl) {
        console.log(`[${jobId}] Note: Incoming session data had different URL (${sessionData.url}), but keeping original URL (${originalUrl})`);
    }

    // Update session data but keep the original URL
    job.jobData.sessionData = {
        ...sessionData,
        url: originalUrl // Always preserve the original URL
    };
    job.lastSessionUpdate = new Date().toISOString();

    res.status(200).json({
        success: true,
        message: 'Session data updated',
        lastUpdate: job.lastSessionUpdate,
        preservedUrl: originalUrl
    });
});
