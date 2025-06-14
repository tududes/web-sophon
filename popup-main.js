// Clean LLM-only Popup Controller
// Uses FieldManagerLLM for proper state management

class CleanPopupController {
    constructor() {
        // Initialize field manager first
        this.fieldManager = new FieldManagerLLM();

        // Other instance variables
        this.currentDomain = '';
        this.currentTab = 'capture'; // Track current tab
        this.elements = {};
        this.historyManager = null;
        this.saveDebounceTimer = null;
    }

    async initialize() {
        try {
            // 1. Get current domain and display it
            this.currentDomain = await this.getCurrentDomain();
            this.displayCurrentDomain();

            // 2. Get DOM elements
            this.getDOMElements();

            // 3. Load data
            this.fieldManager.currentDomain = this.currentDomain;
            await this.fieldManager.loadFromStorage();

            // 4. Setup UI
            this.setupEventListeners();
            this.initializeTabSystem();
            this.setupMessageListener();

            // 5. Load settings and history manager
            await this.loadBasicSettings();
            await this.initializeHistoryManager();

            // 6. Load initial tab content
            this.switchTab('capture');

            console.log('Clean popup initialized successfully');

        } catch (error) {
            console.error('Failed to initialize popup:', error);
        }
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
            // Fields section
            fieldsContainer: document.getElementById('fieldsContainer'),
            addFieldBtn: document.getElementById('addFieldBtn'),
            presetSelector: document.getElementById('presetSelector'),
            savePresetBtn: document.getElementById('savePresetBtn'),
            deletePresetBtn: document.getElementById('deletePresetBtn'),

            // Capture section
            captureBtn: document.getElementById('captureBtn'),
            captureStatus: document.getElementById('captureStatus'),

            // Settings section
            consentToggle: document.getElementById('consentToggle'),
            captureInterval: document.getElementById('captureInterval'),

            // LLM Configuration
            llmApiUrl: document.getElementById('llmApiUrl'),
            llmApiKey: document.getElementById('llmApiKey'),
            llmModel: document.getElementById('llmModel'),
            llmTemperature: document.getElementById('llmTemperature'),
            llmMaxTokens: document.getElementById('llmMaxTokens'),
            testLlmConfig: document.getElementById('testLlmConfig'),
            testConfigStatus: document.getElementById('testConfigStatus'),

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
            fullPageCaptureToggle: document.getElementById('fullPageCaptureToggle')
        };
    }

    setupEventListeners() {
        // Tab switching
        document.querySelectorAll('[data-tab]').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const tabName = e.target.dataset.tab;
                this.switchTab(tabName);
            });
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
    }

    initializeTabSystem() {
        this.switchTab('capture');
    }

    switchTab(tabName) {
        console.log('Switching to tab:', tabName);

        // Track current tab
        this.currentTab = tabName;

        // Hide all tab panels
        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.style.display = 'none';
            panel.classList.remove('active');
        });

        // Remove active class from all tab buttons
        document.querySelectorAll('[data-tab]').forEach(tab => {
            tab.classList.remove('active');
        });

        // Show selected tab panel
        const tabPanel = document.getElementById(`${tabName}Content`);
        if (tabPanel) {
            tabPanel.style.display = 'block';
            tabPanel.classList.add('active');
            console.log('Showed tab panel:', `${tabName}Content`);
        } else {
            console.error('Tab panel not found:', `${tabName}Content`);
        }

        // Add active class to selected tab button
        const selectedTab = document.querySelector(`[data-tab="${tabName}"]`);
        if (selectedTab) {
            selectedTab.classList.add('active');
        }

        // Load tab-specific data
        this.handleTabSpecificLoading(tabName);
    }

    async handleTabSpecificLoading(tabName) {
        try {
            if (tabName === 'fields') {
                this.renderFields();
                this.renderPresets();
            } else if (tabName === 'history') {
                if (this.historyManager?.loadHistory) {
                    this.historyManager.loadHistory();
                }
            } else if (tabName === 'settings') {
                await this.loadKnownDomains();
            } else if (tabName === 'capture') {
                // No special loading needed for capture tab
            }
        } catch (error) {
            console.error(`Error loading tab ${tabName}:`, error);
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
            console.log(`Updating field ${fieldId}:`, updates);

            // 1. Update field state
            const success = this.fieldManager.updateField(fieldId, updates);
            if (!success) {
                console.warn('Field not found:', fieldId);
                return;
            }

            // 2. Save state atomically
            this.debouncedSave();

            // 3. Update field display if needed
            this.updateFieldDisplay(fieldId);

        } catch (error) {
            console.error('Error updating field:', error);
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

            // 1. Validate domain consent
            if (!this.elements.consentToggle?.checked) {
                throw new Error('Please enable WebSophon for this domain first');
            }

            // 2. Validate LLM configuration
            const llmConfig = await this.getLlmConfig();
            if (!llmConfig.apiUrl || !llmConfig.apiKey) {
                throw new Error('Please configure LLM API URL and API Key first');
            }

            // 3. Validate fields
            const validationErrors = this.fieldManager.validateFields();
            if (validationErrors.length > 0) {
                throw new Error(validationErrors[0]);
            }

            // 4. Mark all fields as pending atomically
            const eventId = Date.now().toString();
            this.fieldManager.markFieldsPending(eventId);
            await this.fieldManager.saveToStorage();

            // 5. Re-render to show pending state
            this.renderFields();

            // 6. Show capture status
            this.showStatus('Starting capture...', 'info');

            // 7. Send capture request with clean field data
            const fieldsForAPI = this.fieldManager.getFieldsForAPI();
            console.log('Sending fields to API:', fieldsForAPI);

            const response = await this.sendCaptureRequest(fieldsForAPI, eventId, llmConfig);

            // 8. Handle response
            if (response.success) {
                this.showStatus('Capture in progress...', 'info');
                console.log('Capture initiated successfully');
            } else {
                throw new Error(response.error || 'Capture failed');
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

    async sendCaptureRequest(fields, eventId, llmConfig) {
        try {
            const message = {
                action: 'captureLLM',
                tabId: await this.getCurrentTabId(),
                domain: this.currentDomain,
                fields: fields,
                eventId: eventId,
                llmConfig: llmConfig,
                refreshPage: this.elements.refreshPageToggle?.checked || false,
                captureDelay: parseInt(this.elements.captureDelay?.value || '0'),
                fullPageCapture: this.elements.fullPageCaptureToggle?.checked || false
            };

            const response = await this.sendMessageToBackground(message);
            return response;

        } catch (error) {
            console.error('Error sending capture request:', error);
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
        try {
            console.log('=== CAPTURE RESULTS DEBUG START ===');
            console.log('Raw results received:', results);
            console.log('Event ID:', eventId);
            console.log('Current fields before update:', this.fieldManager.fields.map(f => ({
                id: f.id,
                name: f.name,
                friendlyName: f.friendlyName,
                isPending: f.isPending,
                lastEventId: f.lastEventId
            })));

            // The LLMService sends results in this format:
            // results = raw LLM response like { "field_name": [true, 0.95], "reason": "..." }
            // We need to format it as { fields: { "field_name": [true, 0.95] } }

            let formattedResults;
            if (results && typeof results === 'object') {
                // Check if results already has the expected structure
                if (results.fields) {
                    formattedResults = results;
                    console.log('Results already have .fields structure');
                } else {
                    // Convert raw LLM response to expected format
                    const fields = {};
                    Object.keys(results).forEach(key => {
                        // Skip non-field properties like 'reason', 'timestamp', etc.
                        if (key !== 'reason' && key !== 'timestamp' && key !== 'url' &&
                            key !== 'domain' && key !== 'screenshot' && !key.startsWith('_')) {
                            fields[key] = results[key];
                            console.log(`Extracted field result: ${key} = ${JSON.stringify(results[key])}`);
                        }
                    });
                    formattedResults = { fields };
                    console.log('Converted raw results to structured format');
                }
            } else {
                console.warn('Invalid results format, using empty fields');
                formattedResults = { fields: {} };
            }

            console.log('Final formatted results for FieldManager:', formattedResults);

            // Update field manager with results
            const beforeUpdateFields = JSON.parse(JSON.stringify(this.fieldManager.fields));
            this.fieldManager.updateResults(formattedResults, eventId);
            const afterUpdateFields = this.fieldManager.fields;

            console.log('Fields comparison:');
            beforeUpdateFields.forEach((beforeField, index) => {
                const afterField = afterUpdateFields[index];
                if (afterField) {
                    console.log(`Field ${beforeField.friendlyName}:`, {
                        before: {
                            isPending: beforeField.isPending,
                            result: beforeField.result,
                            lastStatus: beforeField.lastStatus
                        },
                        after: {
                            isPending: afterField.isPending,
                            result: afterField.result,
                            lastStatus: afterField.lastStatus
                        },
                        changed: beforeField.isPending !== afterField.isPending ||
                            beforeField.result !== afterField.result ||
                            beforeField.lastStatus !== afterField.lastStatus
                    });
                }
            });

            // Save and re-render
            console.log('Saving to storage and re-rendering...');
            this.fieldManager.saveToStorage();
            this.renderFields();
            console.log('Fields re-rendered');

            // Update Known Domains display if we're on the settings tab
            if (this.currentTab === 'settings') {
                this.loadKnownDomains();
            }

            this.showStatus('Capture completed successfully', 'success');
            console.log('=== CAPTURE RESULTS DEBUG END ===');

        } catch (error) {
            console.error('Error handling capture results:', error);
            this.fieldManager.markFieldsError(error.message, null, eventId);
            this.fieldManager.saveToStorage();
            this.renderFields();
            this.showError(`Error processing results: ${error.message}`);
        }
    }

    // === UI RENDERING (State → DOM) ===

    renderFields() {
        if (!this.elements.fieldsContainer) return;

        console.log('Rendering fields from state:', this.fieldManager.fields.length);

        // Clear container
        this.elements.fieldsContainer.innerHTML = '';

        // Render each field from current state
        this.fieldManager.fields.forEach(field => {
            this.renderField(field.id);
        });
    }

    renderField(fieldId) {
        const field = this.fieldManager.getField(fieldId);
        if (!field) return;

        // Helper function to get domain from URL
        const getDomainFromUrl = (url) => {
            if (!url) return '';
            try {
                const urlObj = new URL(url);
                return urlObj.hostname;
            } catch {
                return url; // Return original if not a valid URL
            }
        };

        // Check if URL should show domain only (has been saved before)
        const showDomainOnly = field.webhookUrl && field.webhookUrl.startsWith('http');
        const displayUrl = showDomainOnly ? getDomainFromUrl(field.webhookUrl) : field.webhookUrl;

        const fieldHtml = `
            <div class="field-item" data-field-id="${fieldId}">
                <div class="field-header">
                    <input type="text" 
                           class="field-name-input" 
                           placeholder="Field Name" 
                           value="${this.escapeHtml(field.friendlyName || '')}"
                           data-field-id="${fieldId}">
                    
                    <div class="field-status">
                        ${this.renderFieldStatus(field)}
                    </div>
                    
                    <button class="remove-field-btn" data-field-id="${fieldId}" title="Remove field">
                        ✕
                    </button>
                </div>
                
                <textarea class="field-description" 
                          placeholder="Describe what to evaluate..." 
                          data-field-id="${fieldId}">${this.escapeHtml(field.description || '')}</textarea>
                
                <!-- Webhook Toggle (just below field) -->
                <div class="webhook-toggle-section">
                    <label class="webhook-toggle-switch">
                        <input type="checkbox" class="webhook-enabled" 
                               data-field-id="${fieldId}" 
                               ${field.webhookEnabled ? 'checked' : ''}>
                        <span class="webhook-slider"></span>
                        <span class="webhook-label">🔗 Webhook Integration</span>
                    </label>
                </div>
                
                <!-- Webhook Configuration (expanded when enabled) -->
                <div class="webhook-config-panel ${field.webhookEnabled ? 'webhook-panel-visible' : 'webhook-panel-hidden'}">
                    
                    <div class="webhook-setting-row">
                        <label class="webhook-setting-label">Fire webhook when result is:</label>
                        <select class="webhook-trigger-select" data-field-id="${fieldId}">
                            <option value="true" ${(field.webhookTrigger === true || field.webhookTrigger === undefined) ? 'selected' : ''}>TRUE</option>
                            <option value="false" ${field.webhookTrigger === false ? 'selected' : ''}>FALSE</option>
                        </select>
                    </div>
                    
                    <div class="webhook-setting-row">
                        <label class="webhook-setting-label">Minimum Confidence: <span class="confidence-value">${field.webhookMinConfidence || 75}%</span></label>
                        <input type="range" 
                               class="webhook-confidence-slider" 
                               min="0" max="100" step="5"
                               value="${field.webhookMinConfidence || 75}"
                               data-field-id="${fieldId}">
                    </div>
                    
                    <div class="webhook-setting-row">
                        <label class="webhook-setting-label">Webhook URL:</label>
                        <div class="webhook-url-container">
                            <input type="text" 
                                   class="webhook-url-input ${showDomainOnly ? 'url-masked' : ''}" 
                                   placeholder="https://discord.com/api/webhooks/..." 
                                   value="${this.escapeHtml(displayUrl)}"
                                   data-field-id="${fieldId}"
                                   data-full-url="${this.escapeHtml(field.webhookUrl || '')}">
                            ${showDomainOnly ? `
                                <button type="button" class="url-visibility-toggle" data-field-id="${fieldId}" title="Show/hide full URL">
                                    👁️
                                </button>
                            ` : ''}
                        </div>
                    </div>
                    
                    <div class="webhook-setting-row webhook-payload-row">
                        <label class="webhook-setting-label">Payload (JSON):</label>
                        <textarea class="webhook-payload-input" 
                                  placeholder='{"content": "Field **${field.friendlyName || 'FieldName'}** result: **{{result}}** ({{confidence}}% confidence)\\nDomain: {{domain}} | Time: {{timestamp}}"}'
                                  data-field-id="${fieldId}">${this.escapeHtml(field.webhookPayload || '')}</textarea>
                        <div class="webhook-variables-help">
                            <small>Available variables: {{fieldName}}, {{result}}, {{confidence}}, {{timestamp}}, {{domain}}</small>
                        </div>
                    </div>
                    
                </div>
            </div>
        `;

        const container = this.elements.fieldsContainer;
        const existingField = container.querySelector(`[data-field-id="${fieldId}"]`);

        if (existingField) {
            existingField.outerHTML = fieldHtml;
        } else {
            container.insertAdjacentHTML('beforeend', fieldHtml);
        }

        this.setupFieldEventHandlers(fieldId);
    }

    renderFieldStatus(field) {
        if (field.isPending) {
            return '<span class="status pending">⏳ Pending</span>';
        }

        if (field.lastStatus === 'error') {
            const errorMsg = field.lastError ? ` (${field.lastError})` : '';
            return `<span class="status error" title="Error${errorMsg}">❌ Error</span>`;
        }

        if (field.result !== null) {
            const percentage = field.probability ? ` (${(field.probability * 100).toFixed(0)}%)` : '';
            const statusClass = field.result ? 'true' : 'false';
            const statusText = field.result ? 'TRUE' : 'FALSE';
            return `<span class="status ${statusClass}" title="Click to view in history">${statusText}${percentage}</span>`;
        }

        return '<span class="status none">No results yet</span>';
    }

    updateFieldDisplay(fieldId) {
        const field = this.fieldManager.getField(fieldId);
        if (!field) return;

        // Update status display
        const statusEl = document.querySelector(`.field-status[data-field-id="${fieldId}"]`);
        if (statusEl) {
            statusEl.innerHTML = this.renderFieldStatus(field);
        }
    }

    // === EVENT HANDLERS (ID-Based) ===

    setupFieldEventHandlers(fieldId) {
        // Name input
        const nameInput = document.querySelector(`input.field-name-input[data-field-id="${fieldId}"]`);
        nameInput?.addEventListener('input', (e) => {
            this.updateField(fieldId, {
                friendlyName: e.target.value
            });
        });

        // Description input  
        const descInput = document.querySelector(`textarea.field-description[data-field-id="${fieldId}"]`);
        descInput?.addEventListener('input', (e) => {
            this.updateField(fieldId, {
                description: e.target.value
            });
        });

        // Remove button
        const removeBtn = document.querySelector(`button.remove-field-btn[data-field-id="${fieldId}"]`);
        removeBtn?.addEventListener('click', () => {
            this.removeField(fieldId);
        });

        // Status click (for history navigation)
        const statusEl = document.querySelector(`.field-status[data-field-id="${fieldId}"]`);
        statusEl?.addEventListener('click', () => {
            const field = this.fieldManager.getField(fieldId);
            if (field?.lastEventId) {
                this.navigateToHistoryEvent(field.lastEventId);
            }
        });

        // Webhook controls
        const webhookEnabled = document.querySelector(`input.webhook-enabled[data-field-id="${fieldId}"]`);
        webhookEnabled?.addEventListener('change', (e) => {
            this.updateField(fieldId, {
                webhookEnabled: e.target.checked
            });
            // Show/hide webhook config
            const config = document.querySelector(`.field-item[data-field-id="${fieldId}"] .webhook-config-panel`);
            if (config) {
                config.className = `webhook-config-panel ${e.target.checked ? 'webhook-panel-visible' : 'webhook-panel-hidden'}`;
            }
        });

        const webhookTrigger = document.querySelector(`select.webhook-trigger-select[data-field-id="${fieldId}"]`);
        webhookTrigger?.addEventListener('change', (e) => {
            this.updateField(fieldId, {
                webhookTrigger: e.target.value === 'true'
            });
        });

        const webhookUrl = document.querySelector(`input.webhook-url-input[data-field-id="${fieldId}"]`);
        webhookUrl?.addEventListener('input', (e) => {
            this.updateField(fieldId, {
                webhookUrl: e.target.value
            });
        });

        // URL visibility toggle
        const urlVisibilityToggle = document.querySelector(`button.url-visibility-toggle[data-field-id="${fieldId}"]`);
        urlVisibilityToggle?.addEventListener('click', (e) => {
            e.preventDefault();
            const urlInput = document.querySelector(`input.webhook-url-input[data-field-id="${fieldId}"]`);
            if (urlInput) {
                const isCurrentlyMasked = urlInput.classList.contains('url-masked');
                if (isCurrentlyMasked) {
                    // Show full URL
                    urlInput.value = urlInput.dataset.fullUrl || '';
                    urlInput.classList.remove('url-masked');
                    e.target.textContent = '🙈';
                } else {
                    // Show domain only
                    const fullUrl = urlInput.value;
                    urlInput.dataset.fullUrl = fullUrl;
                    try {
                        const urlObj = new URL(fullUrl);
                        urlInput.value = urlObj.hostname;
                    } catch {
                        // If not a valid URL, keep as is
                    }
                    urlInput.classList.add('url-masked');
                    e.target.textContent = '👁️';
                }
            }
        });

        const webhookPayload = document.querySelector(`textarea.webhook-payload-input[data-field-id="${fieldId}"]`);
        webhookPayload?.addEventListener('input', (e) => {
            this.updateField(fieldId, {
                webhookPayload: e.target.value
            });
        });

        // Webhook minimum confidence slider
        const webhookMinConfidenceSlider = document.querySelector(`input.webhook-confidence-slider[data-field-id="${fieldId}"]`);
        webhookMinConfidenceSlider?.addEventListener('input', (e) => {
            const confidence = parseInt(e.target.value);
            this.updateField(fieldId, {
                webhookMinConfidence: confidence
            });
            // Update the displayed value
            const valueDisplay = document.querySelector(`.field-item[data-field-id="${fieldId}"] .confidence-value`);
            if (valueDisplay) {
                valueDisplay.textContent = `${confidence}%`;
            }
        });
    }

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
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            console.log('Received message:', message);

            // Handle both 'action' and 'type' properties for compatibility
            const messageType = message.type || message.action;

            switch (messageType) {
                case 'captureComplete':
                case 'captureResults':
                    console.log('Processing capture results:', message);
                    this.handleCaptureResults(message.results, message.eventId);

                    // Reload history to show new event
                    if (this.historyManager?.loadHistory) {
                        this.historyManager.loadHistory();
                    }
                    break;

                case 'captureError':
                    this.fieldManager.markFieldsError(
                        message.error,
                        message.httpStatus,
                        message.eventId
                    );
                    this.fieldManager.saveToStorage();
                    this.renderFields();
                    this.showError(`Capture failed: ${message.error}`);
                    break;

                case 'captureCancelled':
                    this.fieldManager.markFieldsCancelled(message.eventId);
                    this.fieldManager.saveToStorage();
                    this.renderFields();
                    this.showStatus('Capture cancelled', 'warning');
                    break;

                default:
                    console.warn('Unknown message type:', messageType, 'Full message:', message);
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

            this.fieldManager.saveToStorage();
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

    async loadBasicSettings() {
        try {
            const keys = [
                `consent_${this.currentDomain}`,
                `interval_${this.currentDomain}`,
                'llmConfig_global'
            ];

            const data = await chrome.storage.local.get(keys);

            if (this.elements.consentToggle) {
                this.elements.consentToggle.checked = data[`consent_${this.currentDomain}`] || false;
            }

            if (this.elements.captureInterval) {
                this.elements.captureInterval.value = data[`interval_${this.currentDomain}`] || 'manual';
            }

            // LLM configuration (global)
            const llmConfig = data.llmConfig_global || {};
            if (this.elements.llmApiUrl) {
                this.elements.llmApiUrl.value = llmConfig.apiUrl || '';
            }
            if (this.elements.llmApiKey) {
                this.elements.llmApiKey.value = llmConfig.apiKey || '';
            }
            if (this.elements.llmModel) {
                this.elements.llmModel.value = llmConfig.model || 'opengvlab/internvl3-14b:free';
            }

            // Load theme
            await this.loadTheme();

        } catch (error) {
            console.error('Failed to load settings:', error);
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
                model: this.elements.llmModel?.value || 'opengvlab/internvl3-14b:free',
                temperature: parseFloat(this.elements.llmTemperature?.value) || 0.3,
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

    async testLlmConfiguration() {
        console.log('Testing LLM configuration...');

        if (this.elements.testConfigStatus) {
            this.elements.testConfigStatus.textContent = 'Testing...';
            this.elements.testConfigStatus.className = 'status-pending';
        }

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
                if (this.elements.testConfigStatus) {
                    this.elements.testConfigStatus.textContent = '✓ Configuration valid';
                    this.elements.testConfigStatus.className = 'status-success';
                }
                console.log('LLM test successful');
            } else {
                throw new Error(response?.error || 'Test failed');
            }
        } catch (error) {
            console.error('LLM test failed:', error);
            if (this.elements.testConfigStatus) {
                this.elements.testConfigStatus.textContent = `✗ ${error.message}`;
                this.elements.testConfigStatus.className = 'status-error';
            }
        }
    }

    // === HISTORY ===

    async initializeHistoryManager() {
        try {
            console.log('Initializing history manager...');
            console.log('window.HistoryManager available:', !!window.HistoryManager);
            console.log('historyContainer element:', !!this.elements.historyContainer);

            if (window.HistoryManager) {
                this.historyManager = new window.HistoryManager();
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
        console.log(`Status (${type}):`, message);

        if (this.elements.captureStatus) {
            this.elements.captureStatus.textContent = message;
            this.elements.captureStatus.className = `status-message ${type}`;

            setTimeout(() => {
                if (this.elements.captureStatus.textContent === message) {
                    this.elements.captureStatus.textContent = '';
                    this.elements.captureStatus.className = 'status-message';
                }
            }, 5000);
        }
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
                key.startsWith('consent_') || key.startsWith('interval_') || key.startsWith('fields_')
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

                    // Get last run information from history
                    const lastRunInfo = await this.getDomainLastRun(domain);

                    const domainHtml = `
                        <div class="domain-item ${isCurrentDomain ? 'current-domain-item' : ''}" data-domain="${domain}">
                            <div class="domain-header">
                                <div class="domain-name-section">
                                    <div class="domain-name">
                                        ${domain}
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
                        </div>
                    `;

                    this.elements.domainsContainer.insertAdjacentHTML('beforeend', domainHtml);
                }

                // Add event listeners for delete buttons
                this.setupDomainDeleteListeners();
            }

            console.log(`Loaded ${domains.size} known domains`);
        } catch (error) {
            console.error('Failed to load known domains:', error);
            if (this.elements.domainsContainer) {
                this.elements.domainsContainer.innerHTML = '<p class="no-domains">Error loading domains</p>';
            }
        }
    }

    async getDomainLastRun(domain) {
        try {
            // Get history from storage
            const { captureHistory = [] } = await chrome.storage.local.get(['captureHistory']);

            // Filter events for this domain
            const domainEvents = captureHistory.filter(event => event.domain === domain);

            if (domainEvents.length === 0) {
                return {
                    display: 'Never',
                    never: true,
                    totalEvents: 0
                };
            }

            // Sort by timestamp (newest first)
            domainEvents.sort((a, b) => b.timestamp - a.timestamp);

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

    setupDomainDeleteListeners() {
        const deleteButtons = this.elements.domainsContainer.querySelectorAll('.domain-delete-btn');

        deleteButtons.forEach(button => {
            button.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();

                const domain = button.dataset.domain;

                // Confirm deletion
                const confirmMessage = `Delete all WebSophon settings for "${domain}"?\n\nThis will remove:\n• Domain consent settings\n• Capture interval\n• Field configurations\n• History data\n\nThis action cannot be undone.`;

                if (confirm(confirmMessage)) {
                    await this.deleteDomainSettings(domain);
                }
            });
        });
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
            const { captureHistory = [] } = await chrome.storage.local.get(['captureHistory']);
            const filteredHistory = captureHistory.filter(event => event.domain !== domain);

            if (filteredHistory.length !== captureHistory.length) {
                await chrome.storage.local.set({ captureHistory: filteredHistory });
                console.log(`Removed ${captureHistory.length - filteredHistory.length} history events for domain`);
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
        const field = {
            id: this.generateFieldId(),
            name: this.sanitizeFieldName(data.friendlyName || data.name || ''),
            friendlyName: data.friendlyName || data.name || '',
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
        if (!friendlyName) return 'unnamed_field';
        return friendlyName.toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
            .replace(/^_+|_+$/g, '')
            .replace(/_+/g, '_') || 'unnamed_field';
    }

    removeField(fieldId) {
        this.fields = this.fields.filter(f => f.id !== fieldId);
    }

    updateField(fieldId, updates) {
        const field = this.fields.find(f => f.id === fieldId);
        if (!field) return false;

        Object.assign(field, updates);

        if (updates.name || updates.friendlyName) {
            field.name = this.sanitizeFieldName(field.friendlyName || field.name);
        }

        return true;
    }

    getField(fieldId) {
        return this.fields.find(f => f.id === fieldId);
    }

    getFieldsForAPI() {
        return this.fields
            .filter(f => f.friendlyName && f.description)
            .map(f => ({
                name: f.name,
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
        if (!results || !results.fields) {
            console.warn('Invalid results format:', results);
            return;
        }

        console.log('=== UpdateResults Debug ===');
        console.log('Results fields:', results.fields);
        console.log('Current fields in manager:', this.fields.map(f => ({
            id: f.id,
            name: f.name,
            friendlyName: f.friendlyName,
            isPending: f.isPending
        })));

        // Track which fields were updated
        const updatedFields = [];
        const missingFields = [];

        this.fields.forEach(field => {
            console.log(`Processing field: ${field.friendlyName} (${field.name})`);

            const result = results.fields[field.name];
            if (result !== undefined) {
                let resultValue = null;
                let probabilityValue = null;

                if (Array.isArray(result) && result.length >= 2) {
                    resultValue = result[0];
                    probabilityValue = result[1];
                } else if (typeof result === 'object' && result !== null) {
                    resultValue = result.boolean !== undefined ? result.boolean : result.result;
                    probabilityValue = result.probability;
                } else {
                    resultValue = result;
                }

                // Update field properties
                field.result = resultValue;
                field.probability = probabilityValue;
                field.lastStatus = 'success';
                field.lastError = null;
                field.isPending = false;
                field.lastEventId = eventId;
                field.lastResultTime = new Date().toISOString();

                updatedFields.push(field.name);

                console.log(`✓ Updated field "${field.friendlyName}" (${field.name}):`, {
                    result: resultValue,
                    probability: probabilityValue,
                    eventId: eventId
                });
            } else {
                // Field was pending but no result received
                if (field.isPending) {
                    field.isPending = false;
                    field.lastStatus = 'error';
                    field.lastError = 'No result received';
                    field.lastResultTime = new Date().toISOString();
                }
                missingFields.push(field.name);
                console.log(`✗ No result for field "${field.friendlyName}" (${field.name})`);
            }
        });

        console.log('Updated fields:', updatedFields);
        console.log('Missing fields:', missingFields);
        console.log('=== End UpdateResults Debug ===');

        this.lastResults = results;
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
        if (!name || !name.trim()) return false;

        const presetFields = this.fields.map(field => ({
            id: field.id,
            name: field.name,
            friendlyName: field.friendlyName,
            description: field.description
        }));

        this.presets[name.trim()] = {
            name: name.trim(),
            fields: presetFields,
            created: new Date().toISOString(),
            domain: this.currentDomain
        };

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
            const updates = {
                [domainKey]: this.fields,
                fieldPresets: this.presets
            };

            await chrome.storage.local.set(updates);
            console.log(`Saved ${this.fields.length} fields for domain: ${this.currentDomain}`);
        } catch (error) {
            console.error('Error saving to storage:', error);
            throw error;
        }
    }

    async loadFromStorage() {
        try {
            const domainKey = `fields_${this.currentDomain}`;
            const data = await chrome.storage.local.get([domainKey, 'fieldPresets']);

            this.fields = data[domainKey] || [];
            this.presets = data.fieldPresets || {};

            console.log(`Loaded ${this.fields.length} fields for domain: ${this.currentDomain}`);

            // Ensure all fields have required properties
            this.fields = this.fields.map(field => ({
                id: field.id || this.generateFieldId(),
                name: field.name || this.sanitizeFieldName(field.friendlyName || ''),
                friendlyName: field.friendlyName || field.name || '',
                description: field.description || '',
                result: field.result || null,
                probability: field.probability || null,
                lastStatus: field.lastStatus || null,
                lastError: field.lastError || null,
                lastEventId: field.lastEventId || null,
                lastResultTime: field.lastResultTime || null,
                isPending: field.isPending || false,
                // Add webhook properties for backwards compatibility
                webhookEnabled: field.webhookEnabled || false,
                webhookTrigger: field.webhookTrigger !== undefined ? field.webhookTrigger : true,
                webhookUrl: field.webhookUrl || '',
                webhookPayload: field.webhookPayload || '',
                webhookMinConfidence: field.webhookMinConfidence !== undefined ? field.webhookMinConfidence : 75
            }));

        } catch (error) {
            console.error('Error loading from storage:', error);
            this.fields = [];
            this.presets = {};
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

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM loaded, starting clean popup...');
    const popup = new CleanPopupController();
    window.popupController = popup;

    // Add debug methods to window for console access
    window.debugFields = () => popup.debugFieldStates();
    window.debugFieldManager = () => popup.fieldManager;

    await popup.initialize();
});

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CleanPopupController, FieldManagerLLM };
}
console.log('WebSophon popup script loaded'); 