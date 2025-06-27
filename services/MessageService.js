// Chrome runtime message handling service
export class MessageService {
    constructor(captureService, webhookService, eventService, llmService) {
        this.captureService = captureService;
        this.webhookService = webhookService;
        this.eventService = eventService;
        this.llmService = llmService;
        this.setupMessageListener();
    }

    // Set up the main message listener
    setupMessageListener() {
        chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
            console.log('Background received message:', request.action);

            switch (request.action) {
                case 'ping':
                    sendResponse({ pong: true });
                    break;

                case 'startCapture':
                    this.captureService.startCapture(request, this.llmService, this.eventService);
                    sendResponse({ success: true });
                    break;

                case 'stopCapture':
                    this.captureService.stopCapture(request.tabId);
                    sendResponse({ success: true });
                    break;

                case 'updateInterval':
                    this.captureService.updateInterval(request, this.llmService, this.eventService);
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
                    // Handle async getRecentEvents
                    this.eventService.getRecentEvents()
                        .then(result => {
                            sendResponse(result);
                        })
                        .catch(error => {
                            console.error('Error getting recent events:', error);
                            sendResponse({ events: [], unreadCount: 0 });
                        });
                    return true; // Keep channel open for async response
                    break;

                case 'markEventsRead':
                    sendResponse(this.eventService.markEventsRead());
                    break;

                case 'clearHistory':
                    sendResponse(this.eventService.clearHistory());
                    break;

                case 'cancelRequest':
                    // Cancel a pending request (works for both webhook and LLM)
                    let result = this.webhookService.cancelRequest(request.eventId);
                    if (!result.success && this.llmService) {
                        result = this.llmService.cancelRequest(request.eventId);
                    }
                    sendResponse(result);
                    break;

                case 'captureNow':
                    // Manual capture with webhook
                    console.log('Manual webhook capture requested:', request);
                    this.webhookService.captureAndSend(
                        request.tabId,
                        request.domain,
                        request.webhookUrl,
                        true,
                        request.fields,
                        request.refreshPage,
                        request.captureDelay
                    )
                        .then(result => {
                            console.log('Webhook capture result:', result);
                            sendResponse(result);
                        })
                        .catch(error => {
                            console.error('Webhook capture error in background:', error);
                            sendResponse({ success: false, error: error.message });
                        });
                    return true; // Will respond asynchronously

                case 'captureLLM':
                    console.log('LLM capture requested:', request);
                    try {
                        const response = await this.llmService.captureAndSend(
                            request.tabId,
                            request.domain,
                            request.llmConfig,
                            request.isManual || false,
                            request.fields,
                            request.refreshPage || false,
                            request.captureDelay || 0,
                            request.previousEvaluation || null
                        );
                        sendResponse(response);
                    } catch (error) {
                        console.error('LLM capture failed:', error);
                        sendResponse({ success: false, error: error.message });
                    }
                    return true; // Keep message channel open for async response

                case 'testLLM':
                    // Test LLM configuration
                    console.log('LLM test requested:', { ...request, llmConfig: { ...request.llmConfig, apiKey: 'HIDDEN' } });
                    if (!this.llmService) {
                        sendResponse({ success: false, error: 'LLM service not available' });
                        return;
                    }

                    this.llmService.testConfiguration(request.llmConfig)
                        .then(result => {
                            console.log('LLM test result:', result);
                            sendResponse(result);
                        })
                        .catch(error => {
                            console.error('LLM test error:', error);
                            sendResponse({ success: false, error: error.message });
                        });
                    return true; // Will respond asynchronously

                case 'prepareCaptureData':
                    // Shared data preparation for DRY principle
                    console.log('Prepare capture data requested for domain:', request.domain);
                    try {
                        const captureData = await this.prepareCaptureData(request.domain);
                        if (captureData.isValid) {
                            sendResponse({
                                success: true,
                                data: {
                                    llmConfig: captureData.llmConfig,
                                    fields: captureData.fields,
                                    previousEvaluation: captureData.previousEvaluation,
                                    captureSettings: captureData.captureSettings
                                }
                            });
                        } else {
                            sendResponse({
                                success: false,
                                error: captureData.error || 'Invalid capture configuration'
                            });
                        }
                    } catch (error) {
                        console.error('Error preparing capture data:', error);
                        sendResponse({ success: false, error: error.message });
                    }
                    return true; // Will respond asynchronously

                case 'captureResults':
                    // Handle automatic capture results when popup might be closed
                    console.log('Background received captureResults for automatic capture');
                    try {
                        if (request.results && request.domain && !request.isManual) {
                            // Store automatic capture results for field updates
                            this.storeAutomaticCaptureResults(request.domain, request.results, request.eventId);
                        }
                        // Always forward to popup if it's listening
                        this.sendToPopup(request);
                    } catch (error) {
                        console.error('Error handling captureResults in background:', error);
                    }
                    sendResponse({ success: true });
                    break;

                case 'startCloudJob':
                    this.handleStartCloudJob(request)
                        .then(sendResponse)
                        .catch(error => {
                            console.error('startCloudJob failed:', error);
                            sendResponse({ success: false, error: error.message });
                        });
                    return true; // Keep channel open for async response
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

    // Store automatic capture results for field updates (when popup is closed)
    async storeAutomaticCaptureResults(domain, results, eventId) {
        try {
            console.log(`Storing automatic capture results for domain ${domain}:`, results);

            // Store the results as previous evaluation for next capture
            if (results && typeof results === 'object') {
                const prevEvalKey = `previousEvaluation_${domain}`;
                const evaluationData = {
                    results: results,
                    timestamp: new Date().toISOString(),
                    eventId: eventId
                };

                await chrome.storage.local.set({ [prevEvalKey]: evaluationData });
                console.log(`Stored automatic capture results as previous evaluation for ${domain}`);
            }

            // Update field results in storage for when popup reopens
            const domainKey = `fields_${domain}`;
            const storage = await chrome.storage.local.get([domainKey]);
            const domainFields = storage[domainKey] || [];

            if (domainFields.length > 0) {
                let updated = false;

                // Update field results based on LLM response
                domainFields.forEach(field => {
                    if (field.name && results[field.name] !== undefined) {
                        const fieldResult = results[field.name];

                        // Parse the result format: [boolean, probability] or direct values
                        if (Array.isArray(fieldResult) && fieldResult.length >= 2) {
                            field.result = fieldResult[0];
                            field.probability = fieldResult[1];
                        } else if (typeof fieldResult === 'object' && fieldResult.boolean !== undefined) {
                            field.result = fieldResult.boolean;
                            field.probability = fieldResult.probability || null;
                        } else if (typeof fieldResult === 'boolean') {
                            field.result = fieldResult;
                            field.probability = null;
                        }

                        // Update field status
                        field.isPending = false;
                        field.lastStatus = 'success';
                        field.lastResponseTime = new Date().toISOString();
                        field.lastError = null;
                        field.lastEventId = eventId;
                        updated = true;

                        console.log(`Updated field ${field.name} with automatic capture result:`, {
                            result: field.result,
                            probability: field.probability
                        });
                    }
                });

                if (updated) {
                    await chrome.storage.local.set({ [domainKey]: domainFields });
                    console.log(`Updated ${domainFields.length} fields in storage for domain ${domain}`);
                }
            }

        } catch (error) {
            console.error('Error storing automatic capture results:', error);
        }
    }

    // Shared capture preparation logic (DRY principle)
    async prepareCaptureData(domain) {
        try {
            // Get fresh LLM config from storage (same format as popup)
            const llmData = await chrome.storage.local.get(['llmConfig_global']);
            const storedConfig = llmData.llmConfig_global || {};

            const llmConfig = {
                apiUrl: storedConfig.apiUrl || '',
                apiKey: storedConfig.apiKey || '',
                model: storedConfig.model || 'opengvlab/internvl3-14b:free',
                temperature: storedConfig.temperature !== undefined ? parseFloat(storedConfig.temperature) : 0.1,
                maxTokens: storedConfig.maxTokens !== undefined ? parseInt(storedConfig.maxTokens) : 1000
            };

            console.log('Prepared LLM config for automatic capture:', {
                ...llmConfig,
                apiKey: llmConfig.apiKey ? `${llmConfig.apiKey.length} chars` : 'MISSING'
            });

            // Get domain-specific fields
            const domainKey = `fields_${domain}`;
            const storage = await chrome.storage.local.get([domainKey, 'usePreviousEvaluation']);
            const domainFields = storage[domainKey] || [];

            const fields = domainFields
                .filter(f => f.name && f.name.trim() && f.description && f.description.trim())
                .map(f => ({
                    name: this.captureService.sanitizeFieldName(f.friendlyName || f.name),
                    criteria: f.description
                }));

            console.log(`Prepared ${fields.length} fields for automatic capture`);

            // Get previous evaluation context
            let previousEvaluation = null;
            const usePreviousEvaluation = storage.usePreviousEvaluation !== false;

            if (usePreviousEvaluation) {
                const prevEvalKey = `previousEvaluation_${domain}`;
                const prevEvalData = await chrome.storage.local.get([prevEvalKey]);
                previousEvaluation = prevEvalData[prevEvalKey] || null;
            }

            // Get capture settings
            const captureSettings = await chrome.storage.local.get(['refreshPageToggle', 'captureDelay', 'fullPageCaptureToggle']);

            const isValid = !!(llmConfig.apiUrl && llmConfig.apiKey && fields.length > 0);

            if (!isValid) {
                console.error('Automatic capture validation failed:', {
                    hasApiUrl: !!llmConfig.apiUrl,
                    hasApiKey: !!llmConfig.apiKey,
                    fieldCount: fields.length
                });
            }

            return {
                llmConfig,
                fields,
                previousEvaluation,
                captureSettings,
                isValid
            };

        } catch (error) {
            console.error('Error preparing capture data:', error);
            return {
                llmConfig: null,
                fields: [],
                previousEvaluation: null,
                captureSettings: {},
                isValid: false,
                error: error.message
            };
        }
    }

    // Full capture method for automatic captures only
    async performCapture(tabId, domain, isManual = false, eventId = null) {
        try {
            console.log(`Performing ${isManual ? 'manual' : 'automatic'} capture for domain: ${domain}`);

            // Use shared data preparation
            const captureData = await this.prepareCaptureData(domain);

            if (!captureData.isValid) {
                const error = captureData.error || 'Invalid capture configuration or no fields configured';
                console.error('Capture failed:', error);
                return { success: false, error };
            }

            // Send captureLLM message to ensure same flow as manual captures
            const message = {
                action: 'captureLLM',
                tabId: tabId,
                domain: domain,
                fields: captureData.fields,
                eventId: eventId || Date.now().toString(),
                llmConfig: captureData.llmConfig,
                isManual: isManual,
                refreshPage: captureData.captureSettings.refreshPageToggle || false,
                captureDelay: parseInt(captureData.captureSettings.captureDelay || '0'),
                fullPageCapture: captureData.captureSettings.fullPageCaptureToggle || false,
                previousEvaluation: captureData.previousEvaluation
            };

            console.log(`${isManual ? 'Manual' : 'Automatic'} capture sending captureLLM message:`, {
                ...message,
                llmConfig: { ...message.llmConfig, apiKey: 'HIDDEN' }
            });

            // Send through the same message handler as manual captures
            const response = await this.llmService.captureAndSend(
                message.tabId,
                message.domain,
                message.llmConfig,
                message.isManual,
                message.fields,
                message.refreshPage,
                message.captureDelay,
                message.previousEvaluation
            );

            console.log(`${isManual ? 'Manual' : 'Automatic'} capture completed:`, response);
            return response;

        } catch (error) {
            console.error('Error in performCapture:', error);
            return { success: false, error: error.message };
        }
    }

    // === CLOUD RUNNER LOGIC ===

    async getSessionData(tabId) {
        try {
            const [result] = await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: () => {
                    return {
                        localStorage: { ...window.localStorage },
                        sessionStorage: { ...window.sessionStorage },
                        viewport: {
                            width: window.innerWidth,
                            height: window.innerHeight,
                            deviceScaleFactor: window.devicePixelRatio
                        },
                        userAgent: navigator.userAgent,
                        url: window.location.href
                    };
                }
            });
            return result.result;
        } catch (error) {
            console.error('[Cloud] Failed to inject script to get session data:', error);
            // Fallback for pages where script injection is not allowed
            const tab = await chrome.tabs.get(tabId);
            return {
                localStorage: {},
                sessionStorage: {},
                viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
                userAgent: navigator.userAgent, // Background script's user agent
                url: tab.url
            };
        }
    }

