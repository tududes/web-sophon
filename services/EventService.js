// Event tracking and management service
export class EventService {
    constructor() {
        this.recentEvents = []; // Store recent capture events
        this.unreadTrueCount = 0; // Count of unread TRUE events
        this.isLoading = true; // Track loading state
        this.loadPromise = this.loadEventsFromStorage(); // Store the promise
        this.screenshotCache = new Map(); // In-memory cache for fetched screenshots
        this.fetchingScreenshots = new Set(); // Track ongoing fetch requests
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
            screenshot: this.processScreenshotData(screenshot, source, eventId, domain), // Smart screenshot handling
            screenshotUrl: this.generateScreenshotUrl(screenshot, source, eventId, domain), // URL for on-demand loading
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
            screenshotUrl: event.screenshotUrl,
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

        // Save to storage (optimized: large screenshots stored as URLs for on-demand loading)
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

        // Handle screenshot update with new approach
        if (screenshot) {
            if (typeof screenshot === 'string' && screenshot.startsWith('http')) {
                // Direct URL from cloud runner
                event.screenshotUrl = screenshot;
                event.screenshot = null; // Don't store base64
            } else {
                // Base64 data - process according to source
                event.screenshot = this.processScreenshotData(screenshot, originalSource, eventId, event.domain);
                if (!event.screenshotUrl) {
                    event.screenshotUrl = this.generateScreenshotUrl(screenshot, originalSource, eventId, event.domain);
                }
            }
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

    // Save events to storage with intelligent cleanup
    async saveEventsToStorage() {
        try {
            // Proactive cleanup: remove local screenshot data from old events (URLs are kept for on-demand loading)
            await this.cleanupOldScreenshots();

            await chrome.storage.local.set({ recentEvents: this.recentEvents });
        } catch (err) {
            console.error('Error saving events to storage:', err);
            // If storage fails due to size, try more aggressive cleanup
            if (err.message && err.message.includes('QUOTA_BYTES')) {
                console.log('Storage quota exceeded, performing aggressive cleanup...');
                await this.handleStorageQuotaExceeded();
                // Try saving again after cleanup
                try {
                    await chrome.storage.local.set({ recentEvents: this.recentEvents });
                    console.log('Successfully saved events after cleanup');
                } catch (retryErr) {
                    console.error('Failed to save events even after cleanup:', retryErr);
                    // Last resort: keep only the most recent 20 events without screenshots
                    this.recentEvents = this.recentEvents.slice(0, 20).map(event => ({
                        ...event,
                        screenshot: null
                    }));
                    await chrome.storage.local.set({ recentEvents: this.recentEvents });
                    console.log('Emergency cleanup completed - kept only 20 most recent events without screenshots');
                }
            }
        }
    }

    // Clean up old screenshots proactively
    async cleanupOldScreenshots() {
        const now = Date.now();
        const seventyTwoHours = 72 * 60 * 60 * 1000; // 72 hours in milliseconds
        let cleanedCount = 0;

        // Only remove base64 screenshots from local events (cloud events don't store base64)
        this.recentEvents.forEach((event, index) => {
            const eventAge = now - new Date(event.timestamp).getTime();

            // Remove base64 screenshot data if event is older than 72 hours OR beyond first 300 events
            // Keep screenshotUrl for on-demand loading
            if (event.screenshot && event.source === 'local' && (eventAge > seventyTwoHours || index >= 300)) {
                delete event.screenshot;
                cleanedCount++;
            }
        });

        if (cleanedCount > 0) {
            console.log(`Proactive cleanup: removed ${cleanedCount} old local screenshots`);
        }
    }

    // Handle storage quota exceeded with aggressive cleanup
    async handleStorageQuotaExceeded() {
        console.log('Performing aggressive storage cleanup...');

        // Step 1: Remove all base64 screenshots (but keep URLs for on-demand loading)
        let removedScreenshots = 0;
        this.recentEvents.forEach(event => {
            if (event.screenshot && event.source === 'local') {
                delete event.screenshot;
                removedScreenshots++;
            }
        });
        console.log(`Removed ${removedScreenshots} local screenshots`);

        // Step 2: Remove large response data from older events (keep only last 72 hours or 300 events with full data)
        const now = Date.now();
        const seventyTwoHours = 72 * 60 * 60 * 1000;

        this.recentEvents.forEach((event, index) => {
            const eventAge = now - new Date(event.timestamp).getTime();

            // Clean up large data for events older than 72 hours or beyond first 300 events
            if (eventAge > seventyTwoHours || index >= 300) {
                // Truncate large response data
                if (event.response && typeof event.response === 'string' && event.response.length > 1000) {
                    event.response = event.response.substring(0, 200) + '... [truncated for storage]';
                }

                // Clean up large request data
                if (event.request && typeof event.request === 'object') {
                    // Remove screenshot data from request if present
                    if (event.request.sessionData && event.request.sessionData.screenshotData) {
                        delete event.request.sessionData.screenshotData;
                    }
                }
            }
        });

        console.log('Aggressive cleanup completed');
    }

    // Get storage usage information
    async getStorageInfo() {
        try {
            const usage = await chrome.storage.local.getBytesInUse();
            const quota = 5242880; // Chrome extension limit: ~5MB
            return {
                used: usage,
                quota: quota,
                available: quota - usage,
                usedPercentage: Math.round((usage / quota) * 100)
            };
        } catch (error) {
            console.error('Error getting storage info:', error);
            return null;
        }
    }

    // Manual cleanup method that can be called from UI
    async performManualCleanup() {
        console.log('Manual cleanup requested');

        const beforeInfo = await this.getStorageInfo();
        const beforeEvents = this.recentEvents.length;

        // Remove all base64 screenshots (but keep URLs for on-demand loading)
        let removedScreenshots = 0;
        this.recentEvents.forEach(event => {
            if (event.screenshot && event.source === 'local') {
                delete event.screenshot;
                removedScreenshots++;
            }
        });

        // Clean up large response data from older events (keep full data for events within 72 hours or first 300)
        const now = Date.now();
        const seventyTwoHours = 72 * 60 * 60 * 1000;

        this.recentEvents.forEach((event, index) => {
            const eventAge = now - new Date(event.timestamp).getTime();

            // Clean up large data for events older than 72 hours or beyond first 300 events
            if (eventAge > seventyTwoHours || index >= 300) {
                if (event.response && typeof event.response === 'string' && event.response.length > 1000) {
                    event.response = event.response.substring(0, 200) + '... [truncated for storage]';
                }
                if (event.request && typeof event.request === 'object') {
                    if (event.request.sessionData && event.request.sessionData.screenshotData) {
                        delete event.request.sessionData.screenshotData;
                    }
                }
            }
        });

        // Save cleaned events
        await this.saveEventsToStorage();

        const afterInfo = await this.getStorageInfo();
        const afterEvents = this.recentEvents.length;

        const result = {
            success: true,
            removedScreenshots,
            eventsBefore: beforeEvents,
            eventsAfter: afterEvents,
            storageBefore: beforeInfo,
            storageAfter: afterInfo,
            spaceSaved: beforeInfo ? beforeInfo.used - afterInfo.used : 0
        };

        console.log('Manual cleanup completed:', result);
        return result;
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

    // === SCREENSHOT MANAGEMENT METHODS ===

    // Process screenshot data based on source
    processScreenshotData(screenshot, source, eventId, domain) {
        if (!screenshot) return null;

        // For cloud events, don't store base64 locally (save storage space)
        if (source === 'cloud') {
            return null; // Will be loaded on-demand via screenshotUrl
        }

        // For local events, store the screenshot (subject to cleanup)
        if (source === 'local') {
            return this.createThumbnail(screenshot);
        }

        return null;
    }

    // Generate screenshot URL for on-demand loading
    generateScreenshotUrl(screenshot, source, eventId, domain) {
        if (!screenshot) return null;

        if (source === 'cloud') {
            // For cloud events, screenshots will be fetched from cloud runner using jobId_timestamp format
            return `cloud://${domain}/${eventId}/screenshot`;
        }

        // For local events, only create URL if we have screenshot data
        if (source === 'local' && screenshot) {
            return `local://${eventId}/screenshot`;
        }

        return null;
    }

    // Create thumbnail from base64 image (reduce size for local storage)
    createThumbnail(base64Image) {
        if (!base64Image || typeof base64Image !== 'string') return null;

        // Store screenshots for local events, subject to cleanup
        const maxSize = 100000; // ~100KB limit for thumbnails
        if (base64Image.length > maxSize) {
            console.log(`Image large (${base64Image.length} bytes), storing reference only`);
            return null; // Store reference only, will be cleaned up
        }

        return base64Image;
    }

    // Fetch screenshot on demand
    async fetchScreenshot(event) {
        const { id, screenshotUrl, source, screenshot } = event;

        console.log('fetchScreenshot called for event:', {
            id,
            source,
            hasScreenshotUrl: !!screenshotUrl,
            hasScreenshot: !!screenshot,
            screenshotUrl
        });

        // First check if we already have the screenshot data
        if (screenshot && screenshot.startsWith('data:image/')) {
            console.log('Using existing screenshot data for event:', id);
            return screenshot;
        }

        if (!screenshotUrl) {
            console.log('No screenshot URL for event:', id);
            return null;
        }

        // Check memory cache first
        const cacheKey = `${id}-screenshot`;
        if (this.screenshotCache.has(cacheKey)) {
            console.log('Screenshot loaded from cache:', id);
            return this.screenshotCache.get(cacheKey);
        }

        // Check if already fetching to avoid duplicate requests
        if (this.fetchingScreenshots.has(cacheKey)) {
            console.log('Screenshot fetch already in progress:', id);
            return null;
        }

        this.fetchingScreenshots.add(cacheKey);

        try {
            let screenshotData = null;

            console.log(`Attempting to fetch screenshot for event ${id} from ${screenshotUrl}`);

            if (source === 'cloud' && screenshotUrl.startsWith('cloud://')) {
                screenshotData = await this.fetchCloudScreenshot(event);
            } else if (source === 'local' && screenshotUrl.startsWith('local://')) {
                screenshotData = await this.fetchLocalScreenshot(event);
            } else if (screenshotUrl.startsWith('http')) {
                // Direct URL to cloud runner
                screenshotData = await this.fetchDirectScreenshot(screenshotUrl);
            } else {
                console.warn('Unknown screenshot URL format:', screenshotUrl);
            }

            if (screenshotData && screenshotData.startsWith('data:image/')) {
                // Cache in memory for session
                this.screenshotCache.set(cacheKey, screenshotData);
                console.log('Screenshot fetched and cached:', id);
                return screenshotData;
            } else {
                console.warn('Invalid or no screenshot data received for event:', id, screenshotData ? 'Data received but invalid format' : 'No data received');
                return null;
            }

        } catch (error) {
            console.error('Error fetching screenshot for event', id, ':', error);
            return null;
        } finally {
            this.fetchingScreenshots.delete(cacheKey);
        }
    }

    // Fetch screenshot from cloud runner
    async fetchCloudScreenshot(event) {
        try {
            console.log('fetchCloudScreenshot called for event:', {
                eventId: event.id,
                screenshotUrl: event.screenshotUrl,
                hasJobId: !!(event.request?.jobId)
            });

            // If event already has a direct screenshot URL, use it
            if (event.screenshotUrl && event.screenshotUrl.startsWith('http')) {
                console.log(`Using direct screenshot URL: ${event.screenshotUrl}`);

                const response = await chrome.runtime.sendMessage({
                    action: 'makeAuthenticatedRequest',
                    url: event.screenshotUrl,
                    options: { method: 'GET' }
                });

                if (response && response.success) {
                    // The response might contain binary data or base64
                    if (response.data && response.data.startsWith('data:image/')) {
                        console.log('Cloud screenshot fetched successfully via URL');
                        return response.data;
                    } else if (response.blob) {
                        // Convert blob to base64
                        const reader = new FileReader();
                        return new Promise((resolve) => {
                            reader.onload = () => resolve(reader.result);
                            reader.readAsDataURL(response.blob);
                        });
                    }
                }

                console.warn('Cloud screenshot not available via URL:', event.screenshotUrl);
                return null;
            }

            // Fallback to old method using jobId and timestamp
            const settings = await chrome.storage.local.get(['cloudRunnerUrl']);
            const cloudRunnerUrl = settings.cloudRunnerUrl || 'https://runner.websophon.tududes.com';

            // Extract jobId from event request data
            const jobId = event.request?.jobId;
            if (!jobId) {
                console.error('No jobId found for cloud event and no direct URL:', event.id);
                return null;
            }

            // Create filename using jobId_timestamp format
            const timestamp = new Date(event.timestamp).toISOString().replace(/[:.]/g, '-');
            const filename = `${jobId}_${timestamp}.png`;

            // Construct URL to fetch screenshot using jobId_timestamp format
            const url = `${cloudRunnerUrl.replace(/\/$/, '')}/screenshots/${filename}`;

            console.log(`Fetching cloud screenshot from fallback method: ${url}`);

            // Make authenticated request to cloud runner
            const response = await chrome.runtime.sendMessage({
                action: 'makeAuthenticatedRequest',
                url: url,
                options: { method: 'GET' }
            });

            if (response && response.success && response.data) {
                console.log('Cloud screenshot fetched successfully via fallback');
                return response.data; // Should be base64 image data
            }

            console.warn('Cloud screenshot not available via fallback:', filename);
            return null;

        } catch (error) {
            console.error('Error fetching cloud screenshot:', error);
            return null;
        }
    }

    // Fetch screenshot from local storage/cache
    async fetchLocalScreenshot(event) {
        // For local events, try to get from the screenshot field
        if (event.screenshot && event.screenshot.startsWith('data:image/')) {
            return event.screenshot;
        }

        // Local screenshot not available (was cleaned up)
        console.log('Local screenshot not available for event:', event.id, '(cleaned up to save storage)');
        return null;
    }

    // Fetch screenshot from direct URL
    async fetchDirectScreenshot(url) {
        try {
            const response = await fetch(url);
            if (response.ok) {
                const blob = await response.blob();
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                });
            }
        } catch (error) {
            console.error('Error fetching direct screenshot:', error);
        }
        return null;
    }

    // Update event with cloud screenshot URL
    updateEventScreenshotUrl(eventId, screenshotUrl) {
        const event = this.recentEvents.find(e => e.id === eventId);
        if (event) {
            event.screenshotUrl = screenshotUrl;
            this.saveEventsToStorage();
            console.log('Updated screenshot URL for event:', eventId, screenshotUrl);
        }
    }

    // Clear screenshot cache (useful for memory management)
    clearScreenshotCache() {
        this.screenshotCache.clear();
        this.fetchingScreenshots.clear();
        console.log('Screenshot cache cleared');
    }
} 