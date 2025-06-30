// Clean LLM-only Popup Controller
// Uses FieldManagerLLM for proper state management

class CleanPopupController {
    constructor() {
        this.currentDomain = '';
        this.currentTab = 'fields';
        this.elements = {};

        // Initialize field manager
        this.fieldManager = new FieldManagerLLM();

        // UI manager will be initialized in initialize()
        this.uiManager = null;

        this.historyManager = null;
        this.saveDebounceTimer = null;
    }

    async initialize() {
        try {
            // 0. Ping the background script to ensure it's ready and establish connection
            await this.pingBackgroundScriptWithRetry();

            // 1. Get current domain first (needed for field loading)
            this.currentDomain = await this.getCurrentDomain();
            console.log('Current domain:', this.currentDomain);

            // 2. Get DOM elements
            this.getDOMElements();

            // 3. Initialize managers
            const { UIManager } = await import('./components/UIManager.js');
            const { JobManager } = await import('./services/JobManager.js');

            this.uiManager = new UIManager(this.fieldManager);
            this.uiManager.setElements(this.elements);

            this.jobManager = new JobManager();
            await this.jobManager.loadJobs();

            // 4. Load field state from storage
            this.fieldManager.currentDomain = this.currentDomain;
            await this.fieldManager.loadFromStorage();

            // 5. Setup event listeners
            this.setupEventListeners();

            // 6. Initialize UI components
            this.initializeTabSystem();
            this.setupMessageListener();

            // 7. Load basic settings and display domain
            await this.loadBasicSettings();
            await this.loadCaptureSettings(); // Load capture settings for default tab
            this.displayCurrentDomain();

            // 8. Load and display active jobs
            this.renderActiveJobs();

            // 9. Start cloud runner synchronization
            this.startCloudRunnerSync();

            // Populate models dynamically
            await this.populateLlmModels(this.elements.llmModel?.value);

            console.log('Popup controller initialized successfully');

        } catch (error) {
            console.error('Failed to initialize popup controller:', error);
            throw error;
        }
    }

    // Cleanup method for when popup is closed
    cleanup() {
        console.log('Cleaning up popup controller');
        this.stopCloudRunnerSync();
    }

    async pingBackgroundScriptWithRetry(retries = 3, delay = 100) {
        for (let i = 0; i < retries; i++) {
            try {
                const response = await this.sendMessageToBackground({ action: 'ping' });
                if (response && response.pong) {
                    console.log('Background script ping successful.');
                    // Connection established, safe to proceed.
                    document.body.classList.remove('service-disconnected');
                    return;
                }
            } catch (error) {
                console.warn(`Ping attempt ${i + 1} of ${retries} failed. Retrying in ${delay}ms...`);
                await new Promise(res => setTimeout(res, delay));
            }
        }

        // If all retries fail, show a persistent error message.
        console.error('Failed to connect to background script after multiple retries.');
        document.body.classList.add('service-disconnected');
        const errorContainer = document.getElementById('connectionError');
        if (errorContainer) {
            errorContainer.innerHTML = 'Error: Could not connect to background service. Please try reloading the extension.';
            errorContainer.style.display = 'block';
        }
        throw new Error('Could not establish connection with the background script.');
    }

