// Background service worker for screenshot capture
let captureIntervals = new Map(); // Map of tabId to interval ID
let captureSettings = new Map(); // Map of tabId to capture settings
let recentEvents = []; // Store recent capture events
let unreadTrueCount = 0; // Count of unread TRUE events
let pendingRequests = new Map(); // Map of eventId to AbortController for cancellation

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Background received message:', request.action);

    switch (request.action) {
        case 'ping':
            sendResponse({ pong: true });
            break;
        case 'startCapture':
            startCapture(request);
            sendResponse({ success: true });
            break;

        case 'stopCapture':
            stopCapture(request.tabId);
            sendResponse({ success: true });
            break;

        case 'updateInterval':
            updateInterval(request);
            sendResponse({ success: true });
            break;

        case 'checkStatus':
            // Check if any tab is capturing for this domain
            let isActive = false;
            for (const [tabId, settings] of captureSettings.entries()) {
                if (settings.domain === request.domain) {
                    isActive = true;
                    break;
                }
            }
            sendResponse({ isActive });
            break;

        case 'tabNavigated':
            handleTabNavigation(sender.tab.id, request.newDomain);
            break;

        case 'getRecentEvents':
            sendResponse({ events: recentEvents, unreadCount: unreadTrueCount });
            break;

        case 'markEventsRead':
            unreadTrueCount = 0;
            updateBadge();
            sendResponse({ success: true });
            break;

        case 'clearHistory':
            // Clear the events from memory
            recentEvents = [];
            unreadTrueCount = 0;
            updateBadge();
            // Clear from storage as well
            chrome.storage.local.set({ recentEvents: [] });
            sendResponse({ success: true });
            break;

        case 'cancelRequest':
            // Cancel a pending request
            const eventId = request.eventId;
            if (pendingRequests.has(eventId)) {
                const controller = pendingRequests.get(eventId);
                controller.abort();
                pendingRequests.delete(eventId);
                console.log(`Cancelled request for event ${eventId}`);

                // Update the event as cancelled
                updateEvent(eventId, null, null, 'Request cancelled by user', null);
                sendResponse({ success: true });
            } else {
                sendResponse({ success: false, error: 'Request not found or already completed' });
            }
            break;

        case 'captureNow':
            // Manual capture
            console.log('Manual capture requested:', request);
            captureAndSend(request.tabId, request.domain, request.webhookUrl, true, request.fields)
                .then(result => {
                    console.log('Capture result:', result);
                    sendResponse(result);
                })
                .catch(error => {
                    console.error('Capture error in background:', error);
                    sendResponse({ success: false, error: error.message });
                });
            return true; // Will respond asynchronously
    }
    return true; // Keep message channel open for async responses
});

// Start capturing screenshots
function startCapture(settings) {
    const { tabId, domain, interval, webhookUrl } = settings;

    // Stop any existing capture for this tab
    stopCapture(tabId);

    // Store settings
    captureSettings.set(tabId, { domain, webhookUrl });

    // Get domain-specific fields for automatic captures
    chrome.storage.sync.get([`fields_${domain}`], (data) => {
        const domainFields = data[`fields_${domain}`] || [];
        const fields = domainFields.map(f => ({
            name: sanitizeFieldName(f.friendlyName || f.name),
            criteria: escapeJsonString(f.description)
        }));

        console.log(`Starting capture with fields for ${domain}:`, fields);

        // Capture immediately
        captureAndSend(tabId, domain, webhookUrl, false, fields);

        // Set up interval
        const intervalId = setInterval(() => {
            // Re-fetch fields each time in case they've changed
            chrome.storage.sync.get([`fields_${domain}`], (data) => {
                const currentFields = data[`fields_${domain}`] || [];
                const apiFields = currentFields.map(f => ({
                    name: sanitizeFieldName(f.friendlyName || f.name),
                    criteria: escapeJsonString(f.description)
                }));
                captureAndSend(tabId, domain, webhookUrl, false, apiFields);
            });
        }, interval * 1000);

        captureIntervals.set(tabId, intervalId);
        console.log(`Started capture for tab ${tabId} on domain ${domain} every ${interval} seconds`);
    });
}

// Stop capturing screenshots
function stopCapture(tabId) {
    if (captureIntervals.has(tabId)) {
        clearInterval(captureIntervals.get(tabId));
        captureIntervals.delete(tabId);
        captureSettings.delete(tabId);
        console.log(`Stopped capture for tab ${tabId}`);
    }
}

