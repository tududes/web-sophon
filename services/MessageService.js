// Chrome runtime message handling service
export class MessageService {
    constructor(captureService, webhookService, eventService) {
        this.captureService = captureService;
        this.webhookService = webhookService;
        this.eventService = eventService;
        this.setupMessageListener();
    }

    // Set up the main message listener
    setupMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            console.log('Background received message:', request.action);

            switch (request.action) {
                case 'ping':
                    sendResponse({ pong: true });
                    break;

                case 'startCapture':
                    this.captureService.startCapture(request, this.webhookService, this.eventService);
                    sendResponse({ success: true });
                    break;

                case 'stopCapture':
                    this.captureService.stopCapture(request.tabId);
                    sendResponse({ success: true });
                    break;

                case 'updateInterval':
                    this.captureService.updateInterval(request, this.webhookService, this.eventService);
                    sendResponse({ success: true });
                    break;

                case 'checkStatus':
                    // Check if any tab is capturing for this domain
                    const isActive = this.captureService.checkDomainCaptureStatus(request.domain);
                    sendResponse({ isActive });
                    break;

                case 'tabNavigated':
                    this.captureService.handleTabNavigation(sender.tab.id, request.newDomain);
                    break;

                case 'getRecentEvents':
                    sendResponse(this.eventService.getRecentEvents());
                    break;

                case 'markEventsRead':
                    sendResponse(this.eventService.markEventsRead());
                    break;

                case 'clearHistory':
                    sendResponse(this.eventService.clearHistory());
                    break;

                case 'cancelRequest':
                    // Cancel a pending request
                    const result = this.webhookService.cancelRequest(request.eventId);
                    sendResponse(result);
                    break;

                case 'captureNow':
                    // Manual capture
                    console.log('Manual capture requested:', request);
                    this.webhookService.captureAndSend(request.tabId, request.domain, request.webhookUrl, true, request.fields)
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
    }

    // Set up tab cleanup listeners
    setupTabListeners() {
        // Clean up when tab is closed
        chrome.tabs.onRemoved.addListener((tabId) => {
            this.captureService.cleanupTab(tabId);
        });

        // Clean up when window is closed
        chrome.windows.onRemoved.addListener(() => {
            this.captureService.cleanupAll();
        });
    }

    // Send message to popup
    sendToPopup(message) {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                console.log('No popup listening:', chrome.runtime.lastError.message);
            } else {
                console.log('Message sent to popup:', message.action);
            }
        });
    }

    // Send message to all tabs
    sendToAllTabs(message) {
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, message, () => {
                    // Ignore errors for tabs that don't have our content script
                    if (chrome.runtime.lastError) {
                        // This is expected for most tabs
                    }
                });
            });
        });
    }

    // Send message to specific tab
    sendToTab(tabId, message) {
        chrome.tabs.sendMessage(tabId, message, (response) => {
            if (chrome.runtime.lastError) {
                console.log(`Failed to send message to tab ${tabId}:`, chrome.runtime.lastError.message);
            }
        });
    }
} 