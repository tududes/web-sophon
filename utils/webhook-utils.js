// Shared webhook utility for firing field webhooks
// Used by both extension services and cloud runner

/**
 * Fire a webhook for a field result
 * @param {string} fieldName - Name of the field
 * @param {string} webhookUrl - Webhook URL to call
 * @param {string|null} customPayload - Custom JSON payload (if null, uses GET request)
 * @param {Array} fieldResult - Field result array [boolean, probability]
 * @param {Object} context - Additional context (domain, timestamp, etc.)
 * @returns {Promise<Object>} Webhook result with request/response details
 */
export async function fireFieldWebhook(fieldName, webhookUrl, customPayload, fieldResult, context = {}) {
    console.log(`[Webhook] Firing webhook for field "${fieldName}" to ${webhookUrl}`);

    const timestamp = new Date().toISOString();
    const [result, probability] = fieldResult || [null, null];

    const requestData = {
        url: webhookUrl,
        method: customPayload ? 'POST' : 'GET',
        payload: customPayload,
        timestamp: timestamp
    };

    try {
        let response;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

        if (customPayload) {
            // POST request with custom JSON payload
            let parsedPayload;
            try {
                parsedPayload = JSON.parse(customPayload);
            } catch (e) {
                // If custom payload is invalid JSON, create a default payload
                parsedPayload = {
                    error: 'Invalid JSON payload provided',
                    raw: customPayload,
                    field: fieldName,
                    result: result,
                    probability: probability,
                    timestamp: timestamp,
                    ...context
                };
            }

            // Check if this is a Discord webhook
            if (webhookUrl.includes('discord.com/api/webhooks')) {
                // Format payload for Discord
                parsedPayload = formatDiscordPayload(fieldName, result, probability, parsedPayload, context);
            }

            response = await fetch(webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(parsedPayload),
                signal: controller.signal
            });
        } else {
            // GET request - append field data as query parameters
            const url = new URL(webhookUrl);
            url.searchParams.append('field', fieldName);
            url.searchParams.append('result', result);
            url.searchParams.append('probability', probability || '');
            url.searchParams.append('timestamp', timestamp);
            if (context.domain) url.searchParams.append('domain', context.domain);

            response = await fetch(url.toString(), {
                method: 'GET',
                signal: controller.signal
            });
        }

        clearTimeout(timeoutId);

        // Get response text
        let responseText = '';
        try {
            responseText = await response.text();
        } catch (e) {
            responseText = `Failed to read response: ${e.message}`;
        }

        return {
            request: requestData,
            response: responseText,
            httpStatus: response.status,
            success: response.ok,
            error: response.ok ? null : `HTTP ${response.status}: ${response.statusText}`
        };

    } catch (error) {
        return {
            request: requestData,
            response: error.message,
            httpStatus: null,
            success: false,
            error: error.message
        };
    }
}

/**
 * Format payload for Discord webhooks
 * @param {string} fieldName - Name of the field
 * @param {boolean} result - Field result
 * @param {number} probability - Confidence/probability
 * @param {Object} customPayload - User's custom payload (if any)
 * @param {Object} context - Additional context
 * @returns {Object} Discord-formatted payload
 */
function formatDiscordPayload(fieldName, result, probability, customPayload, context) {
    // If user provided a valid Discord payload structure, use it
    if (customPayload && (customPayload.content || customPayload.embeds)) {
        return customPayload;
    }

    // Otherwise, create a formatted Discord message
    const color = result === true ? 0x00ff00 : result === false ? 0xff0000 : 0x808080; // Green for true, red for false, gray for null
    const confidencePercent = probability ? (probability * 100).toFixed(1) : 'N/A';

    return {
        username: 'WebSophon',
        avatar_url: 'https://raw.githubusercontent.com/yourusername/websophon/main/assets/icon_256.png', // Update with actual icon URL
        content: `Field evaluation completed for **${fieldName}**`,
        embeds: [{
            title: `Field: ${fieldName}`,
            color: color,
            fields: [
                {
                    name: 'Result',
                    value: result === true ? '✅ TRUE' : result === false ? '❌ FALSE' : '❓ NULL',
                    inline: true
                },
                {
                    name: 'Confidence',
                    value: `${confidencePercent}%`,
                    inline: true
                },
                {
                    name: 'Domain',
                    value: context.domain || 'Unknown',
                    inline: true
                }
            ],
            footer: {
                text: 'WebSophon Field Webhook',
                icon_url: 'https://raw.githubusercontent.com/yourusername/websophon/main/assets/icon_32.png' // Update with actual icon URL
            },
            timestamp: new Date().toISOString()
        }]
    };
}