    async getCurrentDomain() {
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs[0]?.url) {
                const url = new URL(tabs[0].url);
                return url.hostname;
            }
        } catch (error) {
            console.error('Error getting current domain:', error);
        }
        return 'unknown';
    }

    displayCurrentDomain() {
        const domainElement = document.getElementById('currentDomain');
        if (domainElement) {
            domainElement.textContent = this.currentDomain;
        }
    }

    getDOMElements() {
        this.elements = {
            // Main structure
            tabNavigation: document.querySelector('.tab-navigation'),
            tabContent: document.querySelector('.tab-content'),

            // Fields section
            fieldsContainer: document.getElementById('fieldsContainer'),
            addFieldBtn: document.getElementById('addFieldBtn'),
            presetSelector: document.getElementById('presetSelector'),
            savePresetBtn: document.getElementById('savePresetBtn'),
            deletePresetBtn: document.getElementById('deletePresetBtn'),

            // Capture section
            captureBtn: document.getElementById('captureBtn'),
            captureStatus: document.getElementById('captureStatus'),
            currentDomain: document.getElementById('currentDomain'),

            // Settings section
            consentToggle: document.getElementById('consentToggle'),
            captureInterval: document.getElementById('captureInterval'),

            // LLM Configuration
            llmApiUrl: document.getElementById('llmApiUrl'),
            llmApiKey: document.getElementById('llmApiKey'),
            llmModel: document.getElementById('llmModel'),
            includePremiumModelsToggle: document.getElementById('includePremiumModelsToggle'),
            llmTemperature: document.getElementById('llmTemperature'),
            llmMaxTokens: document.getElementById('llmMaxTokens'),
            testLlmConfig: document.getElementById('testLlmConfig'),
            testConfigStatus: document.getElementById('testConfigStatus'),

            // Cloud Runner
            cloudRunnerUrl: document.getElementById('cloudRunnerUrl'),
            testCloudRunnerBtn: document.getElementById('testCloudRunnerBtn'),
            testCloudRunnerStatus: document.getElementById('testCloudRunnerStatus'),

            // Token and CAPTCHA elements
            tokenStatus: document.getElementById('tokenStatus'),
            tokenStatusText: document.getElementById('tokenStatusText'),
            quotaDisplay: document.getElementById('quotaDisplay'),
            quotaRecurring: document.getElementById('quotaRecurring'),
            quotaManual: document.getElementById('quotaManual'),
            captchaContainer: document.getElementById('captchaContainer'),
            authenticateBtn: document.getElementById('authenticateBtn'),
            captchaStatus: document.getElementById('captchaStatus'),
            testCloudRunnerSection: document.getElementById('testCloudRunnerSection'),
            refreshTokenBtn: document.getElementById('refreshTokenBtn'),
            clearTokenBtn: document.getElementById('clearTokenBtn'),

            // History section
            historyContainer: document.getElementById('historyContainer'),
            showTrueOnly: document.getElementById('showTrueOnly'),
            clearHistoryBtn: document.getElementById('clearHistoryBtn'),

            // Known Domains
            domainsContainer: document.getElementById('domainsContainer'),

            // Theme toggle
            themeToggle: document.getElementById('themeToggle'),

            // New elements
            refreshPageToggle: document.getElementById('refreshPageToggle'),
            captureDelay: document.getElementById('captureDelay'),
            fullPageCaptureToggle: document.getElementById('fullPageCaptureToggle'),
            usePreviousEvaluationToggle: document.getElementById('usePreviousEvaluationToggle'),
            clearPreviousEvaluationBtn: document.getElementById('clearPreviousEvaluationBtn'),
            cloudRunnerToggle: document.getElementById('cloudRunnerToggle'),
            activeJobsList: document.getElementById('activeJobsList')
        };
    }

    setupEventListeners() {
        // Tab switching - use delegation for efficiency
        this.elements.tabNavigation?.addEventListener('click', (e) => {
            const button = e.target.closest('.tab-button');
            if (button && button.dataset.tab) {
                this.switchTab(button.dataset.tab);
            }
        });

        // Field management
        this.elements.addFieldBtn?.addEventListener('click', () => {
            this.addField();
        });

        // Capture button
        this.elements.captureBtn?.addEventListener('click', () => {
            this.handleCapture();
        });

        // Preset management
        this.elements.presetSelector?.addEventListener('change', () => {
            this.updatePresetButtons();
            // Load preset when selected
            if (this.elements.presetSelector.value) {
                this.loadPreset();
            }
        });

        this.elements.savePresetBtn?.addEventListener('click', () => {
            this.savePreset();
        });

        this.elements.deletePresetBtn?.addEventListener('click', () => {
            this.deletePreset();
        });

        // Settings
        this.elements.consentToggle?.addEventListener('change', (e) => {
            this.saveConsent(e.target.checked);
        });

        // LLM Configuration
        this.elements.llmApiUrl?.addEventListener('input', () => {
            this.debouncedSaveLlmConfig();
        });

        this.elements.llmApiKey?.addEventListener('input', () => {
            this.debouncedSaveLlmConfig();
        });

        this.elements.llmModel?.addEventListener('change', () => {
            this.debouncedSaveLlmConfig();
        });

        this.elements.cloudRunnerUrl?.addEventListener('input', () => {
            this.debouncedSaveCloudRunnerUrl();
        });

        this.elements.includePremiumModelsToggle?.addEventListener('change', async (e) => {
            const isChecked = e.target.checked;
            await chrome.storage.local.set({ includePremiumModels: isChecked });
            // Repopulate models with the new setting
            await this.populateLlmModels(this.elements.llmModel?.value);
            // After repopulating, the selection might have changed, so save again.
            await this.saveLlmConfig();
        });

        this.elements.testCloudRunnerBtn?.addEventListener('click', () => {
            this.testCloudRunner();
        });

        this.elements.testLlmConfig?.addEventListener('click', () => {
            this.testLlmConfiguration();
        });

        // Theme toggle
        this.elements.themeToggle?.addEventListener('click', () => {
            this.toggleTheme();
        });

        // History controls
        this.elements.clearHistoryBtn?.addEventListener('click', () => {
            if (this.historyManager?.clearHistory) {
                this.historyManager.clearHistory();
            }
        });

        this.elements.showTrueOnly?.addEventListener('change', (e) => {
            if (this.historyManager?.setShowTrueOnly) {
                this.historyManager.setShowTrueOnly(e.target.checked);
                this.historyManager.renderHistory();
            }
        });

        // Previous evaluation toggle
        this.elements.usePreviousEvaluationToggle?.addEventListener('change', (e) => {
            this.setUsePreviousEvaluationSetting(e.target.checked);
        });

        // Capture settings
        this.elements.refreshPageToggle?.addEventListener('change', (e) => {
            chrome.storage.local.set({ refreshPageToggle: e.target.checked });
            this.updateCaptureDelayVisibility(e.target.checked);
        });

        this.elements.captureDelay?.addEventListener('change', (e) => {
            chrome.storage.local.set({ captureDelay: e.target.value });
        });

        this.elements.fullPageCaptureToggle?.addEventListener('change', (e) => {
            chrome.storage.local.set({ fullPageCaptureToggle: e.target.checked });
        });

        // Capture interval
        this.elements.captureInterval?.addEventListener('change', (e) => {
            this.handleCaptureIntervalChange(e.target.value);
        });

        // Clear previous evaluation button
        this.elements.clearPreviousEvaluationBtn?.addEventListener('click', () => {
            this.clearPreviousEvaluation();
        });

        // Cloud runner toggle
        this.elements.cloudRunnerToggle?.addEventListener('change', (e) => {
            chrome.storage.local.set({ cloudRunnerEnabled: e.target.checked });
        });

        // CAPTCHA and token management
        this.elements.authenticateBtn?.addEventListener('click', () => {
            this.openAuthenticationTab();
        });

        this.elements.refreshTokenBtn?.addEventListener('click', () => {
            this.refreshTokenStats();
        });

        this.elements.clearTokenBtn?.addEventListener('click', () => {
            this.clearAuthToken();
        });
    }

    initializeTabSystem() {
        this.switchTab('capture');
    }

    switchTab(tabName) {
        console.log('Switching to tab:', tabName);

        // Track current tab
        this.currentTab = tabName;

        // Hide all tab panels
        this.elements.tabContent?.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.remove('active');
        });

        // Remove active class from all tab buttons
        this.elements.tabNavigation?.querySelectorAll('.tab-button').forEach(button => {
            button.classList.remove('active');
        });

        // Show selected tab panel
        const tabPanel = this.elements.tabContent?.querySelector(`#${tabName}Content`);
        if (tabPanel) {
            tabPanel.classList.add('active');
            console.log('Showed tab panel:', `${tabName}Content`);
        } else {
            console.error('Tab panel not found:', `${tabName}Content`);
        }

        // Add active class to selected tab button
        const selectedTab = this.elements.tabNavigation?.querySelector(`[data-tab="${tabName}"]`);
        if (selectedTab) {
            selectedTab.classList.add('active');
        }

        // Load tab-specific data
        this.handleTabSpecificLoading(tabName);
    }

    async handleTabSpecificLoading(tabName) {
        console.log('Loading tab-specific content for:', tabName);

        switch (tabName) {
            case 'capture':
                // Load capture-specific settings when switching to capture tab
                await this.loadCaptureSettings();
                this.renderActiveJobs();
                break;
            case 'fields':
                this.renderFields();
                this.renderPresets(); // Load presets for the preset dropdown
                break;
            case 'history':
                if (!this.historyManager) {
                    await this.initializeHistoryManager();
                }
                if (this.historyManager && this.historyManager.loadHistory) {
                    // Add a small delay to ensure background service is ready
                    // This helps avoid the race condition when popup opens immediately after browser starts
                    if (!this.historyManager.recentEvents || this.historyManager.recentEvents.length === 0) {
                        console.log('History empty, adding small delay before loading...');
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                    await this.historyManager.loadHistory();

                    // If still empty after first load, try once more after a longer delay
                    if (this.historyManager.recentEvents.length === 0) {
                        console.log('History still empty, retrying after delay...');
                        await new Promise(resolve => setTimeout(resolve, 300));
                        await this.historyManager.loadHistory();
                    }
                }
                break;
            case 'settings':
                this.renderPresets();
                // Always reload known domains to show current statistics
                console.log('Loading known domains for settings tab...');
                await this.loadKnownDomains();
                // Load token status and quotas
                await this.loadTokenStatus();
                break;
        }
    }

    async testCloudRunner() {
        const url = this.elements.cloudRunnerUrl?.value;
        const statusEl = this.elements.testCloudRunnerStatus;

        if (!url) {
            this.showToast('✗ Please enter a Cloud Runner URL.', 'error', statusEl);
            return;
        }

        this.showToast('Testing connection...', 'info', statusEl);

        try {
            // Check if we have a valid token first
            const tokenResponse = await this.sendMessageToBackground({ action: 'getTokenStats' });

            if (!tokenResponse || !tokenResponse.quotas || !tokenResponse.expiresAt) {
                this.showToast('✗ No valid authentication token. Complete CAPTCHA first.', 'error', statusEl);
                return;
            }

            const runnerEndpoint = url.replace(/\/$/, '');
            const testUrl = `${runnerEndpoint}/test`;

            // Use token-based authentication
            const payload = JSON.stringify({ testData: 'ping' });

            // Use MessageService to make authenticated request
            const testResponse = await this.sendMessageToBackground({
                action: 'testCloudRunner',
                url: testUrl,
                payload: payload
            });

            if (testResponse.success) {
                const quotaInfo = testResponse.quotas ?
                    ` (${testResponse.quotas.recurringDomains}/${testResponse.quotas.maxRecurringDomains} domains, ${testResponse.quotas.manualCaptures}/${testResponse.quotas.maxManualCaptures} manual)` : '';
                this.showToast(`✓ ${testResponse.message}${quotaInfo}`, 'success', statusEl);

                // Update quota display with latest data
                if (testResponse.quotas) {
                    this.updateQuotaDisplay(testResponse.quotas);
                }
            } else {
                throw new Error(testResponse.error || 'Test failed');
            }

        } catch (error) {
            console.error('Cloud Runner test failed:', error);
            let errorMessage = error.message;
            if (errorMessage.includes('Failed to fetch')) {
                errorMessage = 'Connection failed. Check URL and authentication token.';
            } else if (errorMessage.includes('No valid authentication token')) {
                errorMessage = 'Authentication required. Complete CAPTCHA first.';
            }
            this.showToast(`✗ ${errorMessage}`, 'error', statusEl);
        }
    }

    // === CAPTCHA AND TOKEN MANAGEMENT ===

    async loadTokenStatus() {
        try {
            if (!this.elements.tokenStatusText) return;

            console.log('[TOKEN] Loading token status...');

            // Check if we have a valid token and get its stats
            const response = await this.sendMessageToBackground({ action: 'getTokenStats' });

            if (response && response.quotas && response.expiresAt) {
                console.log('[TOKEN] Token stats loaded:', response);

                this.updateTokenStatusDisplay(true, response);
                this.updateQuotaDisplay(response.quotas);
                this.hideCaptcha();
            } else {
                const errorMsg = response && response.error ? response.error : 'No valid token available';
                console.log('[TOKEN] No valid token available:', errorMsg);
                this.updateTokenStatusDisplay(false);
                this.showCaptcha();
            }

        } catch (error) {
            console.error('[TOKEN] Error loading token status:', error);
            this.updateTokenStatusDisplay(false);
            this.showCaptcha();
        }
    }

    updateTokenStatusDisplay(hasValidToken, stats = null) {
        if (!this.elements.tokenStatusText) return;

        if (hasValidToken && stats) {
            const expiryDate = new Date(stats.expiresAt);
            const timeRemaining = stats.timeRemaining;

            // Use a more compact date format
            const compactDate = expiryDate.toLocaleDateString('en-US', {
                month: 'numeric',
                day: 'numeric',
                year: '2-digit'
            });
            const compactTime = expiryDate.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });

            this.elements.tokenStatusText.textContent = `✅ Valid token (expires ${compactDate} ${compactTime})`;
            this.elements.tokenStatusText.className = 'valid';

            // Show refresh and clear buttons
            if (this.elements.refreshTokenBtn) this.elements.refreshTokenBtn.style.display = 'inline-block';
            if (this.elements.clearTokenBtn) this.elements.clearTokenBtn.style.display = 'inline-block';

            // Show test cloud runner section when authenticated
            if (this.elements.testCloudRunnerSection) this.elements.testCloudRunnerSection.style.display = 'block';

            // Show token expiry warning if less than 1 hour remaining
            if (timeRemaining < 60 * 60 * 1000) {
                this.showTokenExpiryWarning(timeRemaining);
            }
        } else {
            this.elements.tokenStatusText.textContent = '❌ No valid authentication token';
            this.elements.tokenStatusText.className = 'invalid';

            // Hide refresh and clear buttons
            if (this.elements.refreshTokenBtn) this.elements.refreshTokenBtn.style.display = 'none';
            if (this.elements.clearTokenBtn) this.elements.clearTokenBtn.style.display = 'none';

            // Hide test cloud runner section when not authenticated
            if (this.elements.testCloudRunnerSection) this.elements.testCloudRunnerSection.style.display = 'none';
        }
    }

    updateQuotaDisplay(quotas) {
        if (!quotas || !this.elements.quotaDisplay) return;

        // Show quota display
        this.elements.quotaDisplay.style.display = 'block';

        // Update recurring domains quota
        if (this.elements.quotaRecurring) {
            const recurringText = `${quotas.recurringDomains}/${quotas.maxRecurringDomains}`;
            this.elements.quotaRecurring.textContent = recurringText;

            // Add styling based on usage
            this.elements.quotaRecurring.className = 'quota-value';
            if (quotas.recurringDomains >= quotas.maxRecurringDomains) {
                this.elements.quotaRecurring.classList.add('at-limit');
            } else if (quotas.recurringDomains > quotas.maxRecurringDomains * 0.8) {
                this.elements.quotaRecurring.classList.add('over-limit');
            }
        }

        // Update manual captures quota
        if (this.elements.quotaManual) {
            const manualText = `${quotas.manualCaptures}/${quotas.maxManualCaptures}`;
            this.elements.quotaManual.textContent = manualText;

            // Add styling based on usage
            this.elements.quotaManual.className = 'quota-value';
            if (quotas.manualCaptures >= quotas.maxManualCaptures) {
                this.elements.quotaManual.classList.add('at-limit');
            } else if (quotas.manualCaptures > quotas.maxManualCaptures * 0.8) {
                this.elements.quotaManual.classList.add('over-limit');
            }
        }
    }

    async showCaptcha() {
        if (!this.elements.captchaContainer) return;

        try {
            // Show the authentication container
            this.elements.captchaContainer.style.display = 'block';
            this.showCaptchaMessage('Click the authentication button to complete CAPTCHA verification');

        } catch (error) {
            console.error('[AUTH] Error showing authentication:', error);
            this.showCaptchaError('Error loading authentication: ' + error.message);
        }
    }

    async openAuthenticationTab() {
        try {
            this.showCaptchaMessage('Testing connection to cloud runner...', 'info');

            // First, test if we can reach the cloud runner at all
            const cloudRunnerUrl = this.elements.cloudRunnerUrl?.value || 'https://runner.websophon.tududes.com';
            const testUrl = `${cloudRunnerUrl.replace(/\/$/, '')}/health`;

            try {
                // Try a simple health check first
                const healthResponse = await fetch(testUrl, {
                    method: 'GET',
                    mode: 'cors',
                    credentials: 'omit'
                });
                console.log('[AUTH] Health check response:', healthResponse.status);
            } catch (testError) {
                console.error('[AUTH] Cannot reach cloud runner:', testError);

                // Provide helpful error messages
                if (testError.message.includes('Failed to fetch')) {
                    // Show manual authentication option
                    this.showCaptchaError(`Cannot connect to cloud runner at ${cloudRunnerUrl}. Please check:`);

                    // Add manual token input UI
                    const captchaContainer = this.elements.captchaContainer;
                    if (captchaContainer) {
                        const manualAuthHtml = `
                            <div class="manual-auth-section" style="margin-top: 15px; padding: 10px; border: 1px solid #444; border-radius: 5px;">
                                <p style="margin-bottom: 10px; font-size: 12px;">
                                    <strong>Troubleshooting:</strong><br>
                                    1. Check your internet connection<br>
                                    2. Verify the cloud runner URL is correct<br>
                                    3. Try the default URL: https://runner.websophon.tududes.com<br>
                                    4. If using a custom server, ensure CORS is properly configured
                                </p>
                                <p style="margin-top: 10px; font-size: 12px;">
                                    <strong>Manual Authentication:</strong><br>
                                    If automatic authentication fails, you can manually visit:<br>
                                    <code style="background: #333; padding: 2px 5px; border-radius: 3px;">${cloudRunnerUrl}/auth</code><br>
                                    Complete the CAPTCHA there and paste the token below:
                                </p>
                                <input type="text" id="manualTokenInput" placeholder="Paste authentication token here" style="width: 100%; margin-top: 10px; padding: 5px;">
                                <button id="submitManualToken" style="margin-top: 5px;">Submit Token</button>
                            </div>
                        `;

                        // Check if manual auth section already exists
                        let manualSection = captchaContainer.querySelector('.manual-auth-section');
                        if (!manualSection) {
                            captchaContainer.insertAdjacentHTML('beforeend', manualAuthHtml);

                            // Add event listener for manual token submission
                            const submitBtn = captchaContainer.querySelector('#submitManualToken');
                            const tokenInput = captchaContainer.querySelector('#manualTokenInput');

                            submitBtn?.addEventListener('click', async () => {
                                const token = tokenInput?.value.trim();
                                if (token) {
                                    try {
                                        // Parse the token to get expiry
                                        const tokenParts = token.split('.');
                                        if (tokenParts.length === 3) {
                                            const payload = JSON.parse(atob(tokenParts[1]));
                                            const expiresAt = payload.exp * 1000; // Convert to milliseconds

                                            await this.sendMessageToBackground({
                                                action: 'storeAuthToken',
                                                token: token,
                                                expiresAt: expiresAt
                                            });

                                            this.showCaptchaMessage('✅ Token stored successfully!', 'success');
                                            await this.loadTokenStatus();
                                        } else {
                                            throw new Error('Invalid token format');
                                        }
                                    } catch (error) {
                                        this.showCaptchaError('Invalid token: ' + error.message);
                                    }
                                } else {
                                    this.showCaptchaError('Please enter a token');
                                }
                            });
                        }
                    }

                    return; // Don't continue with automatic flow
                }
            }

            this.showCaptchaMessage('Getting authentication challenge...', 'info');

            // Get CAPTCHA challenge from server (this will also start background polling)
            const challengeResponse = await this.sendMessageToBackground({ action: 'getCaptchaChallenge' });

            if (challengeResponse.success) {
                const { captchaUrl, jobId } = challengeResponse;
                console.log('[CAPTCHA] Opening authentication tab with job ID:', jobId);

                // Open new tab with CAPTCHA page
                const tab = await chrome.tabs.create({
                    url: captchaUrl,
                    active: true
                });

                // Polling is now started automatically in the background when getCaptchaChallenge is called
                this.showCaptchaMessage('Complete the CAPTCHA in the opened tab. Automatic detection in progress...', 'info');
            } else {
                // If getCaptchaChallenge fails, show detailed error
                console.error('[AUTH] getCaptchaChallenge failed:', challengeResponse.error);

                if (challengeResponse.error.includes('Network error')) {
                    this.showCaptchaError('Network error: Cannot reach cloud runner. Check your connection and try again.');
                } else if (challengeResponse.error.includes('Server error')) {
                    this.showCaptchaError(challengeResponse.error);
                } else {
                    this.showCaptchaError('Failed to get authentication challenge: ' + challengeResponse.error);
                }
            }

        } catch (error) {
            console.error('[AUTH] Error opening authentication tab:', error);
            this.showCaptchaError(error.message);
        }
    }

    // Note: Authentication is now handled via job-based polling for better reliability and security

    hideCaptcha() {
        if (this.elements.captchaContainer) {
            this.elements.captchaContainer.style.display = 'none';
        }
        if (this.elements.quotaDisplay) {
            this.elements.quotaDisplay.style.display = 'block';
        }
    }



    showCaptchaMessage(message, type = 'info') {
        if (this.elements.captchaStatus) {
            this.elements.captchaStatus.textContent = message;
            this.elements.captchaStatus.className = `status-message ${type}`;
        }
    }



    showCaptchaError(message) {
        this.showCaptchaMessage(message, 'error');
    }

    showTokenExpiryWarning(timeRemaining) {
        const hours = Math.floor(timeRemaining / (60 * 60 * 1000));
        const minutes = Math.floor((timeRemaining % (60 * 60 * 1000)) / (60 * 1000));

        let warningText;
        if (hours > 0) {
            warningText = `⚠️ Token expires in ${hours}h ${minutes}m`;
        } else {
            warningText = `⚠️ Token expires in ${minutes}m`;
        }

        // Add warning element if it doesn't exist
        let warningElement = document.getElementById('tokenExpiryWarning');
        if (!warningElement) {
            warningElement = document.createElement('div');
            warningElement.id = 'tokenExpiryWarning';
            warningElement.className = 'token-expiry-warning';
            this.elements.tokenStatus.appendChild(warningElement);
        }

        warningElement.textContent = warningText;
    }

    async refreshTokenStats() {
        try {
            this.showToast('Refreshing token stats...', 'info', this.elements.testCloudRunnerStatus);

            const response = await this.sendMessageToBackground({ action: 'getTokenStats' });

            if (response && response.quotas && response.expiresAt) {
                this.updateTokenStatusDisplay(true, response);
                this.updateQuotaDisplay(response.quotas);
                this.showToast('✅ Token stats refreshed', 'success', this.elements.testCloudRunnerStatus);
            } else {
                const errorMsg = response && response.error ? response.error : 'Failed to get token stats';
                this.showToast('❌ Failed to refresh: ' + errorMsg, 'error', this.elements.testCloudRunnerStatus);
            }

        } catch (error) {
            console.error('[TOKEN] Error refreshing stats:', error);
            this.showToast('❌ Error refreshing stats', 'error', this.elements.testCloudRunnerStatus);
        }
    }

    async clearAuthToken() {
        if (!confirm('Clear the authentication token? You will need to complete a CAPTCHA again to use cloud runner features.')) {
            return;
        }

        try {
            await this.sendMessageToBackground({ action: 'clearToken' });

            // Update UI
            this.updateTokenStatusDisplay(false);
            if (this.elements.quotaDisplay) {
                this.elements.quotaDisplay.style.display = 'none';
            }
            this.showCaptcha();

            this.showToast('✅ Authentication token cleared', 'success', this.elements.testCloudRunnerStatus);

        } catch (error) {
            console.error('[TOKEN] Error clearing token:', error);
            this.showToast('❌ Error clearing token', 'error', this.elements.testCloudRunnerStatus);
        }
    }

    async testLlmConfiguration() {
        console.log('Testing LLM configuration...');
        this.showToast('Testing...', 'info', this.elements.testConfigStatus);

        try {
            const llmConfig = await this.getLlmConfig();

            if (!llmConfig.apiUrl || !llmConfig.apiKey) {
                throw new Error('Missing API URL or API Key');
            }

            // Test with a simple request
            const testMessage = {
                action: 'testLLM',
                llmConfig: llmConfig
            };

            const response = await this.sendMessageToBackground(testMessage);

            if (response && response.success) {
                this.showToast('✓ Configuration valid', 'success', this.elements.testConfigStatus);
                console.log('LLM test successful');
            } else {
                throw new Error(response?.error || 'Test failed');
            }
        } catch (error) {
            console.error('LLM test failed:', error);
            this.showToast(`✗ ${error.message}`, 'error', this.elements.testConfigStatus);
        }
    }

    // === THEME FUNCTIONALITY ===

    toggleTheme() {
        const currentTheme = document.body.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';

        document.body.setAttribute('data-theme', newTheme);

        // Update theme icon
        const themeIcon = this.elements.themeToggle?.querySelector('.theme-icon');
        if (themeIcon) {
            themeIcon.textContent = newTheme === 'light' ? '🌙' : '☀️';
        }

        // Save theme preference
        chrome.storage.local.set({ theme: newTheme });

        console.log('Theme switched to:', newTheme);
    }

    async loadTheme() {
        try {
            const data = await chrome.storage.local.get(['theme']);
            const theme = data.theme || 'light';

            document.body.setAttribute('data-theme', theme);

            const themeIcon = this.elements.themeToggle?.querySelector('.theme-icon');
            if (themeIcon) {
                themeIcon.textContent = theme === 'light' ? '🌙' : '☀️';
            }
        } catch (error) {
            console.error('Failed to load theme:', error);
        }
    }

    // === FIELD MANAGEMENT (Clean Data Flow) ===

    addField() {
        try {
            // 1. Create field in memory with stable ID
            const field = this.fieldManager.addField({
                friendlyName: '',
                description: ''
            });

            console.log('Added new field:', field.id);

            // 2. Save state atomically  
            this.debouncedSave();

            // 3. Re-render UI from state
            this.renderFields();

            // 4. Focus new field for editing
            this.focusField(field.id);

            this.showFieldStatus('Field added', 'success');

        } catch (error) {
            console.error('Error adding field:', error);
            this.showFieldStatus('Failed to add field', 'error');
        }
    }

    updateField(fieldId, updates) {
        try {
            // Update field in the field manager
            const success = this.fieldManager.updateField(fieldId, updates);
            if (!success) {
                console.warn('Field not found:', fieldId);
                return;
            }

            // Save to storage after update
            this.fieldManager.saveToStorage();

            this.showFieldStatus('Field updated', 'success');

        } catch (error) {
            console.error('Error updating field:', error);
            this.showFieldStatus('Failed to update field', 'error');
        }
    }

    removeField(fieldId) {
        try {
            const field = this.fieldManager.getField(fieldId);
            const fieldName = field?.friendlyName || 'Unknown';

            if (!confirm(`Remove field "${fieldName}"?`)) {
                return;
            }

            console.log('Removing field:', fieldId);

            // 1. Remove from memory
            this.fieldManager.removeField(fieldId);

            // 2. Save state atomically
            this.debouncedSave();

            // 3. Re-render UI
            this.renderFields();

            this.showFieldStatus(`Field "${fieldName}" removed`, 'success');

        } catch (error) {
            console.error('Error removing field:', error);
            this.showFieldStatus('Failed to remove field', 'error');
        }
    }

    // === CAPTURE FLOW (No Race Conditions) ===

    async handleCapture() {
        try {
            console.log('=== Starting capture ===');

            // Always validate domain consent first
            if (!this.elements.consentToggle?.checked) {
                throw new Error('Please enable WebSophon for this domain first');
            }

            // Get fields directly from FieldManager
            const fieldsForAPI = this.fieldManager.getFieldsForAPI();

            // Validate fields exist
            if (!fieldsForAPI || fieldsForAPI.length === 0) {
                throw new Error('No valid fields configured for this domain');
            }

            // Check current interval setting to decide capture type
            const intervalKey = `interval_${this.currentDomain}`;
            const intervalData = await chrome.storage.local.get([intervalKey]);
            const currentInterval = intervalData[intervalKey] || 'manual';

            console.log(`Current interval setting: ${currentInterval}`);

            if (currentInterval === 'manual') {
                // One-time capture
                console.log('Performing one-time capture');
                await this.performSingleCapture(fieldsForAPI);
            } else {
                // Start interval capture
                console.log(`Starting interval capture every ${currentInterval} seconds`);
                await this.startIntervalCapture(parseInt(currentInterval));
            }

        } catch (error) {
            console.error('Capture failed:', error);

            // Mark fields as error atomically
            this.fieldManager.markFieldsError(error.message);
            await this.fieldManager.saveToStorage();
            this.renderFields();

            this.showError(error.message);
        }
    }

    async performSingleCapture(fieldsForAPI) {
        // Mark all fields as pending atomically (UI management)
        const eventId = Date.now().toString();
        this.fieldManager.markFieldsPending(eventId);
        await this.fieldManager.saveToStorage();

        // Re-render to show pending state
        this.renderFields();

        // Check if cloud runner is enabled for this specific capture
        if (this.elements.cloudRunnerToggle?.checked) {
            console.log('Cloud runner is enabled. Starting cloud capture flow.');
            this.showStatus('Starting cloud capture...', 'info');
            await this.handleCloudCapture();
        } else {
            console.log('Starting local capture flow.');
            this.showStatus('Starting local capture...', 'info');
            await this.handleLocalCapture(fieldsForAPI, eventId);
        }
    }

    async handleLocalCapture(fieldsForAPI, eventId) {
        try {
            // Send capture request using local LLM flow
            const response = await this.sendCaptureRequest(fieldsForAPI, eventId, null);

            // Handle response
            if (response.success) {
                this.showStatus('Local capture in progress...', 'info');
                console.log('Manual local capture initiated successfully');
            } else {
                throw new Error(response.error || 'Local capture failed');
            }
        } catch (error) {
            throw new Error(`Local capture failed: ${error.message}`);
        }
    }

    async handleCloudCapture() {
        try {
            this.showStatus('Starting cloud capture...', 'info');
            const tabId = await this.getCurrentTabId();
            if (!tabId) {
                throw new Error('Could not get current tab ID.');
            }

            const message = {
                action: 'startCloudJob',
                tabId: tabId,
                domain: this.currentDomain
            };

            console.log('Sending startCloudJob message:', message);
            const response = await this.sendMessageToBackground(message);

            if (response && response.success) {
                this.showStatus('Cloud job created. Waiting for results...', 'info');
                // Optional: immediately switch to history tab and highlight the pending job
                if (response.eventId) {
                    this.navigateToHistoryEvent(response.eventId);
                }
            } else {
                throw new Error(response.error || 'Failed to start cloud job.');
            }
        } catch (error) {
            console.error('Cloud capture failed:', error);
            this.showError(error.message);
        }
    }

    async sendCaptureRequest(fields, eventId, llmConfig) {
        try {
            // For manual captures: get fresh LLM config and previous evaluation directly
            // (Don't use prepareCaptureData - that's for automatic captures only)

            // Get fresh LLM config from popup settings
            const freshLlmConfig = await this.getLlmConfig();

            // Get previous evaluation for this domain
            const previousEvaluation = await this.getPreviousEvaluation();

            const message = {
                action: 'captureLLM',
                tabId: await this.getCurrentTabId(),
                domain: this.currentDomain,
                fields: fields,
                eventId: eventId,
                llmConfig: freshLlmConfig,
                isManual: true,
                refreshPage: this.elements.refreshPageToggle?.checked || false,
                captureDelay: parseInt(this.elements.captureDelay?.value || '0'),
                fullPageCapture: this.elements.fullPageCaptureToggle?.checked || false,
                previousEvaluation: previousEvaluation
            };

            console.log('Sending manual captureLLM message:', {
                ...message,
                llmConfig: { ...message.llmConfig, apiKey: 'HIDDEN' }
            });

            const response = await this.sendMessageToBackground(message);
            return response;

        } catch (error) {
            console.error('Error sending manual capture request:', error);
            return { success: false, error: error.message };
        }
    }

    async getCurrentTabId() {
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            return tabs[0]?.id || null;
        } catch (error) {
            console.error('Error getting current tab ID:', error);
            return null;
        }
    }

    // === RESULT UPDATES (Single Path) ===

    handleCaptureResults(results, eventId) {
        if (!results) return;

        try {
            // Process the results directly - the LLM returns field data mixed with metadata
            const fieldsData = {};

            // Extract only field results, skip metadata like 'reason'
            Object.keys(results).forEach(key => {
                if (key !== 'reason' && key !== 'timestamp' && key !== 'domain') {
                    fieldsData[key] = results[key];
                }
            });

            // Update fields with results
            this.fieldManager.updateResults(fieldsData, eventId);

            // Store current results as previous evaluation for next run
            this.storePreviousEvaluation(results, eventId);

            // Save to storage
            this.fieldManager.saveToStorage();

            // Re-render to show updated results
            this.renderFields();

            this.showStatus('Fields evaluated successfully', 'success');

        } catch (error) {
            console.error('Error handling capture results:', error);
            this.showError('Failed to process field results');
        }
    }

    // === UI RENDERING (State → DOM) ===

    renderFields() {
        if (!this.elements.fieldsContainer) return;

        console.log('Rendering fields from state:', this.fieldManager.fields.length);

        // Use the UIManager to render fields (which has proper event handling)
        if (this.uiManager) {
            this.uiManager.renderFields();
        } else {
            console.warn('UIManager not available for field rendering');
        }
    }

    // === EVENT HANDLERS (ID-Based) ===

    focusField(fieldId) {
        setTimeout(() => {
            const nameInput = document.querySelector(`input.field-name-input[data-field-id="${fieldId}"]`);
            if (nameInput) {
                nameInput.focus();
                nameInput.select();
            }
        }, 100);
    }

    // === MESSAGE HANDLING (Clean) ===

    setupMessageListener() {
        chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
            console.log('Popup received message:', request.action);

            switch (request.action) {
                case 'fieldResults':
                    console.log('Received field results for event:', request.eventId);
                    this.handleCaptureResults(request.results, request.eventId);

                    // Update job statistics if this was from an interval capture
                    if (request.domain && !request.isManual) {
                        const job = this.jobManager.getJobByDomain(request.domain);
                        if (job) {
                            await this.jobManager.recordJobRun(job.id, true);
                            this.renderActiveJobs(); // Refresh to show updated stats
                        }
                    }
                    break;

                case 'fieldsCancelled':
                    console.log('Fields cancelled for event:', request.eventId);
                    this.fieldManager.markFieldsCancelled(request.eventId);
                    this.fieldManager.saveToStorage();
                    this.renderFields();
                    break;

                case 'eventUpdated':
                    console.log('Event updated:', request.eventId);
                    // If history manager exists and we're on the history tab, update the event
                    if (this.historyManager && this.currentTab === 'history') {
                        this.historyManager.updateEvent(request.eventId, request.event);
                    }
                    // Also reload history if it's currently empty (might have been a race condition)
                    if (this.historyManager && this.historyManager.recentEvents.length === 0) {
                        console.log('History empty, reloading after event update...');
                        this.historyManager.loadHistory();
                    }
                    // If we're on the settings tab, refresh domain statistics
                    if (this.currentTab === 'settings' && request.event) {
                        console.log('Refreshing settings tab after event update...');
                        this.loadKnownDomains();
                    }
                    break;

                case 'cloudResultsSynced':
                    console.log('Cloud results synced:', request);
                    // Refresh history if we're on the history tab
                    if (this.historyManager && this.currentTab === 'history') {
                        console.log('Refreshing history due to cloud sync...');
                        this.historyManager.loadHistory();
                    }
                    // Refresh settings tab to update domain statistics
                    if (this.currentTab === 'settings') {
                        console.log('Refreshing settings tab after cloud sync...');
                        this.loadKnownDomains();
                    }
                    // Show toast notification about new results
                    this.showStatus(`${request.resultCount} new cloud results synced for ${request.domain}`, 'success');
                    break;

                case 'authTokenDetected':
                    console.log('Authentication token detected by background script:', request);
                    if (request.tokenStats) {
                        this.showCaptchaMessage('✅ Authentication successful! Token detected automatically.', 'success');
                        this.updateTokenStatusDisplay(true, request.tokenStats);
                        this.updateQuotaDisplay(request.tokenStats.quotas);

                        setTimeout(() => {
                            this.hideCaptcha();
                        }, 2000);
                    }
                    break;

                case 'authPollingTimeout':
                    console.log('Background authentication polling timed out');
                    this.showCaptchaMessage('⏰ Authentication timeout. If you completed the CAPTCHA, try clicking "Check for Token".', 'warning');
                    break;
            }
        });
    }

    // === PRESETS ===

    renderPresets() {
        if (!this.elements.presetSelector) return;

        const presetNames = this.fieldManager.getPresetNames();

        // Clear existing options
        this.elements.presetSelector.innerHTML = '<option value="">Select a preset...</option>';

        if (presetNames.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No presets available';
            option.disabled = true;
            this.elements.presetSelector.appendChild(option);
        } else {
            presetNames.forEach(name => {
                const option = document.createElement('option');
                option.value = name;
                option.textContent = name;
                this.elements.presetSelector.appendChild(option);
            });
        }

        this.updatePresetButtons();
    }

    updatePresetButtons() {
        const hasSelection = this.elements.presetSelector?.value;
        if (this.elements.deletePresetBtn) {
            this.elements.deletePresetBtn.disabled = !hasSelection;
        }
    }

    savePreset() {
        const name = prompt('Enter preset name:');
        if (!name || !name.trim()) return;

        try {
            const validationErrors = this.fieldManager.validateFields();
            if (validationErrors.length > 0) {
                this.showError(`Cannot save preset: ${validationErrors[0]}`);
                return;
            }

            const success = this.fieldManager.savePreset(name.trim());
            if (!success) {
                this.showError('Failed to save preset');
                return;
            }

            this.renderPresets();

            if (this.elements.presetSelector) {
                this.elements.presetSelector.value = name.trim();
                this.updatePresetButtons();
            }

            this.showStatus(`Preset "${name.trim()}" saved successfully`, 'success');

        } catch (error) {
            console.error('Error saving preset:', error);
            this.showError('Failed to save preset');
        }
    }

    deletePreset() {
        const presetName = this.elements.presetSelector?.value;
        if (!presetName) return;

        if (!confirm(`Are you sure you want to delete the preset "${presetName}"?`)) {
            return;
        }

        try {
            const success = this.fieldManager.deletePreset(presetName);
            if (!success) {
                this.showError('Preset not found');
                return;
            }

            this.fieldManager.saveToStorage();
            this.renderPresets();
            this.showStatus(`Preset "${presetName}" deleted successfully`, 'success');

        } catch (error) {
            console.error('Error deleting preset:', error);
            this.showError('Failed to delete preset');
        }
    }

    loadPreset() {
        const presetName = this.elements.presetSelector?.value;
        if (!presetName) return;

        try {
            console.log('Loading preset:', presetName);

            const success = this.fieldManager.loadPreset(presetName);
            if (!success) {
                this.showError('Preset not found');
                return;
            }

            // Save the loaded state and re-render
            this.fieldManager.saveToStorage();
            this.renderFields();

            this.showStatus(`Preset "${presetName}" loaded successfully`, 'success');
            console.log('Preset loaded successfully');

        } catch (error) {
            console.error('Error loading preset:', error);
            this.showError('Failed to load preset');
        }
    }

    // === SETTINGS ===

    async loadCaptureSettings() {
        try {
            // Load domain consent
            const consentKey = `consent_${this.currentDomain}`;
            const intervalKey = `interval_${this.currentDomain}`;

            const [consentData, intervalData, captureSettings, previousEvalData, cloudRunnerData] = await Promise.all([
                chrome.storage.local.get([consentKey]),
                chrome.storage.local.get([intervalKey]),
                chrome.storage.local.get(['refreshPageToggle', 'captureDelay', 'fullPageCaptureToggle']),
                chrome.storage.local.get(['usePreviousEvaluation']),
                chrome.storage.local.get(['cloudRunnerEnabled'])
            ]);

            // Set consent toggle
            if (this.elements.consentToggle) {
                this.elements.consentToggle.checked = consentData[consentKey] || false;
            }

            // Set capture interval
            if (this.elements.captureInterval) {
                const savedInterval = intervalData[intervalKey] || 'manual';
                this.elements.captureInterval.value = savedInterval;
                console.log('Loaded capture interval setting:', savedInterval);
            }

            // Load capture settings
            if (this.elements.refreshPageToggle) {
                this.elements.refreshPageToggle.checked = captureSettings.refreshPageToggle || false;
                // Set initial visibility of delay dropdown
                this.updateCaptureDelayVisibility(this.elements.refreshPageToggle.checked);
            }
            if (this.elements.captureDelay) {
                this.elements.captureDelay.value = captureSettings.captureDelay || '0';
            }
            if (this.elements.fullPageCaptureToggle) {
                this.elements.fullPageCaptureToggle.checked = captureSettings.fullPageCaptureToggle || false;
            }

            // Load previous evaluation setting
            if (this.elements.usePreviousEvaluationToggle) {
                this.elements.usePreviousEvaluationToggle.checked = previousEvalData.usePreviousEvaluation !== false; // Default to true
            }

            // Load cloud runner setting
            if (this.elements.cloudRunnerToggle) {
                this.elements.cloudRunnerToggle.checked = cloudRunnerData.cloudRunnerEnabled || false;
            }

        } catch (error) {
            console.error('Error loading capture settings:', error);
        }
    }

    async loadBasicSettings() {
        try {
            // Load LLM configuration (global)
            const settingsData = await chrome.storage.local.get(['llmConfig_global', 'cloudRunnerUrl', 'includePremiumModels']);
            const llmConfig = settingsData.llmConfig_global || {};
            const cloudRunnerUrl = settingsData.cloudRunnerUrl || 'https://runner.websophon.tududes.com';
            const includePremium = settingsData.includePremiumModels || false;

            if (this.elements.includePremiumModelsToggle) {
                this.elements.includePremiumModelsToggle.checked = includePremium;
            }

            if (this.elements.llmApiUrl) {
                this.elements.llmApiUrl.value = llmConfig.apiUrl || 'https://openrouter.ai/api/v1/chat/completions';
            }
            if (this.elements.llmApiKey) {
                this.elements.llmApiKey.value = llmConfig.apiKey || '';
            }

            // Populate models dynamically
            await this.populateLlmModels(llmConfig.model);

            if (this.elements.cloudRunnerUrl) {
                this.elements.cloudRunnerUrl.value = cloudRunnerUrl;
            }

            // Load theme
            await this.loadTheme();

        } catch (error) {
            console.error('Error loading basic settings:', error);
        }
    }

    async populateLlmModels(savedModel) {
        if (!this.elements.llmModel) return;

        const select = this.elements.llmModel;
        select.innerHTML = '<option value="">Loading models...</option>'; // Placeholder

        try {
            const { includePremiumModels } = await chrome.storage.local.get(['includePremiumModels']);
            let apiUrl = 'https://openrouter.ai/api/frontend/models/find?fmt=json&input_modalities=image&order=context-high-to-low';
            if (!includePremiumModels) {
                apiUrl += '&max_price=0';
            }

            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${response.statusText}`);
            }
            const data = await response.json();
            let models = data?.data?.models || [];

            // Add more specific client-side filtering for modalities
            models = models.filter(model => {
                const inputs = model.input_modalities || [];
                const outputs = model.output_modalities || [];
                const hasImageInput = inputs.includes('image');
                const hasTextInput = inputs.includes('text');
                const hasTextOutput = outputs.includes('text');
                return hasImageInput && hasTextInput && hasTextOutput;
            });

            select.innerHTML = ''; // Clear placeholder

            if (models.length > 0) {
                const modelsGroup = document.createElement('optgroup');
                modelsGroup.label = includePremiumModels ? '📈 All Vision Models (Highest Context First)' : '📈 Free Vision Models (Highest Context First)';

                models.forEach(model => {
                    const option = document.createElement('option');
                    const price = model.pricing?.prompt ? parseFloat(model.pricing.prompt) * 1000000 : 0;
                    const priceString = price > 0 ? ` ($${price.toFixed(2)}/M)` : ' (Free)';
                    option.value = model.slug;
                    option.textContent = `${model.name} (${(model.context_length / 1000).toFixed(0)}k)${priceString}`;
                    modelsGroup.appendChild(option);
                });
                select.appendChild(modelsGroup);

                // Add the other groups for local/custom models
                const otherGroupsHtml = `
                        <optgroup label="🏠 Local/Self-hosted">
                            <option value="llava">LLaVA (Local)</option>
                        </optgroup>
                        <optgroup label="⚙️ Custom">
                             <option value="custom">Other/Custom Model...</option>
                        </optgroup>
                    `;
                select.insertAdjacentHTML('beforeend', otherGroupsHtml);

                // Set the selected model
                if (savedModel && models.some(m => m.slug === savedModel)) {
                    select.value = savedModel;
                } else if (models.length > 0) {
                    // Default to the first model (highest context) if no valid model was saved
                    select.value = models[0].slug;
                }
            } else {
                select.innerHTML = '<option value="">Could not load models</option>';
            }
        } catch (error) {
            console.error('Error populating LLM models:', error);
            select.innerHTML = '<option value="">Error loading models</option>';
        }
    }

    async saveConsent(enabled) {
        try {
            await chrome.storage.local.set({ [`consent_${this.currentDomain}`]: enabled });
        } catch (error) {
            console.error('Failed to save consent:', error);
        }
    }

    async getLlmConfig() {
        try {
            const data = await chrome.storage.local.get(['llmConfig_global']);
            const config = data.llmConfig_global || {};

            // Fallback to UI values if storage is empty
            if (!config.apiUrl && this.elements.llmApiUrl) {
                config.apiUrl = this.elements.llmApiUrl.value;
            }
            if (!config.apiKey && this.elements.llmApiKey) {
                config.apiKey = this.elements.llmApiKey.value;
            }
            if (!config.model && this.elements.llmModel) {
                config.model = this.elements.llmModel.value;
            }

            return {
                apiUrl: config.apiUrl || 'https://openrouter.ai/api/v1/chat/completions',
                apiKey: config.apiKey || '',
                model: config.model,
                temperature: parseFloat(config.temperature) || 0.1,
                maxTokens: parseInt(config.maxTokens) || 5000 // Increased from 2000 to 5000
            };
        } catch (error) {
            console.error('Failed to get LLM config:', error);
            return {};
        }
    }

    async saveLlmConfig() {
        try {
            const config = {
                apiUrl: this.elements.llmApiUrl?.value || '',
                apiKey: this.elements.llmApiKey?.value || '',
                model: this.elements.llmModel?.value,
                temperature: parseFloat(this.elements.llmTemperature?.value) || 0.1,
                maxTokens: parseInt(this.elements.llmMaxTokens?.value) || 5000 // Increased from 2000 to 5000
            };

            await chrome.storage.local.set({ llmConfig_global: config });
            console.log('LLM config saved');

        } catch (error) {
            console.error('Failed to save LLM config:', error);
        }
    }

    debouncedSaveLlmConfig() {
        clearTimeout(this.saveDebounceTimer);
        this.saveDebounceTimer = setTimeout(() => {
            this.saveLlmConfig();
        }, 500);
    }

    debouncedSaveCloudRunnerUrl() {
        clearTimeout(this.saveDebounceTimer);
        this.saveDebounceTimer = setTimeout(() => {
            const url = this.elements.cloudRunnerUrl?.value || '';
            chrome.storage.local.set({ cloudRunnerUrl: url });
            console.log('Cloud runner URL saved');
        }, 500);
    }

    // === HISTORY ===

    async initializeHistoryManager() {
        try {
            console.log('Initializing history manager...');
            const { HistoryManager } = await import('./components/HistoryManager.js');
            console.log('HistoryManager available:', !!HistoryManager);
            console.log('historyContainer element:', !!this.elements.historyContainer);

            if (HistoryManager) {
                this.historyManager = new HistoryManager();
                this.historyManager.setElements(this.elements);

                // Load initial history data
                if (this.historyManager.loadHistory) {
                    console.log('Loading history data...');
                    this.historyManager.loadHistory();
                } else {
                    console.warn('HistoryManager.loadHistory method not found');
                }

                console.log('History manager initialized successfully');
            } else {
                console.warn('HistoryManager not available - adding fallback');
                // Add fallback placeholder
                if (this.elements.historyContainer) {
                    this.elements.historyContainer.innerHTML = `
                            <div class="history-empty">
                                <h3>📊 History</h3>
                                <p>No capture events yet. Try running a manual capture to see results here.</p>
                                <p style="margin-top: 10px; font-size: 12px; opacity: 0.7;">History manager failed to load</p>
                            </div>
                        `;
                }
            }
        } catch (error) {
            console.error('Failed to initialize history manager:', error);
            // Add error placeholder with better styling
            if (this.elements.historyContainer) {
                this.elements.historyContainer.innerHTML = `
                        <div class="history-empty">
                            <h3>📊 History</h3>
                            <p>No capture events yet. Try running a manual capture to see results here.</p>
                            <p style="margin-top: 10px; font-size: 12px; opacity: 0.7;">Error: ${error.message}</p>
                        </div>
                    `;
            }
        }
    }

    navigateToHistoryEvent(eventId) {
        this.switchTab('history');

        if (this.historyManager?.scrollToEvent) {
            this.historyManager.scrollToEvent(eventId);
        }
    }

    // === UTILITY METHODS ===

    debouncedSave() {
        clearTimeout(this.saveDebounceTimer);
        this.saveDebounceTimer = setTimeout(() => {
            this.fieldManager.saveToStorage();
        }, 500);
    }

    async sendMessageToBackground(message) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response || {});
                }
            });
        });
    }

    showStatus(message, type = 'info') {
        this.showToast(message, type, this.elements.captureStatus);
    }

    showToast(message, type = 'info', element) {
        if (!element) return;

        console.log(`Toast (${type}) on ${element.id}:`, message);
        element.textContent = message;
        element.className = `status-message ${type}`;

        setTimeout(() => {
            if (element.textContent === message) {
                element.textContent = '';
                element.className = 'status-message';
            }
        }, 5000);
    }

    showError(message) {
        this.showStatus(message, 'error');
    }

    showFieldStatus(message, type = 'info') {
        console.log(`Field Status (${type}):`, message);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Debug method for troubleshooting field updates
    debugFieldStates() {
        console.log('=== FIELD DEBUG INFO ===');
        console.log('Current Domain:', this.currentDomain);
        console.log('Total Fields:', this.fieldManager.fields.length);

        this.fieldManager.fields.forEach((field, index) => {
            console.log(`Field ${index + 1}:`, {
                id: field.id,
                name: field.name,
                friendlyName: field.friendlyName,
                description: field.description?.substring(0, 50) + '...',
                isPending: field.isPending,
                lastStatus: field.lastStatus,
                result: field.result,
                probability: field.probability,
                lastEventId: field.lastEventId,
                lastResultTime: field.lastResultTime
            });
        });

        // Check if DOM elements exist for each field
        console.log('DOM Field Elements:');
        this.fieldManager.fields.forEach((field, index) => {
            const fieldElement = document.querySelector(`[data-field-id="${field.id}"]`);
            const statusElement = fieldElement?.querySelector('.field-status');
            console.log(`Field ${index + 1} DOM:`, {
                fieldElement: !!fieldElement,
                statusElement: !!statusElement,
                statusHTML: statusElement?.innerHTML || 'NOT FOUND'
            });
        });

        console.log('Last Results:', this.fieldManager.lastResults);
        console.log('=== END FIELD DEBUG ===');

        return {
            fieldCount: this.fieldManager.fields.length,
            fields: this.fieldManager.fields,
            lastResults: this.fieldManager.lastResults
        };
    }

    async loadKnownDomains() {
        if (!this.elements.domainsContainer) {
            console.log('No domains container found');
            return;
        }

        try {
            // Get all storage data and find domain-related keys
            const allData = await chrome.storage.local.get();
            const domainKeys = Object.keys(allData).filter(key =>
                key.startsWith('consent_') || key.startsWith('interval_') || key.startsWith('fields_') || key.startsWith('cloud_job_')
            );

            // Extract unique domains
            const domains = new Set();
            domainKeys.forEach(key => {
                const parts = key.split('_');
                if (parts.length >= 2) {
                    const domain = parts.slice(1).join('_'); // Handle domains with underscores
                    if (domain) {
                        domains.add(domain);
                    }
                }
            });

            // Clear existing content
            this.elements.domainsContainer.innerHTML = '';

            if (domains.size === 0) {
                this.elements.domainsContainer.innerHTML = '<p class="no-domains">No domains configured yet</p>';
            } else {
                const sortedDomains = Array.from(domains).sort();

                for (const domain of sortedDomains) {
                    const isCurrentDomain = domain === this.currentDomain;
                    const consentEnabled = allData[`consent_${domain}`] || false;
                    const interval = allData[`interval_${domain}`] || 'manual';
                    const fieldsCount = (allData[`fields_${domain}`] || []).length;
                    const jobId = allData[`cloud_job_${domain}`] || null;

                    // Get last run information from history
                    const lastRunInfo = await this.getDomainLastRun(domain);
                    const jobInfo = jobId ? await this.getCloudJobInfo(jobId) : null;

                    const domainHtml = `
                            <div class="domain-item ${isCurrentDomain ? 'current-domain-item' : ''}" data-domain="${domain}">
                                <div class="domain-header">
                                    <div class="domain-name-section">
                                        <div class="domain-name">
                                            <span class="domain-name-text" title="${domain}">${domain}</span>
                                            ${isCurrentDomain ? '<span class="domain-current-badge">CURRENT</span>' : ''}
                                        </div>
                                    </div>
                                    <div class="domain-actions">
                                        <span class="domain-status ${consentEnabled ? 'enabled' : 'disabled'}">
                                            ${consentEnabled ? '✓ Enabled' : '○ Disabled'}
                                        </span>
                                        <button class="domain-delete-btn" data-domain="${domain}" title="Delete all settings for ${domain}">
                                            🗑️
                                        </button>
                                    </div>
                                </div>
                                <div class="domain-details">
                                    <div class="domain-detail-item">
                                        <div class="domain-detail-label">Interval</div>
                                        <div class="domain-detail-value domain-interval-value">
                                            ${interval === 'manual' ? 'Manual Only' : interval + 's'}
                                        </div>
                                    </div>
                                    <div class="domain-detail-item">
                                        <div class="domain-detail-label">Fields</div>
                                        <div class="domain-detail-value domain-fields-value">${fieldsCount} field${fieldsCount !== 1 ? 's' : ''}</div>
                                    </div>
                                    <div class="domain-detail-item">
                                        <div class="domain-detail-label">Last Run</div>
                                        <div class="domain-detail-value domain-last-run-value ${lastRunInfo.never ? 'never' : ''}">
                                            ${lastRunInfo.display}
                                        </div>
                                    </div>
                                    <div class="domain-detail-item">
                                        <div class="domain-detail-label">Total Events</div>
                                        <div class="domain-detail-value">${lastRunInfo.totalEvents}</div>
                                    </div>
                                </div>
                                ${jobInfo && jobInfo.id ? this.getJobDetailsHtml(jobInfo) : ''}
                            </div>
                        `;

                    this.elements.domainsContainer.insertAdjacentHTML('beforeend', domainHtml);
                }

                // Add event listeners for delete and clear job buttons
                this.setupDomainActionListeners();
            }

            console.log(`Loaded ${domains.size} known domains`);
        } catch (error) {
            console.error('Failed to load known domains:', error);
            if (this.elements.domainsContainer) {
                this.elements.domainsContainer.innerHTML = '<p class="no-domains">Error loading domains</p>';
            }
        }
    }

    getJobDetailsHtml(jobInfo) {
        const createdDate = new Date(jobInfo.createdAt).toLocaleString();
        const hasPending = jobInfo.resultCount > 0;
        return `
            <details class="domain-job-details">
                <summary class="job-details-header">
                    <span class="job-details-title">☁️ Active Cloud Job</span>
                    <span class="job-pending-indicator ${hasPending ? 'visible' : ''}" title="${jobInfo.resultCount} results pending sync">${jobInfo.resultCount}</span>
                </summary>
                <div class="job-details-content">
                    <div class="job-detail-item"><strong>Job ID:</strong> <span class="job-id">${jobInfo.id.substring(0, 8)}...</span></div>
                    <div class="job-detail-item"><strong>Created:</strong> ${createdDate}</div>
                    <div class="job-detail-item"><strong>Interval:</strong> ${jobInfo.interval}s</div>
                    <div class="job-detail-item"><strong>Status:</strong> <span class="job-status-${jobInfo.status}">${jobInfo.status}</span></div>
                    <div class="job-detail-item"><strong>Pending Results:</strong> ${jobInfo.resultCount}</div>
                    <button class="small-button danger clear-job-btn" data-job-id="${jobInfo.id}" data-domain="${jobInfo.domain}" title="Stop and clear this recurring job from the server">
                        Stop Cloud Job
                    </button>
                </div>
            </details>
        `;
    }

    async getCloudJobInfo(jobId) {
        try {
            const { cloudRunnerUrl } = await chrome.storage.local.get('cloudRunnerUrl');
            const runnerEndpoint = (cloudRunnerUrl || 'https://runner.websophon.tududes.com').replace(/\/$/, '');
            const jobStatusUrl = `${runnerEndpoint}/job/${jobId}`;

            const response = await fetch(jobStatusUrl);
            if (!response.ok) {
                if (response.status === 404) {
                    console.log(`Job ${jobId} not found on server.`);
                    return null;
                }
                throw new Error(`Server returned status ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`Failed to get info for cloud job ${jobId}:`, error);
            return null;
        }
    }

    async getDomainLastRun(domain) {
        try {
            console.log(`Getting last run info for domain: ${domain}`);

            // Get history from storage - use recentEvents which is the actual storage key
            const { recentEvents = [] } = await chrome.storage.local.get(['recentEvents']);
            console.log(`Total events in storage: ${recentEvents.length}`);

            // Filter events for this domain
            const domainEvents = recentEvents.filter(event => event.domain === domain);
            console.log(`Events for ${domain}: ${domainEvents.length}`);

            if (domainEvents.length === 0) {
                return {
                    display: 'Never',
                    never: true,
                    totalEvents: 0
                };
            }

            // Sort by timestamp (newest first) - timestamps are ISO strings
            domainEvents.sort((a, b) => {
                const timeA = new Date(a.timestamp).getTime();
                const timeB = new Date(b.timestamp).getTime();
                return timeB - timeA;
            });

            const lastEvent = domainEvents[0];
            const lastRunTime = new Date(lastEvent.timestamp);
            const now = new Date();
            const diffMs = now - lastRunTime;

            let display;
            if (diffMs < 60000) { // Less than 1 minute
                display = 'Just now';
            } else if (diffMs < 3600000) { // Less than 1 hour
                const minutes = Math.floor(diffMs / 60000);
                display = `${minutes}m ago`;
            } else if (diffMs < 86400000) { // Less than 1 day
                const hours = Math.floor(diffMs / 3600000);
                display = `${hours}h ago`;
            } else { // More than 1 day
                const days = Math.floor(diffMs / 86400000);
                display = `${days}d ago`;
            }

            console.log(`Last run for ${domain}: ${display} (${domainEvents.length} total events)`);

            return {
                display,
                never: false,
                totalEvents: domainEvents.length
            };
        } catch (error) {
            console.error('Error getting domain last run:', error);
            return {
                display: 'Unknown',
                never: true,
                totalEvents: 0
            };
        }
    }

    setupDomainActionListeners() {
        this.elements.domainsContainer.addEventListener('click', async (e) => {
            const target = e.target;
            if (target.matches('.domain-delete-btn')) {
                e.preventDefault();
                e.stopPropagation();
                const domain = target.dataset.domain;
                const confirmMessage = `Delete all WebSophon settings for "${domain}"?\n\nThis will remove:\n• Domain consent settings\n• Capture interval\n• Field configurations\n• History data\n\nThis action cannot be undone.`;
                if (confirm(confirmMessage)) {
                    await this.deleteDomainSettings(domain);
                }
            } else if (target.matches('.clear-job-btn')) {
                e.preventDefault();
                e.stopPropagation();
                const jobId = target.dataset.jobId;
                const domain = target.dataset.domain;
                if (confirm(`Stop the recurring cloud job for "${domain}"?`)) {
                    await this.clearCloudJob(jobId, domain);
                }
            } else if (target.matches('.domain-name-text')) {
                e.preventDefault();
                e.stopPropagation();
                const domain = target.textContent.trim();
                this.openDomain(domain);
            }
        });
    }

    async clearCloudJob(jobId, domain) {
        try {
            this.showStatus(`Clearing cloud job for ${domain}...`, 'info');
            // This reuses the logic in CaptureService to send a DELETE request
            const captureService = this.controller.captureService;
            await this.sendMessageToBackground({
                action: 'stopCapture', // This now correctly maps to stopping cloud jobs
                tabId: null, // tabId is not needed for stopping a cloud job by ID/domain
                domain: domain // Pass domain to identify the job
            });

            this.showStatus(`Cloud job for ${domain} cleared successfully.`, 'success');
            // Refresh the domains list to show the change
            await this.loadKnownDomains();

        } catch (error) {
            console.error('Failed to clear cloud job:', error);
            this.showError(`Error clearing job: ${error.message}`);
        }
    }

    async deleteDomainSettings(domain) {
        try {
            console.log(`Deleting all settings for domain: ${domain}`);

            // Get all storage data
            const allData = await chrome.storage.local.get();

            // Find all keys related to this domain
            const keysToDelete = Object.keys(allData).filter(key => {
                return key.startsWith(`consent_${domain}`) ||
                    key.startsWith(`interval_${domain}`) ||
                    key.startsWith(`fields_${domain}`) ||
                    key.startsWith(`llmConfig_${domain}`) ||
                    key.startsWith(`llmMode_${domain}`) ||
                    key.startsWith(`refreshPage_${domain}`) ||
                    key.startsWith(`captureDelay_${domain}`);
            });

            // Delete domain-specific storage keys
            if (keysToDelete.length > 0) {
                await chrome.storage.local.remove(keysToDelete);
                console.log(`Deleted ${keysToDelete.length} storage keys:`, keysToDelete);
            }

            // Clean up history data for this domain
            const { recentEvents = [] } = await chrome.storage.local.get(['recentEvents']);
            const filteredHistory = recentEvents.filter(event => event.domain !== domain);

            if (filteredHistory.length !== recentEvents.length) {
                await chrome.storage.local.set({ recentEvents: filteredHistory });
                console.log(`Removed ${recentEvents.length - filteredHistory.length} history events for domain`);
            }

            // Refresh the domains list
            await this.loadKnownDomains();

            // Refresh history if we're on the history tab
            if (this.historyManager && this.historyManager.loadHistory) {
                this.historyManager.loadHistory();
            }

            this.showStatus(`All settings for "${domain}" have been deleted`, 'success');

        } catch (error) {
            console.error('Failed to delete domain settings:', error);
            this.showStatus(`Failed to delete settings for "${domain}"`, 'error');
        }
    }

    // === PREVIOUS EVALUATION MANAGEMENT ===

    async getUsePreviousEvaluationSetting() {
        try {
            const data = await chrome.storage.local.get(['usePreviousEvaluation']);
            return data.usePreviousEvaluation !== false; // Default to true
        } catch (error) {
            console.error('Error getting previous evaluation setting:', error);
            return true; // Default to enabled
        }
    }

    async setUsePreviousEvaluationSetting(enabled) {
        try {
            await chrome.storage.local.set({ usePreviousEvaluation: enabled });
            console.log('Previous evaluation setting updated:', enabled);
        } catch (error) {
            console.error('Error setting previous evaluation setting:', error);
        }
    }

    async getPreviousEvaluation() {
        try {
            const storageKey = `previousEvaluation_${this.currentDomain}`;
            const data = await chrome.storage.local.get([storageKey]);
            return data[storageKey] || null;
        } catch (error) {
            console.error('Error getting previous evaluation:', error);
            return null;
        }
    }

    async storePreviousEvaluation(results, eventId) {
        try {
            const storageKey = `previousEvaluation_${this.currentDomain}`;
            const timestamp = new Date().toISOString();

            // Use filtered state snapshot instead of raw results
            const filteredSnapshot = this.fieldManager.getFilteredStateSnapshot();
            const previousEvaluation = {};

            // Convert filtered snapshot to previous evaluation format
            Object.keys(filteredSnapshot).forEach(fieldName => {
                // Find the field to get its confidence and raw result
                const field = this.fieldManager.fields.find(f => f.name === fieldName);
                if (field && field.result !== null) {
                    previousEvaluation[fieldName] = {
                        result: filteredSnapshot[fieldName], // Use filtered result (confidence threshold applied)
                        confidence: field.probability || 0.8,
                        rawResult: field.result, // Store raw result for debugging
                        threshold: field.webhookMinConfidence || 75,
                        timestamp: timestamp,
                        eventId: eventId
                    };
                }
            });

            if (Object.keys(previousEvaluation).length > 0) {
                await chrome.storage.local.set({ [storageKey]: previousEvaluation });
                console.log('Stored filtered previous evaluation for domain', this.currentDomain, ':', previousEvaluation);
            }
        } catch (error) {
            console.error('Error storing previous evaluation:', error);
        }
    }

    async clearPreviousEvaluation() {
        try {
            const storageKey = `previousEvaluation_${this.currentDomain}`;
            await chrome.storage.local.remove([storageKey]);
            console.log('Cleared previous evaluation for domain:', this.currentDomain);
            this.showStatus('Previous evaluation context cleared', 'success');
        } catch (error) {
            console.error('Error clearing previous evaluation:', error);
            this.showError('Failed to clear previous evaluation');
        }
    }

    updateCaptureDelayVisibility(isEnabled) {
        // Find the form group containing the capture delay
        const captureDelayGroup = this.elements.captureDelay?.closest('.form-group');
        if (captureDelayGroup) {
            captureDelayGroup.style.display = isEnabled ? 'block' : 'none';
        }
    }

    async handleCaptureIntervalChange(intervalValue) {
        try {
            console.log('Capture interval changed to:', intervalValue);

            // Save the interval setting for this domain
            const intervalKey = `interval_${this.currentDomain}`;
            await chrome.storage.local.set({ [intervalKey]: intervalValue });

            // Only stop existing intervals when switching to manual
            // Don't start new intervals - that should only happen when capture button is clicked
            if (intervalValue === 'manual') {
                // Stop any existing automatic capture (both local and cloud)
                await this.stopAllIntervalCaptures();
                this.showStatus('Interval capture setting changed to manual', 'info');
            } else {
                console.log(`Interval setting changed to ${intervalValue} seconds - will be used for next capture`);
                this.showStatus(`Interval set to ${this.formatInterval(parseInt(intervalValue))} - click capture to start`, 'info');
            }

            // Refresh job list to show current state
            this.renderActiveJobs();

        } catch (error) {
            console.error('Error handling capture interval change:', error);
            this.showError(error.message);

            // Reset to manual on error
            if (this.elements.captureInterval) {
                this.elements.captureInterval.value = 'manual';
                const intervalKey = `interval_${this.currentDomain}`;
                await chrome.storage.local.set({ [intervalKey]: 'manual' });
            }
        }
    }

    async stopAllIntervalCaptures() {
        console.log('Stopping all interval captures for domain:', this.currentDomain);

        // Get current tab
        const tabId = await this.getCurrentTabId();

        // Stop both local and cloud captures
        await this.sendMessageToBackground({
            action: 'stopCapture',
            tabId: tabId,
            domain: this.currentDomain
        });

        // Remove job from JobManager
        const existingJob = this.jobManager.getJobByDomain(this.currentDomain);
        if (existingJob) {
            await this.jobManager.deleteJob(existingJob.id);
            console.log(`Removed job ${existingJob.id} for domain ${this.currentDomain}`);
        }
    }

    async startIntervalCapture(intervalSeconds) {
        console.log(`Starting interval capture every ${intervalSeconds} seconds`);

        // Stop any existing interval captures first
        await this.stopAllIntervalCaptures();

        // Validate domain consent and LLM config before starting
        if (!this.elements.consentToggle?.checked) {
            throw new Error('Please enable WebSophon for this domain first');
        }

        const llmConfig = await this.getLlmConfig();
        if (!llmConfig.apiUrl || !llmConfig.apiKey) {
            throw new Error('Please configure LLM API URL and API Key first');
        }

        // Get current tab info
        const tabId = await this.getCurrentTabId();
        if (!tabId) {
            throw new Error('Could not get current tab');
        }

        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentUrl = tabs[0]?.url || `https://${this.currentDomain}`;

        // Determine if using cloud runner
        const isCloudJob = this.elements.cloudRunnerToggle?.checked || false;

        if (isCloudJob) {
            // For cloud jobs, validate authentication token
            const tokenStats = await this.sendMessageToBackground({ action: 'getTokenStats' });
            if (!tokenStats || !tokenStats.quotas || !tokenStats.expiresAt) {
                throw new Error('Cloud runner requires valid authentication token. Complete CAPTCHA first.');
            }

            console.log('Starting cloud runner interval job');
            await this.startCloudIntervalJob(tabId, intervalSeconds, currentUrl);
        } else {
            console.log('Starting local interval job');
            await this.startLocalIntervalJob(tabId, intervalSeconds, currentUrl);
        }
    }

    async startLocalIntervalJob(tabId, intervalSeconds, currentUrl) {
        // Start local interval capture
        await this.sendMessageToBackground({
            action: 'startCapture',
            tabId: tabId,
            domain: this.currentDomain,
            interval: intervalSeconds,
            type: 'local'
        });

        // Create job in JobManager
        await this.jobManager.createJob({
            domain: this.currentDomain,
            url: currentUrl,
            interval: intervalSeconds,
            tabId: tabId,
            status: 'active',
            isCloudJob: false
        });

        this.showStatus(`Local interval capture started (every ${this.formatInterval(intervalSeconds)})`, 'success');

        // Refresh job list to show new active job
        this.renderActiveJobs();
    }

    async startCloudIntervalJob(tabId, intervalSeconds, currentUrl) {
        // Start cloud interval capture
        const response = await this.sendMessageToBackground({
            action: 'startCloudInterval',
            tabId: tabId,
            domain: this.currentDomain,
            interval: intervalSeconds
        });

        if (!response.success) {
            throw new Error(response.error || 'Failed to start cloud interval job');
        }

        // Create job in JobManager with cloud runner job ID
        await this.jobManager.createJob({
            domain: this.currentDomain,
            url: currentUrl,
            interval: intervalSeconds,
            tabId: tabId,
            status: 'active',
            isCloudJob: true,
            jobId: response.jobId // Store cloud runner job ID
        });

        this.showStatus(`Cloud interval capture started (every ${this.formatInterval(intervalSeconds)})`, 'success');

        // Refresh job list to show new active job
        this.renderActiveJobs();
    }

    formatInterval(seconds) {
        if (seconds < 60) {
            return `${seconds} seconds`;
        } else if (seconds < 3600) {
            return `${Math.floor(seconds / 60)} minutes`;
        } else if (seconds < 86400) {
            return `${Math.floor(seconds / 3600)} hours`;
        } else {
            return `${Math.floor(seconds / 86400)} days`;
        }
    }

    // === ACTIVE JOBS MANAGEMENT ===

    renderActiveJobs() {
        if (!this.elements.activeJobsList) return;

        const activeJobs = this.jobManager.getActiveJobs();

        if (activeJobs.length === 0) {
            this.elements.activeJobsList.innerHTML = '<div class="no-active-jobs">No active interval captures</div>';
            return;
        }

        const jobsHtml = activeJobs.map(job => this.renderJobItem(job)).join('');
        this.elements.activeJobsList.innerHTML = jobsHtml;

        // Add event listeners for job controls
        this.setupJobControlListeners();
    }

    renderJobItem(job) {
        const statusClass = job.status.toLowerCase();
        const statusText = job.status.charAt(0).toUpperCase() + job.status.slice(1);
        const intervalText = this.formatInterval(job.interval);
        const lastRun = job.lastRun ? new Date(job.lastRun).toLocaleString() : 'Never';
        const cloudBadge = job.isCloudJob ? '<span class="job-cloud-badge">Cloud</span>' : '';

        return `
            <div class="job-item" data-job-id="${job.id}">
                <div class="job-header">
                    <div class="job-info">
                        <div class="job-domain" onclick="this.openDomain('${job.domain}')" title="Open ${job.domain}">
                            ${job.domain}
                        </div>
                        <div class="job-url" onclick="this.openUrl('${job.url}')" title="Open ${job.url}">
                            ${job.url}
                        </div>
                        <div class="job-status">
                            <div class="job-status-indicator ${statusClass}"></div>
                            <span>${statusText}</span>
                            ${cloudBadge}
                        </div>
                    </div>
                                        <div class="job-controls">
                        ${this.getJobControlButtons(job)}
                        <button class="job-control-btn danger" data-action="delete" data-job-id="${job.id}">🗑️ Delete</button>
                    </div>
                </div>
                <div class="job-details">
                    <div class="job-interval">Every ${intervalText}</div>
                    <div class="job-stats">
                        <span>Runs: ${job.runCount}</span>
                        <span>Last: ${lastRun}</span>
                        ${job.errorCount > 0 ? `<span style="color: var(--danger)">Errors: ${job.errorCount}</span>` : ''}
                    </div>
                </div>
                ${job.lastError ? `<div class="job-error" style="color: var(--danger); font-size: var(--text-xs); margin-top: var(--space-xs);">Error: ${job.lastError}</div>` : ''}
            </div>
        `;
    }

    getJobControlButtons(job) {
        switch (job.status) {
            case 'active':
                return `<button class="job-control-btn" data-action="pause" data-job-id="${job.id}">⏸️ Pause</button>`;

            case 'paused':
                return `<button class="job-control-btn primary" data-action="resume" data-job-id="${job.id}">▶️ Resume</button>`;

            case 'disconnected':
                return `<button class="job-control-btn primary" data-action="reconnect" data-job-id="${job.id}">🔄 Reconnect</button>`;

            case 'error':
                return `<button class="job-control-btn primary" data-action="restart" data-job-id="${job.id}">🔄 Restart</button>`;

            default:
                return `<button class="job-control-btn primary" data-action="resume" data-job-id="${job.id}">▶️ Resume</button>`;
        }
    }

    setupJobControlListeners() {
        if (!this.elements.activeJobsList) return;

        this.elements.activeJobsList.addEventListener('click', async (e) => {
            const button = e.target.closest('.job-control-btn');
            if (!button) return;

            e.preventDefault();
            e.stopPropagation();

            const action = button.dataset.action;
            const jobId = button.dataset.jobId;

            try {
                await this.handleJobAction(action, jobId);
            } catch (error) {
                console.error(`Error handling job action ${action}:`, error);
                this.showError(`Failed to ${action} job: ${error.message}`);
            }
        });

        // Handle URL/domain clicks
        this.elements.activeJobsList.addEventListener('click', (e) => {
            if (e.target.classList.contains('job-domain')) {
                const domain = e.target.textContent.trim();
                this.openDomain(domain);
            } else if (e.target.classList.contains('job-url')) {
                const url = e.target.textContent.trim();
                this.openUrl(url);
            }
        });
    }

    async handleJobAction(action, jobId) {
        const job = this.jobManager.getJob(jobId);
        if (!job) {
            throw new Error('Job not found');
        }

        switch (action) {
            case 'pause':
                if (job.isCloudJob) {
                    // For cloud jobs, we don't have pause functionality yet
                    // Just update local state
                    await this.jobManager.pauseJob(jobId);
                } else {
                    // For local jobs, stop the capture and mark as paused
                    await this.sendMessageToBackground({
                        action: 'stopCapture',
                        tabId: job.tabId,
                        domain: job.domain
                    });
                    await this.jobManager.pauseJob(jobId);
                }
                this.showStatus(`Paused job for ${job.domain}`, 'info');
                break;

            case 'resume':
                if (job.status !== 'paused') {
                    throw new Error('Job is not paused');
                }

                if (job.isCloudJob) {
                    // For cloud jobs, restart the cloud job
                    await this.sendMessageToBackground({
                        action: 'startCapture',
                        tabId: job.tabId,
                        domain: job.domain,
                        interval: job.interval
                    });
                } else {
                    // For local jobs, restart the capture
                    await this.sendMessageToBackground({
                        action: 'startCapture',
                        tabId: job.tabId,
                        domain: job.domain,
                        interval: job.interval
                    });
                }
                await this.jobManager.resumeJob(jobId);
                this.showStatus(`Resumed job for ${job.domain}`, 'success');
                break;

            case 'delete':
                const confirmMessage = `Delete interval capture job for "${job.domain}"?\n\nThis will stop the ${this.formatInterval(job.interval)} capture schedule.`;
                if (!confirm(confirmMessage)) return;

                // Stop the actual capture
                await this.sendMessageToBackground({
                    action: 'stopCapture',
                    tabId: job.tabId,
                    domain: job.domain
                });

                // Remove from job manager
                await this.jobManager.deleteJob(jobId);

                // Reset interval selector if this is the current domain
                if (job.domain === this.currentDomain && this.elements.captureInterval) {
                    this.elements.captureInterval.value = 'manual';
                    const intervalKey = `interval_${this.currentDomain}`;
                    await chrome.storage.local.set({ [intervalKey]: 'manual' });
                }

                this.showStatus(`Deleted job for ${job.domain}`, 'success');
                break;

            case 'reconnect':
            case 'restart':
                // For disconnected or error jobs, attempt to restart them
                if (job.isCloudJob) {
                    // Restart cloud job
                    const response = await this.sendMessageToBackground({
                        action: 'startCloudInterval',
                        tabId: job.tabId || await this.getCurrentTabId(),
                        domain: job.domain,
                        interval: job.interval
                    });

                    if (response.success) {
                        await this.jobManager.updateJob(jobId, {
                            status: 'active',
                            jobId: response.jobId,
                            lastError: null,
                            errorCount: 0
                        });
                        this.showStatus(`Reconnected cloud job for ${job.domain}`, 'success');
                    } else {
                        throw new Error(response.error || 'Failed to reconnect cloud job');
                    }
                } else {
                    // Restart local job
                    await this.sendMessageToBackground({
                        action: 'startCapture',
                        tabId: job.tabId || await this.getCurrentTabId(),
                        domain: job.domain,
                        interval: job.interval,
                        type: 'local'
                    });

                    await this.jobManager.updateJob(jobId, {
                        status: 'active',
                        lastError: null,
                        errorCount: 0
                    });
                    this.showStatus(`Restarted local job for ${job.domain}`, 'success');
                }
                break;

            default:
                throw new Error(`Unknown action: ${action}`);
        }

        // Refresh the job list
        this.renderActiveJobs();
    }

    openDomain(domain) {
        const url = `https://${domain}`;
        chrome.tabs.create({ url });
    }

    openUrl(url) {
        chrome.tabs.create({ url });
    }

    // === CLOUD RUNNER SYNCHRONIZATION ===

    startCloudRunnerSync() {
        // Sync immediately on startup
        this.syncWithCloudRunner();

        // Set up periodic sync every 30 seconds
        if (this.cloudSyncInterval) {
            clearInterval(this.cloudSyncInterval);
        }

        this.cloudSyncInterval = setInterval(() => {
            this.syncWithCloudRunner();
        }, 30000); // 30 seconds

        console.log('Cloud runner synchronization started');
    }

    stopCloudRunnerSync() {
        if (this.cloudSyncInterval) {
            clearInterval(this.cloudSyncInterval);
            this.cloudSyncInterval = null;
            console.log('Cloud runner synchronization stopped');
        }
    }

    async syncWithCloudRunner() {
        try {
            // Check if we have a valid token
            const tokenStats = await this.sendMessageToBackground({ action: 'getTokenStats' });
            if (!tokenStats || !tokenStats.quotas || !tokenStats.expiresAt) {
                // No valid token, skip sync
                return;
            }

            // Get cloud runner jobs for our token
            const response = await this.sendMessageToBackground({
                action: 'getCloudJobs'
            });

            if (response.success) {
                await this.processCloudJobSync(response.jobs || []);
            } else {
                console.warn('Failed to sync with cloud runner:', response.error);
                await this.handleCloudSyncError(response.error);
            }

        } catch (error) {
            console.warn('Cloud runner sync error:', error);
            await this.handleCloudSyncError(error.message);
        }
    }

    async processCloudJobSync(cloudJobs) {
        console.log(`Syncing with ${cloudJobs.length} cloud runner jobs`);

        // Get current local jobs
        const localJobs = this.jobManager.getActiveJobs();
        const localCloudJobs = localJobs.filter(job => job.isCloudJob);

        // Check for cloud jobs that don't exist locally
        for (const cloudJob of cloudJobs) {
            const localJob = localCloudJobs.find(lj => lj.jobId === cloudJob.id);

            if (!localJob) {
                // Cloud job exists but not locally - add it
                console.log(`Found cloud job ${cloudJob.id} not in local state, adding...`);

                await this.jobManager.createJob({
                    domain: cloudJob.domain,
                    url: cloudJob.url || `https://${cloudJob.domain}`,
                    interval: cloudJob.interval,
                    tabId: null, // No local tab for cloud-only jobs
                    status: this.mapCloudStatus(cloudJob.status),
                    isCloudJob: true,
                    jobId: cloudJob.id
                });
            } else {
                // Update existing local job with cloud status
                const mappedStatus = this.mapCloudStatus(cloudJob.status);
                if (localJob.status !== mappedStatus) {
                    console.log(`Updating job ${cloudJob.id} status from ${localJob.status} to ${mappedStatus}`);
                    await this.jobManager.updateJob(localJob.id, {
                        status: mappedStatus,
                        lastRun: cloudJob.lastRun || localJob.lastRun,
                        runCount: cloudJob.runCount || localJob.runCount
                    });
                }
            }
        }

        // Check for local cloud jobs that don't exist on cloud runner
        for (const localJob of localCloudJobs) {
            const cloudJob = cloudJobs.find(cj => cj.id === localJob.jobId);

            if (!cloudJob) {
                // Local job exists but not on cloud runner - mark as disconnected
                console.log(`Local job ${localJob.id} not found on cloud runner, marking as disconnected`);
                await this.jobManager.updateJob(localJob.id, {
                    status: 'disconnected',
                    lastError: 'Job not found on cloud runner (may have been restarted)'
                });
            }
        }

        // Refresh job list if we made changes
        this.renderActiveJobs();
    }

    mapCloudStatus(cloudStatus) {
        switch (cloudStatus) {
            case 'idle':
            case 'running':
                return 'active';
            case 'failed':
                return 'error';
            case 'stopped':
                return 'stopped';
            default:
                return cloudStatus;
        }
    }

    async handleCloudSyncError(error) {
        // Mark all cloud jobs as potentially disconnected
        const localJobs = this.jobManager.getActiveJobs();
        const localCloudJobs = localJobs.filter(job => job.isCloudJob && job.status === 'active');

        let hasChanges = false;
        for (const job of localCloudJobs) {
            if (job.status !== 'disconnected') {
                await this.jobManager.updateJob(job.id, {
                    status: 'disconnected',
                    lastError: `Cloud runner sync failed: ${error}`
                });
                hasChanges = true;
            }
        }

        if (hasChanges) {
            this.renderActiveJobs();
        }
    }
}

