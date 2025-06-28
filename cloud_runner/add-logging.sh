#!/bin/bash

# Backup original server.js
cp server.js server.js.backup

# Create a modified server.js with request logging
cat > server-with-logging.js << 'SERVEREOF'
// Add this at the top after other imports
import express from 'express';
import bodyParser from 'body-parser';
import { v4 as uuidv4 } from 'uuid';
import puppeteer from 'puppeteer';
import cors from 'cors';
import crypto from 'crypto';
import { getSystemPrompt } from './utils/prompt-formatters.js';
import { parseSAPIENTResponse } from './utils/sapient-parser.js';
import { fireFieldWebhooks } from './utils/webhook-utils.js';

// Request logger middleware
function requestLogger(req, res, next) {
    // Only log specific endpoints we care about
    const importantEndpoints = ['/job', '/auth/captcha', '/auth/token/stats', '/test'];
    const shouldLog = importantEndpoints.some(endpoint => req.path.startsWith(endpoint));
    
    if (shouldLog) {
        console.log('\n========== RAW REQUEST DUMP ==========');
        console.log(`Timestamp: ${new Date().toISOString()}`);
        console.log(`Method: ${req.method}`);
        console.log(`URL: ${req.originalUrl}`);
        console.log(`IP: ${req.ip}`);
        
        console.log('\nHEADERS:');
        Object.entries(req.headers).forEach(([key, value]) => {
            // Mask sensitive data but keep structure
            if (key.toLowerCase().includes('key') || key.toLowerCase().includes('token')) {
                console.log(`  ${key}: ${value ? value.substring(0, 30) + '...' : 'null'}`);
            } else {
                console.log(`  ${key}: ${value}`);
            }
        });
        
        if (req.body && Object.keys(req.body).length > 0) {
            console.log('\nBODY:');
            // Pretty print but mask sensitive fields
            const sanitizedBody = JSON.parse(JSON.stringify(req.body));
            if (sanitizedBody.llmConfig?.apiKey) {
                sanitizedBody.llmConfig.apiKey = sanitizedBody.llmConfig.apiKey.substring(0, 10) + '...';
            }
            if (sanitizedBody.captchaResponse) {
                sanitizedBody.captchaResponse = sanitizedBody.captchaResponse.substring(0, 20) + '...';
            }
            console.log(JSON.stringify(sanitizedBody, null, 2));
        }
        
        console.log('======================================\n');
    }
    next();
}

SERVEREOF

# Append the rest of the original server.js, adding the middleware after app setup
tail -n +10 server.js >> server-with-logging.js

# Find where app.use statements are and inject our logger
sed -i '/app.use(cors());/a app.use(requestLogger);' server-with-logging.js

# Replace the original server.js
mv server-with-logging.js server.js

echo "✅ Request logging added to server.js"
echo "The server will now log raw requests for: /job, /auth/captcha, /auth/token/stats, /test"