/**
 * Process webhook configurations and fire webhooks for field results
 * @param {string} jobId - Job ID (for logging)
 * @param {string} domain - Domain being evaluated
 * @param {Object} responseData - LLM response data with evaluation
 * @param {Array} fields - Array of field configurations
 * @returns {Promise<Array>} Array of webhook results
 */
export async function fireFieldWebhooks(jobId, domain, responseData, fields) {
    console.log(`[${jobId}] Checking for field webhooks to fire...`);

    const fieldWebhooks = [];
    let hasActualFields = false;

    // Check if we have a valid response with evaluation data
    if (!responseData || !responseData.evaluation) {
        console.log(`[${jobId}] No evaluation data found in response, skipping webhooks`);
        return fieldWebhooks;
    }

    // Process each field result
    for (const field of fields) {
        if (!field.webhookEnabled || !field.webhookUrl) {
            continue;
        }

        const fieldName = field.name;
        const fieldResult = responseData.evaluation[fieldName];

        if (!fieldResult || !Array.isArray(fieldResult) || fieldResult.length < 1) {
            console.log(`[${jobId}] No result found for field "${fieldName}"`);
            continue;
        }

        hasActualFields = true;
        const result = fieldResult[0]; // boolean result
        const probability = fieldResult.length > 1 ? fieldResult[1] : 0.8;

        console.log(`[${jobId}] Field "${fieldName}" result: ${result}, probability: ${probability}`);

        // Apply confidence threshold filtering to get the filtered result
        const minConfidence = field.webhookMinConfidence !== undefined ? field.webhookMinConfidence : 75;
        const confidencePercent = probability * 100;

        // Calculate filtered result (confidence threshold applied)
        let filteredResult = result;
        if (result === true && confidencePercent < minConfidence) {
            filteredResult = false; // Demote low-confidence TRUE to FALSE
            console.log(`[${jobId}] Field "${fieldName}" TRUE result demoted to FALSE due to low confidence ${confidencePercent.toFixed(1)}% < ${minConfidence}%`);
        }

        // Check webhookTrigger setting against the FILTERED result (defaults to true for backward compatibility)
        const shouldTriggerOnTrue = field.webhookTrigger !== false; // Default to true if undefined
        const shouldFireWebhook = shouldTriggerOnTrue ? filteredResult === true : filteredResult === false;

        if (!shouldFireWebhook) {
            console.log(`[${jobId}] Field "${fieldName}" filtered result ${filteredResult} does not match trigger condition (trigger on ${shouldTriggerOnTrue ? 'TRUE' : 'FALSE'})`);
            continue;
        }

        console.log(`[${jobId}] Field "${fieldName}" firing webhook: ${field.webhookUrl}`);

        try {
            // Fire the webhook with context
            const webhookResult = await fireFieldWebhook(
                fieldName,
                field.webhookUrl,
                field.webhookPayload,
                [result, probability],
                { domain, jobId }
            );

            fieldWebhooks.push({
                fieldName: fieldName,
                ...webhookResult
            });
        } catch (error) {
            console.error(`[${jobId}] Failed to fire webhook for field "${fieldName}":`, error);
            fieldWebhooks.push({
                fieldName: fieldName,
                request: {
                    url: field.webhookUrl,
                    method: field.webhookPayload ? 'POST' : 'GET',
                    payload: field.webhookPayload
                },
                response: `Error: ${error.message}`,
                error: error.message,
                success: false,
                httpStatus: null
            });
        }
    }

    if (fieldWebhooks.length > 0) {
        console.log(`[${jobId}] Fired ${fieldWebhooks.length} field webhooks`);
    } else if (hasActualFields) {
        console.log(`[${jobId}] Field results found but no webhooks fired (conditions not met)`);
    }

    return fieldWebhooks;
}

// Test function for Discord webhook
export async function testDiscordWebhook(webhookUrl, testMessage = 'WebSophon webhook test') {
    const testPayload = {
        username: 'WebSophon Test',
        content: testMessage,
        embeds: [{
            title: 'Webhook Test',
            description: 'This is a test message from WebSophon to verify webhook connectivity.',
            color: 0x667eea, // Purple color
            fields: [
                {
                    name: 'Status',
                    value: '✅ Connection Successful',
                    inline: true
                },
                {
                    name: 'Timestamp',
                    value: new Date().toLocaleString(),
                    inline: true
                }
            ],
            footer: {
                text: 'WebSophon Webhook Test'
            }
        }]
    };

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(testPayload)
        });

        return {
            success: response.ok,
            status: response.status,
            statusText: response.statusText
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
} 