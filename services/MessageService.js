// Chrome runtime message handling service
export class MessageService {
    constructor(captureService, webhookService, eventService, llmService) {
        this.captureService = captureService;
        this.webhookService = webhookService;
        this.eventService = eventService;
        this.llmService = llmService;
        this.currentlyPolling = new Set(); // Track jobs being polled
        this.syncIntervalId = null;
        this.authPollIntervalId = null; // Use a dedicated interval ID for auth polling
        this.currentlyPollingAuthJobId = null;

        // Cloud runner security configuration
        this.cloudSecurity = {
            authToken: null, // Will be obtained via CAPTCHA
            tokenExpiry: null,
            quotas: null
        };

        this.setupMessageListener();
        this.resumePendingCloudJobs();
        this.resumePendingAuthJob(); // Resume auth polling on startup
        this.startCloudSync(); // Start the new sync process
    }

    // Set up the main message listener
    setupMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            // Use a specific handler for each action to correctly manage async behavior.
            const handler = this.getMessageHandler(request.action);
            if (handler) {
                // Return true only for handlers that are actually asynchronous.
                const asyncActions = [
                    'getRecentEvents', 'captureNow', 'captureLLM', 'testLLM',
                    'prepareCaptureData', 'startCloudJob', 'startCapture', 'stopCapture',
                    'getCaptchaChallenge', 'verifyCaptcha', 'getTokenStats', 'clearToken', 'testCloudRunner',
                    'storeAuthToken', 'startAuthPolling', 'getCloudJobs', 'startCloudInterval',
                    'getStorageInfo', 'performManualCleanup', 'makeAuthenticatedRequest', 'fetchScreenshot'
                ];
                const isAsync = asyncActions.includes(request.action);
                if (isAsync) {
                    handler(request, sender, sendResponse);
                    return true; // Keep the message channel open for async response
                } else {
                    // For synchronous actions, handle directly
                    handler(request, sender, sendResponse);
                    return false;
                }
            }
            // If no handler, do nothing.
        });
    }

    getMessageHandler(action) {
        const handlers = {
            'ping': (req, sender, res) => res({ pong: true }),
            'startAuthPolling': (req, sender, res) => {
                this.startAuthTokenPolling(req.jobId);
                res({ success: true });
            },
            'stopAuthPolling': (req, sender, res) => {
                this.stopAuthTokenPolling();
                res({ success: true });
            },

            'startCapture': async (req, sender, res) => {
                try {
                    await this.captureService.startCapture(req);
                    res({ success: true });
                } catch (error) {
                    res({ success: false, error: error.message });
                }
            },

            'stopCapture': async (req, sender, res) => {
                try {
                    // The `stopCapture` action from the UI can mean stopping a local capture
                    // OR stopping a cloud job. This logic needs to be robust.
                    if (req.tabId) {
                        // If a tabId is provided, it's a request to stop captures associated with that tab.
                        await this.captureService.stopCapture(req.tabId);
                    } else if (req.domain) {
                        // If a domain is provided (from settings), find the cloud job and stop it.
                        const jobKey = `cloud_job_${req.domain}`;
                        const data = await chrome.storage.local.get(jobKey);
                        const jobId = data[jobKey];
                        if (jobId) {
                            await this.stopCloudJob({ jobId, domain: req.domain });
                        } else {
                            console.warn(`Stop command received for domain ${req.domain}, but no cloud job found.`);
                        }
                    }
                    res({ success: true });
                } catch (error) {
                    res({ success: false, error: error.message });
                }
            },

            'updateInterval': (req) => this.captureService.updateInterval(req, this.llmService, this.eventService),
            'checkStatus': (req, sender, res) => res({ isActive: this.captureService.checkDomainCaptureStatus(req.domain) }),
            'tabNavigated': (req, sender) => this.captureService.handleTabNavigation(sender.tab.id, req.newDomain),
            'getRecentEvents': (req, sender, res) => {
                this.eventService.getRecentEvents()
                    .then(res)
                    .catch(err => res({ events: [], unreadCount: 0, error: err.message }));
            },
            'markEventsRead': (req, sender, res) => res(this.eventService.markEventsRead()),
            'clearHistory': (req, sender, res) => res(this.eventService.clearHistory()),
            'cancelRequest': (req, sender, res) => {
                let result = this.webhookService.cancelRequest(req.eventId);
                if (!result.success && this.llmService) {
                    result = this.llmService.cancelRequest(req.eventId);
                }
                res(result);
            },
            'captureNow': (req, sender, res) => {
                this.webhookService.captureAndSend(req.tabId, req.domain, req.webhookUrl, true, req.fields, req.refreshPage, req.captureDelay)
                    .then(res)
                    .catch(err => res({ success: false, error: err.message }));
            },
            'captureLLM': (req, sender, res) => {
                this.llmService.captureAndSend(req.tabId, req.domain, req.llmConfig, req.isManual, req.fields, req.refreshPage, req.captureDelay, req.previousEvaluation)
                    .then(res)
                    .catch(err => res({ success: false, error: err.message }));
            },
            'testLLM': async (req, sender, res) => {
                // This handler is now explicitly async to use await, providing the most stable
                // way to handle the fetch call inside testConfiguration.
                try {
                    const result = await this.llmService.testConfiguration(req.llmConfig);
                    res(result);
                } catch (err) {
                    res({ success: false, error: err.message });
                }
            },
            'prepareCaptureData': (req, sender, res) => {
                this.prepareCaptureData(req.domain)
                    .then(data => res({ success: data.isValid, data: data, error: data.error }))
                    .catch(err => res({ success: false, error: err.message }));
            },
            'captureResults': (req, sender, res) => {
                this.handleCaptureResults(req);
                res({ success: true });
            },
            'startCloudJob': (req, sender, res) => {
                this.handleStartCloudJob(req)
                    .then(res)
                    .catch(err => res({ success: false, error: err.message }));
            },
            'getCaptchaChallenge': (req, sender, res) => {
                this.getCaptchaChallenge()
                    .then(res)
                    .catch(err => res({ success: false, error: err.message }));
            },
            'verifyCaptcha': (req, sender, res) => {
                this.verifyCaptchaAndGetToken(req.captchaResponse)
                    .then(res)
                    .catch(err => res({ success: false, error: err.message }));
            },
            'getTokenStats': (req, sender, res) => {
                this.getTokenStats()
                    .then(res)
                    .catch(err => res({ success: false, error: err.message }));
            },
            'clearToken': (req, sender, res) => {
                this.clearStoredToken()
                    .then(() => res({ success: true }))
                    .catch(err => res({ success: false, error: err.message }));
            },
            'testCloudRunner': (req, sender, res) => {
                this.testCloudRunnerWithToken(req.url, req.payload)
                    .then(res)
                    .catch(err => res({ success: false, error: err.message }));
            },
            'storeAuthToken': async (req, sender, res) => {
                try {
                    await this.storeAuthToken(req.token, req.expiresAt);
                    res({ success: true });
                } catch (error) {
                    res({ success: false, error: error.message });
                }
            },
            'startCloudInterval': (req, sender, res) => {
                this.startOrUpdateCloudJob(req)
                    .then(res)
                    .catch(err => res({ success: false, error: err.message }));
            },
            'getCloudJobs': (req, sender, res) => {
                this.getCloudJobs()
                    .then(res)
                    .catch(err => res({ success: false, error: err.message }));
            },
            'getStorageInfo': (req, sender, res) => {
                this.eventService.getStorageInfo()
                    .then(res)
                    .catch(err => res({ success: false, error: err.message }));
            },
            'performManualCleanup': (req, sender, res) => {
                this.eventService.performManualCleanup()
                    .then(res)
                    .catch(err => res({ success: false, error: err.message }));
            },
            'makeAuthenticatedRequest': (req, sender, res) => {
                this.makeAuthenticatedRequest(req.url, req.options)
                    .then(response => res({ success: true, data: response }))
                    .catch(err => res({ success: false, error: err.message }));
            },
            'fetchScreenshot': (req, sender, res) => {
                console.log('fetchScreenshot handler called for eventId:', req.eventId);

                const event = this.eventService.getEventById(req.eventId);
                if (!event) {
                    console.error('Event not found in fetchScreenshot handler:', req.eventId);
                    res({ success: false, error: 'Event not found' });
                    return;
                }

                console.log('Event found for screenshot fetch:', {
                    id: event.id,
                    source: event.source,
                    hasScreenshot: !!event.screenshot,
                    hasScreenshotUrl: !!event.screenshotUrl,
                    screenshotUrl: event.screenshotUrl
                });

                this.eventService.fetchScreenshot(event)
                    .then(screenshotData => {
                        console.log('fetchScreenshot result:', {
                            hasData: !!screenshotData,
                            dataType: typeof screenshotData,
                            isValidDataUrl: screenshotData ? screenshotData.startsWith('data:image/') : false,
                            dataLength: screenshotData ? screenshotData.length : 0
                        });

                        if (screenshotData && screenshotData.startsWith('data:image/')) {
                            // Return the screenshot data directly for consistency
                            res(screenshotData);
                        } else {
                            const errorMsg = screenshotData ?
                                'Invalid screenshot data format' :
                                `No screenshot available for ${event.source} event (ID: ${event.id})`;
                            console.warn('fetchScreenshot failed:', errorMsg);
                            res({ success: false, error: errorMsg });
                        }
                    })
                    .catch(err => {
                        console.error('fetchScreenshot error:', err);
                        res({ success: false, error: err.message || 'Failed to fetch screenshot' });
                    });
            }
        };
        return handlers[action];
    }

    handleCaptureResults(request) {
        try {
            if (request.results && request.domain && !request.isManual) {
                this.storeAutomaticCaptureResults(request.domain, request.results, request.eventId);
            }
            this.sendToPopup(request);
        } catch (error) {
            console.error('Error handling captureResults in background:', error);
        }
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
            // Apply confidence filtering to create reliable context
            if (results && typeof results === 'object') {
                const prevEvalKey = `previousEvaluation_${domain}`;
                const filteredResults = await this.applyConfidenceFilteringToResults(domain, results);

                const evaluationData = {
                    results: filteredResults,
                    timestamp: new Date().toISOString(),
                    eventId: eventId
                };

                await chrome.storage.local.set({ [prevEvalKey]: evaluationData });
                console.log(`Stored filtered automatic capture results as previous evaluation for ${domain}:`, filteredResults);
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

    /**
     * Apply confidence filtering to results for reliable state snapshots
     * @param {string} domain - Domain to get field configurations
     * @param {Object} results - Raw LLM results
     * @returns {Object} Filtered results with confidence threshold applied
     */
    async applyConfidenceFilteringToResults(domain, results) {
        try {
            // Get field configurations to get confidence thresholds
            const domainKey = `fields_${domain}`;
            const storage = await chrome.storage.local.get([domainKey]);
            const domainFields = storage[domainKey] || [];

            const filteredResults = {};

            // Process each result
            Object.keys(results).forEach(fieldName => {
                if (fieldName === 'reason') return; // Skip metadata

                const fieldResult = results[fieldName];
                if (!Array.isArray(fieldResult) || fieldResult.length < 1) return;

                const result = fieldResult[0]; // boolean
                const probability = fieldResult.length > 1 ? fieldResult[1] : 0.8;

                // Find field configuration for confidence threshold
                const fieldConfig = domainFields.find(f => f.name === fieldName);
                const threshold = fieldConfig?.webhookMinConfidence || 75;

                // Apply confidence filtering
                let filteredResult = result;
                if (result === true) {
                    const confidencePercent = probability * 100;
                    filteredResult = confidencePercent >= threshold;
                }
                // FALSE results stay FALSE regardless of confidence

                filteredResults[fieldName] = [filteredResult, probability];
            });

            return filteredResults;

        } catch (error) {
            console.error('Error applying confidence filtering to results:', error);
            return results; // Return raw results if filtering fails
        }
    }

    // Shared capture preparation logic (DRY principle)
    async prepareCaptureData(domain) {
        try {
            // Get global LLM configuration
            const llmConfigData = await chrome.storage.local.get(['llmConfig_global']);
            const storedConfig = llmConfigData.llmConfig_global || {};

            const llmConfig = {
                apiUrl: storedConfig.apiUrl || 'https://openrouter.ai/api/v1/chat/completions',
                apiKey: storedConfig.apiKey || '',
                model: storedConfig.model || 'gpt-4-vision-preview',
                temperature: storedConfig.temperature !== undefined ? parseFloat(storedConfig.temperature) : 0.1,
                maxTokens: storedConfig.maxTokens !== undefined ? parseInt(storedConfig.maxTokens) : 5000 // Increased from 2000 to 5000
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
                    criteria: f.description,
                    // Include webhook configuration for cloud runner
                    webhookEnabled: f.webhookEnabled || false,
                    webhookUrl: f.webhookUrl || null,
                    webhookPayload: f.webhookPayload || null,
                    webhookTrigger: f.webhookTrigger !== undefined ? f.webhookTrigger : true, // Default to true
                    webhookMinConfidence: f.webhookMinConfidence !== undefined ? f.webhookMinConfidence : 75 // Default to 75%
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

            // 2. Gather all necessary data in parallel including capture settings
            const [
                sessionData,
                cookies,
                captureData,
                captureSettings
            ] = await Promise.all([
                this.getSessionData(tabId),
                chrome.cookies.getAll({ url: tab.url }),
                this.prepareCaptureData(domain), // Reuse existing data prep logic
                chrome.storage.local.get(['refreshPageToggle', 'captureDelay', 'fullPageCaptureToggle'])
            ]);

            if (!captureData.isValid) {
                throw new Error(captureData.error || 'Invalid configuration for capture.');
            }

            const jobPayload = {
                sessionData: { ...sessionData, cookies },
                llmConfig: captureData.llmConfig,
                fields: captureData.fields,
                previousEvaluation: captureData.previousEvaluation,
                domain: domain,
                captureSettings: {
                    refreshPageToggle: captureSettings.refreshPageToggle || false,
                    captureDelay: captureSettings.captureDelay || '0',
                    fullPageCaptureToggle: captureSettings.fullPageCaptureToggle || false
                }
            };

            console.log(`[Cloud] Manual job payload includes capture settings:`, jobPayload.captureSettings);

            // 3. Make initial POST request to cloud runner
            const { cloudRunnerUrl } = await chrome.storage.local.get(['cloudRunnerUrl']);
            const runnerEndpoint = (cloudRunnerUrl || 'https://runner.websophon.tududes.com').replace(/\/$/, ''); // Remove trailing slash
            const runnerUrl = `${runnerEndpoint}/job`;

            const initialResponse = await this.makeAuthenticatedRequest(runnerUrl, {
                method: 'POST',
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
        if (this.currentlyPolling.has(jobId)) {
            console.log(`[Cloud] Polling for job ${jobId} is already in progress.`);
            return;
        }
        this.currentlyPolling.add(jobId);

        // Stop the sync process for this specific job to prevent conflicts
        console.log(`[Cloud] Stopping sync process for job ${jobId} to prevent polling conflicts`);

        const pollInterval = 2000; // 2 seconds (faster polling for better UX)
        const maxPolls = 150; // 5 minutes timeout (adjusted for faster polling)
        let pollCount = 0;

        const intervalId = setInterval(async () => {
            if (pollCount >= maxPolls) {
                clearInterval(intervalId);
                this.currentlyPolling.delete(jobId);
                console.error(`[Cloud] Job ${jobId} timed out after ${maxPolls * pollInterval / 1000} seconds.`);

                // Preserve jobId in request
                const currentEvent = this.eventService.getEventById(eventId);
                const preservedRequestData = currentEvent && currentEvent.request
                    ? currentEvent.request
                    : { jobId: jobId };

                this.eventService.updateEvent(eventId, null, 504, 'Job polling timed out', 'Job polling timed out', null, preservedRequestData);
                return;
            }

            try {
                const { cloudRunnerUrl } = await chrome.storage.local.get(['cloudRunnerUrl']);
                const runnerEndpoint = (cloudRunnerUrl || 'https://runner.websophon.tududes.com').replace(/\/$/, ''); // Remove trailing slash
                const jobStatusUrl = `${runnerEndpoint}/job/${jobId}`;

                const response = await this.makeAuthenticatedRequest(jobStatusUrl, {
                    method: 'GET'
                });

                if (!response.ok) {
                    // Stop polling on server error
                    clearInterval(intervalId);
                    this.currentlyPolling.delete(jobId);
                    const errorText = await response.text();

                    console.error(`[Cloud] Job status check failed for ${jobId}: ${response.status} - ${errorText}`);

                    // Check if it's an authentication error
                    if (response.status === 401 || response.status === 403 || errorText.includes('Token not found')) {
                        console.error(`[Cloud] Authentication error during polling - clearing token`);
                        await this.clearStoredToken();
                    }

                    // Preserve jobId in request
                    const currentEvent = this.eventService.getEventById(eventId);
                    const preservedRequestData = currentEvent && currentEvent.request
                        ? currentEvent.request
                        : { jobId: jobId };

                    this.eventService.updateEvent(eventId, null, response.status, `Job status check failed: ${errorText}`, errorText, null, preservedRequestData);
                    return;
                }

                const job = await response.json();

                if (job.status === 'complete' || job.status === 'failed') {
                    clearInterval(intervalId);
                    this.currentlyPolling.delete(jobId);
                    console.log(`[Cloud] Job ${jobId} finished with status: ${job.status}. Polling stopped.`);

                    if (job.status === 'failed') {
                        // Handle failed job - preserve jobId in request
                        const currentEvent = this.eventService.getEventById(eventId);
                        const preservedRequestData = currentEvent && currentEvent.request
                            ? currentEvent.request
                            : { jobId: jobId };

                        this.eventService.updateEvent(
                            eventId,
                            null,
                            500,
                            job.error || 'Job failed',
                            job.error || 'Job failed',
                            null, // No screenshot for failed jobs
                            preservedRequestData // Preserve jobId
                        );
                    } else {
                        // Job completed successfully - fetch the results
                        try {
                            const resultsUrl = `${runnerEndpoint}/job/${jobId}/results`;
                            const resultsResponse = await this.makeAuthenticatedRequest(resultsUrl, {
                                method: 'GET'
                            });

                            if (!resultsResponse.ok) {
                                const errorText = await resultsResponse.text();
                                console.error(`[Cloud] Failed to fetch results for job ${jobId}: ${resultsResponse.status} - ${errorText}`);

                                // Check if it's an authentication error
                                if (resultsResponse.status === 401 || resultsResponse.status === 403 || errorText.includes('Token not found')) {
                                    console.error(`[Cloud] Authentication error fetching results - clearing token`);
                                    await this.clearStoredToken();
                                }

                                throw new Error(`Failed to fetch results: ${resultsResponse.status} - ${errorText}`);
                            }

                            const { results } = await resultsResponse.json();
                            console.log(`[Cloud] Fetched ${results.length} results for completed job ${jobId}`);
                            console.log(`[Cloud] DEBUG 1: About to check results length`);

                            if (results && results.length > 0) {
                                console.log(`[Cloud] DEBUG 2: Results exist, processing latest result`);
                                // Use the most recent result (should be the only one for a one-off job)
                                const latestResult = results[results.length - 1];
                                console.log(`[Cloud] DEBUG 3: Got latest result`);

                                // Validate result structure before processing
                                if (!latestResult) {
                                    throw new Error('Latest result is null or undefined');
                                }

                                // Log detailed structure for debugging
                                console.log(`[Cloud] Result structure validation:`, {
                                    hasResultId: !!latestResult.resultId,
                                    hasTimestamp: !!latestResult.timestamp,
                                    hasScreenshotData: !!latestResult.screenshotData,
                                    hasLlmResponse: !!latestResult.llmResponse,
                                    hasLlmRawResponse: !!latestResult.llmRawResponse,
                                    llmResponseType: typeof latestResult.llmResponse,
                                    llmResponseKeys: latestResult.llmResponse ? Object.keys(latestResult.llmResponse) : []
                                });

                                const llmResponse = latestResult.llmResponse || {};
                                console.log(`[Cloud] DEBUG 4: Got LLM response`);

                                console.log(`[Cloud] Processing completed job result:`, {
                                    hasScreenshot: !!latestResult.screenshotData,
                                    screenshotSize: latestResult.screenshotData ? latestResult.screenshotData.length : 0,
                                    hasLlmResponse: !!llmResponse,
                                    hasEvaluation: !!(llmResponse.evaluation)
                                });
                                console.log(`[Cloud] DEBUG 5: Logged processing info`);

                                // Get the current event to preserve existing data
                                const currentEvent = this.eventService.getEventById(eventId);
                                console.log(`[Cloud] DEBUG 6: Got current event`);

                                // Use raw response if available, otherwise stringify the parsed response
                                const responseText = latestResult.llmRawResponse || JSON.stringify(llmResponse);
                                console.log(`[Cloud] DEBUG 8: Got response text`);

                                // Safely determine domain for the event
                                let domain;
                                if (job && job.domain) {
                                    domain = job.domain;
                                } else if (currentEvent && currentEvent.domain) {
                                    domain = currentEvent.domain;
                                }

                                // If we still don't have a domain, we cannot proceed with event creation.
                                if (!domain) {
                                    console.error(`[Cloud] Critical error: Could not determine domain for job ${jobId}.`, { job, currentEvent });
                                    throw new Error('Could not determine domain for cloud job result.');
                                }

                                console.log(`[Cloud] Successfully determined domain: ${domain}`);

                                // Update the existing pending event instead of creating a new one
                                console.log(`[Cloud] DEBUG 11: About to update existing event ${eventId}`);

                                // Prepare the merged request data for the update
                                const updatedRequestData = currentEvent && currentEvent.request
                                    ? { ...currentEvent.request, llmRequestPayload: latestResult.llmRequestPayload }
                                    : { jobId: jobId, llmRequestPayload: latestResult.llmRequestPayload };

                                // Update the existing event with results
                                this.eventService.updateEvent(
                                    eventId,
                                    llmResponse.evaluation || llmResponse, // The LLM response evaluation
                                    200,
                                    null, // No error
                                    responseText,
                                    latestResult.screenshotData, // Pass screenshot data
                                    updatedRequestData
                                );
                                console.log(`[Cloud] DEBUG 12: updateEvent completed - updated existing event instead of creating new one`);

                                // If the result includes field webhooks fired by cloud runner, add them to the event
                                if (latestResult.fieldWebhooks && latestResult.fieldWebhooks.length > 0) {
                                    console.log(`[Sync] Adding ${latestResult.fieldWebhooks.length} field webhooks to event ${eventId}`);
                                    this.eventService.addFieldWebhooksToEvent(eventId, latestResult.fieldWebhooks);
                                }

                                // Send captureResults message to popup (like local captures do)
                                if (llmResponse.evaluation && Object.keys(llmResponse.evaluation).length > 0) {
                                    console.log(`[Cloud] Sending captureResults message to popup for job ${jobId}`);
                                    chrome.runtime.sendMessage({
                                        action: 'captureResults',
                                        results: llmResponse.evaluation,
                                        eventId: eventId,
                                        domain: domain,
                                        isManual: true // Cloud jobs are manual captures
                                    }).catch(e => {
                                        console.log('[Cloud] Could not send captureResults to popup (popup might not be open)');
                                    });
                                }

                                // Purge the result from server since we've processed it
                                try {
                                    const purgeUrl = `${runnerEndpoint}/job/${jobId}/purge`;
                                    await this.makeAuthenticatedRequest(purgeUrl, { method: 'POST' });
                                    console.log(`[Cloud] Purged result for completed job ${jobId}`);
                                } catch (purgeError) {
                                    console.warn(`[Cloud] Failed to purge result for job ${jobId}:`, purgeError);
                                }
                            } else {
                                // No results available - update existing event instead of creating new one
                                console.log(`[Cloud] Job completed but no results available - updating existing event ${eventId}`);
                                const currentEvent = this.eventService.getEventById(eventId);
                                const preservedRequestData = currentEvent && currentEvent.request
                                    ? currentEvent.request
                                    : { jobId: jobId };

                                this.eventService.updateEvent(
                                    eventId,
                                    null,
                                    200,
                                    'Job completed but no results available',
                                    'Job completed but no results available',
                                    null, // No screenshot
                                    preservedRequestData // Preserve jobId
                                );
                            }
                        } catch (fetchError) {
                            console.error(`[Cloud] Error processing results for job ${jobId}:`, fetchError);

                            // Preserve jobId in request
                            const currentEvent = this.eventService.getEventById(eventId);
                            const preservedRequestData = currentEvent && currentEvent.request
                                ? currentEvent.request
                                : { jobId: jobId };

                            this.eventService.updateEvent(
                                eventId,
                                null,
                                500,
                                'Failed to fetch job results',
                                fetchError.message,
                                null, // No screenshot
                                preservedRequestData // Preserve jobId
                            );
                        }
                    }
                } else {
                    // Job is still pending or running
                    console.log(`[Cloud] Job ${jobId} status: ${job.status}`);
                    pollCount++;
                }
            } catch (error) {
                // Handle different types of errors
                if (error.message.includes('No valid authentication token available')) {
                    console.error(`[Cloud] Authentication token lost during polling for job ${jobId}`);
                    clearInterval(intervalId);
                    this.currentlyPolling.delete(jobId);

                    // Preserve jobId in request
                    const currentEvent = this.eventService.getEventById(eventId);
                    const preservedRequestData = currentEvent && currentEvent.request
                        ? currentEvent.request
                        : { jobId: jobId };

                    this.eventService.updateEvent(eventId, null, 401, 'Authentication token expired during polling', error.message, null, preservedRequestData);
                    return;
                } else {
                    // Network error, keep polling for a while
                    console.warn(`[Cloud] Error polling job ${jobId}:`, error.message);
                    pollCount++;
                }
            }
        }, pollInterval);
    }

    async resumePendingCloudJobs() {
        await this.eventService.ensureLoaded();
        const { events } = await this.eventService.getRecentEvents();
        const pendingCloudJobs = events.filter(e => e.source === 'cloud' && e.status === 'pending' && e.request?.jobId);

        if (pendingCloudJobs.length > 0) {
            console.log(`[Cloud] Resuming polling for ${pendingCloudJobs.length} pending cloud jobs.`);
            for (const job of pendingCloudJobs) {
                this.pollCloudJob(job.id, job.request.jobId);
            }
        }
    }

    // --- Enhanced Cloud Syncing ---
    startCloudSync() {
        console.log('[Sync] Starting enhanced cloud sync service...');
        // Sync immediately on startup
        this.syncCloudJobs();
        // Then sync every 30 seconds (more frequent than before)
        this.syncIntervalId = setInterval(() => this.syncCloudJobs(), 30000);
        console.log('[Sync] Cloud sync service started with 30-second intervals');
    }

    stopCloudSync() {
        if (this.syncIntervalId) {
            clearInterval(this.syncIntervalId);
            this.syncIntervalId = null;
            console.log('[Sync] Cloud sync service stopped');
        }
    }

    async syncCloudJobs() {
        console.log('[Sync] Starting cloud sync...');
        const allData = await chrome.storage.local.get();
        const jobKeys = Object.keys(allData).filter(key => key.startsWith('cloud_job_'));

        if (jobKeys.length === 0) {
            console.log('[Sync] No active cloud jobs to sync.');
            return;
        }

        const { cloudRunnerUrl } = await chrome.storage.local.get(['cloudRunnerUrl']);
        const runnerEndpoint = (cloudRunnerUrl || 'https://runner.websophon.tududes.com').replace(/\/$/, '');

        console.log(`[Sync] Found ${jobKeys.length} active cloud jobs to sync`);

        for (const key of jobKeys) {
            const jobId = allData[key];
            const domain = key.replace('cloud_job_', '');

            // Skip jobs that are currently being polled by pollCloudJob to prevent conflicts
            if (this.currentlyPolling.has(jobId)) {
                console.log(`[Sync] Skipping job ${jobId} for domain ${domain} - currently being polled`);
                continue;
            }

            console.log(`[Sync] Syncing job ${jobId} for domain ${domain}...`);

            try {
                // 1. Fetch results with timeout
                const resultsUrl = `${runnerEndpoint}/job/${jobId}/results`;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

                const response = await this.makeAuthenticatedRequest(resultsUrl, {
                    method: 'GET',
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (!response.ok) {
                    if (response.status === 404) {
                        console.log(`[Sync] Job ${jobId} not found on server. Removing local reference.`);
                        await chrome.storage.local.remove(key);
                        continue;
                    } else if (response.status >= 400 && response.status < 500) {
                        // For 4xx errors, assume it's a permanent issue with this job (e.g., auth)
                        console.warn(`[Sync] Client error ${response.status} for job ${jobId}. Removing local reference.`);
                        await chrome.storage.local.remove(key);
                        continue;
                    }
                    else {
                        const errorText = await response.text();
                        throw new Error(`Failed to fetch results: ${response.status} - ${errorText}`);
                    }
                }

                const { results } = await response.json();
                if (!results || results.length === 0) {
                    console.log(`[Sync] No new results for job ${jobId}.`);
                    continue;
                }

                console.log(`[Sync] Received ${results.length} new results for job ${jobId}.`);

                // 2. Add results to EventService history with proper cloud grouping and timestamps
                let syncedCount = 0;
                for (const result of results) {
                    const eventId = result.resultId || `cloud_${jobId}_${Date.now()}_${syncedCount}`;

                    try {
                        if (result.error) {
                            // Handle error results
                            this.eventService.trackEvent(
                                null,
                                domain,
                                '', // We don't have the exact URL from the server run
                                false,
                                500,
                                result.error,
                                null, // No screenshot for error results
                                {
                                    jobId: jobId,
                                    captureSettings: result.captureSettings,
                                    timestamp: result.timestamp,
                                    source: 'cloud_sync'
                                },
                                result.error,
                                eventId,
                                'completed',
                                'cloud',
                                result.timestamp // Use server timestamp
                            );
                        } else {
                            // Handle successful results
                            const llmResponse = result.llmResponse || {};

                            // Debug the data we're about to process
                            console.log(`[Sync] Processing result ${eventId}:`, {
                                hasScreenshot: !!result.screenshotData,
                                screenshotSize: result.screenshotData ? result.screenshotData.length : 0,
                                hasLlmResponse: !!llmResponse,
                                llmResponseKeys: Object.keys(llmResponse),
                                hasEvaluation: !!(llmResponse.evaluation),
                                evaluationKeys: llmResponse.evaluation ? Object.keys(llmResponse.evaluation) : []
                            });

                            // Use raw response if available, otherwise stringify the parsed response
                            const responseText = result.llmRawResponse || JSON.stringify(llmResponse);

                            // Track the event with all data including field webhooks
                            const eventData = this.eventService.trackEvent(
                                llmResponse.evaluation || llmResponse, // The LLM response evaluation
                                domain,
                                `https://${domain}`, // Provide a reasonable URL for cloud runs
                                true,
                                200,
                                null,
                                result.screenshotData, // Pass screenshot data
                                {
                                    jobId: jobId,
                                    captureSettings: result.captureSettings,
                                    timestamp: result.timestamp,
                                    llmRequestPayload: result.llmRequestPayload,
                                    source: 'cloud_sync'
                                },
                                responseText,
                                eventId,
                                'completed',
                                'cloud',
                                result.timestamp // Use server timestamp
                            );

                            // If the result includes field webhooks fired by cloud runner, add them to the event
                            if (result.fieldWebhooks && result.fieldWebhooks.length > 0) {
                                console.log(`[Sync] Adding ${result.fieldWebhooks.length} field webhooks to event ${eventId}`);
                                this.eventService.addFieldWebhooksToEvent(eventId, result.fieldWebhooks);
                            }
                        }
                        syncedCount++;
                    } catch (eventError) {
                        console.error(`[Sync] Error processing result ${eventId}:`, eventError);
                    }
                }

                if (syncedCount > 0) {
                    // 3. Purge results from server after successful sync
                    try {
                        const purgeUrl = `${runnerEndpoint}/job/${jobId}/purge`;
                        const purgeController = new AbortController();
                        const purgeTimeoutId = setTimeout(() => purgeController.abort(), 5000);

                        const purgeResponse = await this.makeAuthenticatedRequest(purgeUrl, {
                            method: 'POST',
                            signal: purgeController.signal
                        });
                        clearTimeout(purgeTimeoutId);

                        if (!purgeResponse.ok) {
                            console.error(`[Sync] Failed to purge results for job ${jobId} on server.`);
                        } else {
                            console.log(`[Sync] Successfully purged ${syncedCount} results from server for job ${jobId}.`);
                        }
                    } catch (purgeError) {
                        console.error(`[Sync] Error purging results for job ${jobId}:`, purgeError);
                    }

                    // 4. Notify popup about new events if it's open
                    try {
                        chrome.runtime.sendMessage({
                            action: 'cloudResultsSynced',
                            domain: domain,
                            jobId: jobId,
                            resultCount: syncedCount
                        });
                    } catch (messageError) {
                        // Popup might not be open, ignore this error
                        console.log('[Sync] Could not notify popup about sync (popup might not be open)');
                    }
                }

            } catch (error) {
                if (error.name === 'AbortError') {
                    console.warn(`[Sync] Timeout syncing job ${jobId} for domain ${domain}`);
                } else {
                    console.error(`[Sync] Error syncing job ${jobId} for domain ${domain}:`, error);
                }
            }
        }
        console.log('[Sync] Cloud sync finished.');
    }

    // Helper method to extract fields from LLM response for history display
    extractFieldsFromLLMResponse(llmResponse) {
        const fields = [];

        if (llmResponse.evaluation) {
            // Handle evaluation format
            Object.keys(llmResponse.evaluation).forEach(fieldName => {
                const fieldData = llmResponse.evaluation[fieldName];
                if (typeof fieldData === 'boolean') {
                    fields.push({
                        name: fieldName,
                        result: fieldData,
                        probability: null
                    });
                } else if (Array.isArray(fieldData) && fieldData.length >= 2) {
                    fields.push({
                        name: fieldName,
                        result: fieldData[0],
                        probability: fieldData[1]
                    });
                } else if (typeof fieldData === 'object' && fieldData.boolean !== undefined) {
                    fields.push({
                        name: fieldName,
                        result: fieldData.boolean,
                        probability: fieldData.probability || null
                    });
                } else if (typeof fieldData === 'object' && fieldData.result !== undefined) {
                    // NEW: Handle {result: boolean, confidence: number} format from Gemini and other LLMs
                    fields.push({
                        name: fieldName,
                        result: fieldData.result,
                        probability: fieldData.confidence || fieldData.probability || null
                    });
                }
            });
        }

        return fields;
    }

    async startOrUpdateCloudJob(request) {
        const { tabId, domain, interval } = request;
        try {
            console.log(`[Cloud] Sending request to start/update recurring job for ${domain}`);
            const tab = await chrome.tabs.get(tabId);

            // 1. Gather all necessary data including capture settings
            const [sessionData, cookies, captureData, captureSettings] = await Promise.all([
                this.getSessionData(tabId),
                chrome.cookies.getAll({ url: tab.url }),
                this.prepareCaptureData(domain),
                chrome.storage.local.get(['refreshPageToggle', 'captureDelay', 'fullPageCaptureToggle'])
            ]);

            if (!captureData.isValid) {
                throw new Error(captureData.error || 'Invalid configuration for capture.');
            }

            // 2. Prepare payload for the server with capture settings
            const jobPayload = {
                sessionData: { ...sessionData, cookies },
                llmConfig: captureData.llmConfig,
                fields: captureData.fields,
                previousEvaluation: captureData.previousEvaluation,
                interval: interval,
                domain: domain,
                url: tab.url, // For reference
                captureSettings: {
                    refreshPageToggle: captureSettings.refreshPageToggle || false,
                    captureDelay: captureSettings.captureDelay || '0',
                    fullPageCaptureToggle: captureSettings.fullPageCaptureToggle || false
                }
            };

            console.log(`[Cloud] Job payload includes capture settings:`, jobPayload.captureSettings);

            // 3. Make POST request to cloud runner's /job endpoint
            const { cloudRunnerUrl } = await chrome.storage.local.get(['cloudRunnerUrl']);
            const runnerEndpoint = (cloudRunnerUrl || 'https://runner.websophon.tududes.com').replace(/\/$/, '');
            const runnerUrl = `${runnerEndpoint}/job`;

            const response = await this.makeAuthenticatedRequest(runnerUrl, {
                method: 'POST',
                body: JSON.stringify(jobPayload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Cloud runner rejected job: ${response.status} - ${errorText}`);
            }

            const { jobId } = await response.json();
            if (!jobId) {
                throw new Error('Cloud runner did not return a valid job ID.');
            }

            // 4. Store the job ID locally to associate with the domain
            await chrome.storage.local.set({ [`cloud_job_${domain}`]: jobId });
            console.log(`[Cloud] Stored job ID ${jobId} for domain ${domain}`);

            return { success: true, jobId };

        } catch (error) {
            console.error('[Cloud] Error starting recurring cloud job:', error);
            return { success: false, error: error.message };
        }
    }

    async stopCloudJob(request) {
        const { jobId, domain } = request;
        try {
            console.log(`[Cloud] Sending request to stop recurring job ${jobId} for domain ${domain}`);

            const { cloudRunnerUrl } = await chrome.storage.local.get(['cloudRunnerUrl']);
            const runnerEndpoint = (cloudRunnerUrl || 'https://runner.websophon.tududes.com').replace(/\/$/, '');
            const runnerUrl = `${runnerEndpoint}/job/${jobId}`;

            const response = await this.makeAuthenticatedRequest(runnerUrl, { method: 'DELETE' });

            if (!response.ok) {
                const errorText = await response.text();
                // If the job is already gone (404), that's a success for our purposes.
                if (response.status !== 404) {
                    throw new Error(`Cloud runner failed to stop job: ${response.status} - ${errorText}`);
                }
            }

            // 4. Remove the locally stored job ID
            await chrome.storage.local.remove([`cloud_job_${domain}`]);
            console.log(`[Cloud] Removed job ID for domain ${domain}`);

            return { success: true };
        } catch (error) {
            console.error('[Cloud] Error stopping recurring cloud job:', error);
            return { success: false, error: error.message };
        }
    }

    // CAPTCHA and token management
    async verifyCaptchaAndGetToken(captchaResponse) {
        try {
            const { cloudRunnerUrl } = await chrome.storage.local.get(['cloudRunnerUrl']);
            const runnerEndpoint = (cloudRunnerUrl || 'https://runner.websophon.tududes.com').replace(/\/$/, '');

            const response = await fetch(`${runnerEndpoint}/captcha/verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ captchaResponse })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || `CAPTCHA verification failed: ${response.status}`);
            }

            const result = await response.json();

            // Store token and metadata
            this.cloudSecurity.authToken = result.token;
            this.cloudSecurity.tokenExpiry = result.expiresAt;
            this.cloudSecurity.quotas = result.quotas;

            // Save to storage for persistence
            await chrome.storage.local.set({
                websophon_auth_token: result.token,
                websophon_token_expires: result.expiresAt,
                cloudAuthToken: result.token,
                cloudTokenExpiry: result.expiresAt,
                cloudQuotas: result.quotas
            });

            console.log('[CAPTCHA] Token obtained successfully, expires:', new Date(result.expiresAt).toLocaleString());
            return result;

        } catch (error) {
            console.error('[CAPTCHA] Error verifying CAPTCHA:', error);
            throw error;
        }
    }

    async ensureValidToken() {
        // Always check storage for the latest token (don't rely on memory cache)
        const storedData = await chrome.storage.local.get([
            'cloudAuthToken', 'cloudTokenExpiry', 'cloudQuotas',
            'websophon_auth_token', 'websophon_token_expires'
        ]);

        // Try new format first, then fall back to old format
        let authToken = storedData.websophon_auth_token || storedData.cloudAuthToken;
        let tokenExpiry = storedData.websophon_token_expires || storedData.cloudTokenExpiry;
        let quotas = storedData.cloudQuotas;

        console.log('[TOKEN] Token check:', {
            hasToken: !!authToken,
            tokenPrefix: authToken ? authToken.substring(0, 12) + '...' : 'none',
            expiresAt: tokenExpiry ? new Date(tokenExpiry).toISOString() : 'none',
            isExpired: tokenExpiry ? Date.now() >= tokenExpiry : 'unknown'
        });

        if (authToken && tokenExpiry) {
            // Check if token is expired
            if (Date.now() >= tokenExpiry) {
                console.log('[TOKEN] Token expired, clearing stored token');
                await this.clearStoredToken();
                return false;
            }

            // Update memory cache with fresh token from storage
            this.cloudSecurity.authToken = authToken;
            this.cloudSecurity.tokenExpiry = tokenExpiry;
            this.cloudSecurity.quotas = quotas;

            console.log('[TOKEN] Valid token found and loaded');
            return true;
        }

        console.log('[TOKEN] No valid token available');
        return false;
    }

    async storeAuthToken(token, expiresAt) {
        try {
            this.cloudSecurity.authToken = token;
            this.cloudSecurity.tokenExpiry = expiresAt;

            // Store with both key formats for compatibility
            await chrome.storage.local.set({
                'websophon_auth_token': token,
                'websophon_token_expires': expiresAt,
                'cloudAuthToken': token,
                'cloudTokenExpiry': expiresAt
            });
            console.log('[TOKEN] Stored authentication token, expires at:', new Date(expiresAt).toLocaleString());
        } catch (error) {
            console.error('[TOKEN] Error storing token:', error);
            throw error;
        }
    }

    async clearStoredToken() {
        this.cloudSecurity.authToken = null;
        this.cloudSecurity.tokenExpiry = null;
        this.cloudSecurity.quotas = null;

        await chrome.storage.local.remove([
            'websophon_auth_token', 'websophon_token_expires',
            'cloudAuthToken', 'cloudTokenExpiry', 'cloudQuotas'
        ]);
        console.log('[TOKEN] Cleared stored authentication token');
    }

    async getTokenStats() {
        if (!(await this.ensureValidToken())) {
            throw new Error('No valid authentication token available');
        }

        try {
            const { cloudRunnerUrl } = await chrome.storage.local.get(['cloudRunnerUrl']);
            const runnerEndpoint = (cloudRunnerUrl || 'https://runner.websophon.tududes.com').replace(/\/$/, '');

            const response = await this.makeAuthenticatedRequest(`${runnerEndpoint}/auth/token/stats`, {
                method: 'GET'
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || `Failed to get token stats: ${response.status}`);
            }

            const stats = await response.json();

            // Update local quota cache
            this.cloudSecurity.quotas = stats.quotas;
            await chrome.storage.local.set({ cloudQuotas: stats.quotas });

            return stats;

        } catch (error) {
            console.error('[TOKEN] Error getting stats:', error);
            throw error;
        }
    }

    async makeAuthenticatedRequest(url, options = {}) {
        console.log(`[AUTH] Making authenticated request to: ${url}`);

        if (!(await this.ensureValidToken())) {
            console.error('[AUTH] No valid token available for request');
            throw new Error('No valid authentication token available');
        }

        const authOptions = {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.cloudSecurity.authToken}`,
                ...options.headers
            }
        };

        console.log(`[AUTH] Request headers:`, {
            'Content-Type': authOptions.headers['Content-Type'],
            'Authorization': `Bearer ${this.cloudSecurity.authToken.substring(0, 12)}...`,
            hasBody: !!options.body
        });

        try {
            const response = await fetch(url, authOptions);
            console.log(`[AUTH] Response status: ${response.status}`);

            // Don't read the response body here - let the caller handle it
            return response;
        } catch (error) {
            console.error(`[AUTH] Network error:`, error);
            throw error;
        }
    }

    async testCloudRunnerWithToken(testUrl, payload) {
        if (!(await this.ensureValidToken())) {
            throw new Error('No valid authentication token available');
        }

        try {
            const response = await this.makeAuthenticatedRequest(testUrl, {
                method: 'POST',
                body: payload
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Server responded with status ${response.status}: ${errorText}`);
            }

            const result = await response.json();

            if (result.success) {
                return {
                    success: true,
                    message: result.message,
                    clientId: result.clientId,
                    quotas: result.quotas
                };
            } else {
                throw new Error(result.error || 'Cloud runner test failed');
            }

        } catch (error) {
            console.error('[CLOUD] Test failed:', error);
            throw error;
        }
    }

    // === AUTH TOKEN POLLING (Robust Implementation) ===

    async resumePendingAuthJob() {
        try {
            const { auth_job_id, auth_job_timestamp } = await chrome.storage.local.get(['auth_job_id', 'auth_job_timestamp']);

            if (auth_job_id) {
                const age = Date.now() - (auth_job_timestamp || 0);
                // Only resume if the job is less than 30 minutes old
                if (age < 30 * 60 * 1000) {
                    console.log(`[AUTH] Resuming auth polling for job ${auth_job_id} (age: ${Math.round(age / 1000)}s)`);
                    this.startAuthTokenPolling(auth_job_id);
                } else {
                    console.log(`[AUTH] Auth job ${auth_job_id} is too old, clearing`);
                    await chrome.storage.local.remove(['auth_job_id', 'auth_job_timestamp']);
                }
            }
        } catch (error) {
            console.error('[AUTH] Error resuming auth job:', error);
        }
    }

    stopAuthTokenPolling() {
        if (this.authPollIntervalId) {
            clearInterval(this.authPollIntervalId);
            this.authPollIntervalId = null;
            console.log(`[AUTH] Polling stopped for job ${this.currentlyPollingAuthJobId}.`);
            this.currentlyPollingAuthJobId = null;
        }
    }

    startAuthTokenPolling(jobId) {
        // Prevent duplicate polling
        if (this.currentlyPollingAuthJobId === jobId) {
            console.log(`[AUTH] Already polling for job ${jobId}`);
            return;
        }

        this.stopAuthTokenPolling(); // Stop any previous polling

        if (!jobId) {
            console.error('[AUTH] startAuthTokenPolling called with no jobId.');
            return;
        }

        this.currentlyPollingAuthJobId = jobId;
        console.log(`[AUTH] Starting background polling for auth job: ${jobId}`);

        const pollInterval = 3000; // 3 seconds (faster auth polling)
        const maxPolls = 600; // 30 minutes timeout (adjusted for faster polling)
        let pollCount = 0;

        this.authPollIntervalId = setInterval(async () => {
            if (this.currentlyPollingAuthJobId !== jobId) {
                clearInterval(this.authPollIntervalId);
                return;
            }

            pollCount++;
            if (pollCount > maxPolls) {
                console.log(`[AUTH] Polling timed out for job ${jobId}.`);
                // Clean up stored job ID
                await chrome.storage.local.remove(['auth_job_id', 'auth_job_timestamp']);
                this.sendToPopup({ action: 'authPollingTimeout' });
                this.stopAuthTokenPolling();
                return;
            }

            try {
                const { cloudRunnerUrl } = await chrome.storage.local.get(['cloudRunnerUrl']);
                const runnerEndpoint = (cloudRunnerUrl || 'https://runner.websophon.tududes.com').replace(/\/$/, '');
                const jobUrl = `${runnerEndpoint}/auth/job/${jobId}`;

                console.log(`[AUTH] Polling attempt ${pollCount} for job ${jobId}`);
                const response = await fetch(jobUrl);

                if (response.ok) {
                    const result = await response.json();
                    if (result.success && result.token) {
                        console.log(`[AUTH] Token found for job ${jobId}!`);
                        this.stopAuthTokenPolling();

                        // Store the token
                        await this.storeAuthToken(result.token, result.expiresAt);

                        // Clean up the auth job ID
                        await chrome.storage.local.remove(['auth_job_id', 'auth_job_timestamp']);

                        // Get token stats and notify popup if open
                        try {
                            const tokenStats = await this.getTokenStats();
                            this.sendToPopup({ action: 'authTokenDetected', tokenStats });
                        } catch (statsError) {
                            console.warn('[AUTH] Error getting token stats after auth:', statsError);
                            this.sendToPopup({ action: 'authTokenDetected' });
                        }

                        // Close the auth success tab if it's still open
                        const tabs = await chrome.tabs.query({ url: `${runnerEndpoint}/auth-success*` });
                        if (tabs.length > 0) {
                            chrome.tabs.remove(tabs.map(t => t.id));
                        }
                    } else {
                        console.log(`[AUTH] Job ${jobId} status: pending`);
                    }
                } else if (response.status === 404) {
                    console.log(`[AUTH] Job ${jobId} not found, may have expired`);
                    // Clean up and stop polling
                    await chrome.storage.local.remove(['auth_job_id', 'auth_job_timestamp']);
                    this.sendToPopup({ action: 'authPollingTimeout' });
                    this.stopAuthTokenPolling();
                } else {
                    console.error(`[AUTH] Server error ${response.status} polling job ${jobId}`);
                }
            } catch (error) {
                console.warn(`[AUTH] Network error during poll ${pollCount} for job ${jobId}:`, error.message);
                // Continue polling on network errors
            }
        }, pollInterval);
    }

    // CAPTCHA challenge method
    async getCaptchaChallenge() {
        try {
            const { cloudRunnerUrl } = await chrome.storage.local.get(['cloudRunnerUrl']);
            const runnerEndpoint = (cloudRunnerUrl || 'https://runner.websophon.tududes.com').replace(/\/$/, '');
            const challengeUrl = `${runnerEndpoint}/captcha/challenge`;

            console.log('[CAPTCHA] Requesting challenge from:', challengeUrl);

            const response = await fetch(challengeUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });

            console.log('[CAPTCHA] Response status:', response.status);
            console.log('[CAPTCHA] Response headers:', [...response.headers.entries()]);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[CAPTCHA] Server error:', response.status, errorText);
                throw new Error(`Server error (${response.status}): ${errorText}`);
            }

            // Get response as text for debug (only if response is OK)
            const responseText = await response.text();
            console.log('[CAPTCHA] Raw response text:', responseText);

            // Simple approach: just open the auth page with a generated job ID
            // The cloud runner will handle the association when the CAPTCHA is completed
            const jobId = `auth_${Date.now()}_${Math.random().toString(36).substring(7)}`;
            const captchaUrl = `${runnerEndpoint}/auth?jobId=${jobId}`;

            console.log('[CAPTCHA] Using job ID:', jobId);
            console.log('[CAPTCHA] Auth URL:', captchaUrl);

            // Store the auth job ID for background polling
            await chrome.storage.local.set({
                'auth_job_id': jobId,
                'auth_job_timestamp': Date.now()
            });

            // Start polling immediately
            this.startAuthTokenPolling(jobId);

            return {
                success: true,
                jobId: jobId,
                captchaUrl: captchaUrl
            };
        } catch (error) {
            console.error('[CAPTCHA] Error in getCaptchaChallenge:', error);
            return {
                success: false,
                error: error.message || 'Failed to get CAPTCHA challenge'
            };
        }
    }

    async getCloudJobs() {
        try {
            // Ensure we have a valid token
            await this.ensureValidToken();

            const { cloudRunnerUrl = 'https://runner.websophon.tududes.com' } = await chrome.storage.local.get(['cloudRunnerUrl']);
            const runnerEndpoint = cloudRunnerUrl.replace(/\/$/, '');
            const jobsUrl = `${runnerEndpoint}/jobs`; // New endpoint to get all jobs for token

            const response = await this.makeAuthenticatedRequest(jobsUrl, {
                method: 'GET'
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to get cloud jobs: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            console.log(`[Cloud] Retrieved ${data.jobs?.length || 0} cloud jobs`);

            return {
                success: true,
                jobs: data.jobs || []
            };

        } catch (error) {
            console.error('[Cloud] Error getting cloud jobs:', error);
            return {
                success: false,
                error: error.message,
                jobs: []
            };
        }
    }
}