// LLM-only Field Manager (simplified version)
class FieldManagerLLM {
    constructor() {
        this.fields = [];
        this.presets = {};
        this.currentDomain = '';
        this.lastResults = null;
    }

    generateFieldId() {
        return `field_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    maskWebhookUrl(url) {
        if (!url || url.length < 20) return url;

        // Show first 10 and last 6 characters with dots in between
        const start = url.substring(0, 10);
        const end = url.substring(url.length - 6);
        return `${start}...${end}`;
    }

    addField(data = {}) {
        const friendlyName = data.friendlyName || data.name || '';
        const baseSanitizedName = this.sanitizeFieldName(friendlyName);

        // Ensure unique sanitized name by adding incrementer if needed
        let sanitizedName = baseSanitizedName;
        let incrementer = 1;
        while (this.fields.some(f => f.name === sanitizedName)) {
            sanitizedName = `${baseSanitizedName}_${incrementer}`;
            incrementer++;
        }

        const field = {
            id: this.generateFieldId(),
            name: sanitizedName,  // This is the unique identifier used for LLM communication
            friendlyName: friendlyName,  // This is for display only
            description: data.description || '',
            result: null,
            probability: null,
            lastStatus: null,
            lastError: null,
            lastEventId: null,
            lastResultTime: null,
            isPending: false,
            webhookEnabled: data.webhookEnabled || false,
            webhookTrigger: data.webhookTrigger !== undefined ? data.webhookTrigger : true,
            webhookUrl: data.webhookUrl || '',
            webhookPayload: data.webhookPayload || '',
            webhookMinConfidence: data.webhookMinConfidence !== undefined ? data.webhookMinConfidence : 75
        };
        this.fields.push(field);
        return field;
    }

    sanitizeFieldName(friendlyName) {
        if (!friendlyName || !friendlyName.trim()) return 'unnamed_field';

        return friendlyName
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]/g, '_')  // Replace non-alphanumeric with underscores
            .replace(/^_+|_+$/g, '')     // Remove leading/trailing underscores
            .replace(/_+/g, '_')         // Replace multiple underscores with single
            || 'unnamed_field';
    }

    removeField(fieldId) {
        this.fields = this.fields.filter(f => f.id !== fieldId);
    }

    updateField(fieldId, updates) {
        const field = this.fields.find(f => f.id === fieldId);
        if (!field) return false;

        // If friendly name is being updated, regenerate the sanitized name
        if (updates.friendlyName !== undefined) {
            const baseSanitizedName = this.sanitizeFieldName(updates.friendlyName);

            // Ensure unique sanitized name by adding incrementer if needed
            let sanitizedName = baseSanitizedName;
            let incrementer = 1;
            while (this.fields.some(f => f.name === sanitizedName && f.id !== fieldId)) {
                sanitizedName = `${baseSanitizedName}_${incrementer}`;
                incrementer++;
            }

            updates.name = sanitizedName;
        }

        Object.assign(field, updates);
        return true;
    }

    getField(fieldId) {
        return this.fields.find(f => f.id === fieldId);
    }

    getFieldsForAPI() {
        return this.fields
            .filter(f => f.friendlyName && f.description)
            .map(f => ({
                name: f.name,  // Use the sanitized name for LLM communication
                criteria: f.description.trim()
            }));
    }

    markFieldsPending(eventId = null) {
        this.fields.forEach(field => {
            field.isPending = true;
            field.lastStatus = 'pending';
            field.lastEventId = eventId;
            field.lastError = null;
            field.lastResultTime = new Date().toISOString();
        });
    }

    updateResults(results, eventId = null) {
        // Handle responses with "evaluation" wrapper (newer format)
        let dataToProcess = results;
        if (results && results.evaluation && typeof results.evaluation === 'object') {
            dataToProcess = results.evaluation;
            console.log('FieldManager: Found evaluation wrapper, processing inner data');
        }

        this.fields.forEach(field => {
            // Skip if this field doesn't belong to this event
            if (eventId && field.lastEventId !== eventId) {
                return;
            }

            // Look for the result using the field's sanitized name (which is what LLM returns)
            const fieldResult = dataToProcess[field.name];

            if (fieldResult !== null && fieldResult !== undefined) {
                // Parse the result format: [boolean, probability] or {boolean: true, probability: 0.95} or {result: true, confidence: 0.95}
                if (Array.isArray(fieldResult) && fieldResult.length >= 2) {
                    field.result = fieldResult[0];
                    field.probability = fieldResult[1];
                } else if (typeof fieldResult === 'object' && fieldResult.result !== undefined) {
                    // NEW: Handle {result: boolean, confidence: number} format from Gemini and other LLMs
                    field.result = fieldResult.result;
                    field.probability = fieldResult.confidence || fieldResult.probability || null;
                } else if (typeof fieldResult === 'object' && fieldResult.boolean !== undefined) {
                    // Legacy: Handle {boolean: boolean, probability: number} format
                    field.result = fieldResult.boolean;
                    field.probability = fieldResult.probability || null;
                } else if (typeof fieldResult === 'boolean') {
                    field.result = fieldResult;
                    field.probability = null;
                }

                // Apply confidence threshold filtering for state snapshot
                field.filteredResult = this.applyConfidenceFilter(field.result, field.probability, field.webhookMinConfidence);

                // Update field status
                field.isPending = false;
                field.lastStatus = 'success';
                field.lastResponseTime = new Date().toISOString();
                field.lastError = null;
            }
        });
    }

    /**
     * Apply confidence threshold filtering
     * @param {boolean} result - Raw LLM result
     * @param {number} probability - Confidence score (0-1)
     * @param {number} threshold - Confidence threshold percentage (0-100)
     * @returns {boolean} Filtered result
     */
    applyConfidenceFilter(result, probability, threshold = 75) {
        if (result !== true) {
            return false; // FALSE results remain FALSE regardless of confidence
        }

        if (probability === null || probability === undefined) {
            return false; // No confidence data means we can't trust it
        }

        const confidencePercent = probability * 100;
        const minConfidence = threshold || 75;

        // Only TRUE results with sufficient confidence pass as TRUE
        return confidencePercent >= minConfidence;
    }

    markFieldsError(error, httpStatus = null, eventId = null) {
        this.fields.forEach(field => {
            if (field.lastEventId === eventId || eventId === null) {
                field.isPending = false;
                field.lastStatus = 'error';
                field.lastError = error;
                field.lastResultTime = new Date().toISOString();
                field.result = null;
                field.probability = null;
            }
        });
    }

    markFieldsCancelled(eventId = null) {
        this.fields.forEach(field => {
            if (field.isPending && (field.lastEventId === eventId || eventId === null)) {
                field.isPending = false;
                field.lastStatus = 'cancelled';
                field.lastError = 'Request cancelled';
                field.lastResultTime = new Date().toISOString();
            }
        });
    }

    savePreset(name) {
        if (!name || !name.trim()) {
            throw new Error('Please provide a preset name');
        }

        // Create clean preset data
        const presetData = {
            name: name.trim(),
            fields: this.fields.map(field => ({
                // Only save essential field configuration, not runtime state
                name: field.name,
                friendlyName: field.friendlyName,
                description: field.description,
                webhookEnabled: field.webhookEnabled,
                webhookTrigger: field.webhookTrigger,
                webhookUrl: field.webhookUrl,
                webhookPayload: field.webhookPayload,
                webhookMinConfidence: field.webhookMinConfidence
            })),
            timestamp: new Date().toISOString()
        };

        this.presets[name.trim()] = presetData;
        this.saveToStorage();

        console.log(`Saved preset "${name}" with ${presetData.fields.length} fields`);
        return true;
    }

    loadPreset(name) {
        const preset = this.presets[name];
        if (!preset || !preset.fields) return false;

        this.fields = preset.fields.map(fieldData => ({
            ...fieldData,
            id: this.generateFieldId(),
            result: null,
            probability: null,
            filteredResult: null,
            lastStatus: null,
            lastError: null,
            lastEventId: null,
            lastResultTime: null,
            isPending: false,
            // Add webhook properties for backwards compatibility
            webhookEnabled: fieldData.webhookEnabled || false,
            webhookTrigger: fieldData.webhookTrigger !== undefined ? fieldData.webhookTrigger : true,
            webhookUrl: fieldData.webhookUrl || '',
            webhookPayload: fieldData.webhookPayload || '',
            webhookMinConfidence: fieldData.webhookMinConfidence !== undefined ? fieldData.webhookMinConfidence : 75
        }));

        return true;
    }

    deletePreset(name) {
        if (this.presets[name]) {
            delete this.presets[name];
            return true;
        }
        return false;
    }

    getPresetNames() {
        return Object.keys(this.presets).sort();
    }

    async saveToStorage() {
        try {
            const domainKey = `fields_${this.currentDomain}`;
            const presetKey = `presets_${this.currentDomain}`;

            await Promise.all([
                chrome.storage.local.set({ [domainKey]: this.fields }),
                chrome.storage.local.set({ [presetKey]: this.presets })
            ]);

            console.log(`Saved ${this.fields.length} fields and ${Object.keys(this.presets).length} presets for domain: ${this.currentDomain}`);

        } catch (error) {
            console.error('Error saving to storage:', error);
            throw error;
        }
    }

    async loadFromStorage() {
        try {
            const domainKey = `fields_${this.currentDomain}`;
            const presetKey = `presets_${this.currentDomain}`;

            const [fieldsData, presetsData] = await Promise.all([
                chrome.storage.local.get([domainKey]),
                chrome.storage.local.get([presetKey])
            ]);

            // Load fields from storage
            const storedFields = fieldsData[domainKey] || [];
            console.log(`Loading ${storedFields.length} fields for domain:`, this.currentDomain);

            this.fields = storedFields.map(fieldData => ({
                ...fieldData,
                id: fieldData.id || this.generateFieldId(),
                // Ensure result and status fields exist (may have been updated by automatic captures)
                result: fieldData.result !== undefined ? fieldData.result : null,
                probability: fieldData.probability !== undefined ? fieldData.probability : null,
                filteredResult: fieldData.filteredResult !== undefined ? fieldData.filteredResult : null,
                lastStatus: fieldData.lastStatus || null,
                lastError: fieldData.lastError || null,
                lastEventId: fieldData.lastEventId || null,
                lastResultTime: fieldData.lastResponseTime || fieldData.lastResultTime || null,
                isPending: fieldData.isPending || false,
                // Ensure webhook properties exist for backwards compatibility
                webhookEnabled: fieldData.webhookEnabled || false,
                webhookTrigger: fieldData.webhookTrigger !== undefined ? fieldData.webhookTrigger : true,
                webhookUrl: fieldData.webhookUrl || '',
                webhookPayload: fieldData.webhookPayload || '',
                webhookMinConfidence: fieldData.webhookMinConfidence !== undefined ? fieldData.webhookMinConfidence : 75
            }));

            console.log(`Loaded field results:`, this.fields.map(f => ({
                name: f.name,
                result: f.result,
                probability: f.probability,
                lastStatus: f.lastStatus,
                lastEventId: f.lastEventId
            })));

            // Load presets from storage
            this.presets = presetsData[presetKey] || {};
            console.log(`Loaded ${Object.keys(this.presets).length} presets for domain:`, this.currentDomain);

            return { fieldsLoaded: this.fields.length, presetsLoaded: Object.keys(this.presets).length };

        } catch (error) {
            console.error('Error loading from storage:', error);
            this.fields = [];
            this.presets = {};
            return { fieldsLoaded: 0, presetsLoaded: 0, error: error.message };
        }
    }

    validateFields() {
        const errors = [];

        if (this.fields.length === 0) {
            errors.push('No fields configured');
        }

        this.fields.forEach((field, index) => {
            if (!field.friendlyName || !field.friendlyName.trim()) {
                errors.push(`Field ${index + 1}: Name is required`);
            }
            if (!field.description || !field.description.trim()) {
                errors.push(`Field ${index + 1}: Description is required`);
            }
        });

        return errors;
    }

    getSummary() {
        const validFields = this.fields.filter(f => f.friendlyName && f.description);
        const pendingFields = this.fields.filter(f => f.isPending);
        const completedFields = this.fields.filter(f => f.result !== null);
        const errorFields = this.fields.filter(f => f.lastStatus === 'error');

        return {
            total: this.fields.length,
            valid: validFields.length,
            pending: pendingFields.length,
            completed: completedFields.length,
            errors: errorFields.length,
            presets: Object.keys(this.presets).length
        };
    }

    /**
     * Get filtered state snapshot for previous evaluation context
     * Only includes fields that have been evaluated with sufficient confidence
     * @returns {Object} Filtered evaluation results for context
     */
    getFilteredStateSnapshot() {
        const snapshot = {};

        this.fields.forEach(field => {
            if (field.result !== null && field.probability !== null) {
                // Use the filtered result (confidence threshold applied)
                snapshot[field.name] = field.filteredResult;
            }
        });

        console.log('Generated filtered state snapshot:', snapshot);
        return snapshot;
    }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM loaded, initializing popup...');
    try {
        const popup = new CleanPopupController();
        await popup.initialize();

        console.log('Popup initialized successfully');
    } catch (error) {
        console.error('Failed to initialize popup:', error);
        document.body.innerHTML = '<div style="padding: 20px; color: red;">Failed to initialize popup. Check console for details.</div>';
    }
});

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CleanPopupController, FieldManagerLLM };
}
console.log('WebSophon popup script loaded'); 