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

            // 3. Initialize UI manager with field manager and set its elements
            const { UIManager } = await import('./components/UIManager.js');
            this.uiManager = new UIManager(this.fieldManager);
            this.uiManager.setElements(this.elements);

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

            // Populate models dynamically
            await this.populateLlmModels(this.elements.llmModel?.value);

            console.log('Popup controller initialized successfully');

        } catch (error) {
            console.error('Failed to initialize popup controller:', error);
            throw error;
        }
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
            cloudRunnerToggle: document.getElementById('cloudRunnerToggle')
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
                break;
            case 'fields':
                this.renderFields();
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
            const runnerEndpoint = url.replace(/\/$/, '');
            const testUrl = `${runnerEndpoint}/test`;

            const response = await fetch(testUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ testData: 'ping' })
            });

            const result = await response.json();

            if (response.ok && result.success) {
                this.showToast(`✓ ${result.message}`, 'success', statusEl);
            } else {
                throw new Error(result.error || `Server responded with status ${response.status}`);
            }
        } catch (error) {
            console.error('Cloud Runner test failed:', error);
            let errorMessage = error.message;
            if (errorMessage.includes('Failed to fetch')) {
                errorMessage = 'Connection failed. Check URL and CORS policy on the server.';
            }
            this.showToast(`✗ ${errorMessage}`, 'error', statusEl);
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
            console.log('=== Starting manual capture ===');

            // 1. Check if cloud runner is enabled
            if (this.elements.cloudRunnerToggle?.checked) {
                console.log('Cloud runner is enabled. Starting cloud capture flow.');
                await this.handleCloudCapture();
                return;
            }

            // 2. Validate domain consent for local capture
            if (!this.elements.consentToggle?.checked) {
                throw new Error('Please enable WebSophon for this domain first');
            }

            // 3. Get fields directly from FieldManager (original manual capture flow)
            const fieldsForAPI = this.fieldManager.getFieldsForAPI();

            // 4. Validate fields exist
            if (!fieldsForAPI || fieldsForAPI.length === 0) {
                throw new Error('No valid fields configured for this domain');
            }

            // 5. Mark all fields as pending atomically (UI management)
            const eventId = Date.now().toString();
            this.fieldManager.markFieldsPending(eventId);
            await this.fieldManager.saveToStorage();

            // 6. Re-render to show pending state
            this.renderFields();

            // 7. Show capture status
            this.showStatus('Starting local capture...', 'info');

            // 8. Send capture request using original manual flow (not shared preparation)
            const response = await this.sendCaptureRequest(fieldsForAPI, eventId, null);

            // 9. Handle response
            if (response.success) {
                this.showStatus('Local capture in progress...', 'info');
                console.log('Manual local capture initiated successfully');
            } else {
                throw new Error(response.error || 'Local capture failed');
            }

        } catch (error) {
            console.error('Manual capture failed:', error);

            // Mark fields as error atomically
            this.fieldManager.markFieldsError(error.message);
            await this.fieldManager.saveToStorage();
            this.renderFields();

            this.showError(error.message);
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
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            console.log('Popup received message:', request.action);

            switch (request.action) {
                case 'fieldResults':
                    console.log('Received field results for event:', request.eventId);
                    this.handleCaptureResults(request.results, request.eventId);
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

            return config;
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
                maxTokens: parseInt(this.elements.llmMaxTokens?.value) || 1000
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

            // Convert results to previous evaluation format
            const previousEvaluation = {};

            // Handle results from LLM response
            if (results && typeof results === 'object') {
                Object.keys(results).forEach(fieldName => {
                    if (fieldName !== 'reason' && Array.isArray(results[fieldName]) && results[fieldName].length >= 1) {
                        const result = results[fieldName][0]; // boolean
                        const confidence = results[fieldName].length > 1 ? results[fieldName][1] : 0.8;

                        previousEvaluation[fieldName] = {
                            result: result,
                            confidence: confidence,
                            timestamp: timestamp,
                            eventId: eventId
                        };
                    }
                });
            }

            if (Object.keys(previousEvaluation).length > 0) {
                await chrome.storage.local.set({ [storageKey]: previousEvaluation });
                console.log('Stored previous evaluation for domain', this.currentDomain, ':', previousEvaluation);
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

            // Get current tab
            const tabId = await this.getCurrentTabId();
            if (!tabId) {
                throw new Error('Could not get current tab');
            }

            if (intervalValue === 'manual') {
                // Stop automatic capture
                console.log('Stopping automatic capture');
                await this.sendMessageToBackground({
                    action: 'stopCapture',
                    tabId: tabId
                });
                this.showStatus('Automatic capture stopped', 'info');
            } else {
                // Validate domain consent and LLM config before starting
                if (!this.elements.consentToggle?.checked) {
                    // Reset to manual
                    this.elements.captureInterval.value = 'manual';
                    await chrome.storage.local.set({ [intervalKey]: 'manual' });
                    throw new Error('Please enable WebSophon for this domain first');
                }

                const llmConfig = await this.getLlmConfig();
                if (!llmConfig.apiUrl || !llmConfig.apiKey) {
                    // Reset to manual
                    this.elements.captureInterval.value = 'manual';
                    await chrome.storage.local.set({ [intervalKey]: 'manual' });
                    throw new Error('Please configure LLM API URL and API Key first');
                }

                // Start automatic capture
                const intervalSeconds = parseInt(intervalValue);
                console.log(`Starting automatic capture every ${intervalSeconds} seconds`);

                await this.sendMessageToBackground({
                    action: 'startCapture',
                    tabId: tabId,
                    domain: this.currentDomain,
                    interval: intervalSeconds
                });

                this.showStatus(`Automatic capture started (every ${this.formatInterval(intervalSeconds)})`, 'success');
            }

        } catch (error) {
            console.error('Error handling capture interval change:', error);
            this.showError(error.message);
        }
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
        this.fields.forEach(field => {
            // Skip if this field doesn't belong to this event
            if (eventId && field.lastEventId !== eventId) {
                return;
            }

            // Look for the result using the field's sanitized name (which is what LLM returns)
            const fieldResult = results[field.name];

            if (fieldResult !== null && fieldResult !== undefined) {
                // Parse the result format: [boolean, probability] or {boolean: true, probability: 0.95}
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
            }
        });
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