// Update capture interval
function updateInterval(settings) {
    const { tabId, interval } = settings;

    if (captureIntervals.has(tabId)) {
        const currentSettings = captureSettings.get(tabId);
        stopCapture(tabId);
        startCapture({
            tabId,
            domain: currentSettings.domain,
            interval,
            webhookUrl: currentSettings.webhookUrl
        });
    }
}

// Handle tab navigation
function handleTabNavigation(tabId, newDomain) {
    if (captureSettings.has(tabId)) {
        const settings = captureSettings.get(tabId);
        if (settings.domain !== newDomain) {
            console.log(`Tab ${tabId} navigated away from ${settings.domain} to ${newDomain}. Stopping capture.`);
            stopCapture(tabId);
        }
    }
}

// Capture screenshot and send to webhook
async function captureAndSend(tabId, domain, webhookUrl, isManual = false, fields = null) {
    try {
        console.log(`Attempting to capture screenshot for tab ${tabId}, domain: ${domain}, webhook: ${webhookUrl}`);

        // For automatic captures, get fields from storage
        if (!fields && !isManual) {
            const domainKey = `fields_${domain}`;
            const storage = await chrome.storage.sync.get([domainKey]);
            const domainFields = storage[domainKey] || [];

            console.log(`Loading fields for domain ${domain}:`, domainFields);

            fields = domainFields.map(f => ({
                name: sanitizeFieldName(f.friendlyName || f.name),
                criteria: escapeJsonString(f.description)
            }));

            // If no fields configured, still track the event
            if (fields.length === 0) {
                console.log('No fields configured for domain:', domain);
            }
        }

        // Check if tab still exists
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab) {
            console.error(`Tab ${tabId} no longer exists`);
            stopCapture(tabId);
            return { success: false, error: 'Tab no longer exists' };
        }

        // Check if URL is capturable
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') ||
            tab.url.startsWith('edge://') || tab.url === 'about:blank') {
            console.error(`Cannot capture screenshot on URL: ${tab.url}`);
            return { success: false, error: 'Cannot capture screenshots on this page type' };
        }

        // Ensure tab is active and window is focused for capture
        let dataUrl;
        try {
            // Make the tab active if it's not
            if (!tab.active) {
                await chrome.tabs.update(tabId, { active: true });
                // Small delay to ensure tab is ready
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Try to focus the window
            await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {
                console.warn('Could not focus window, continuing anyway');
            });

            // Capture visible tab
            console.log('Capturing visible tab...');
            dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
            console.log('Screenshot captured, size:', dataUrl.length);
        } catch (captureError) {
            console.error('Screenshot capture failed:', captureError);
            throw new Error(`Screenshot capture failed: ${captureError.message}`);
        }

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
        trackEvent(null, domain, tab.url, true, null, null, dataUrl, requestData, null, eventId, 'pending');

        // Notify popup that request is pending
        chrome.runtime.sendMessage({
            action: 'captureStarted',
            eventId: eventId,
            domain: domain
        });

        // Send to webhook with very long timeout (300 seconds)
        const controller = new AbortController();
        pendingRequests.set(eventId, controller); // Store for potential cancellation

        const timeoutId = setTimeout(() => {
            controller.abort();
            pendingRequests.delete(eventId);
        }, 300000); // 300 seconds

        let webhookResponse;
        try {
            webhookResponse = await fetch(webhookUrl, {
                method: 'POST',
                body: formData,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            pendingRequests.delete(eventId); // Remove from pending when completed
        } catch (fetchError) {
            clearTimeout(timeoutId);
            pendingRequests.delete(eventId); // Remove from pending on error
            console.log('Fetch error occurred:', fetchError);

            let errorMessage;
            if (fetchError.name === 'AbortError') {
                // Check if it was user-cancelled or timeout
                errorMessage = pendingRequests.has(eventId) ? 'Request timed out after 5 minutes' : 'Request cancelled by user';
            } else {
                errorMessage = fetchError.message;
            }

            // Update the pending event with the error
            updateEvent(eventId, null, null, errorMessage, null);

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
        updateEvent(eventId, responseData, webhookResponse.status, parseError, responseText);

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
            updateEvent(eventId, null, null, error.message, null);
        } else {
            // Track failed event (screenshot may be undefined if capture failed)
            trackEvent(null, domain, tab ? tab.url : '', false, null, error.message,
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
            stopCapture(tabId);
        }

        return { success: false, error: error.message };
    }
}

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
    stopCapture(tabId);
});

