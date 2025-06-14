// LLM API service for field evaluation using multimodal models
export class LLMService {
    constructor(captureService, eventService) {
        this.captureService = captureService;
        this.eventService = eventService;
        this.pendingRequests = new Map(); // Map of eventId to AbortController for cancellation
        this.userCancelledRequests = new Set(); // Track user-initiated cancellations
    }

    // System prompt template for field evaluation
    getSystemPrompt(fields) {
        const fieldsJson = JSON.stringify(fields, null, 2);

        return `Analyze this screenshot and return JSON with your evaluation for each field.

For each field, return: "field_name": [boolean_result, confidence_0_to_1]

Fields to evaluate:
${fieldsJson}

Response format:
{
  "field_name": [true, 0.95],
  "another_field": [false, 0.80],
  "reason": "Brief explanation"
}

Return only JSON.`;
    }

    // Capture screenshot and send to LLM API
    async captureAndSend(tabId, domain, llmConfig, isManual = false, fields = null, refreshPage = false, captureDelay = 0) {
        try {
            console.log(`Attempting LLM capture for tab ${tabId}, domain: ${domain}`);
            console.log(`LLM Config:`, llmConfig);
            console.log(`Refresh page: ${refreshPage}, Capture delay: ${captureDelay}s`);

            // Validate LLM configuration
            if (!llmConfig || !llmConfig.apiUrl || !llmConfig.apiKey) {
                const missingFields = [];
                if (!llmConfig) missingFields.push('entire config');
                else {
                    if (!llmConfig.apiUrl) missingFields.push('apiUrl');
                    if (!llmConfig.apiKey) missingFields.push('apiKey');
                }

                console.error('LLM Config validation failed!');
                console.error('Missing fields:', missingFields);
                console.error('Full llmConfig object:', llmConfig);

                const errorMessage = `LLM configuration incomplete. Missing: ${missingFields.join(', ')}`;

                this.eventService.trackEvent(null, domain, tab ? tab.url : '', false, null, errorMessage,
                    dataUrl, { error: 'Configuration incomplete', config: llmConfig }, errorMessage, eventId);

                if (isManual) {
                    chrome.runtime.sendMessage({
                        action: 'captureComplete',
                        success: false,
                        error: errorMessage
                    });
                }

                return { success: false, error: errorMessage };
            }

            console.log('=== LLM CONFIG DEBUG ===');
            console.log('Domain:', domain);
            console.log('LLM Config object:', llmConfig);
            console.log('API URL:', llmConfig.apiUrl);
            console.log('API Key present:', !!llmConfig.apiKey);
            console.log('API Key length:', llmConfig.apiKey ? llmConfig.apiKey.length : 0);
            console.log('API Key prefix:', llmConfig.apiKey ? llmConfig.apiKey.substring(0, 10) + '...' : 'NOT SET');
            console.log('Model:', llmConfig.model);
            console.log('========================');

            // Handle page refresh if enabled
            if (refreshPage) {
                console.log('Refreshing page before capture...');
                try {
                    await chrome.tabs.reload(tabId);
                    console.log('Page refresh initiated');

                    // Wait for the page to start loading, then wait for it to complete
                    await new Promise((resolve, reject) => {
                        const timeout = setTimeout(() => {
                            reject(new Error('Page refresh timeout'));
                        }, 30000); // 30 second timeout for page refresh

                        const onUpdated = (updatedTabId, changeInfo, tab) => {
                            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                                chrome.tabs.onUpdated.removeListener(onUpdated);
                                clearTimeout(timeout);
                                console.log('Page refresh completed, DOM ready');
                                resolve();
                            }
                        };

                        chrome.tabs.onUpdated.addListener(onUpdated);
                    });
                } catch (refreshError) {
                    console.error('Page refresh failed:', refreshError);
                    throw new Error(`Page refresh failed: ${refreshError.message}`);
                }
            }

            // Apply capture delay if specified
            if (captureDelay > 0) {
                console.log(`Waiting ${captureDelay} seconds before capture...`);
                await new Promise(resolve => setTimeout(resolve, captureDelay * 1000));
                console.log('Capture delay completed');
            }

            // For automatic captures, get fields from storage
            if (!fields && !isManual) {
                const domainKey = `fields_${domain}`;
                const storage = await chrome.storage.local.get([domainKey]);
                const domainFields = storage[domainKey] || [];

                console.log(`Loading fields for domain ${domain}:`, domainFields);

                // Filter and validate fields
                const validFields = domainFields.filter(f => {
                    const hasName = f.name && f.name.trim();
                    const hasDescription = f.description && f.description.trim();
                    return hasName && hasDescription;
                });

                fields = validFields.map(f => ({
                    name: this.captureService.sanitizeFieldName(f.friendlyName || f.name),
                    criteria: f.description
                }));

                console.log(`Final fields for LLM:`, fields);

                if (fields.length === 0) {
                    console.log('No valid fields configured for domain:', domain);
                }
            }

            // Get full page preference from storage
            const { fullPageCapture = false } = await new Promise(resolve => {
                chrome.storage.local.get(['fullPageCapture'], resolve);
            });

            // Capture screenshot using CaptureService
            const captureResult = await this.captureService.captureScreenshot(tabId, fullPageCapture);
            const { dataUrl, tab } = captureResult;

            // Convert dataURL to base64 (remove data:image/png;base64, prefix)
            const base64Image = dataUrl.split(',')[1];
            console.log('Screenshot converted to base64, length:', base64Image.length);

            // Store request data for history
            const requestData = {
                domain: domain,
                timestamp: new Date().toISOString(),
                tabId: tabId.toString(),
                url: tab.url,
                isManual: isManual.toString(),
                fields: fields,
                llmConfig: {
                    apiUrl: llmConfig.apiUrl,
                    model: llmConfig.model || 'gpt-4-vision-preview',
                    // Don't store API key in history for security
                }
            };

            console.log(`Sending to LLM API: ${llmConfig.apiUrl}`);

            // Generate event ID early
            const eventId = Date.now();

            // Track the event immediately as pending
            this.eventService.trackEvent(null, domain, tab.url, true, null, null, dataUrl, requestData, null, eventId, 'pending');

            // Notify popup that request is pending
            chrome.runtime.sendMessage({
                action: 'captureStarted',
                eventId: eventId,
                domain: domain,
                fields: fields
            });

            // Prepare LLM API request
            const controller = new AbortController();
            this.pendingRequests.set(eventId, controller);

            const timeoutId = setTimeout(() => {
                controller.abort();
                this.pendingRequests.delete(eventId);
            }, 120000); // 2 minute timeout for LLM requests

            let llmResponse;
            let responseText = '';
            let responseData = null;
            let parseError = null;
            let finalError = null;

            try {
                // Build the system prompt with fields
                const systemPrompt = this.getSystemPrompt(fields);

                // Prepare the request payload for OpenAI-compatible API
                const requestPayload = {
                    model: llmConfig.model || 'gpt-4-vision-preview',
                    messages: [
                        {
                            role: 'system',
                            content: systemPrompt
                        },
                        {
                            role: 'user',
                            content: [
                                {
                                    type: 'text',
                                    text: 'Please analyze this screenshot according to the field criteria provided in the system prompt.'
                                },
                                {
                                    type: 'image_url',
                                    image_url: {
                                        url: `data:image/png;base64,${base64Image}`
                                    }
                                }
                            ]
                        }
                    ],
                    max_tokens: 1000,
                    temperature: 0.1, // Low temperature for consistent results
                    stream: false // Disable streaming to avoid chunked responses
                };

                // Add additional parameters if specified in config
                if (llmConfig.temperature !== undefined) {
                    requestPayload.temperature = llmConfig.temperature;
                }
                if (llmConfig.maxTokens !== undefined) {
                    requestPayload.max_tokens = llmConfig.maxTokens;
                }

                console.log('=== LLM REQUEST DEBUG ===');
                console.log('URL:', llmConfig.apiUrl);
                console.log('Method: POST');
                console.log('Headers:', {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${llmConfig.apiKey.substring(0, 10)}...`,
                    ...(llmConfig.customHeaders || {})
                });
                console.log('Payload:', JSON.stringify(requestPayload, null, 2));
                console.log('Full Authorization header:', `Bearer ${llmConfig.apiKey}`);
                console.log('========================');

                // Update the event with the full LLM request payload for history
                const fullRequestData = {
                    ...requestData, // Keep the original metadata
                    llmRequestPayload: {
                        url: llmConfig.apiUrl,
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${llmConfig.apiKey.substring(0, 20)}...`
                        },
                        body: requestPayload,
                        timestamp: new Date().toISOString()
                    }
                };

                // Update the tracked event with the full request data
                this.eventService.updateEventRequestData(eventId, fullRequestData);

                // Send request to LLM API
                llmResponse = await fetch(llmConfig.apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${llmConfig.apiKey}`,
                        ...(llmConfig.customHeaders || {})
                    },
                    body: JSON.stringify(requestPayload),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);
                this.pendingRequests.delete(eventId);
                this.userCancelledRequests.delete(eventId);

                console.log(`LLM API response status: ${llmResponse.status}`);

                // Get response text
                try {
                    responseText = await llmResponse.text();
                    console.log('Raw LLM response:', responseText);
                } catch (textError) {
                    console.log('Failed to read LLM response text:', textError);
                    responseText = `Failed to read response: ${textError.message}`;
                }

                if (!llmResponse.ok) {
                    console.log(`LLM API error: ${llmResponse.status}: ${llmResponse.statusText}`);
                    finalError = `LLM API Error ${llmResponse.status}: ${llmResponse.statusText}`;
                } else {
                    // Parse the LLM response
                    try {
                        const llmData = JSON.parse(responseText);

                        // Extract content from OpenAI-style response
                        let content = '';
                        if (llmData.choices && llmData.choices[0] && llmData.choices[0].message) {
                            content = llmData.choices[0].message.content;
                        } else if (typeof llmData === 'object' && llmData.content) {
                            content = llmData.content;
                        } else {
                            throw new Error('Unexpected LLM response format');
                        }

                        // Parse the JSON content from the LLM
                        // Remove markdown code blocks using simple string replacement (like n8n approach)
                        let jsonContent = content
                            .replaceAll("```json", "")
                            .replaceAll("```", "")
                            .trim();

                        console.log('Cleaned JSON content after removing markdown:', jsonContent);

                        try {
                            const rawResponseData = JSON.parse(jsonContent);
                            console.log('Raw parsed LLM response:', rawResponseData);

                            // Normalize the response to handle various LLM formats
                            responseData = this.normalizeFieldResults(rawResponseData, fields);
                            console.log('Normalized LLM field results:', responseData);
                        } catch (contentParseError) {
                            console.log('Failed to parse LLM content as JSON:', contentParseError);
                            console.log('Original content:', content);
                            console.log('Attempted to parse:', jsonContent);
                            responseData = {
                                error: 'Failed to parse LLM response as JSON',
                                raw_content: content,
                                attempted_json: jsonContent,
                                parse_error: contentParseError.message
                            };
                        }
                    } catch (e) {
                        parseError = e.message;
                        console.log('Failed to parse LLM response:', e);
                        responseData = {
                            error: 'Failed to parse LLM response',
                            raw_response: responseText
                        };
                    }
                }

            } catch (fetchError) {
                clearTimeout(timeoutId);
                this.pendingRequests.delete(eventId);
                console.log('LLM API fetch error:', fetchError);

                if (fetchError.name === 'AbortError') {
                    if (this.userCancelledRequests.has(eventId)) {
                        finalError = 'Request cancelled by user';
                        console.log(`LLM Request ${eventId} was cancelled by user`);
                        this.userCancelledRequests.delete(eventId);
                        return { success: false, error: finalError };
                    } else {
                        finalError = 'LLM request timed out after 2 minutes';
                        console.log(`LLM Request ${eventId} timed out`);
                    }
                    responseText = finalError;
                } else {
                    finalError = `LLM API Error: ${fetchError.message}`;
                    responseText = fetchError.message;
                }

                this.userCancelledRequests.delete(eventId);
                llmResponse = { status: null };

                this.eventService.updateEvent(eventId, null, null, finalError, responseText);

                if (isManual) {
                    chrome.runtime.sendMessage({
                        action: 'captureComplete',
                        success: false,
                        error: finalError
                    });
                }

                return { success: false, error: finalError };
            }

            console.log(`Updating LLM event ${eventId} with response`);

            // Update the existing event with response data
            this.eventService.updateEvent(eventId, responseData, llmResponse.status, finalError, responseText);

            // Send results to popup if response contains field evaluations
            const hasFields = responseData && typeof responseData === 'object' && !responseData.error;

            // Check for actual field results (excluding 'reason' field)
            const fieldResults = {};
            let hasActualFields = false;

            console.log('=== FIELD DETECTION DEBUG ===');
            console.log('responseData type:', typeof responseData);
            console.log('responseData:', responseData);

            if (hasFields) {
                console.log('hasFields is true, processing field entries...');
                for (const [key, value] of Object.entries(responseData)) {
                    console.log(`Processing field: "${key}" with value:`, value, 'type:', typeof value, 'isArray:', Array.isArray(value));

                    if (key !== 'reason' && Array.isArray(value) && value.length >= 1) {
                        fieldResults[key] = value;
                        hasActualFields = true;
                        console.log(`✓ Added field "${key}" to results:`, value);
                    } else {
                        console.log(`✗ Skipped field "${key}" - reason: ${key === 'reason' ? 'is reason field' : !Array.isArray(value) ? 'not array' : 'array too short'}`);
                    }
                }
            } else {
                console.log('hasFields is false, skipping field processing');
            }

            console.log('=== FIELD DETECTION RESULTS ===');
            console.log('Field detection results:', {
                hasFields,
                hasActualFields,
                fieldCount: Object.keys(fieldResults).length,
                fieldResults
            });
            console.log('================================');

            if (hasActualFields) {
                const message = {
                    action: 'captureResults',
                    results: responseData,
                    fieldResults: fieldResults,
                    hasActualFields: hasActualFields,
                    eventId: eventId
                };

                console.log('=== LLM RESULTS DEBUG ===');
                console.log('Raw LLM response data:', responseData);
                console.log('Field results extracted:', fieldResults);
                console.log('Has actual fields:', hasActualFields);
                console.log('Field result keys:', Object.keys(fieldResults));
                console.log('Sending captureResults message to popup:', message);
                console.log('========================');

                chrome.runtime.sendMessage(message);
            } else {
                console.log('Not sending captureResults - no actual field results found');
                console.log('Debug info:', { hasFields, hasActualFields, fieldResultsCount: Object.keys(fieldResults).length });
            }

            // Fire field-level webhooks for TRUE results if configured
            if (hasActualFields && responseData) {
                await this.fireFieldWebhooks(eventId, domain, responseData);
            }

            console.log(`LLM analysis completed successfully`);

            if (isManual) {
                chrome.runtime.sendMessage({
                    action: 'captureComplete',
                    success: true,
                    eventId: eventId,
                    results: responseData
                });
            }

            return { success: true, eventId: eventId };

        } catch (error) {
            console.error('Error in LLM capture/analysis:', error);

            const errorResponseText = error.message || 'Unknown error occurred';

            if (typeof eventId !== 'undefined') {
                this.eventService.updateEvent(eventId, null, null, error.message, errorResponseText);
            } else {
                this.eventService.trackEvent(null, domain, tab ? tab.url : '', false, null, error.message,
                    typeof dataUrl !== 'undefined' ? dataUrl : null,
                    typeof requestData !== 'undefined' ? requestData : null,
                    errorResponseText, Date.now());
            }

            if (isManual) {
                chrome.runtime.sendMessage({
                    action: 'captureComplete',
                    success: false,
                    error: error.message,
                    eventId: eventId
                });
            }

            return { success: false, error: error.message };
        }
    }

    // Fire webhooks for individual fields (reused from WebhookService)
    async fireFieldWebhooks(eventId, domain, mainResponseData) {
        console.log('Checking for field webhooks to fire after LLM analysis...');
        console.log('LLM Response Data:', mainResponseData);

        const storage = await chrome.storage.local.get([`fields_${domain}`]);
        const fieldConfigs = storage[`fields_${domain}`] || [];

        console.log('Field configurations from storage:', fieldConfigs);

        // Create multiple lookup maps for robust field matching
        const fieldConfigMap = {};
        const fieldConfigMapBySanitized = {};
        fieldConfigs.forEach(field => {
            if (field.name) {
                const originalName = field.name;
                const sanitizedName = field.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

                // Map both original and sanitized names
                fieldConfigMap[originalName] = field;
                fieldConfigMap[originalName.toLowerCase()] = field;
                fieldConfigMapBySanitized[sanitizedName] = field;

                console.log(`Field mapping: "${originalName}" -> sanitized: "${sanitizedName}"`);
            }
        });

        console.log('Field config maps:', { fieldConfigMap, fieldConfigMapBySanitized });

        const fieldWebhooks = [];
        let fieldResultsFound = false;

        // Process field results from the LLM response
        for (const [fieldName, fieldResult] of Object.entries(mainResponseData)) {
            if (fieldName !== 'reason' && Array.isArray(fieldResult) && fieldResult.length >= 1) {
                fieldResultsFound = true;
                const result = fieldResult[0]; // boolean result
                const probability = fieldResult.length > 1 ? fieldResult[1] : null;

                console.log(`LLM Field "${fieldName}" result:`, result, 'probability:', probability);

                // Try multiple lookup strategies
                let fieldConfig = fieldConfigMap[fieldName] ||
                    fieldConfigMap[fieldName.toLowerCase()] ||
                    fieldConfigMapBySanitized[fieldName] ||
                    fieldConfigMapBySanitized[fieldName.toLowerCase()];

                console.log(`Field "${fieldName}" config lookup result:`, fieldConfig ? 'FOUND' : 'NOT FOUND');

                if (fieldConfig && fieldConfig.webhookEnabled && fieldConfig.webhookUrl) {
                    const shouldTriggerOnTrue = fieldConfig.webhookTrigger !== false;
                    const shouldFireWebhook = shouldTriggerOnTrue ? result === true : result === false;

                    if (shouldFireWebhook) {
                        console.log(`LLM Field "${fieldName}" firing webhook:`, fieldConfig.webhookUrl);

                        try {
                            const fieldWebhookResult = await this.fireFieldWebhook(
                                fieldConfig.name,
                                fieldConfig.webhookUrl,
                                fieldConfig.webhookPayload,
                                { result: [result, probability] }
                            );

                            fieldWebhooks.push({
                                fieldName: fieldConfig.name,
                                ...fieldWebhookResult
                            });
                        } catch (error) {
                            console.error(`Failed to fire webhook for LLM field "${fieldConfig.name}":`, error);
                            fieldWebhooks.push({
                                fieldName: fieldConfig.name,
                                request: {
                                    url: fieldConfig.webhookUrl,
                                    method: fieldConfig.webhookPayload ? 'POST' : 'GET',
                                    payload: fieldConfig.webhookPayload
                                },
                                response: `Error: ${error.message}`,
                                error: error.message,
                                success: false,
                                httpStatus: null
                            });
                        }
                    }
                }
            }
        }

        console.log(`Field processing summary: Found ${fieldResultsFound ? 'YES' : 'NO'} field results, Fired ${fieldWebhooks.length} webhooks`);

        if (fieldWebhooks.length > 0) {
            console.log(`Fired ${fieldWebhooks.length} field webhooks after LLM analysis`);
            this.eventService.addFieldWebhooksToEvent(eventId, fieldWebhooks);
        } else if (fieldResultsFound) {
            console.log('Field results were found but no webhooks were fired (webhooks may not be configured for these fields)');
        } else {
            console.log('No field results found in LLM response');
        }
    }

    // Fire a single field webhook (reused from WebhookService)
    async fireFieldWebhook(fieldName, webhookUrl, customPayload, fieldResult) {
        console.log(`Firing webhook for LLM field "${fieldName}" to ${webhookUrl}`);

        const requestData = {
            url: webhookUrl,
            method: customPayload ? 'POST' : 'GET',
            payload: customPayload,
            timestamp: new Date().toISOString()
        };

        try {
            let response;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);

            if (customPayload) {
                let parsedPayload;
                try {
                    parsedPayload = JSON.parse(customPayload);
                } catch (e) {
                    parsedPayload = { error: 'Invalid JSON payload', raw: customPayload };
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
                response = await fetch(webhookUrl, {
                    method: 'GET',
                    signal: controller.signal
                });
            }

            clearTimeout(timeoutId);

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

    // Cancel a pending LLM request
    cancelRequest(eventId) {
        if (this.pendingRequests.has(eventId)) {
            const controller = this.pendingRequests.get(eventId);
            this.userCancelledRequests.add(eventId);
            controller.abort();
            this.pendingRequests.delete(eventId);
            console.log(`User cancelled LLM request for event ${eventId}`);

            const cancellationMessage = 'LLM request cancelled by user';
            this.eventService.updateEvent(eventId, null, null, cancellationMessage, cancellationMessage);

            setTimeout(() => {
                this.userCancelledRequests.delete(eventId);
            }, 1000);

            return { success: true };
        } else {
            return { success: false, error: 'LLM request not found or already completed' };
        }
    }

    // Check if a request is pending
    isRequestPending(eventId) {
        return this.pendingRequests.has(eventId);
    }

    // Get all pending request IDs
    getPendingRequestIds() {
        return Array.from(this.pendingRequests.keys());
    }

    // Normalize field results to handle various LLM response formats
    normalizeFieldResults(rawResponseData, fields) {
        const normalized = {};
        const fieldNames = fields.map(f => f.name);

        console.log('Normalizing response for fields:', fieldNames);
        console.log('Raw response data:', rawResponseData);

        // Handle various LLM response formats
        for (const fieldName of fieldNames) {
            let result = null;
            let probability = null;

            // Format 1: Correct format - "field_name": [boolean, probability]
            if (rawResponseData[fieldName] && Array.isArray(rawResponseData[fieldName])) {
                const fieldArray = rawResponseData[fieldName];
                result = fieldArray[0];
                probability = fieldArray.length > 1 ? fieldArray[1] : null;
                console.log(`Field "${fieldName}" - Format 1 (correct): result=${result}, probability=${probability}`);
            }
            // Format 2: Boolean only - "field_name": [boolean] + separate probability array
            else if (rawResponseData[fieldName] && Array.isArray(rawResponseData[fieldName]) && rawResponseData[fieldName].length === 1) {
                result = rawResponseData[fieldName][0];

                // Look for separate probability array
                if (rawResponseData.probability && Array.isArray(rawResponseData.probability)) {
                    const fieldIndex = fieldNames.indexOf(fieldName);
                    if (fieldIndex >= 0 && fieldIndex < rawResponseData.probability.length) {
                        probability = rawResponseData.probability[fieldIndex];
                    }
                }
                console.log(`Field "${fieldName}" - Format 2 (separate probability): result=${result}, probability=${probability}`);
            }
            // Format 3: Separate probability fields - "probability_field_name": number
            else if (rawResponseData[fieldName] && Array.isArray(rawResponseData[fieldName]) && rawResponseData[fieldName].length === 1) {
                result = rawResponseData[fieldName][0];

                // Look for separate probability field
                const probField = `probability_${fieldName}`;
                if (rawResponseData[probField] !== undefined) {
                    probability = rawResponseData[probField];
                }
                console.log(`Field "${fieldName}" - Format 3 (separate prob field): result=${result}, probability=${probability}`);
            }
            // Format 4: Direct boolean - "field_name": boolean
            else if (rawResponseData[fieldName] !== undefined && typeof rawResponseData[fieldName] === 'boolean') {
                result = rawResponseData[fieldName];
                probability = 0.8; // Default probability
                console.log(`Field "${fieldName}" - Format 4 (direct boolean): result=${result}, probability=${probability} (default)`);
            }

            // If we found a result, add it to normalized response
            if (result !== null) {
                // Ensure result is boolean
                if (typeof result === 'string') {
                    result = result.toLowerCase() === 'true';
                }

                // Ensure probability is a number between 0 and 1
                if (probability === null || probability === undefined) {
                    probability = 0.8; // Default confidence
                } else if (typeof probability === 'string') {
                    probability = parseFloat(probability);
                }
                if (probability < 0) probability = 0;
                if (probability > 1) probability = 1;

                normalized[fieldName] = [result, probability];
                console.log(`✓ Normalized field "${fieldName}": [${result}, ${probability}]`);
            } else {
                console.warn(`✗ Could not extract result for field "${fieldName}"`);
            }
        }

        // Preserve reason field if it exists
        if (rawResponseData.reason) {
            normalized.reason = rawResponseData.reason;
        }

        console.log('Final normalized response:', normalized);
        return normalized;
    }

    // Test LLM configuration with a simple request
    async testConfiguration(llmConfig) {
        try {
            console.log('Testing LLM configuration...');

            // Validate basic config
            if (!llmConfig || !llmConfig.apiUrl || !llmConfig.apiKey) {
                const missingFields = [];
                if (!llmConfig) missingFields.push('entire config');
                else {
                    if (!llmConfig.apiUrl) missingFields.push('API URL');
                    if (!llmConfig.apiKey) missingFields.push('API Key');
                }
                throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
            }

            // Create a simple test request
            const testPayload = {
                model: llmConfig.model || 'gpt-4-vision-preview',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a helpful assistant. Respond with a simple confirmation message.'
                    },
                    {
                        role: 'user',
                        content: 'Please respond with "Configuration test successful" to confirm this connection works.'
                    }
                ],
                max_tokens: 50,
                temperature: 0.1
            };

            console.log('Sending test request to:', llmConfig.apiUrl);

            // Send test request
            const response = await fetch(llmConfig.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${llmConfig.apiKey}`,
                    ...(llmConfig.customHeaders || {})
                },
                body: JSON.stringify(testPayload),
                signal: AbortSignal.timeout(30000) // 30 second timeout
            });

            console.log('Test response status:', response.status);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
            }

            const responseData = await response.json();
            console.log('Test response received successfully');

            // Validate response structure
            if (!responseData.choices || !responseData.choices[0] || !responseData.choices[0].message) {
                console.warn('Unexpected response format, but API responded successfully');
            }

            return {
                success: true,
                message: 'LLM API connection successful',
                model: llmConfig.model || 'default',
                status: response.status
            };

        } catch (error) {
            console.error('LLM configuration test failed:', error);

            let errorMessage = error.message;
            if (error.name === 'AbortError' || error.name === 'TimeoutError') {
                errorMessage = 'Request timed out - API may be slow or unavailable';
            } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                errorMessage = 'Network error - check API URL and internet connection';
            }

            return {
                success: false,
                error: errorMessage
            };
        }
    }
} 