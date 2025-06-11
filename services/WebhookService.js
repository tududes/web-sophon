// Webhook communication service
export class WebhookService {
    constructor(captureService, eventService) {
        this.captureService = captureService;
        this.eventService = eventService;
        this.pendingRequests = new Map(); // Map of eventId to AbortController for cancellation
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
                domain: domain
            });

            // Send to webhook with very long timeout (300 seconds)
            const controller = new AbortController();
            this.pendingRequests.set(eventId, controller); // Store for potential cancellation

            const timeoutId = setTimeout(() => {
                controller.abort();
                this.pendingRequests.delete(eventId);
            }, 300000); // 300 seconds

            let webhookResponse;
            try {
                webhookResponse = await fetch(webhookUrl, {
                    method: 'POST',
                    body: formData,
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                this.pendingRequests.delete(eventId); // Remove from pending when completed
            } catch (fetchError) {
                clearTimeout(timeoutId);
                this.pendingRequests.delete(eventId); // Remove from pending on error
                console.log('Fetch error occurred:', fetchError);

                let errorMessage;
                if (fetchError.name === 'AbortError') {
                    // Check if it was user-cancelled or timeout
                    errorMessage = this.pendingRequests.has(eventId) ? 'Request timed out after 5 minutes' : 'Request cancelled by user';
                } else {
                    errorMessage = fetchError.message;
                }

                // Update the pending event with the error
                this.eventService.updateEvent(eventId, null, null, errorMessage, null);

                // Send notification on manual capture
                if (isManual) {
                    chrome.runtime.sendMessage({
                        action: 'captureComplete',
                        success: false,
                        error: errorMessage
                    });
                }

                return { success: false, error: errorMessage };
            }

            console.log(`Webhook response status: ${webhookResponse.status}`);

            // Don't throw error for non-200 status codes, let them be processed
            console.log(`Webhook response received with status: ${webhookResponse.status}`);
            if (!webhookResponse.ok) {
                console.log(`Non-success status: ${webhookResponse.status}: ${webhookResponse.statusText}`);
            }

            // Try to parse response for field results
            let responseData = null;
            let parseError = null;
            let responseText = '';
            try {
                responseText = await webhookResponse.text();
                console.log('Raw response text:', responseText);
                responseData = JSON.parse(responseText);
                console.log('Webhook response data:', responseData);
            } catch (e) {
                parseError = e.message;
                console.log('Response was not JSON or could not be parsed:', e);
                console.log('Raw response that failed to parse:', responseText);
            }

            console.log(`Updating event ${eventId} with response. Status: ${webhookResponse.status}, Has data: ${!!responseData}`);

            // Update the existing event with the response data
            this.eventService.updateEvent(eventId, responseData, webhookResponse.status, parseError, responseText);

            // Send results to popup if it contains field evaluations
            if (responseData && responseData.fields) {
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
                    success: true
                });
            }

            return { success: true };
        } catch (error) {
            console.error('Error capturing/sending screenshot:', error);

            // If we have an eventId, update the existing event; otherwise create a new one
            if (typeof eventId !== 'undefined') {
                this.eventService.updateEvent(eventId, null, null, error.message, null);
            } else {
                // Track failed event (screenshot may be undefined if capture failed)
                this.eventService.trackEvent(null, domain, tab ? tab.url : '', false, null, error.message,
                    typeof dataUrl !== 'undefined' ? dataUrl : null,
                    typeof requestData !== 'undefined' ? requestData : null,
                    null, Date.now());
            }

            // Send error notification on manual capture
            if (isManual) {
                chrome.runtime.sendMessage({
                    action: 'captureComplete',
                    success: false,
                    error: error.message
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
            controller.abort();
            this.pendingRequests.delete(eventId);
            console.log(`Cancelled request for event ${eventId}`);

            // Update the event as cancelled
            this.eventService.updateEvent(eventId, null, null, 'Request cancelled by user', null);
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