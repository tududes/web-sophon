// Middleware to log raw request details
export function requestLogger(req, res, next) {
    console.log('\n========== RAW REQUEST DUMP ==========');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`Method: ${req.method}`);
    console.log(`URL: ${req.originalUrl}`);
    console.log(`IP: ${req.ip}`);
    
    console.log('\nHEADERS:');
    Object.entries(req.headers).forEach(([key, value]) => {
        // Mask sensitive data but keep structure
        if (key.toLowerCase().includes('key') || key.toLowerCase().includes('token')) {
            console.log(`  ${key}: ${value ? value.substring(0, 20) + '...' : 'null'}`);
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
    next();
}
