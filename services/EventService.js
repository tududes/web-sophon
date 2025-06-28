// Event tracking and management service
export class EventService {
    constructor() {
        this.recentEvents = []; // Store recent capture events
        this.unreadTrueCount = 0; // Count of unread TRUE events
        this.isLoading = true; // Track loading state
        this.loadPromise = this.loadEventsFromStorage(); // Store the promise
    }

    // Load recent events from storage on startup
    async loadEventsFromStorage() {
        try {
            const data = await chrome.storage.local.get(['recentEvents']);
            if (data.recentEvents && Array.isArray(data.recentEvents)) {
                this.recentEvents = data.recentEvents;
                // Count unread TRUE events
                this.unreadTrueCount = this.recentEvents.filter(e => e.hasTrueResult && !e.read).length;
                this.updateBadge();
            }
        } catch (error) {
            console.error('Error loading events from storage:', error);
        } finally {
            this.isLoading = false;
        }
    }

    // Ensure events are loaded before returning
    async ensureLoaded() {
        if (this.loadPromise) {
            await this.loadPromise;
        }
    }

    // Track capture event
    trackEvent(results, domain, url, success = true, httpStatus = null, error = null, screenshot = null, request = null, response = null, eventId = null, status = 'completed', source = 'local', customTimestamp = null) {
        // Check if any field evaluated to true
        let hasTrueResult = false;
        const fieldResults = [];

        if (results) {
            // Handle responses with "evaluation" wrapper (newer format)
            let dataToProcess = results;
            if (results.evaluation && typeof results.evaluation === 'object') {
                dataToProcess = results.evaluation;
                console.log('EventService: Found evaluation wrapper, processing inner data');
            }

            // New format: results.fieldName.result or results.fieldName.boolean OR LLM array format
            for (const [fieldName, fieldData] of Object.entries(dataToProcess)) {
                if (fieldName === 'reason' || fieldName === 'summary') continue; // Skip reason/summary fields

                let resultValue = null;
                let probabilityValue = null;

                // Handle LLM array format: [boolean, probability]
                if (Array.isArray(fieldData) && fieldData.length >= 1) {
                    resultValue = fieldData[0]; // boolean result
                    probabilityValue = fieldData.length > 1 ? fieldData[1] : null; // probability
                    console.log(`LLM array format - Field "${fieldName}": result=${resultValue}, probability=${probabilityValue}`);
                }
                // Handle NEW format: {result: boolean, confidence: number} from Gemini and other LLMs
                else if (fieldData && typeof fieldData === 'object' && fieldData.result !== undefined) {
                    resultValue = Array.isArray(fieldData.result) ? fieldData.result[0] : fieldData.result;
                    probabilityValue = fieldData.confidence || fieldData.probability || null;
                    console.log(`Result/confidence format - Field "${fieldName}": result=${resultValue}, probability=${probabilityValue}`);
                }
                // Handle legacy object format: {result: boolean, probability: number} or {boolean: boolean, probability: number}
                else if (fieldData && typeof fieldData === 'object') {
                    // Check for 'boolean' property (legacy)
                    if ('boolean' in fieldData) {
                        resultValue = Array.isArray(fieldData.boolean) ? fieldData.boolean[0] : fieldData.boolean;
                    }

                    // Get probability
                    if ('probability' in fieldData) {
                        probabilityValue = Array.isArray(fieldData.probability) ? fieldData.probability[0] : fieldData.probability;
                    }
                    console.log(`Legacy object format - Field "${fieldName}": result=${resultValue}, probability=${probabilityValue}`);
                }

                if (resultValue !== null && typeof resultValue === 'boolean') {
                    fieldResults.push({
                        name: fieldName,
                        result: resultValue,
                        probability: probabilityValue
                    });
                    if (resultValue === true) {
                        hasTrueResult = true;
                    }
                    console.log(`✓ Added field "${fieldName}" to event: result=${resultValue}, probability=${probabilityValue}`);
                } else {
                    console.warn(`✗ Skipped field "${fieldName}": invalid data format`, fieldData);
                }
            }
        }

        // Create event record
        const event = {
            id: eventId || Date.now(),
            timestamp: customTimestamp || new Date().toISOString(), // Use custom timestamp if provided
            domain: domain,
            url: url,
            success: success,
            httpStatus: httpStatus,
            error: error,
            fields: fieldResults,
            summary: results ? (results.summary || '') : '',
            hasTrueResult: hasTrueResult,
            read: false,
            screenshot: screenshot, // Store the base64 screenshot
            request: request,
            response: response, // Contains response data, error messages, or null for pending events
            status: status, // 'pending' or 'completed'
            source: source // 'local' or 'cloud'
        };

        console.log('Tracking event:', {
            id: event.id,
            timestamp: event.timestamp,
            domain: event.domain,
            source: event.source,
            hasScreenshot: !!event.screenshot,
            screenshotSize: event.screenshot ? event.screenshot.length : 0
        });

        // Add to recent events (keep last 100)
        this.recentEvents.unshift(event);
        if (this.recentEvents.length > 100) {
            this.recentEvents = this.recentEvents.slice(0, 100);
        }

        // Update unread count if has true result
        if (hasTrueResult) {
            this.unreadTrueCount++;
            this.updateBadge();
        }

        // Save to storage (note: screenshots can be large, may need to handle storage limits)
        this.saveEventsToStorage();

        // Return the ID of the created event
        return event.id;
    }

