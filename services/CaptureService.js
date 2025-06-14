// Enhanced screenshot capture service with full page support
export class CaptureService {
    constructor() {
        this.captureIntervals = new Map(); // Map of tabId to interval ID
        this.captureSettings = new Map(); // Map of tabId to capture settings
        this.activeCdpSessions = new Set(); // Track active CDP sessions
    }

    // Start capturing screenshots for a tab
    startCapture(settings, webhookService, eventService) {
        const { tabId, domain, interval, webhookUrl, refreshPage = false, captureDelay = 0 } = settings;

        // Stop any existing capture for this tab
        this.stopCapture(tabId);

        // Store settings including new refresh and delay options
        this.captureSettings.set(tabId, {
            domain,
            webhookUrl,
            refreshPage,
            captureDelay
        });

        // Get domain-specific fields for automatic captures
        chrome.storage.local.get([`fields_${domain}`], (data) => {
            const domainFields = data[`fields_${domain}`] || [];
            const fields = domainFields
                .filter(f => f.name && f.name.trim() && f.description && f.description.trim()) // Filter out empty fields
                .map(f => ({
                    name: this.sanitizeFieldName(f.friendlyName || f.name),
                    criteria: this.escapeJsonString(f.description)
                }));

            console.log(`Starting capture with fields for ${domain}:`, fields);

            // Capture immediately
            webhookService.captureAndSend(tabId, domain, webhookUrl, false, fields, refreshPage, captureDelay);

            // Set up interval
            const intervalId = setInterval(() => {
                // Re-fetch fields each time in case they've changed
                chrome.storage.local.get([`fields_${domain}`], (data) => {
                    const currentFields = data[`fields_${domain}`] || [];
                    const apiFields = currentFields
                        .filter(f => f.name && f.name.trim() && f.description && f.description.trim()) // Filter out empty fields
                        .map(f => ({
                            name: this.sanitizeFieldName(f.friendlyName || f.name),
                            criteria: this.escapeJsonString(f.description)
                        }));
                    webhookService.captureAndSend(tabId, domain, webhookUrl, false, apiFields, refreshPage, captureDelay);
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

            // Clean up any active CDP session for this tab
            this.cleanupCdpSession(tabId);

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
                webhookUrl: currentSettings.webhookUrl,
                refreshPage: currentSettings.refreshPage || false,
                captureDelay: currentSettings.captureDelay || 0
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

        // Clean up all CDP sessions
        this.activeCdpSessions.forEach(tabId => {
            this.cleanupCdpSession(tabId);
        });
    }

    // Enhanced screenshot capture with full page support
    async captureScreenshot(tabId, fullPage = false) {
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

            console.log(`Capturing ${fullPage ? 'full page' : 'viewport'} screenshot for tab ${tabId}`);

            // Make the tab active if it's not
            if (!tab.active) {
                await chrome.tabs.update(tabId, { active: true });
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Try to focus the window
            await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {
                console.warn('Could not focus window, continuing anyway');
            });

            let dataUrl;

            if (fullPage) {
                // Try multiple methods for full page capture
                dataUrl = await this.captureFullPage(tabId, tab);
            } else {
                // Standard viewport capture
                dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
                console.log('Viewport screenshot captured, size:', dataUrl.length);
            }

            return { success: true, dataUrl, tab };

        } catch (error) {
            console.error('Error capturing screenshot:', error);
            throw error;
        }
    }

    // Full page screenshot with multiple fallback methods
    async captureFullPage(tabId, tab) {
        console.log('Attempting full page capture using multiple methods...');

        // Method 1: Chrome DevTools Protocol (Most reliable)
        try {
            return await this.captureFullPageCDP(tabId);
        } catch (cdpError) {
            console.warn('CDP full page capture failed:', cdpError.message);
        }

        // Method 2: Scroll and stitch (Fallback)
        try {
            return await this.captureFullPageScrollStitch(tabId, tab);
        } catch (scrollError) {
            console.warn('Scroll and stitch capture failed:', scrollError.message);
        }

        // Method 3: Fallback to viewport if all else fails
        console.warn('Full page capture failed, falling back to viewport capture');
        return await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    }

    // Method 1: Chrome DevTools Protocol Full Page Capture
    async captureFullPageCDP(tabId) {
        console.log('Attempting CDP full page capture...');

        try {
            // Attach debugger to tab
            await chrome.debugger.attach({ tabId }, '1.3');
            this.activeCdpSessions.add(tabId);

            // Enable Page domain
            await chrome.debugger.sendCommand({ tabId }, 'Page.enable');

            // Wait a moment for page to be ready
            await new Promise(resolve => setTimeout(resolve, 100));

            // Capture full page screenshot
            const result = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', {
                format: 'png',
                captureBeyondViewport: true,
                optimizeForSpeed: false
            });

            // Clean up debugger session
            await this.cleanupCdpSession(tabId);

            const dataUrl = `data:image/png;base64,${result.data}`;
            console.log('CDP full page screenshot captured, size:', dataUrl.length);

            return dataUrl;

        } catch (error) {
            // Ensure cleanup on error
            await this.cleanupCdpSession(tabId);
            throw new Error(`CDP capture failed: ${error.message}`);
        }
    }

    // Method 2: Scroll and Stitch Full Page Capture
    async captureFullPageScrollStitch(tabId, tab) {
        console.log('Attempting scroll and stitch full page capture...');

        try {
            // Inject content script to get page dimensions and manage scrolling
            const [result] = await chrome.scripting.executeScript({
                target: { tabId },
                func: this.getPageDimensionsAndPrepare
            });

            const dimensions = result.result;
            console.log('Page dimensions:', dimensions);

            if (!dimensions.success) {
                throw new Error('Could not get page dimensions');
            }

            // Calculate number of screenshots needed
            const screenshots = [];
            const viewportHeight = dimensions.viewportHeight;
            const totalHeight = dimensions.totalHeight;
            const scrollSteps = Math.ceil(totalHeight / viewportHeight);

            console.log(`Will capture ${scrollSteps} screenshots to cover ${totalHeight}px height`);

            // Capture screenshots by scrolling
            for (let i = 0; i < scrollSteps; i++) {
                const scrollY = i * viewportHeight;

                // Scroll to position
                await chrome.scripting.executeScript({
                    target: { tabId },
                    func: this.scrollToPositionWithLazyLoading,
                    args: [scrollY, { delay: 200, triggerLazyLoad: true, hideStickyElements: false }]
                });

                // Wait for scroll to complete and content to load
                await new Promise(resolve => setTimeout(resolve, 200));

                // Capture this viewport
                const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
                screenshots.push({
                    dataUrl: screenshot,
                    y: scrollY,
                    viewportHeight: viewportHeight
                });

                console.log(`Captured screenshot ${i + 1}/${scrollSteps} at scroll position ${scrollY}`);
            }

            // Restore original scroll position
            await chrome.scripting.executeScript({
                target: { tabId },
                func: this.scrollToPositionWithLazyLoading,
                args: [0, { delay: 100, triggerLazyLoad: false, hideStickyElements: false }]
            });

            // Restore any hidden sticky elements
            await chrome.scripting.executeScript({
                target: { tabId },
                func: this.restoreStickyElements
            });

            // Stitch screenshots together
            const stitchedImage = await this.stitchScreenshots(screenshots, dimensions);
            console.log('Screenshots stitched together, size:', stitchedImage.length);

            return stitchedImage;

        } catch (error) {
            // Restore scroll position on error
            await chrome.scripting.executeScript({
                target: { tabId },
                func: this.restoreStickyElements
            }).catch(() => { }); // Ignore errors during cleanup

            throw new Error(`Scroll and stitch failed: ${error.message}`);
        }
    }

    // Enhanced content script function to get page dimensions and handle lazy loading
    getPageDimensionsAndPrepare() {
        try {
            const body = document.body;
            const html = document.documentElement;

            const totalHeight = Math.max(
                body.scrollHeight, body.offsetHeight,
                html.clientHeight, html.scrollHeight, html.offsetHeight
            );

            const totalWidth = Math.max(
                body.scrollWidth, body.offsetWidth,
                html.clientWidth, html.scrollWidth, html.offsetWidth
            );

            const viewportHeight = window.innerHeight;
            const viewportWidth = window.innerWidth;

            // Store original scroll position
            const originalScrollY = window.scrollY;
            const originalScrollX = window.scrollX;

            // Detect sticky elements for potential handling
            const stickyElements = Array.from(document.querySelectorAll('*'))
                .filter(el => {
                    const style = window.getComputedStyle(el);
                    return style.position === 'sticky' || style.position === 'fixed';
                })
                .map(el => ({
                    element: el,
                    originalVisibility: el.style.visibility,
                    selector: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (el.className ? `.${el.className.split(' ').join('.')}` : '')
                }));

            return {
                success: true,
                totalHeight,
                totalWidth,
                viewportHeight,
                viewportWidth,
                originalScrollY,
                originalScrollX,
                stickyCount: stickyElements.length,
                hasStickyElements: stickyElements.length > 0
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Enhanced scroll function with lazy loading support
    scrollToPositionWithLazyLoading(y, options = {}) {
        const {
            delay = 200,
            triggerLazyLoad = true,
            hideStickyElements = false
        } = options;

        // Hide sticky elements if requested
        if (hideStickyElements) {
            document.querySelectorAll('*').forEach(el => {
                const style = window.getComputedStyle(el);
                if (style.position === 'sticky' || style.position === 'fixed') {
                    el.style.visibility = 'hidden';
                    el.setAttribute('data-websophon-hidden', 'true');
                }
            });
        }

        // Scroll to position
        window.scrollTo(0, y);

        // Trigger lazy loading by dispatching scroll events
        if (triggerLazyLoad) {
            window.dispatchEvent(new Event('scroll'));
            window.dispatchEvent(new Event('resize'));

            // Check for images with loading="lazy" and intersection observers
            const lazyImages = document.querySelectorAll('img[loading="lazy"], img[data-src]');
            lazyImages.forEach(img => {
                // Trigger intersection observer callbacks
                if (img.getBoundingClientRect().top < window.innerHeight + 100) {
                    if (img.dataset.src) {
                        img.src = img.dataset.src;
                        delete img.dataset.src;
                    }
                }
            });
        }

        // Force a repaint
        document.body.offsetHeight;

        return {
            scrollY: window.scrollY,
            scrollX: window.scrollX,
            timestamp: Date.now()
        };
    }

    // Function to restore sticky elements
    restoreStickyElements() {
        document.querySelectorAll('[data-websophon-hidden="true"]').forEach(el => {
            el.style.visibility = '';
            el.removeAttribute('data-websophon-hidden');
        });

        return {
            restored: true,
            timestamp: Date.now()
        };
    }

    // Stitch multiple screenshots together
    async stitchScreenshots(screenshots, dimensions) {
        return new Promise((resolve, reject) => {
            try {
                // Create canvas for stitching
                const canvas = new OffscreenCanvas(dimensions.viewportWidth, dimensions.totalHeight);
                const ctx = canvas.getContext('2d');

                let processedCount = 0;
                const totalCount = screenshots.length;

                screenshots.forEach((screenshot, index) => {
                    const img = new Image();

                    img.onload = () => {
                        // Draw image at correct position
                        const y = screenshot.y;
                        ctx.drawImage(img, 0, y);

                        processedCount++;

                        if (processedCount === totalCount) {
                            // All images processed, convert to data URL
                            canvas.convertToBlob({ type: 'image/png' }).then(blob => {
                                const reader = new FileReader();
                                reader.onload = () => {
                                    resolve(reader.result);
                                };
                                reader.onerror = () => {
                                    reject(new Error('Failed to convert stitched image to data URL'));
                                };
                                reader.readAsDataURL(blob);
                            }).catch(reject);
                        }
                    };

                    img.onerror = () => {
                        reject(new Error(`Failed to load screenshot ${index}`));
                    };

                    img.src = screenshot.dataUrl;
                });

            } catch (error) {
                reject(new Error(`Stitching failed: ${error.message}`));
            }
        });
    }

    // Clean up CDP session
    async cleanupCdpSession(tabId) {
        if (this.activeCdpSessions.has(tabId)) {
            try {
                await chrome.debugger.detach({ tabId });
                console.log(`Cleaned up CDP session for tab ${tabId}`);
            } catch (error) {
                console.warn(`Failed to clean up CDP session for tab ${tabId}:`, error.message);
            } finally {
                this.activeCdpSessions.delete(tabId);
            }
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