    async handleStartCloudJob(request) {
        const { tabId, domain } = request;
        let eventId;

        try {
            console.log(`[Cloud] Starting job for tab ${tabId} on domain ${domain}`);
            const tab = await chrome.tabs.get(tabId);

            // 1. Create a pending event immediately so the user sees feedback.
            eventId = this.eventService.trackEvent(
                null, domain, tab.url, true, null, null, null,
                { source: 'cloud', status: 'gathering_data' },
                null, null, 'pending', 'cloud'
            );
            console.log(`[Cloud] Created pending event ${eventId}`);

            // 2. Gather all necessary data in parallel
            const [
                sessionData,
                cookies,
                captureData
            ] = await Promise.all([
                this.getSessionData(tabId),
                chrome.cookies.getAll({ url: tab.url }),
                this.prepareCaptureData(domain) // Reuse existing data prep logic
            ]);

            if (!captureData.isValid) {
                throw new Error(captureData.error || 'Invalid configuration for capture.');
            }

            const jobPayload = {
                sessionData: { ...sessionData, cookies },
                llmConfig: captureData.llmConfig,
                fields: captureData.fields,
                previousEvaluation: captureData.previousEvaluation
            };

            // 3. Make initial POST request to cloud runner
            const runnerUrl = 'http://localhost:7113/job';
            const initialResponse = await fetch(runnerUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(jobPayload)
            });

            if (!initialResponse.ok) {
                const errorText = await initialResponse.text();
                throw new Error(`Cloud runner rejected job: ${initialResponse.status} - ${errorText}`);
            }

            const { jobId } = await initialResponse.json();
            if (!jobId) {
                throw new Error('Cloud runner did not return a valid job ID.');
            }

            console.log(`[Cloud] Job submitted successfully. Job ID: ${jobId}`);

            // 4. Update event with jobId and request data for history
            this.eventService.updateEventRequestData(eventId, { jobId, jobPayload: { ...jobPayload, llmConfig: { ...jobPayload.llmConfig, apiKey: 'REDACTED' } } });

            // 5. Start polling for the result
            this.pollCloudJob(eventId, jobId);

            // 6. Return success to the popup
            return { success: true, eventId: eventId };

        } catch (error) {
            console.error('[Cloud] Error starting cloud job:', error);
            if (eventId) {
                this.eventService.updateEvent(eventId, null, null, error.message, error.message);
            }
            return { success: false, error: error.message };
        }
    }

    pollCloudJob(eventId, jobId) {
        const pollInterval = 5000; // 5 seconds
        const maxPolls = 60; // 5 minutes timeout
        let pollCount = 0;

        const intervalId = setInterval(async () => {
            if (pollCount >= maxPolls) {
                clearInterval(intervalId);
                console.error(`[Cloud] Job ${jobId} timed out after ${maxPolls * pollInterval / 1000} seconds.`);
                this.eventService.updateEvent(eventId, null, 504, 'Job polling timed out', 'Job polling timed out');
                return;
            }

            try {
                const runnerUrl = `http://localhost:7113/job/${jobId}`;
                const response = await fetch(runnerUrl);

                if (!response.ok) {
                    // Stop polling on server error
                    clearInterval(intervalId);
                    const errorText = await response.text();
                    this.eventService.updateEvent(eventId, null, response.status, `Job status check failed: ${errorText}`, errorText);
                    return;
                }

                const job = await response.json();

                if (job.status === 'complete' || job.status === 'failed') {
                    clearInterval(intervalId);
                    console.log(`[Cloud] Job ${jobId} finished with status: ${job.status}`);

                    // The cloud runner now returns the LLM analysis directly
                    const llmResponse = job.llmResponse || {};
                    const finalResponseText = typeof llmResponse === 'string' ? llmResponse : JSON.stringify(llmResponse);

                    this.eventService.updateEvent(
                        eventId,
                        llmResponse, // The LLM response is the new "result"
                        job.status === 'complete' ? 200 : 500,
                        job.error,
                        job.error || finalResponseText,
                        job.screenshotData
                    );
                } else {
                    // Job is still pending or running
                    console.log(`[Cloud] Job ${jobId} status: ${job.status}`);
                    pollCount++;
                }
            } catch (error) {
                // Network error, keep polling for a while
                console.warn(`[Cloud] Error polling job ${jobId}:`, error.message);
                pollCount++;
            }
        }, pollInterval);
    }
} 