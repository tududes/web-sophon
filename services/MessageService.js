// Chrome runtime message handling service
export class MessageService {
    constructor(captureService, webhookService, eventService, llmService) {
        this.captureService = captureService;
        this.webhookService = webhookService;
        this.eventService = eventService;
        this.llmService = llmService;
        this.currentlyPolling = new Set(); // Track jobs being polled
        this.setupMessageListener();
        this.resumePendingCloudJobs();
        this.startCloudSync(); // Start the new sync process
    }

    // Set up the main message listener
    setupMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            // Use a specific handler for each action to correctly manage async behavior.
            const handler = this.getMessageHandler(request.action);
            if (handler) {
                handler(request, sender, sendResponse);
                // Return true only for handlers that are actually asynchronous.
                const asyncActions = [
                    'getRecentEvents', 'captureNow', 'captureLLM',
                    'testLLM', 'prepareCaptureData', 'startCloudJob'
                ];
                return asyncActions.includes(request.action);
            }
            // If no handler, do nothing.
        });
    }

    getMessageHandler(action) {
        const handlers = {
            'ping': (req, sender, res) => res({ pong: true }),
            'startCapture': (req) => this.captureService.startCapture(req, this.llmService, this.eventService),
            'stopCapture': (req) => this.captureService.stopCapture(req.tabId),
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
            const { cloudRunnerUrl } = await chrome.storage.local.get(['cloudRunnerUrl']);
            const runnerEndpoint = (cloudRunnerUrl || 'https://runner.websophon.tududes.com').replace(/\/$/, ''); // Remove trailing slash
            const runnerUrl = `${runnerEndpoint}/job`;

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
        if (this.currentlyPolling.has(jobId)) {
            console.log(`[Cloud] Polling for job ${jobId} is already in progress.`);
            return;
        }
        this.currentlyPolling.add(jobId);

        const pollInterval = 5000; // 5 seconds
        const maxPolls = 60; // 5 minutes timeout
        let pollCount = 0;

        const intervalId = setInterval(async () => {
            if (pollCount >= maxPolls) {
                clearInterval(intervalId);
                this.currentlyPolling.delete(jobId);
                console.error(`[Cloud] Job ${jobId} timed out after ${maxPolls * pollInterval / 1000} seconds.`);
                this.eventService.updateEvent(eventId, null, 504, 'Job polling timed out', 'Job polling timed out');
                return;
            }

            try {
                const { cloudRunnerUrl } = await chrome.storage.local.get(['cloudRunnerUrl']);
                const runnerEndpoint = (cloudRunnerUrl || 'https://runner.websophon.tududes.com').replace(/\/$/, ''); // Remove trailing slash
                const jobStatusUrl = `${runnerEndpoint}/job/${jobId}`;

                const response = await fetch(jobStatusUrl);

                if (!response.ok) {
                    // Stop polling on server error
                    clearInterval(intervalId);
                    this.currentlyPolling.delete(jobId);
                    const errorText = await response.text();
                    this.eventService.updateEvent(eventId, null, response.status, `Job status check failed: ${errorText}`, errorText);
                    return;
                }

                const job = await response.json();

                if (job.status === 'complete' || job.status === 'failed') {
                    clearInterval(intervalId);
                    this.currentlyPolling.delete(jobId);
                    console.log(`[Cloud] Job ${jobId} finished with status: ${job.status}`);

                    // The cloud runner now returns the LLM analysis directly
                    const llmResponse = job.llmResponse || {};
                    const finalResponseText = typeof llmResponse === 'string' ? llmResponse : JSON.stringify(llmResponse);

                    this.eventService.updateEvent(
                        eventId,
                        llmResponse.evaluation || llmResponse, // The LLM response is the new "result"
                        job.status === 'complete' ? 200 : 500,
                        job.error,
                        job.error || finalResponseText,
                        job.screenshotData,
                        job.llmRequestPayload // Pass the request payload for history
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

    // --- NEW: Cloud Syncing ---
    startCloudSync() {
        // Sync immediately on startup, then every 1 minute.
        this.syncCloudJobs();
        setInterval(() => this.syncCloudJobs(), 60000);
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

        for (const key of jobKeys) {
            const jobId = allData[key];
            const domain = key.replace('cloud_job_', '');
            console.log(`[Sync] Found active job ${jobId} for domain ${domain}. Fetching results...`);

            try {
                // 1. Fetch results
                const resultsUrl = `${runnerEndpoint}/job/${jobId}/results`;
                const response = await fetch(resultsUrl);
                if (!response.ok) {
                    if (response.status === 404) {
                        console.log(`[Sync] Job ${jobId} not found on server. Removing local reference.`);
                        await chrome.storage.local.remove(key);
                    } else {
                        const errorText = await response.text();
                        throw new Error(`Failed to fetch results: ${response.status} - ${errorText}`);
                    }
                    continue; // Move to the next job
                }

                const { results } = await response.json();
                if (!results || results.length === 0) {
                    console.log(`[Sync] No new results for job ${jobId}.`);
                    continue;
                }

                console.log(`[Sync] Received ${results.length} new results for job ${jobId}.`);

                // 2. Add results to EventService history
                for (const result of results) {
                    if (result.error) {
                        this.eventService.trackEvent(null, domain, '', false, 500, result.error, null, null, result.error, result.resultId, 'completed', 'cloud');
                    } else {
                        this.eventService.trackEvent(
                            result.llmResponse.evaluation || result.llmResponse,
                            domain,
                            '', // We don't have the exact URL from the server run, can be added later
                            true,
                            200,
                            null,
                            result.screenshotData,
                            result.llmRequestPayload,
                            JSON.stringify(result.llmResponse),
                            result.resultId,
                            'completed',
                            'cloud'
                        );
                    }
                }

                // 3. Purge results from server
                const purgeUrl = `${runnerEndpoint}/job/${jobId}/purge`;
                const purgeResponse = await fetch(purgeUrl, { method: 'POST' });
                if (!purgeResponse.ok) {
                    console.error(`[Sync] Failed to purge results for job ${jobId} on server.`);
                } else {
                    console.log(`[Sync] Successfully purged ${results.length} results from server for job ${jobId}.`);
                }

            } catch (error) {
                console.error(`[Sync] Error syncing job ${jobId} for domain ${domain}:`, error);
            }
        }
        console.log('[Sync] Cloud sync finished.');
    }

    async startOrUpdateCloudJob(request) {
        const { tabId, domain, interval } = request;
        try {
            console.log(`[Cloud] Sending request to start/update recurring job for ${domain}`);
            const tab = await chrome.tabs.get(tabId);

            // 1. Gather all necessary data
            const [sessionData, cookies, captureData] = await Promise.all([
                this.getSessionData(tabId),
                chrome.cookies.getAll({ url: tab.url }),
                this.prepareCaptureData(domain)
            ]);

            if (!captureData.isValid) {
                throw new Error(captureData.error || 'Invalid configuration for capture.');
            }

            // 2. Prepare payload for the server
            const jobPayload = {
                sessionData: { ...sessionData, cookies },
                llmConfig: captureData.llmConfig,
                fields: captureData.fields,
                previousEvaluation: captureData.previousEvaluation,
                interval: interval,
                domain: domain,
                url: tab.url // For reference
            };

            // 3. Make POST request to cloud runner's /job endpoint
            const { cloudRunnerUrl } = await chrome.storage.local.get(['cloudRunnerUrl']);
            const runnerEndpoint = (cloudRunnerUrl || 'https://runner.websophon.tududes.com').replace(/\/$/, '');
            const runnerUrl = `${runnerEndpoint}/job`;

            const response = await fetch(runnerUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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

            const response = await fetch(runnerUrl, { method: 'DELETE' });

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
} 