    // Update an existing event with response data
    updateEvent(eventId, results, httpStatus, error, responseText, screenshot = null, requestPayload = null) {
        // Find the event
        const eventIndex = this.recentEvents.findIndex(e => e.id === eventId);
        if (eventIndex === -1) {
            console.error('Event not found for update:', eventId);
            return;
        }

        const event = this.recentEvents[eventIndex];

        // Preserve the original source (important for cloud jobs)
        const originalSource = event.source;

        // Update event data
        event.status = 'completed';
        event.httpStatus = httpStatus;
        event.error = error;
        event.response = responseText; // ALWAYS contains response data (JSON, text, or error message)
        event.source = originalSource; // Explicitly preserve the original source

        // Debug logging to verify what's being stored
        console.log('=== EVENT SERVICE STORING RESPONSE ===');
        console.log('Event ID:', eventId);
        console.log('Response being stored:', responseText);
        console.log('Is SAPIENT format?', responseText && responseText.includes('::SAPIENT v:') ? 'YES' : 'NO');
        console.log('=====================================');
        if (screenshot) {
            event.screenshot = screenshot;
        }
        if (requestPayload) {
            event.request = requestPayload;
        }

        // Update success flag based on HTTP status and error
        if (error) {
            event.success = false;
        } else if (httpStatus) {
            event.success = httpStatus >= 200 && httpStatus < 300;
        }

        // Process results if available
        if (results) {
            event.fields = [];
            let hasTrueResult = false;

            // Handle responses with "evaluation" wrapper (newer format)
            let dataToProcess = results;
            if (results.evaluation && typeof results.evaluation === 'object') {
                dataToProcess = results.evaluation;
                console.log('EventService: Found evaluation wrapper, processing inner data');
            }

            // New format: results.fieldName.result or results.fieldName.boolean OR LLM array format
            for (const [fieldName, fieldData] of Object.entries(dataToProcess)) {
                if (fieldName === 'reason' || fieldName === 'summary') continue; // Skip reason/summary fields

                let resultValue = null;
                let probabilityValue = null;

                // Handle LLM array format: [boolean, probability]
                if (Array.isArray(fieldData) && fieldData.length >= 1) {
                    resultValue = fieldData[0]; // boolean result
                    probabilityValue = fieldData.length > 1 ? fieldData[1] : null; // probability
                    console.log(`LLM array format - Field "${fieldName}": result=${resultValue}, probability=${probabilityValue}`);
                }
                // Handle NEW format: {result: boolean, confidence: number} from Gemini and other LLMs
                else if (fieldData && typeof fieldData === 'object' && fieldData.result !== undefined) {
                    resultValue = Array.isArray(fieldData.result) ? fieldData.result[0] : fieldData.result;
                    probabilityValue = fieldData.confidence || fieldData.probability || null;
                    console.log(`Result/confidence format - Field "${fieldName}": result=${resultValue}, probability=${probabilityValue}`);
                }
                // Handle legacy object format: {result: boolean, probability: number} or {boolean: boolean, probability: number}
                else if (fieldData && typeof fieldData === 'object') {
                    // Check for 'boolean' property (legacy)
                    if ('boolean' in fieldData) {
                        resultValue = Array.isArray(fieldData.boolean) ? fieldData.boolean[0] : fieldData.boolean;
                    }

                    // Get probability
                    if ('probability' in fieldData) {
                        probabilityValue = Array.isArray(fieldData.probability) ? fieldData.probability[0] : fieldData.probability;
                    }
                    console.log(`Legacy object format - Field "${fieldName}": result=${resultValue}, probability=${probabilityValue}`);
                }

                if (resultValue !== null && typeof resultValue === 'boolean') {
                    event.fields.push({
                        name: fieldName,
                        result: resultValue,
                        probability: probabilityValue
                    });
                    if (resultValue === true) {
                        hasTrueResult = true;
                    }
                    console.log(`✓ Added field "${fieldName}" to event: result=${resultValue}, probability=${probabilityValue}`);
                } else {
                    console.warn(`✗ Skipped field "${fieldName}": invalid data format`, fieldData);
                }
            }

            event.hasTrueResult = hasTrueResult;
            event.summary = results.summary || '';

            console.log('EventService: Setting summary from results:', {
                hasSummary: !!results.summary,
                summaryText: results.summary,
                resultsStructure: Object.keys(results)
            });

            // Update unread count if has true result
            if (hasTrueResult && !event.read) {
                this.unreadTrueCount++;
                this.updateBadge();
            }
        }

        console.log(`Event ${eventId} updated with status: ${event.status}, httpStatus: ${httpStatus}, success: ${event.success}, source: ${originalSource} (preserved), summary: "${event.summary}"`);

        // Save updated events
        this.saveEventsToStorage();

        // Notify all tabs and popups of the update
        this.notifyEventUpdate(eventId, event);
    }

