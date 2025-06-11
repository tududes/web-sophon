// Screenshot capture service
export class CaptureService {
    constructor() {
        this.captureIntervals = new Map(); // Map of tabId to interval ID
        this.captureSettings = new Map(); // Map of tabId to capture settings
    }

    // Start capturing screenshots for a tab
    startCapture(settings, webhookService, eventService) {
        const { tabId, domain, interval, webhookUrl } = settings;

        // Stop any existing capture for this tab
        this.stopCapture(tabId);

        // Store settings
        this.captureSettings.set(tabId, { domain, webhookUrl });

        // Get domain-specific fields for automatic captures
        chrome.storage.sync.get([`fields_${domain}`], (data) => {
            const domainFields = data[`fields_${domain}`] || [];
            const fields = domainFields.map(f => ({
                name: this.sanitizeFieldName(f.friendlyName || f.name),
                criteria: this.escapeJsonString(f.description)
            }));

            console.log(`Starting capture with fields for ${domain}:`, fields);

            // Capture immediately
            webhookService.captureAndSend(tabId, domain, webhookUrl, false, fields);

            // Set up interval
            const intervalId = setInterval(() => {
                // Re-fetch fields each time in case they've changed
                chrome.storage.sync.get([`fields_${domain}`], (data) => {
                    const currentFields = data[`fields_${domain}`] || [];
                    const apiFields = currentFields.map(f => ({
                        name: this.sanitizeFieldName(f.friendlyName || f.name),
                        criteria: this.escapeJsonString(f.description)
                    }));
                    webhookService.captureAndSend(tabId, domain, webhookUrl, false, apiFields);
                });
            }, interval * 1000);

            this.captureIntervals.set(tabId, intervalId);
            console.log(`Started capture for tab ${tabId} on domain ${domain} every ${interval} seconds`);
        });
    }

    // Stop capturing screenshots for a tab
    stopCapture(tabId) {
        if (this.captureIntervals.has(tabId)) {
            clearInterval(this.captureIntervals.get(tabId));
            this.captureIntervals.delete(tabId);
            this.captureSettings.delete(tabId);
            console.log(`Stopped capture for tab ${tabId}`);
        }
    }

    // Update capture interval for a tab
    updateInterval(settings, webhookService, eventService) {
        const { tabId, interval } = settings;

        if (this.captureIntervals.has(tabId)) {
            const currentSettings = this.captureSettings.get(tabId);
            this.stopCapture(tabId);
            this.startCapture({
                tabId,
                domain: currentSettings.domain,
                interval,
                webhookUrl: currentSettings.webhookUrl
            }, webhookService, eventService);
        }
    }

    // Handle tab navigation - stop capture if navigated away from domain
    handleTabNavigation(tabId, newDomain) {
        if (this.captureSettings.has(tabId)) {
            const settings = this.captureSettings.get(tabId);
            if (settings.domain !== newDomain) {
                console.log(`Tab ${tabId} navigated away from ${settings.domain} to ${newDomain}. Stopping capture.`);
                this.stopCapture(tabId);
            }
        }
    }

    // Check if any tab is capturing for a specific domain
    checkDomainCaptureStatus(domain) {
        for (const [tabId, settings] of this.captureSettings.entries()) {
            if (settings.domain === domain) {
                return true;
            }
        }
        return false;
    }

    // Get capture settings for a tab
    getCaptureSettings(tabId) {
        return this.captureSettings.get(tabId);
    }

    // Clean up when tab or window is closed
    cleanupTab(tabId) {
        this.stopCapture(tabId);
    }

    // Clean up all captures
    cleanupAll() {
        this.captureIntervals.forEach((intervalId, tabId) => {
            this.stopCapture(tabId);
        });
    }

    // Capture screenshot from a specific tab
    async captureScreenshot(tabId) {
        try {
            // Check if tab still exists
            const tab = await chrome.tabs.get(tabId).catch(() => null);
            if (!tab) {
                console.error(`Tab ${tabId} no longer exists`);
                this.stopCapture(tabId);
                throw new Error('Tab no longer exists');
            }

            // Check if URL is capturable
            if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') ||
                tab.url.startsWith('edge://') || tab.url === 'about:blank') {
                console.error(`Cannot capture screenshot on URL: ${tab.url}`);
                throw new Error('Cannot capture screenshots on this page type');
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

                return { success: true, dataUrl, tab };
            } catch (captureError) {
                console.error('Screenshot capture failed:', captureError);
                throw new Error(`Screenshot capture failed: ${captureError.message}`);
            }
        } catch (error) {
            console.error('Error capturing screenshot:', error);
            throw error;
        }
    }

    // Helper functions for field processing
    sanitizeFieldName(friendlyName) {
        if (!friendlyName) return 'unnamed_field';
        return friendlyName.toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
            .replace(/^_+|_+$/g, '')
            .replace(/_+/g, '_') || 'unnamed_field';
    }

    escapeJsonString(str) {
        if (!str) return '';
        return str
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
    }
} 