// Clean up when window is closed
chrome.windows.onRemoved.addListener(() => {
    // Stop all captures
    captureIntervals.forEach((intervalId, tabId) => {
        stopCapture(tabId);
    });
});

// Track capture event
function trackEvent(results, domain, url, success = true, httpStatus = null, error = null, screenshot = null, request = null, response = null, eventId = null, status = 'completed') {
    // Check if any field evaluated to true
    let hasTrueResult = false;
    const fieldResults = [];

    if (results && results.fields) {
        for (const [fieldName, result] of Object.entries(results.fields)) {
            fieldResults.push({
                name: fieldName,
                result: result.boolean,
                probability: result.probability
            });
            if (result.boolean === true) {
                hasTrueResult = true;
            }
        }
    }

    // Create event record
    const event = {
        id: eventId || Date.now(),
        timestamp: new Date().toISOString(),
        domain: domain,
        url: url,
        success: success,
        httpStatus: httpStatus,
        error: error,
        fields: fieldResults,
        reason: results ? (results.reason || '') : '',
        hasTrueResult: hasTrueResult,
        read: false,
        screenshot: screenshot, // Store the base64 screenshot
        request: request,
        response: response,
        status: status // 'pending' or 'completed'
    };

    console.log('Tracking event:', event);

    // Add to recent events (keep last 100)
    recentEvents.unshift(event);
    if (recentEvents.length > 100) {
        recentEvents = recentEvents.slice(0, 100);
    }

    // Update unread count if has true result
    if (hasTrueResult) {
        unreadTrueCount++;
        updateBadge();
    }

    // Save to storage (note: screenshots can be large, may need to handle storage limits)
    chrome.storage.local.set({ recentEvents: recentEvents }).catch(err => {
        console.error('Error saving events to storage:', err);
        // If storage fails due to size, try removing screenshots from older events
        if (err.message && err.message.includes('QUOTA_BYTES')) {
            console.log('Storage quota exceeded, removing old screenshots...');
            recentEvents.slice(50).forEach(e => delete e.screenshot);
            chrome.storage.local.set({ recentEvents: recentEvents });
        }
    });
}

// Update an existing event with response data
function updateEvent(eventId, results, httpStatus, error, responseText) {
    // Find the event
    const eventIndex = recentEvents.findIndex(e => e.id === eventId);
    if (eventIndex === -1) {
        console.error('Event not found for update:', eventId);
        return;
    }

    const event = recentEvents[eventIndex];

    // Update event data
    event.status = 'completed';
    event.httpStatus = httpStatus;
    event.error = error;
    event.response = responseText;

    // Update success flag based on HTTP status and error
    if (error) {
        event.success = false;
    } else if (httpStatus) {
        event.success = httpStatus >= 200 && httpStatus < 300;
    }

    // Process results if available
    if (results && results.fields) {
        event.fields = [];
        let hasTrueResult = false;

        for (const [fieldName, result] of Object.entries(results.fields)) {
            event.fields.push({
                name: fieldName,
                result: result.boolean,
                probability: result.probability
            });
            if (result.boolean === true) {
                hasTrueResult = true;
            }
        }

        event.hasTrueResult = hasTrueResult;
        event.reason = results.reason || '';

        // Update unread count if has true result
        if (hasTrueResult && !event.read) {
            unreadTrueCount++;
            updateBadge();
        }
    }

    console.log(`Event ${eventId} updated with status: ${event.status}, httpStatus: ${httpStatus}, success: ${event.success}`);

    // Save updated events
    chrome.storage.local.set({ recentEvents: recentEvents }, () => {
        console.log('Updated events saved to storage');
    });

    // Notify all tabs and popups of the update
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

// Update extension badge
function updateBadge() {
    if (unreadTrueCount > 0) {
        chrome.action.setBadgeText({ text: unreadTrueCount.toString() });
        chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
    } else {
        chrome.action.setBadgeText({ text: '' });
    }
}

// Load recent events on startup
chrome.storage.local.get(['recentEvents'], (data) => {
    if (data.recentEvents) {
        recentEvents = data.recentEvents;
        // Count unread TRUE events
        unreadTrueCount = recentEvents.filter(e => e.hasTrueResult && !e.read).length;
        updateBadge();
    }
});

// Helper functions for field processing
function sanitizeFieldName(friendlyName) {
    if (!friendlyName) return 'unnamed_field';
    return friendlyName.toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_') || 'unnamed_field';
}

function escapeJsonString(str) {
    if (!str) return '';
    return str
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
} 