    // Add field webhook results to an existing event
    addFieldWebhooksToEvent(eventId, fieldWebhooks) {
        // Find the event
        const eventIndex = this.recentEvents.findIndex(e => e.id === eventId);
        if (eventIndex === -1) {
            console.error('Event not found for field webhook update:', eventId);
            return;
        }

        const event = this.recentEvents[eventIndex];

        // Add field webhooks array to the event
        event.fieldWebhooks = fieldWebhooks;

        console.log(`Added ${fieldWebhooks.length} field webhook results to event ${eventId}`);

        // Save updated events
        this.saveEventsToStorage();

        // Notify all tabs and popups of the update
        this.notifyEventUpdate(eventId, event);
    }

    // Update an existing event's request data
    updateEventRequestData(eventId, fullRequestData) {
        // Find the event
        const eventIndex = this.recentEvents.findIndex(e => e.id === eventId);
        if (eventIndex === -1) {
            console.error('Event not found for request data update:', eventId);
            return;
        }

        const event = this.recentEvents[eventIndex];

        // Update the request data with the full LLM payload
        event.request = fullRequestData;

        console.log(`Updated request data for event ${eventId} with full LLM payload`);

        // Save updated events
        this.saveEventsToStorage();
    }

    // Notify about event updates
    notifyEventUpdate(eventId, event) {
        // First try runtime message (for popup)
        chrome.runtime.sendMessage({
            action: 'eventUpdated',
            eventId: eventId,
            event: event
        }, (response) => {
            // Log if message was received
            if (chrome.runtime.lastError) {
                console.log('No popup listening for event update:', chrome.runtime.lastError.message);
            } else {
                console.log('Event update sent to popup for event:', eventId);
            }
        });

        // Also send to all tabs in case multiple popups are open
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, {
                    action: 'eventUpdated',
                    eventId: eventId,
                    event: event
                }, () => {
                    // Ignore errors for tabs that don't have our content script
                    if (chrome.runtime.lastError) {
                        // This is expected for most tabs
                    }
                });
            });
        });
    }

    // Get recent events
    async getRecentEvents() {
        // Ensure events are loaded before returning
        await this.ensureLoaded();

        return {
            events: this.recentEvents,
            unreadCount: this.unreadTrueCount
        };
    }

    // Mark events as read
    markEventsRead() {
        this.unreadTrueCount = 0;
        this.updateBadge();
        return { success: true };
    }

    // Clear all events
    clearHistory() {
        this.recentEvents = [];
        this.unreadTrueCount = 0;
        this.updateBadge();
        // Clear from storage as well
        chrome.storage.local.set({ recentEvents: [] });
        return { success: true };
    }

    // Save events to storage
    async saveEventsToStorage() {
        try {
            await chrome.storage.local.set({ recentEvents: this.recentEvents });
        } catch (err) {
            console.error('Error saving events to storage:', err);
            // If storage fails due to size, try removing screenshots from older events
            if (err.message && err.message.includes('QUOTA_BYTES')) {
                console.log('Storage quota exceeded, removing old screenshots...');
                this.recentEvents.slice(50).forEach(e => delete e.screenshot);
                await chrome.storage.local.set({ recentEvents: this.recentEvents });
            }
        }
    }

    // Update extension badge
    updateBadge() {
        if (this.unreadTrueCount > 0) {
            chrome.action.setBadgeText({ text: this.unreadTrueCount.toString() });
            chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
        } else {
            chrome.action.setBadgeText({ text: '' });
        }
    }

    // Get event by ID
    getEventById(eventId) {
        return this.recentEvents.find(e => e.id === eventId);
    }

    // Get events count
    getEventsCount() {
        return this.recentEvents.length;
    }

    // Get unread true count
    getUnreadTrueCount() {
        return this.unreadTrueCount;
    }
} 