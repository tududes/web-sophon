// Webhook communication service
import { fireFieldWebhooks, fireFieldWebhook } from "../utils/webhook-utils.js";

export class WebhookService {
    constructor(captureService, eventService) {
        this.captureService = captureService;
        this.eventService = eventService;
        this.pendingRequests = new Map(); // Map of eventId to AbortController for cancellation
        this.userCancelledRequests = new Set(); // Track user-initiated cancellations
    }

    // Capture screenshot and send to webhook
    async captureAndSend(tabId, domain, webhookUrl, isManual = false, fields = null, refreshPage = false, captureDelay = 0) {
        try {
            console.log(`Attempting to capture screenshot for tab ${tabId}, domain: ${domain}, webhook: ${webhookUrl}`);
            console.log(`Refresh page: ${refreshPage}, Capture delay: ${captureDelay}s`);

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
                console.log(`Found ${domainFields.length} raw fields in storage`);

                // Filter and validate fields
                const validFields = domainFields.filter(f => {
                    const hasName = f.name && f.name.trim();
                    const hasDescription = f.description && f.description.trim();
                    const isValid = hasName && hasDescription;

                    if (!isValid) {
                        console.log(`Filtering out invalid field:`, {
                            name: f.name,
                            description: f.description,
                            hasName,
                            hasDescription
                        });
                    }

                    return isValid;
                });

                console.log(`After filtering: ${validFields.length} valid fields`);

                fields = validFields.map(f => ({
                    name: this.captureService.sanitizeFieldName(f.friendlyName || f.name),
                    criteria: this.captureService.escapeJsonString(f.description)
                }));

                console.log(`Final fields to send to webhook:`, fields);

                // If no fields configured, still track the event
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

            // Convert dataURL to blob
            const response = await fetch(dataUrl);
            const blob = await response.blob();
            console.log('Blob created, size:', blob.size);

            // Prepare form data
            const formData = new FormData();
            formData.append('screenshot', blob, `screenshot_${Date.now()}.png`);
            formData.append('domain', domain);
            formData.append('timestamp', new Date().toISOString());
            formData.append('tabId', tabId.toString());
            formData.append('url', tab.url);
            formData.append('isManual', isManual.toString());

            // Add fields if present
            if (fields && fields.length > 0) {
                formData.append('fields', JSON.stringify(fields));
            }

            // Store request data for history
            const requestData = {
                domain: domain,
                timestamp: new Date().toISOString(),
                tabId: tabId.toString(),
                url: tab.url,
                isManual: isManual.toString(),
                fields: fields
            };

            console.log(`Sending to webhook: ${webhookUrl}`);

            // Generate event ID early
            const eventId = Date.now();

            // Track the event immediately as pending
            this.eventService.trackEvent(null, domain, tab.url, true, null, null, dataUrl, requestData, null, eventId, 'pending');

            // Notify popup that request is pending
            chrome.runtime.sendMessage({
                action: 'captureStarted',
                eventId: eventId,
                domain: domain,
                fields: fields // Include fields so popup can update their status
            });

            // Send to webhook with very long timeout (300 seconds)
            const controller = new AbortController();
            this.pendingRequests.set(eventId, controller); // Store for potential cancellation

            const timeoutId = setTimeout(() => {
                controller.abort();
                this.pendingRequests.delete(eventId);
            }, 300000); // 300 seconds

            let webhookResponse;
            let responseText = '';
            let responseData = null;
            let parseError = null;
            let finalError = null;

            try {
                webhookResponse = await fetch(webhookUrl, {
                    method: 'POST',
                    body: formData,
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                this.pendingRequests.delete(eventId); // Remove from pending when completed
                this.userCancelledRequests.delete(eventId); // Clean up cancellation flag

                console.log(`Webhook response status: ${webhookResponse.status}`);

                // ALWAYS try to get response text, regardless of status code
                try {
                    responseText = await webhookResponse.text();
                    console.log('Raw response text:', responseText);
                } catch (textError) {
                    console.log('Failed to read response text:', textError);
                    responseText = `Failed to read response: ${textError.message}`;
                }

                // Log non-success status codes but still process the response
                if (!webhookResponse.ok) {
                    console.log(`Non-success status: ${webhookResponse.status}: ${webhookResponse.statusText}`);
                    finalError = `HTTP ${webhookResponse.status}: ${webhookResponse.statusText}`;
                }

                // Try to parse response as JSON if we have text
                if (responseText) {
                    try {
                        responseData = JSON.parse(responseText);
                        console.log('Webhook response data:', responseData);
                    } catch (e) {
                        parseError = e.message;
                        console.log('Response was not JSON or could not be parsed:', e);
                        console.log('Raw response that failed to parse:', responseText);
                        // responseText is preserved for non-JSON responses
                    }
                }

            } catch (fetchError) {
                clearTimeout(timeoutId);
                this.pendingRequests.delete(eventId); // Remove from pending on error
                console.log('Fetch error occurred:', fetchError);

                // Try to extract any response text from the error if possible
                let errorResponseText = '';
                try {
                    // Some fetch errors might still have response data
                    if (fetchError.response) {
                        errorResponseText = await fetchError.response.text();
                    }
                } catch (e) {
                    // If we can't get response text, that's okay
                    console.log('No response text available from fetch error');
                }

                // Determine error message and response text
                if (fetchError.name === 'AbortError') {
                    // Check if it was user-cancelled or timeout using our tracking flag
                    if (this.userCancelledRequests.has(eventId)) {
                        finalError = 'Request cancelled by user';
                        console.log(`Request ${eventId} was cancelled by user`);
                        // Clean up the cancellation flag
                        this.userCancelledRequests.delete(eventId);
                        // Don't update the event here - it was already updated in cancelRequest()
                        return { success: false, error: finalError };
                    } else {
                        finalError = 'Request timed out after 5 minutes';
                        console.log(`Request ${eventId} timed out`);
                    }
                    responseText = finalError; // Use error message as response for cancelled requests
                } else {
                    finalError = fetchError.message;
                    // Use error response text if available, otherwise use error message
                    responseText = errorResponseText || fetchError.message;
                }

                // Clean up cancellation flag for non-AbortError cases
                this.userCancelledRequests.delete(eventId);

                // Set httpStatus to indicate network/fetch error
                webhookResponse = { status: null }; // Network error, no HTTP status

                // Update the pending event with the error
                this.eventService.updateEvent(eventId, null, null, finalError, responseText);

                // Send notification on manual capture
                if (isManual) {
                    chrome.runtime.sendMessage({
                        action: 'captureComplete',
                        success: false,
                        error: finalError
                    });
                }

                return { success: false, error: finalError };
            }

            console.log(`Updating event ${eventId} with response. Status: ${webhookResponse.status}, Has data: ${!!responseData}, Response text length: ${responseText.length}`);

            // Update the existing event with ALL response data
            // - responseData: parsed JSON if successful
            // - webhookResponse.status: HTTP status code
            // - finalError: error message if any
            // - responseText: ALWAYS preserved (JSON, text, or error string)
            this.eventService.updateEvent(eventId, responseData, webhookResponse.status, finalError, responseText);

            // Send results to popup if response contains field evaluations
            // Check if fields are in responseData.fields or at the top level
            const hasFields = responseData && (
                responseData.fields ||
                Object.keys(responseData).some(key => key !== 'reason' && typeof responseData[key] === 'object')
            );

            if (hasFields) {
                chrome.runtime.sendMessage({
                    action: 'captureResults',
                    results: responseData,
                    eventId: eventId // Send event ID for linking
                });
            }

            // Fire field-level webhooks for TRUE results
            if (hasFields && responseData) {
                await this.fireFieldWebhooksWrapper(eventId, domain, responseData);
            }

            console.log(`Screenshot sent successfully to webhook`);

            // Send notification on manual capture
            if (isManual) {
                chrome.runtime.sendMessage({
                    action: 'captureComplete',
                    success: true,
                    eventId: eventId,
                    results: responseData // Include results if available
                });
            }

            return { success: true, eventId: eventId };
        } catch (error) {
            console.error('Error capturing/sending screenshot:', error);

            // Create error response text from the error
            const errorResponseText = error.message || 'Unknown error occurred';

            // If we have an eventId, update the existing event; otherwise create a new one
            if (typeof eventId !== 'undefined') {
                this.eventService.updateEvent(eventId, null, null, error.message, errorResponseText);
            } else {
                // Track failed event (screenshot may be undefined if capture failed)
                this.eventService.trackEvent(null, domain, tab ? tab.url : '', false, null, error.message,
                    typeof dataUrl !== 'undefined' ? dataUrl : null,
                    typeof requestData !== 'undefined' ? requestData : null,
                    errorResponseText, Date.now()); // Include error as response text
            }

            // Send error notification on manual capture
            if (isManual) {
                chrome.runtime.sendMessage({
                    action: 'captureComplete',
                    success: false,
                    error: error.message,
                    eventId: eventId // Include eventId for field status updates
                });
            }

            // If it's a permission error or tab doesn't exist, stop capture
            if (error.message?.includes('Cannot access') || error.message?.includes('No tab')) {
                this.captureService.stopCapture(tabId);
            }

            return { success: false, error: error.message };
        }
    }

    // Wrapper to use the shared webhook utility with the event service integration
    async fireFieldWebhooksWrapper(eventId, domain, mainResponseData) {
        console.log('Checking for field webhooks to fire...');

        // Get field configurations from storage
        const storage = await chrome.storage.local.get([`fields_${domain}`]);
        const fieldConfigs = storage[`fields_${domain}`] || [];

        console.log('Field configurations from storage:', fieldConfigs);

        // Convert webhook response to standard evaluation format for the shared utility
        const evaluation = {};

        // Process field results from the main response
        for (const [fieldName, fieldData] of Object.entries(mainResponseData)) {
            if (fieldData && typeof fieldData === 'object' && fieldName !== 'reason') {
                // Get the field result
                let result = null;
                let probability = null;

                if ('result' in fieldData) {
                    result = Array.isArray(fieldData.result) ? fieldData.result[0] : fieldData.result;
                } else if ('boolean' in fieldData) {
                    result = Array.isArray(fieldData.boolean) ? fieldData.boolean[0] : fieldData.boolean;
                }

                if ('probability' in fieldData) {
                    probability = Array.isArray(fieldData.probability) ? fieldData.probability[0] : fieldData.probability;
                }

                // Standardize field name
                const sanitizedName = fieldName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

                // Store as array format [boolean, probability]
                if (result !== null) {
                    evaluation[sanitizedName] = [result, probability || 0.8];
                }
            }
        }

        // Call the shared utility with standardized format
        const fieldWebhooks = await fireFieldWebhooks(eventId, domain, { evaluation }, fieldConfigs);

        // Update the event with field webhook results if any were fired
        if (fieldWebhooks.length > 0) {
            console.log(`Fired ${fieldWebhooks.length} field webhooks`);
            this.eventService.addFieldWebhooksToEvent(eventId, fieldWebhooks);
        } else {
            console.log('No field webhooks to fire');
        }
    }

    // Cancel a pending request
    cancelRequest(eventId) {
        if (this.pendingRequests.has(eventId)) {
            const controller = this.pendingRequests.get(eventId);

            // Mark this as a user-initiated cancellation BEFORE aborting
            this.userCancelledRequests.add(eventId);

            controller.abort();
            this.pendingRequests.delete(eventId);
            console.log(`User cancelled request for event ${eventId}`);

            // Update the event as cancelled with cancellation message as response
            const cancellationMessage = 'Request cancelled by user';
            this.eventService.updateEvent(eventId, null, null, cancellationMessage, cancellationMessage);

            // Clean up the cancellation flag after a short delay (in case the AbortError handler runs)
            setTimeout(() => {
                this.userCancelledRequests.delete(eventId);
            }, 1000);

            return { success: true };
        } else {
            return { success: false, error: 'Request not found or already completed' };
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