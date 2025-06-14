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

        return `Your job is very important and the results you provide will serve as a gatekeeper for actions taken in an automated system. You will behave as a highly accurate frame-by-frame screenshot processing engine, where you will be passed an image and a set of one or more fields accompanied by a value for each which is the key criteria necessary to evaluate for a boolean true or false value according to your image analysis.

You will respond in pure parseable JSON string from start to finish without any markdown containing all original field(s), each accompanied by an array of the resulting boolean, and resulting probability represented by a floating point number between 0 and 1 that your analysis resulted in a boolean that is 100% correct according to the screenshot. Then at the end of the json response, you will append an additional field named "reason" which will contain a brief explanation of what you saw in the image and the state of the screenshot.

Here are the fields and their criteria for evaluation:
${fieldsJson}`;
    }

    // Capture screenshot and send to LLM API
    async captureAndSend(tabId, domain, llmConfig, isManual = false, fields = null, refreshPage = false, captureDelay = 0) {
        try {
            console.log(`Attempting LLM capture for tab ${tabId}, domain: ${domain}`);
            console.log(`LLM Config:`, llmConfig);
            console.log(`Refresh page: ${refreshPage}, Capture delay: ${captureDelay}s`);

            // Validate LLM configuration
            if (!llmConfig || !llmConfig.apiUrl || !llmConfig.apiKey) {
                throw new Error('LLM configuration missing: apiUrl and apiKey required');
            }

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

            // Capture screenshot using CaptureService
            const captureResult = await this.captureService.captureScreenshot(tabId);
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
                    temperature: 0.1 // Low temperature for consistent results
                };

                // Add additional parameters if specified in config
                if (llmConfig.temperature !== undefined) {
                    requestPayload.temperature = llmConfig.temperature;
                }
                if (llmConfig.maxTokens !== undefined) {
                    requestPayload.max_tokens = llmConfig.maxTokens;
                }

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
                        // First, try to extract JSON from markdown code blocks if present
                        let jsonContent = content;

                        // Check if content is wrapped in markdown code blocks
                        const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
                        const codeBlockMatch = content.match(codeBlockRegex);
                        if (codeBlockMatch) {
                            jsonContent = codeBlockMatch[1].trim();
                            console.log('Extracted JSON from markdown code blocks:', jsonContent);
                        }

                        // If no code blocks, try to find JSON object directly
                        if (!codeBlockMatch) {
                            const jsonObjectRegex = /\{[\s\S]*\}/;
                            const jsonMatch = content.match(jsonObjectRegex);
                            if (jsonMatch) {
                                jsonContent = jsonMatch[0];
                                console.log('Extracted JSON object from content:', jsonContent);
                            }
                        }

                        try {
                            responseData = JSON.parse(jsonContent);
                            console.log('Parsed LLM field results:', responseData);
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

            if (hasFields) {
                chrome.runtime.sendMessage({
                    action: 'captureResults',
                    results: responseData,
                    eventId: eventId
                });
            }

            // Fire field-level webhooks for TRUE results if configured
            if (hasFields && responseData) {
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

        const storage = await chrome.storage.local.get([`fields_${domain}`]);
        const fieldConfigs = storage[`fields_${domain}`] || [];

        console.log('Field configurations from storage:', fieldConfigs);

        const fieldConfigMap = {};
        fieldConfigs.forEach(field => {
            if (field.name) {
                const sanitizedName = field.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
                fieldConfigMap[sanitizedName] = field;
            }
        });

        const fieldWebhooks = [];

        // Process field results from the LLM response
        for (const [fieldName, fieldResult] of Object.entries(mainResponseData)) {
            if (fieldName !== 'reason' && Array.isArray(fieldResult) && fieldResult.length >= 1) {
                const result = fieldResult[0]; // boolean result
                const probability = fieldResult.length > 1 ? fieldResult[1] : null;

                console.log(`LLM Field "${fieldName}" result:`, result, 'probability:', probability);

                const fieldConfig = fieldConfigMap[fieldName];
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

        if (fieldWebhooks.length > 0) {
            console.log(`Fired ${fieldWebhooks.length} field webhooks after LLM analysis`);
            this.eventService.addFieldWebhooksToEvent(eventId, fieldWebhooks);
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
} 