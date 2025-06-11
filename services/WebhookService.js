// Webhook communication service
export class WebhookService {
    constructor(captureService, eventService) {
        this.captureService = captureService;
        this.eventService = eventService;
        this.pendingRequests = new Map(); // Map of eventId to AbortController for cancellation
        this.userCancelledRequests = new Set(); // Track user-initiated cancellations
    }

    // Capture screenshot and send to webhook
    async captureAndSend(tabId, domain, webhookUrl, isManual = false, fields = null) {
        try {
            console.log(`Attempting to capture screenshot for tab ${tabId}, domain: ${domain}, webhook: ${webhookUrl}`);

            // For automatic captures, get fields from storage
            if (!fields && !isManual) {
                const domainKey = `fields_${domain}`;
                const storage = await chrome.storage.sync.get([domainKey]);
                const domainFields = storage[domainKey] || [];

                console.log(`Loading fields for domain ${domain}:`, domainFields);

                fields = domainFields.map(f => ({
                    name: this.captureService.sanitizeFieldName(f.friendlyName || f.name),
                    criteria: this.captureService.escapeJsonString(f.description)
                }));

                // If no fields configured, still track the event
                if (fields.length === 0) {
                    console.log('No fields configured for domain:', domain);
                }
            }

            // Capture screenshot using CaptureService
            const captureResult = await this.captureService.captureScreenshot(tabId);
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
            // - responseText: ALWAYS preserved (JSON, plain text, or error string)
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