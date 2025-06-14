// Simplified WebSophon Popup - Basic functionality first
console.log('Starting WebSophon popup...');

// Basic popup functionality without complex architecture
class SimplePopupController {
    constructor() {
        this.elements = {};
        this.currentDomain = null;
        this.currentTabId = null;
        this.historyManager = null;
        this.saveTimeout = null; // Add debounce timeout for saves
    }

    async initialize() {
        try {
            console.log('Initializing SimplePopupController...');

            // Get DOM elements FIRST
            this.getDOMElements();

            // Then get current tab (so elements are available for updating)
            await this.getCurrentTab();

            // Set up event listeners
            this.setupEventListeners();

            // Load basic settings
            await this.loadBasicSettings();

            // Load field state after domain is set
            await this.loadFieldsState();

            // Load presets into dropdown
            await this.loadPresets();

            // Load known domains
            await this.loadKnownDomains();

            // Initialize theme
            this.initializeTheme();

            // Initialize history manager
            await this.initializeHistoryManager();

            // Set up history event listeners
            this.setupHistoryEventListeners();

            // Test history integration
            this.testHistoryIntegration();

            console.log('SimplePopupController initialized successfully');
        } catch (error) {
            console.error('Failed to initialize SimplePopupController:', error);
        }
    }

    getDOMElements() {
        const elementMap = {
            currentDomain: 'current-domain',
            webhookUrl: 'webhook-url',
            llmModeToggle: 'llm-mode-toggle',
            llmConfigSection: 'llm-config-section',
            llmApiUrl: 'llm-api-url',
            llmApiKey: 'llm-api-key',
            llmModel: 'llm-model',
            llmCustomModel: 'llm-custom-model',
            customModelGroup: 'custom-model-group',
            llmTemperature: 'llm-temperature',
            llmMaxTokens: 'llm-max-tokens',
            captureInterval: 'capture-interval',
            refreshPageToggle: 'refresh-page-toggle',
            captureDelay: 'capture-delay',
            consentToggle: 'consent-toggle',
            status: 'status',
            captureNow: 'capture-now',
            themeToggle: 'theme-toggle',
            addFieldBtn: 'add-field-btn',
            fieldsContainer: 'fields-container',
            presetSelector: 'preset-selector',
            savePresetBtn: 'save-preset-btn',
            deletePresetBtn: 'delete-preset-btn',
            // Known domains
            domainsContainer: 'domains-container',
            // History elements
            historyContainer: 'history-container',
            showTrueOnly: 'show-true-only',
            clearHistoryBtn: 'clear-history-btn',
            testEventsBtn: 'test-events-btn',
            // Field status
            fieldStatus: 'field-status'
        };

        for (const [key, id] of Object.entries(elementMap)) {
            const element = document.getElementById(id);
            if (element) {
                this.elements[key] = element;
                console.log(`Found element: ${key} (${id})`);
            } else {
                console.warn(`Element not found: ${key} (${id})`);
            }
        }
    }

    async getCurrentTab() {
        try {
            console.log('Getting current tab...');
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (tab && tab.url) {
                const url = new URL(tab.url);
                this.currentDomain = url.hostname;
                this.currentTabId = tab.id;

                console.log('Current domain:', this.currentDomain);

                if (this.elements.currentDomain) {
                    this.elements.currentDomain.textContent = this.currentDomain;
                }
            } else {
                throw new Error('No tab found');
            }
        } catch (error) {
            console.error('Failed to get current tab:', error);
            if (this.elements.currentDomain) {
                this.elements.currentDomain.textContent = 'Unable to detect domain';
            }
        }
    }

    setupEventListeners() {
        console.log('Setting up event listeners...');

        // Theme toggle
        if (this.elements.themeToggle) {
            this.elements.themeToggle.addEventListener('click', () => {
                console.log('Theme toggle clicked');
                this.toggleTheme();
            });
            console.log('Theme toggle listener added');
        }

        // Webhook URL
        if (this.elements.webhookUrl) {
            this.elements.webhookUrl.addEventListener('change', async () => {
                const webhookUrl = this.elements.webhookUrl.value.trim();
                if (webhookUrl) {
                    await this.saveWebhookUrl(webhookUrl);
                    this.showStatus('Webhook URL saved', 'success');
                }
            });
        }

        // LLM Mode Toggle
        if (this.elements.llmModeToggle) {
            this.elements.llmModeToggle.addEventListener('change', async () => {
                const isLlmMode = this.elements.llmModeToggle.checked;
                await this.saveLlmMode(isLlmMode);
                this.updateLlmModeUI();
                this.showStatus(`${isLlmMode ? 'LLM' : 'Webhook'} mode enabled`, 'success');
            });
        }

        // LLM Configuration inputs
        if (this.elements.llmApiUrl) {
            this.elements.llmApiUrl.addEventListener('change', async () => {
                const apiUrl = this.elements.llmApiUrl.value.trim();
                await this.saveLlmConfig({ apiUrl });
                this.showStatus('LLM API URL saved', 'success');
            });
        }

        if (this.elements.llmApiKey) {
            this.elements.llmApiKey.addEventListener('change', async () => {
                const apiKey = this.elements.llmApiKey.value.trim();
                await this.saveLlmConfig({ apiKey });
                this.showStatus('LLM API Key saved', 'success');
            });
        }

        if (this.elements.llmModel) {
            this.elements.llmModel.addEventListener('change', async () => {
                const model = this.elements.llmModel.value;

                // Show/hide custom model input based on selection
                if (model === 'custom') {
                    if (this.elements.customModelGroup) {
                        this.elements.customModelGroup.style.display = 'block';
                    }
                    // Don't save the 'custom' value, wait for custom input
                } else {
                    if (this.elements.customModelGroup) {
                        this.elements.customModelGroup.style.display = 'none';
                    }
                    // Clear custom model value when using preset
                    await this.saveLlmConfig({ model, customModel: '' });
                    this.showStatus('LLM Model saved', 'success');
                }
            });
        }

        if (this.elements.llmCustomModel) {
            this.elements.llmCustomModel.addEventListener('change', async () => {
                const customModel = this.elements.llmCustomModel.value.trim();
                if (customModel) {
                    await this.saveLlmConfig({ model: 'custom', customModel });
                    this.showStatus('Custom LLM Model saved', 'success');
                }
            });
        }

        if (this.elements.llmTemperature) {
            this.elements.llmTemperature.addEventListener('change', async () => {
                const temperature = parseFloat(this.elements.llmTemperature.value);
                await this.saveLlmConfig({ temperature });
                this.showStatus('LLM Temperature saved', 'success');
            });
        }

        if (this.elements.llmMaxTokens) {
            this.elements.llmMaxTokens.addEventListener('change', async () => {
                const maxTokens = parseInt(this.elements.llmMaxTokens.value);
                await this.saveLlmConfig({ maxTokens });
                this.showStatus('LLM Max Tokens saved', 'success');
            });
        }

        // Interval change
        if (this.elements.captureInterval) {
            this.elements.captureInterval.addEventListener('change', async () => {
                const interval = this.elements.captureInterval.value;
                await this.saveInterval(interval);

                // Update UI based on manual mode
                this.updateManualModeUI();

                if (interval === 'manual') {
                    this.showStatus('Manual only mode enabled', 'info');
                    // Stop automatic capture but keep domain enabled
                    this.stopAutomaticCapture();
                } else {
                    this.showStatus(`Interval updated to ${interval} seconds`, 'success');
                    // If domain is enabled, start automatic capture with new interval
                    if (this.elements.consentToggle && this.elements.consentToggle.checked) {
                        this.startAutomaticCapture();
                    }
                }
            });
        }

        // Refresh page toggle
        if (this.elements.refreshPageToggle) {
            this.elements.refreshPageToggle.addEventListener('change', async () => {
                const refreshEnabled = this.elements.refreshPageToggle.checked;
                await this.saveRefreshPageSetting(refreshEnabled);
                this.showStatus(`Page refresh ${refreshEnabled ? 'enabled' : 'disabled'}`, 'success');
            });
        }

        // Capture delay change
        if (this.elements.captureDelay) {
            this.elements.captureDelay.addEventListener('change', async () => {
                const delay = this.elements.captureDelay.value;
                await this.saveCaptureDelay(delay);
                this.showStatus(`Capture delay set to ${delay} seconds`, 'success');
            });
        }

        // Consent toggle - now enables WebSophon for domain (both manual and automatic)
        if (this.elements.consentToggle) {
            this.elements.consentToggle.addEventListener('change', async () => {
                const isEnabled = this.elements.consentToggle.checked;
                const interval = this.elements.captureInterval.value;

                await this.saveConsent(isEnabled);

                if (isEnabled) {
                    if (interval === 'manual') {
                        this.showStatus('WebSophon enabled for manual captures', 'success');
                    } else {
                        this.showStatus(`WebSophon enabled with ${interval}s interval`, 'success');
                        // Start automatic capture if interval is set
                        this.startAutomaticCapture();
                    }
                } else {
                    this.showStatus('WebSophon disabled for this domain', 'info');
                    // Stop any automatic capture
                    this.stopAutomaticCapture();
                }
            });
        }

        // Add field button
        if (this.elements.addFieldBtn) {
            this.elements.addFieldBtn.addEventListener('click', () => {
                this.addBasicField();
            });
        }

        // Manual capture
        if (this.elements.captureNow) {
            this.elements.captureNow.addEventListener('click', () => {
                this.handleManualCapture();
            });
        }

        // Preset buttons
        if (this.elements.savePresetBtn) {
            this.elements.savePresetBtn.addEventListener('click', () => {
                this.savePreset();
            });
        }

        if (this.elements.deletePresetBtn) {
            this.elements.deletePresetBtn.addEventListener('click', () => {
                this.deletePreset();
            });
        }

        // Preset selector
        if (this.elements.presetSelector) {
            this.elements.presetSelector.addEventListener('change', () => {
                this.loadPreset();
            });
        }

        // History controls
        this.setupHistoryEventListeners();
    }

    async loadBasicSettings() {
        try {
            if (!this.currentDomain) return;

            const keys = [
                'webhookUrl',
                `consent_${this.currentDomain}`,
                `interval_${this.currentDomain}`,
                `refreshPage_${this.currentDomain}`,
                `captureDelay_${this.currentDomain}`,
                `llmMode_${this.currentDomain}`,
                `llmConfig_${this.currentDomain}`,
                `fields_${this.currentDomain}`
            ];

            const data = await chrome.storage.local.get(keys);

            if (data.webhookUrl && this.elements.webhookUrl) {
                this.elements.webhookUrl.value = data.webhookUrl;
            }

            if (data[`consent_${this.currentDomain}`] !== undefined && this.elements.consentToggle) {
                this.elements.consentToggle.checked = data[`consent_${this.currentDomain}`];
            }

            if (data[`interval_${this.currentDomain}`] && this.elements.captureInterval) {
                this.elements.captureInterval.value = data[`interval_${this.currentDomain}`];
            }

            if (data[`refreshPage_${this.currentDomain}`] !== undefined && this.elements.refreshPageToggle) {
                this.elements.refreshPageToggle.checked = data[`refreshPage_${this.currentDomain}`];
            }

            if (data[`captureDelay_${this.currentDomain}`] !== undefined && this.elements.captureDelay) {
                this.elements.captureDelay.value = data[`captureDelay_${this.currentDomain}`];
            }

            // Load LLM settings
            if (data[`llmMode_${this.currentDomain}`] !== undefined && this.elements.llmModeToggle) {
                this.elements.llmModeToggle.checked = data[`llmMode_${this.currentDomain}`];
            }

            const llmConfig = data[`llmConfig_${this.currentDomain}`] || {};
            if (llmConfig.apiUrl && this.elements.llmApiUrl) {
                this.elements.llmApiUrl.value = llmConfig.apiUrl;
            } else if (this.elements.llmApiUrl && !this.elements.llmApiUrl.value) {
                // Set OpenRouter as default if no URL is configured
                this.elements.llmApiUrl.value = 'https://openrouter.ai/api/v1/chat/completions';
            }
            if (llmConfig.apiKey && this.elements.llmApiKey) {
                this.elements.llmApiKey.value = llmConfig.apiKey;
            }
            if (llmConfig.model && this.elements.llmModel) {
                this.elements.llmModel.value = llmConfig.model;

                // Handle custom model display
                if (llmConfig.model === 'custom') {
                    if (this.elements.customModelGroup) {
                        this.elements.customModelGroup.style.display = 'block';
                    }
                    if (llmConfig.customModel && this.elements.llmCustomModel) {
                        this.elements.llmCustomModel.value = llmConfig.customModel;
                    }
                } else {
                    if (this.elements.customModelGroup) {
                        this.elements.customModelGroup.style.display = 'none';
                    }
                }
            } else if (this.elements.llmModel && this.elements.llmModel.options.length > 0) {
                // Set OpenGVLab InternVL3 14B as default model (free tier on OpenRouter)
                this.elements.llmModel.value = 'opengvlab/internvl3-14b:free';
            }
            if (llmConfig.temperature !== undefined && this.elements.llmTemperature) {
                this.elements.llmTemperature.value = llmConfig.temperature;
            }
            if (llmConfig.maxTokens !== undefined && this.elements.llmMaxTokens) {
                this.elements.llmMaxTokens.value = llmConfig.maxTokens;
            }

            // Load saved fields
            await this.loadFieldsState();

            // Update UI based on manual mode and LLM mode
            this.updateManualModeUI();
            this.updateLlmModeUI();

            console.log('Settings loaded:', data);
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    }

    async saveWebhookUrl(url) {
        try {
            await chrome.storage.local.set({ webhookUrl: url });
            console.log('Webhook URL saved:', url);
        } catch (error) {
            console.error('Failed to save webhook URL:', error);
        }
    }

    async saveInterval(interval) {
        try {
            if (!this.currentDomain) return;
            await chrome.storage.local.set({ [`interval_${this.currentDomain}`]: interval });
            console.log('Interval saved:', interval);

            // Refresh known domains after settings change
            await this.loadKnownDomains();
        } catch (error) {
            console.error('Failed to save interval:', error);
        }
    }

    async saveConsent(enabled) {
        try {
            if (!this.currentDomain) return;
            await chrome.storage.local.set({ [`consent_${this.currentDomain}`]: enabled });
            console.log('Consent saved:', enabled);

            // Refresh known domains after settings change
            await this.loadKnownDomains();
        } catch (error) {
            console.error('Failed to save consent:', error);
        }
    }

    async saveRefreshPageSetting(enabled) {
        try {
            if (!this.currentDomain) return;
            await chrome.storage.local.set({ [`refreshPage_${this.currentDomain}`]: enabled });
            console.log('Refresh page setting saved:', enabled);
        } catch (error) {
            console.error('Failed to save refresh page setting:', error);
        }
    }

    async saveCaptureDelay(delay) {
        try {
            if (!this.currentDomain) return;
            await chrome.storage.local.set({ [`captureDelay_${this.currentDomain}`]: delay });
            console.log('Capture delay saved:', delay);
        } catch (error) {
            console.error('Failed to save capture delay:', error);
        }
    }

    async saveLlmMode(enabled) {
        try {
            if (!this.currentDomain) return;
            await chrome.storage.local.set({ [`llmMode_${this.currentDomain}`]: enabled });
            console.log('LLM mode saved:', enabled);
        } catch (error) {
            console.error('Failed to save LLM mode:', error);
        }
    }

    async saveLlmConfig(config) {
        try {
            if (!this.currentDomain) return;

            // Get existing config
            const data = await chrome.storage.local.get([`llmConfig_${this.currentDomain}`]);
            const existingConfig = data[`llmConfig_${this.currentDomain}`] || {};

            // Merge with new config
            const updatedConfig = { ...existingConfig, ...config };

            await chrome.storage.local.set({ [`llmConfig_${this.currentDomain}`]: updatedConfig });
            console.log('LLM config saved:', updatedConfig);
        } catch (error) {
            console.error('Failed to save LLM config:', error);
        }
    }

    updateLlmModeUI() {
        const isLlmMode = this.elements.llmModeToggle?.checked || false;

        if (this.elements.llmConfigSection) {
            if (isLlmMode) {
                this.elements.llmConfigSection.style.display = 'block';
                this.elements.llmConfigSection.classList.add('visible');
            } else {
                this.elements.llmConfigSection.style.display = 'none';
                this.elements.llmConfigSection.classList.remove('visible');
            }
        }

        // Update capture button text to indicate mode
        if (this.elements.captureNow) {
            const baseText = '📸 Capture Screenshot Now';
            const modeText = isLlmMode ? ' (LLM Analysis)' : ' (Webhook)';
            this.elements.captureNow.textContent = baseText + modeText;
        }
    }

    addBasicField() {
        if (!this.elements.fieldsContainer) return;

        const fieldId = Date.now();
        const fieldHtml = `
            <div class="field-item" data-field-id="${fieldId}">
                <div class="field-header">
                    <input type="text" class="field-name-input" placeholder="Field Name">
                    <div class="field-last-result" id="last-result-${fieldId}">
                        <span class="result-text">No results yet</span>
                    </div>
                    <button class="remove-field-btn" data-field-id="${fieldId}">✕</button>
                </div>
                <textarea class="field-description" placeholder="Describe what to evaluate..."></textarea>
                <div class="field-webhook-config">
                    <div class="webhook-toggle-group">
                        <label class="toggle-switch">
                            <input type="checkbox" class="webhook-toggle">
                            <span class="slider"></span>
                        </label>
                        <div class="webhook-config-text">
                            <span>Fire webhook on </span>
                            <select class="webhook-trigger-dropdown">
                                <option value="true">TRUE</option>
                                <option value="false">FALSE</option>
                            </select>
                            <span> result</span>
                        </div>
                    </div>
                    
                    <div class="webhook-url-group" style="display: none;">
                        <label>Webhook URL:</label>
                        <div class="webhook-url-input-group">
                            <input type="url" class="webhook-url-input" placeholder="https://webhook.url/endpoint">
                            <button class="toggle-url-visibility" title="Show/Hide URL" style="display: none;">👁️</button>
                        </div>
                    </div>
                    
                    <div class="webhook-payload-group" style="display: none;">
                        <label>Custom Payload (JSON):</label>
                        <textarea class="webhook-payload-input" placeholder='{"key": "value"}'></textarea>
                    </div>
                </div>
            </div>
        `;

        this.elements.fieldsContainer.insertAdjacentHTML('beforeend', fieldHtml);

        // Add event listeners for the new field
        this.setupFieldWebhookListeners(fieldId);
        this.setupFieldRemoveListener(fieldId);

        this.showFieldStatus('Field added', 'success');
    }

    async savePreset() {
        const name = prompt('Enter preset name:');
        if (!name || !name.trim()) {
            return;
        }

        const presetName = name.trim();

        // Get current fields from DOM
        const fields = this.getAllFieldsFromDOM(); // Get all field data including webhooks

        if (fields.length === 0) {
            this.showStatus('No fields to save in preset', 'error');
            return;
        }

        try {
            // Get existing presets
            const data = await chrome.storage.local.get(['fieldPresets']);
            const presets = data.fieldPresets || {};

            // Save preset
            presets[presetName] = {
                name: presetName,
                fields: fields,
                created: new Date().toISOString(),
                domain: this.currentDomain // Optional: track which domain it was created on
            };

            await chrome.storage.local.set({ fieldPresets: presets });

            // Refresh preset dropdown
            await this.loadPresets();

            // Select the newly saved preset
            if (this.elements.presetSelector) {
                this.elements.presetSelector.value = presetName;
            }

            this.showStatus(`Preset "${presetName}" saved successfully`, 'success');
            console.log('Preset saved:', presets[presetName]);
        } catch (error) {
            console.error('Failed to save preset:', error);
            this.showStatus('Failed to save preset', 'error');
        }
    }

    async deletePreset() {
        const presetName = this.elements.presetSelector?.value;
        if (!presetName) {
            this.showStatus('Please select a preset to delete', 'error');
            return;
        }

        if (!confirm(`Are you sure you want to delete the preset "${presetName}"?`)) {
            return;
        }

        try {
            // Get existing presets
            const data = await chrome.storage.local.get(['fieldPresets']);
            const presets = data.fieldPresets || {};

            if (presets[presetName]) {
                delete presets[presetName];
                await chrome.storage.local.set({ fieldPresets: presets });

                // Refresh preset dropdown
                await this.loadPresets();

                this.showStatus(`Preset "${presetName}" deleted successfully`, 'success');
                console.log('Preset deleted:', presetName);
            } else {
                this.showStatus('Preset not found', 'error');
            }
        } catch (error) {
            console.error('Failed to delete preset:', error);
            this.showStatus('Failed to delete preset', 'error');
        }
    }

    async loadPresets() {
        if (!this.elements.presetSelector) {
            return;
        }

        try {
            const data = await chrome.storage.local.get(['fieldPresets']);
            const presets = data.fieldPresets || {};

            // Clear existing options except the default
            this.elements.presetSelector.innerHTML = '<option value="">Select a preset...</option>';

            // Add preset options
            const presetNames = Object.keys(presets).sort();
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

            // Update delete button state
            this.updatePresetUIState();

            console.log(`Loaded ${presetNames.length} presets`);
        } catch (error) {
            console.error('Failed to load presets:', error);
        }
    }

    async loadKnownDomains() {
        if (!this.elements.domainsContainer) {
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

                sortedDomains.forEach(domain => {
                    const isCurrentDomain = domain === this.currentDomain;
                    const consentEnabled = allData[`consent_${domain}`] || false;
                    const interval = allData[`interval_${domain}`] || 'manual';
                    const fieldsCount = (allData[`fields_${domain}`] || []).length;

                    const domainHtml = `
                        <div class="domain-item ${isCurrentDomain ? 'current-domain-item' : ''}">
                            <div class="domain-header">
                                <span class="domain-name">${domain} ${isCurrentDomain ? '(current)' : ''}</span>
                                <span class="domain-status ${consentEnabled ? 'enabled' : 'disabled'}">
                                    ${consentEnabled ? '✓ Enabled' : '○ Disabled'}
                                </span>
                            </div>
                            <div class="domain-details">
                                <span class="domain-interval">Interval: ${interval === 'manual' ? 'Manual only' : interval + 's'}</span>
                                <span class="domain-fields">Fields: ${fieldsCount}</span>
                            </div>
                        </div>
                    `;

                    this.elements.domainsContainer.insertAdjacentHTML('beforeend', domainHtml);
                });
            }

            console.log(`Loaded ${domains.size} known domains`);
        } catch (error) {
            console.error('Failed to load known domains:', error);
            if (this.elements.domainsContainer) {
                this.elements.domainsContainer.innerHTML = '<p class="no-domains">Error loading domains</p>';
            }
        }
    }

    updatePresetUIState() {
        const hasSelection = this.elements.presetSelector?.value;
        if (this.elements.deletePresetBtn) {
            this.elements.deletePresetBtn.disabled = !hasSelection;
        }
    }

    async loadPreset() {
        const presetName = this.elements.presetSelector?.value;
        if (!presetName) {
            this.updatePresetUIState();
            return;
        }

        try {
            const data = await chrome.storage.local.get(['fieldPresets']);
            const presets = data.fieldPresets || {};
            const preset = presets[presetName];

            if (!preset || !preset.fields) {
                this.showStatus('Preset not found or invalid', 'error');
                return;
            }

            // Clear existing fields
            if (this.elements.fieldsContainer) {
                this.elements.fieldsContainer.innerHTML = '';
            }

            // Load preset fields
            preset.fields.forEach(fieldData => {
                this.createFieldFromData(fieldData);
            });

            // Save the loaded fields state
            await this.saveFieldsState();

            // Update UI state
            this.updatePresetUIState();

            this.showStatus(`Preset "${presetName}" loaded successfully`, 'success');
            console.log('Preset loaded:', preset);
        } catch (error) {
            console.error('Failed to load preset:', error);
            this.showStatus('Failed to load preset', 'error');
        }
    }

    // Get all field data including webhook configurations
    getAllFieldsFromDOM() {
        const fields = [];
        const fieldItems = Array.from(document.querySelectorAll('.field-item'))
            .filter(item => item.isConnected && item.parentNode);

        fieldItems.forEach((item, index) => {
            const fieldId = item.dataset.fieldId || Date.now() + index;
            const nameInput = item.querySelector('.field-name-input');
            const descriptionInput = item.querySelector('.field-description');
            const webhookToggle = item.querySelector('.webhook-toggle');
            const webhookUrlInput = item.querySelector('.webhook-url-input');
            const webhookPayloadInput = item.querySelector('.webhook-payload-input');
            const webhookTriggerDropdown = item.querySelector('.webhook-trigger-dropdown');

            if (nameInput && descriptionInput && nameInput.isConnected && descriptionInput.isConnected) {
                const name = nameInput.value.trim();
                const description = descriptionInput.value.trim();

                // Only include fields with valid name and description
                if (name && description) {
                    // Get last result and event ID if available
                    const lastResultContainer = item.querySelector('.field-last-result');
                    const lastResultElement = lastResultContainer?.querySelector('.result-text');
                    let lastResult = null;
                    let eventId = null;

                    if (lastResultElement && lastResultElement.innerHTML !== 'No results yet') {
                        // Extract result data from the display
                        if (lastResultElement.innerHTML.includes('Pending')) {
                            lastResult = { status: 'pending' };
                        } else if (lastResultElement.innerHTML.includes('Error')) {
                            lastResult = { status: 'error' };
                        } else if (lastResultElement.innerHTML.includes('TRUE')) {
                            const probMatch = lastResultElement.innerHTML.match(/\((\d+)%\)/);
                            lastResult = {
                                result: true,
                                probability: probMatch ? parseInt(probMatch[1]) / 100 : null
                            };
                        } else if (lastResultElement.innerHTML.includes('FALSE')) {
                            const probMatch = lastResultElement.innerHTML.match(/\((\d+)%\)/);
                            lastResult = {
                                result: false,
                                probability: probMatch ? parseInt(probMatch[1]) / 100 : null
                            };
                        }
                    }

                    if (lastResultContainer && lastResultContainer.dataset.eventId) {
                        eventId = lastResultContainer.dataset.eventId;
                    }

                    fields.push({
                        id: fieldId,
                        name: name,
                        description: description,
                        webhookEnabled: webhookToggle ? webhookToggle.checked : false,
                        webhookTrigger: webhookTriggerDropdown ? webhookTriggerDropdown.value === 'true' : true,
                        webhookUrl: webhookUrlInput ? webhookUrlInput.value.trim() : '',
                        webhookPayload: webhookPayloadInput ? webhookPayloadInput.value.trim() : '',
                        lastResult: lastResult,
                        eventId: eventId
                    });
                }
            }
        });

        return fields;
    }

    async handleManualCapture() {
        // Check if domain is enabled
        if (!this.elements.consentToggle?.checked) {
            this.showStatus('Please enable WebSophon for this domain first', 'error');
            return;
        }

        const isLlmMode = this.elements.llmModeToggle?.checked || false;

        // Validate configuration based on mode
        if (isLlmMode) {
            const llmConfig = await this.getLlmConfig();
            if (!llmConfig.apiUrl || !llmConfig.apiKey) {
                this.showStatus('Please configure LLM API URL and API Key first', 'error');
                return;
            }
        } else {
            const webhookUrl = this.elements.webhookUrl?.value.trim();
            if (!webhookUrl) {
                this.showStatus('Please enter a webhook URL first', 'error');
                return;
            }
        }

        // Get fields and save them before capture
        const fields = this.getFieldsFromDOM();
        if (fields.length === 0) {
            this.showStatus('Please add at least one field', 'error');
            return;
        }

        // Save current field state
        await this.saveFieldsState();

        // Update button state
        if (this.elements.captureNow) {
            this.elements.captureNow.disabled = true;
            this.elements.captureNow.textContent = isLlmMode ? '⏳ Analyzing with LLM...' : '⏳ Capturing...';
        }

        try {
            // Set all fields to pending before sending
            console.log('Setting fields to pending:', fields);
            fields.forEach(field => {
                this.updateFieldStatus(field.name, 'pending', null);
            });

            // Save state to ensure pending status persists
            await this.saveFieldsState();

            // Prepare message based on mode
            let message;
            if (isLlmMode) {
                const llmConfig = await this.getLlmConfig();
                message = {
                    action: 'captureLLM',
                    domain: this.currentDomain,
                    tabId: this.currentTabId,
                    llmConfig: llmConfig,
                    fields: fields,
                    refreshPage: this.elements.refreshPageToggle?.checked || false,
                    captureDelay: parseInt(this.elements.captureDelay?.value || '0')
                };
            } else {
                const webhookUrl = this.elements.webhookUrl.value.trim();
                message = {
                    action: 'captureNow',
                    domain: this.currentDomain,
                    tabId: this.currentTabId,
                    webhookUrl: webhookUrl,
                    fields: fields,
                    refreshPage: this.elements.refreshPageToggle?.checked || false,
                    captureDelay: parseInt(this.elements.captureDelay?.value || '0')
                };
            }

            // Send to background script
            const response = await this.sendMessageToBackground(message);

            if (response && response.success) {
                this.showStatus(isLlmMode ? 'Screenshot analyzed with LLM!' : 'Screenshot captured and sent!', 'success');

                // Store event ID with fields if available
                if (response.eventId) {
                    fields.forEach(field => {
                        this.updateFieldStatus(field.name, 'pending', response.eventId);
                    });
                }
            } else {
                this.showStatus(`${isLlmMode ? 'LLM analysis' : 'Capture'} failed: ${response?.error || 'Unknown error'}`, 'error');

                // Set fields to error state
                fields.forEach(field => {
                    this.updateFieldStatus(field.name, 'error', null);
                });
            }
        } catch (error) {
            console.error('Capture error:', error);
            this.showStatus(`Error: ${error.message}`, 'error');
        } finally {
            // Restore button
            if (this.elements.captureNow) {
                this.elements.captureNow.disabled = false;
                const baseText = '📸 Capture Screenshot Now';
                const modeText = isLlmMode ? ' (LLM Analysis)' : ' (Webhook)';
                this.elements.captureNow.textContent = baseText + modeText;
            }
        }
    }

    async getLlmConfig() {
        if (!this.currentDomain) return {};

        const data = await chrome.storage.local.get([`llmConfig_${this.currentDomain}`]);
        const config = data[`llmConfig_${this.currentDomain}`] || {};

        // Handle custom model: if model is 'custom', use customModel value
        if (config.model === 'custom' && config.customModel) {
            return {
                ...config,
                model: config.customModel // Use the custom model name as the actual model
            };
        }

        return config;
    }

    getFieldsFromDOM() {
        const fields = [];
        const fieldItems = Array.from(document.querySelectorAll('.field-item'))
            .filter(item => item.isConnected && item.parentNode); // Only connected elements

        console.log(`getFieldsFromDOM: Found ${fieldItems.length} connected field items`);

        fieldItems.forEach((item, index) => {
            const nameInput = item.querySelector('.field-name-input');
            const descriptionInput = item.querySelector('.field-description');

            if (nameInput && descriptionInput && nameInput.isConnected && descriptionInput.isConnected) {
                const name = nameInput.value.trim();
                const description = descriptionInput.value.trim();

                console.log(`Field ${index}: name="${name}", description="${description}"`);

                // Only include fields that have both name and description
                if (name && description) {
                    const sanitizedName = name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
                    fields.push({
                        name: sanitizedName,
                        criteria: description
                    });
                    console.log(`Added field ${index} to collection: ${sanitizedName}`);
                } else {
                    console.log(`Skipped field ${index} - empty name or description`);
                }
            } else {
                console.log(`Skipped field ${index} - missing or disconnected elements`);
            }
        });

        console.log(`getFieldsFromDOM: Returning ${fields.length} valid fields:`, fields);
        return fields;
    }

    async sendMessageToBackground(message) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Background script timeout'));
            }, 30000);

            chrome.runtime.sendMessage(message, (response) => {
                clearTimeout(timeout);
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        });
    }

    showStatus(message, type) {
        if (this.elements.status) {
            this.elements.status.textContent = message;
            this.elements.status.className = `status-message ${type}`;
            setTimeout(() => {
                this.elements.status.className = 'status-message';
            }, 3000);
        }
        console.log(`Status: ${type} - ${message}`);
    }

    showError(message) {
        this.showStatus(message, 'error');
    }

    showFieldStatus(message, type) {
        if (this.elements.fieldStatus) {
            this.elements.fieldStatus.textContent = message;
            this.elements.fieldStatus.className = `status-message ${type}`;
            setTimeout(() => {
                this.elements.fieldStatus.className = 'status-message';
            }, 3000);
        }
        console.log(`Field Status: ${type} - ${message}`);
    }

    // Theme system
    initializeTheme() {
        console.log('Initializing theme...');

        chrome.storage.local.get(['themePreference'], (result) => {
            let theme = result.themePreference;
            if (!theme) {
                theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            }
            this.applyTheme(theme);
            this.updateThemeIcon(theme);
            console.log(`Initial theme: ${theme}`);
        });

        // Listen for system theme changes
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        mediaQuery.addListener((e) => {
            chrome.storage.local.get(['themePreference'], (result) => {
                if (!result.themePreference) {
                    const theme = e.matches ? 'dark' : 'light';
                    this.applyTheme(theme);
                    this.updateThemeIcon(theme);
                    console.log(`System theme changed to: ${theme}`);
                }
            });
        });
    }

    toggleTheme() {
        console.log('Toggling theme...');
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';

        this.applyTheme(newTheme);
        this.updateThemeIcon(newTheme);

        // Save preference
        chrome.storage.local.set({ themePreference: newTheme });
        console.log(`Theme switched to: ${newTheme}`);
        this.showStatus(`Switched to ${newTheme} theme`, 'success');
    }

    applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        console.log(`Applied theme: ${theme}`);
    }

    updateThemeIcon(theme) {
        const themeIcon = this.elements.themeToggle?.querySelector('.theme-icon');
        if (themeIcon) {
            themeIcon.textContent = theme === 'light' ? '🌙' : '☀️';
            console.log(`Updated theme icon for ${theme} theme`);
        }
    }

    updateManualModeUI() {
        const isManualMode = this.elements.captureInterval?.value === 'manual';
        const consentLabel = document.querySelector('.consent-label');

        if (consentLabel) {
            if (isManualMode) {
                consentLabel.textContent = 'Enable WebSophon for this domain (Manual captures only)';
            } else {
                const interval = this.elements.captureInterval?.value;
                if (interval && interval !== 'manual') {
                    consentLabel.textContent = `Enable WebSophon for this domain (${interval}s automatic + manual)`;
                } else {
                    consentLabel.textContent = 'Enable WebSophon for this domain';
                }
            }
        }
    }

    async initializeHistoryManager() {
        try {
            console.log('Initializing HistoryManager...');
            console.log('Available elements:', Object.keys(this.elements));
            console.log('History container exists:', !!this.elements.historyContainer);

            // Import the real HistoryManager
            const { HistoryManager } = await import('./components/HistoryManager.js');
            console.log('HistoryManager imported successfully');

            // Create and initialize the manager
            this.historyManager = new HistoryManager();
            this.historyManager.setElements(this.elements);
            console.log('HistoryManager created and elements set');

            // Load history after DOM is ready
            setTimeout(() => {
                console.log('Loading history with elements:', this.elements.historyContainer ? 'Found' : 'Missing');
                this.historyManager.loadHistory();
            }, 100);

            console.log('HistoryManager initialized successfully');
        } catch (error) {
            console.error('Failed to initialize HistoryManager:', error);
            console.error('Error details:', error.stack);
            // Create fallback history manager
            this.historyManager = {
                loadHistory: () => {
                    console.log('Fallback history manager - loadHistory called');
                    if (this.elements.historyContainer) {
                        this.elements.historyContainer.innerHTML = '<div class="history-empty">History functionality unavailable (HistoryManager failed to load)</div>';
                        console.log('Set fallback message in history container');
                    } else {
                        console.error('History container element not found:', this.elements);
                    }
                },
                setShowTrueOnly: () => { },
                clearHistory: () => ({ success: true, message: 'History cleared' }),
                renderHistory: () => { },
                scrollToEvent: () => { },
                updateEvent: () => { },
                createTestEvents: (domain) => {
                    console.log('Creating fallback test events for:', domain);
                    if (this.elements.historyContainer) {
                        this.elements.historyContainer.innerHTML = `<div class="history-empty">Test events created for ${domain} (fallback mode)</div>`;
                    }
                    return { success: true, message: 'Test events created (fallback)' };
                }
            };
        }
    }

    setupHistoryEventListeners() {
        try {
            if (this.elements.showTrueOnly && this.historyManager) {
                this.elements.showTrueOnly.addEventListener('change', () => {
                    if (this.historyManager.setShowTrueOnly) {
                        this.historyManager.setShowTrueOnly(this.elements.showTrueOnly.checked);
                    }
                    if (this.historyManager.renderHistory) {
                        this.historyManager.renderHistory();
                    }
                });
            }

            if (this.elements.clearHistoryBtn && this.historyManager) {
                this.elements.clearHistoryBtn.addEventListener('click', () => {
                    if (this.historyManager.clearHistory) {
                        const result = this.historyManager.clearHistory();
                        if (result && result.success) {
                            this.showStatus(result.message, 'info');
                        }
                    }
                });
            }

            if (this.elements.testEventsBtn && this.historyManager) {
                this.elements.testEventsBtn.addEventListener('click', () => {
                    console.log('Test events button clicked');
                    if (this.historyManager.createTestEvents) {
                        const result = this.historyManager.createTestEvents(this.currentDomain);
                        if (result && result.success) {
                            this.showStatus(result.message, 'info');
                        }
                    }
                });
            }
        } catch (error) {
            console.error('Failed to setup history event listeners:', error);
        }
    }

    testHistoryIntegration() {
        console.log('Testing history integration...');
        console.log('History container:', this.elements.historyContainer);

        if (this.elements.historyContainer) {
            // Set initial message to show container is working
            this.elements.historyContainer.innerHTML = '<div class="history-empty">History container connected - waiting for events...</div>';
            console.log('History container test message set successfully');
        } else {
            console.error('History container not found during test!');
        }
    }

    startAutomaticCapture() {
        const interval = this.elements.captureInterval?.value;
        const webhookUrl = this.elements.webhookUrl?.value.trim();

        if (interval === 'manual' || !webhookUrl) return;

        // Get current fields to include with automatic capture
        const fields = this.getFieldsFromDOM();

        this.sendMessageToBackground({
            action: 'startCapture',
            domain: this.currentDomain,
            tabId: this.currentTabId,
            interval: parseInt(interval),
            webhookUrl: webhookUrl,
            fields: fields,
            refreshPage: this.elements.refreshPageToggle?.checked || false,
            captureDelay: parseInt(this.elements.captureDelay?.value || '0')
        });
    }

    stopAutomaticCapture() {
        this.sendMessageToBackground({
            action: 'stopCapture',
            domain: this.currentDomain,
            tabId: this.currentTabId
        });
    }

    setupFieldWebhookListeners(fieldId) {
        const fieldElement = document.querySelector(`[data-field-id="${fieldId}"]`);
        if (!fieldElement) return;

        const webhookToggle = fieldElement.querySelector('.webhook-toggle');
        const webhookTriggerDropdown = fieldElement.querySelector('.webhook-trigger-dropdown');
        const webhookUrlGroup = fieldElement.querySelector('.webhook-url-group');
        const webhookPayloadGroup = fieldElement.querySelector('.webhook-payload-group');
        const urlInput = fieldElement.querySelector('.webhook-url-input');
        const payloadInput = fieldElement.querySelector('.webhook-payload-input');
        const nameInput = fieldElement.querySelector('.field-name-input');
        const descriptionInput = fieldElement.querySelector('.field-description');

        if (webhookToggle) {
            webhookToggle.addEventListener('change', () => {
                const isEnabled = webhookToggle.checked;

                if (webhookUrlGroup) {
                    webhookUrlGroup.style.display = isEnabled ? 'block' : 'none';
                }
                if (webhookPayloadGroup) {
                    webhookPayloadGroup.style.display = isEnabled ? 'block' : 'none';
                }

                // Use debounced save
                this.debouncedSaveFieldsState();
                console.log(`Webhook toggle for field ${fieldId}:`, isEnabled);
            });
        }

        // Add change listener for webhook trigger dropdown
        if (webhookTriggerDropdown) {
            webhookTriggerDropdown.addEventListener('change', () => {
                const triggerValue = webhookTriggerDropdown.value;
                console.log(`Webhook trigger for field ${fieldId}:`, triggerValue);
                this.debouncedSaveFieldsState();
            });
        }

        // Add change listeners to save field state (use debounced saves)
        if (nameInput) {
            nameInput.addEventListener('input', () => this.debouncedSaveFieldsState());
        }
        if (descriptionInput) {
            descriptionInput.addEventListener('input', () => this.debouncedSaveFieldsState());
        }
        if (urlInput) {
            urlInput.addEventListener('input', () => this.debouncedSaveFieldsState());
        }
        if (payloadInput) {
            payloadInput.addEventListener('input', () => this.debouncedSaveFieldsState());
        }
    }

    setupFieldRemoveListener(fieldId) {
        const removeBtn = document.querySelector(`.remove-field-btn[data-field-id="${fieldId}"]`);
        if (removeBtn) {
            removeBtn.addEventListener('click', async () => {
                const fieldItem = removeBtn.closest('.field-item');
                if (fieldItem) {
                    // Get field name before removing for the status message
                    const nameInput = fieldItem.querySelector('.field-name-input');
                    const fieldName = nameInput ? nameInput.value.trim() : 'Field';

                    // Remove from DOM
                    fieldItem.remove();

                    // Save updated state
                    await this.saveFieldsState();

                    // Show status message
                    this.showFieldStatus(`${fieldName} removed`, 'info');

                    // Refresh known domains to update field count
                    await this.loadKnownDomains();
                }
            });
        }
    }

    // Debounced save to prevent race conditions
    debouncedSaveFieldsState() {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }
        this.saveTimeout = setTimeout(() => {
            this.saveFieldsState();
            this.saveTimeout = null;
        }, 200); // 200ms debounce
    }

    async saveFieldsState() {
        try {
            if (!this.currentDomain) return;

            // Get all valid fields from DOM
            const fields = this.getAllFieldsFromDOM();
            console.log('Saving fields state for domain:', this.currentDomain);
            console.log('Fields to save:', fields);

            // Save to storage
            const key = `fields_${this.currentDomain}`;
            await chrome.storage.local.set({ [key]: fields });

            console.log('Fields state saved successfully');

            // Refresh known domains to update field count
            await this.loadKnownDomains();
        } catch (error) {
            console.error('Failed to save fields state:', error);
        }
    }

    async loadFieldsState() {
        try {
            if (!this.currentDomain) return;

            const data = await chrome.storage.local.get([`fields_${this.currentDomain}`]);
            let fieldsData = data[`fields_${this.currentDomain}`];

            if (fieldsData && fieldsData.length > 0) {
                // Clean up any empty fields before loading
                const cleanedFields = fieldsData.filter(field => {
                    const hasValidName = field.name && field.name.trim();
                    const hasValidDescription = field.description && field.description.trim();
                    return hasValidName && hasValidDescription;
                });

                // If we filtered out any fields, save the cleaned version
                if (cleanedFields.length !== fieldsData.length) {
                    console.log(`Cleaned ${fieldsData.length - cleanedFields.length} empty fields for ${this.currentDomain}`);
                    await chrome.storage.local.set({
                        [`fields_${this.currentDomain}`]: cleanedFields
                    });
                    fieldsData = cleanedFields;
                }

                // Clear existing fields
                if (this.elements.fieldsContainer) {
                    this.elements.fieldsContainer.innerHTML = '';
                }

                // Recreate fields from saved data
                fieldsData.forEach(fieldData => {
                    // Skip fields with empty name or description
                    if (!fieldData.name || !fieldData.name.trim() ||
                        !fieldData.description || !fieldData.description.trim()) {
                        console.log('Skipping empty field during load:', fieldData);
                        return;
                    }
                    this.createFieldFromData(fieldData);
                });

                console.log('Fields state loaded for', this.currentDomain, fieldsData);
            }
        } catch (error) {
            console.error('Failed to load fields state:', error);
        }
    }

    createFieldFromData(fieldData) {
        if (!this.elements.fieldsContainer) return;

        const webhookTrigger = fieldData.webhookTrigger !== undefined ? fieldData.webhookTrigger : true; // Default to true

        const fieldHtml = `
            <div class="field-item" data-field-id="${fieldData.id}">
                <div class="field-header">
                    <input type="text" class="field-name-input" placeholder="Field Name" value="${fieldData.name || ''}">
                    <div class="field-last-result" id="last-result-${fieldData.id}">
                        <span class="result-text">${fieldData.lastResult ? this.formatLastResult(fieldData.lastResult) : 'No results yet'}</span>
                    </div>
                    <button class="remove-field-btn" data-field-id="${fieldData.id}">✕</button>
                </div>
                <textarea class="field-description" placeholder="Describe what to evaluate...">${fieldData.description || ''}</textarea>
                <div class="field-webhook-config">
                    <div class="webhook-toggle-group">
                        <label class="toggle-switch">
                            <input type="checkbox" class="webhook-toggle" ${fieldData.webhookEnabled ? 'checked' : ''}>
                            <span class="slider"></span>
                        </label>
                        <div class="webhook-config-text">
                            <span>Fire webhook on </span>
                            <select class="webhook-trigger-dropdown">
                                <option value="true" ${webhookTrigger ? 'selected' : ''}>TRUE</option>
                                <option value="false" ${!webhookTrigger ? 'selected' : ''}>FALSE</option>
                            </select>
                            <span> result</span>
                        </div>
                    </div>
                    
                    <div class="webhook-url-group" style="display: ${fieldData.webhookEnabled ? 'block' : 'none'};">
                        <label>Webhook URL:</label>
                        <div class="webhook-url-input-group">
                            <input type="url" class="webhook-url-input" placeholder="https://webhook.url/endpoint" value="${fieldData.webhookUrl || ''}">
                            <button class="toggle-url-visibility" title="Show/Hide URL" style="display: none;">👁️</button>
                        </div>
                    </div>
                    
                    <div class="webhook-payload-group" style="display: ${fieldData.webhookEnabled ? 'block' : 'none'};">
                        <label>Custom Payload (JSON):</label>
                        <textarea class="webhook-payload-input" placeholder='{"key": "value"}'>${fieldData.webhookPayload || ''}</textarea>
                    </div>
                </div>
            </div>
        `;

        this.elements.fieldsContainer.insertAdjacentHTML('beforeend', fieldHtml);

        // Add event listeners for the recreated field
        this.setupFieldWebhookListeners(fieldData.id);
        this.setupFieldRemoveListener(fieldData.id);

        // Restore event ID and make clickable if present
        if (fieldData.eventId) {
            const resultContainer = document.querySelector(`#last-result-${fieldData.id}`);
            if (resultContainer) {
                resultContainer.dataset.eventId = fieldData.eventId;
                resultContainer.style.cursor = 'pointer';
                resultContainer.onclick = () => {
                    if (this.historyManager) {
                        console.log('Scrolling to event:', fieldData.eventId);
                        this.historyManager.scrollToEvent(
                            fieldData.eventId,
                            this.elements.showTrueOnly?.checked || false,
                            (showTrueOnly) => {
                                if (this.elements.showTrueOnly) {
                                    this.elements.showTrueOnly.checked = showTrueOnly;
                                }
                            }
                        );
                    }
                };
            }
        }
    }

    formatLastResult(result) {
        if (!result) return 'No results yet';

        if (result.status === 'pending') {
            return '<span class="result-indicator pending"></span>⏳ Pending';
        }

        if (result.status === 'error') {
            return '<span class="result-indicator false"></span>❌ Error';
        }

        const resultClass = result.result ? 'true' : 'false';
        const percentage = result.probability ? ` (${(result.probability * 100).toFixed(0)}%)` : '';

        return `<span class="result-indicator ${resultClass}"></span>${result.result ? 'TRUE' : 'FALSE'}${percentage}`;
    }

    updateFieldStatus(fieldName, status, eventId) {
        console.log(`Updating field "${fieldName}" to status: ${status}, eventId: ${eventId}`);

        const fieldItems = document.querySelectorAll('.field-item');
        fieldItems.forEach(item => {
            // Ensure the item is still connected to the DOM
            if (!item.isConnected) {
                console.log('Skipping disconnected field item');
                return;
            }

            const nameInput = item.querySelector('.field-name-input');
            if (nameInput) {
                // Use the same sanitization logic as CaptureService.sanitizeFieldName()
                const sanitizedFieldValue = this.sanitizeFieldName(nameInput.value);

                if (sanitizedFieldValue === fieldName) {
                    const resultContainer = item.querySelector('.field-last-result');
                    const resultText = resultContainer?.querySelector('.result-text');

                    if (resultContainer && resultText) {
                        // Update status display
                        if (status === 'pending') {
                            resultText.innerHTML = this.formatLastResult({ status: 'pending' });
                        } else if (status === 'error') {
                            resultText.innerHTML = this.formatLastResult({ status: 'error' });
                        }

                        // Store event ID for clicking
                        if (eventId) {
                            resultContainer.dataset.eventId = eventId;
                        }

                        // Use debounced save instead of timeout
                        this.debouncedSaveFieldsState();

                        // Make clickable if not already
                        if (!resultContainer.onclick) {
                            resultContainer.style.cursor = 'pointer';
                            resultContainer.onclick = () => {
                                const storedEventId = resultContainer.dataset.eventId;
                                if (storedEventId && this.historyManager) {
                                    console.log('Scrolling to event:', storedEventId);
                                    this.historyManager.scrollToEvent(
                                        storedEventId,
                                        this.elements.showTrueOnly?.checked || false,
                                        (showTrueOnly) => {
                                            if (this.elements.showTrueOnly) {
                                                this.elements.showTrueOnly.checked = showTrueOnly;
                                            }
                                        }
                                    );
                                }
                            };
                        }
                    }
                }
            }
        });
    }

    updateFieldLastResult(fieldName, result) {
        console.log(`=== UPDATE FIELD LAST RESULT DEBUG ===`);
        console.log(`Looking for field "${fieldName}" to update with result:`, result);

        // Find field by name and update its last result
        const fieldItems = document.querySelectorAll('.field-item');
        console.log(`Found ${fieldItems.length} field items in DOM`);
        let found = false;

        fieldItems.forEach((item, index) => {
            // Ensure the item is still connected to the DOM
            if (!item.isConnected) {
                console.log(`Skipping disconnected field item ${index}`);
                return;
            }

            const nameInput = item.querySelector('.field-name-input');
            if (nameInput) {
                const fieldValue = nameInput.value;
                // Use the same sanitization logic as CaptureService.sanitizeFieldName()
                const sanitizedFieldValue = this.sanitizeFieldName(fieldValue);

                console.log(`Field ${index}: original="${fieldValue}", sanitized="${sanitizedFieldValue}", looking for="${fieldName}"`);

                if (sanitizedFieldValue === fieldName) {
                    found = true;
                    console.log(`✓ MATCH FOUND for field "${fieldName}"`);

                    const resultContainer = item.querySelector('.field-last-result');
                    const resultText = resultContainer?.querySelector('.result-text');

                    if (resultContainer && resultText) {
                        const formattedResult = this.formatLastResult(result);
                        resultText.innerHTML = formattedResult;
                        console.log(`Updated field "${fieldValue}" with formatted result: ${formattedResult}`);

                        // Make container clickable
                        if (!resultContainer.onclick && resultContainer.dataset.eventId) {
                            resultContainer.style.cursor = 'pointer';
                            resultContainer.onclick = () => {
                                const storedEventId = resultContainer.dataset.eventId;
                                if (storedEventId && this.historyManager) {
                                    console.log('Scrolling to event:', storedEventId);
                                    this.historyManager.scrollToEvent(
                                        storedEventId,
                                        this.elements.showTrueOnly?.checked || false,
                                        (showTrueOnly) => {
                                            if (this.elements.showTrueOnly) {
                                                this.elements.showTrueOnly.checked = showTrueOnly;
                                            }
                                        }
                                    );
                                }
                            };
                        }

                        // Use debounced save instead of timeout
                        this.debouncedSaveFieldsState();
                    } else {
                        console.warn(`Field "${fieldValue}" found but result container or text element missing`);
                        console.warn('resultContainer:', resultContainer);
                        console.warn('resultText:', resultText);
                    }
                } else {
                    console.log(`✗ No match: "${sanitizedFieldValue}" !== "${fieldName}"`);
                }
            } else {
                console.log(`Field item ${index} has no name input`);
            }
        });

        if (!found) {
            console.warn(`❌ Field "${fieldName}" not found in DOM`);
            console.log('Available fields in DOM:');
            fieldItems.forEach((item, index) => {
                const nameInput = item.querySelector('.field-name-input');
                if (nameInput) {
                    const fieldValue = nameInput.value;
                    const sanitized = this.sanitizeFieldName(fieldValue);
                    console.log(`  ${index}: "${fieldValue}" → "${sanitized}"`);
                }
            });
        } else {
            console.log(`✓ Successfully updated field "${fieldName}"`);
        }
        console.log(`=== END UPDATE FIELD LAST RESULT DEBUG ===`);
    }

    // Add utility method to force clean storage
    async cleanupStorageForDomain(domain = null) {
        try {
            const targetDomain = domain || this.currentDomain;
            if (!targetDomain) {
                console.log('No domain specified for cleanup');
                return;
            }

            const key = `fields_${targetDomain}`;
            const data = await chrome.storage.local.get([key]);
            const fields = data[key] || [];

            console.log(`Cleaning up storage for ${targetDomain}: ${fields.length} fields found`);

            const cleanFields = fields.filter(field => {
                const hasValidName = field.name && field.name.trim();
                const hasValidDescription = field.description && field.description.trim();
                const isValid = hasValidName && hasValidDescription;

                if (!isValid) {
                    console.log('Removing invalid field from storage:', field);
                }

                return isValid;
            });

            if (cleanFields.length !== fields.length) {
                await chrome.storage.local.set({ [key]: cleanFields });
                console.log(`Cleaned ${fields.length - cleanFields.length} invalid fields, ${cleanFields.length} remaining`);

                // Reload fields to reflect the cleanup
                await this.loadFieldsState();
            } else {
                console.log('No cleanup needed - all fields are valid');
            }
        } catch (error) {
            console.error('Error during storage cleanup:', error);
        }
    }

    // Add method to validate current DOM state
    validateFieldsState() {
        console.log('=== FIELD STATE VALIDATION ===');

        const domFields = this.getFieldsFromDOM();
        console.log('DOM fields:', domFields);

        // Log all field elements found in DOM
        const allFieldItems = document.querySelectorAll('.field-item');
        console.log(`Total .field-item elements in DOM: ${allFieldItems.length}`);

        allFieldItems.forEach((item, index) => {
            const fieldId = item.dataset.fieldId;
            const nameInput = item.querySelector('.field-name-input');
            const descriptionInput = item.querySelector('.field-description');
            const isConnected = item.isConnected;
            const hasParent = !!item.parentNode;

            console.log(`Field element ${index}:`, {
                fieldId,
                name: nameInput?.value || 'MISSING',
                description: descriptionInput?.value || 'MISSING',
                isConnected,
                hasParent,
                element: item
            });
        });

        console.log('=== END VALIDATION ===');

        return domFields;
    }

    // Field name sanitization - MUST match CaptureService.sanitizeFieldName() exactly
    sanitizeFieldName(friendlyName) {
        if (!friendlyName) return 'unnamed_field';
        return friendlyName.toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
            .replace(/^_+|_+$/g, '')
            .replace(/_+/g, '_') || 'unnamed_field';
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM loaded, starting popup...');
    const popup = new SimplePopupController();
    window.popupController = popup;
    await popup.initialize();

    // Add debug functions for testing
    window.debugHistory = () => {
        console.log('Debug history called');
        console.log('Current domain:', popup.currentDomain);
        console.log('History manager:', popup.historyManager);
        console.log('History container element:', popup.elements.historyContainer);
        if (popup.historyManager && popup.historyManager.createTestEvents) {
            return popup.historyManager.createTestEvents(popup.currentDomain);
        } else {
            console.error('No createTestEvents method available');
        }
    };

    // Add field debugging functions
    window.debugFields = () => {
        console.log('=== FIELD DEBUG INFO ===');
        console.log('Current domain:', popup.currentDomain);

        if (popup.validateFieldsState) {
            popup.validateFieldsState();
        }

        return {
            domFields: popup.getFieldsFromDOM(),
            domain: popup.currentDomain
        };
    };

    window.cleanupFields = async () => {
        console.log('Manually cleaning up fields...');
        if (popup.cleanupStorageForDomain) {
            await popup.cleanupStorageForDomain();
        }
        return 'Cleanup completed';
    };

    window.forceRefreshFields = async () => {
        console.log('Force refreshing field state...');
        await popup.saveFieldsState();
        await popup.loadFieldsState();
        return 'Fields refreshed';
    };

    // Add preset debugging functions
    window.debugPresets = async () => {
        console.log('=== PRESET DEBUG INFO ===');
        const data = await chrome.storage.local.get(['fieldPresets']);
        const presets = data.fieldPresets || {};
        console.log('Stored presets:', presets);
        console.log('Preset count:', Object.keys(presets).length);
        console.log('Current selector value:', popup.elements.presetSelector?.value);
        return presets;
    };

    window.clearAllPresets = async () => {
        if (confirm('Are you sure you want to delete ALL presets?')) {
            await chrome.storage.local.set({ fieldPresets: {} });
            await popup.loadPresets();
            console.log('All presets cleared');
            return 'All presets cleared';
        }
        return 'Cancelled';
    };

    window.createTestPreset = async () => {
        // Create a test preset for debugging
        const testPreset = {
            name: 'Test Preset',
            fields: [
                {
                    id: Date.now(),
                    name: 'Test Field 1',
                    description: 'This is a test field for debugging',
                    webhookEnabled: true,
                    webhookUrl: 'https://webhook.site/test',
                    webhookPayload: '{"test": "data"}'
                },
                {
                    id: Date.now() + 1,
                    name: 'Test Field 2',
                    description: 'Another test field',
                    webhookEnabled: false,
                    webhookUrl: '',
                    webhookPayload: ''
                }
            ],
            created: new Date().toISOString(),
            domain: popup.currentDomain
        };

        const data = await chrome.storage.local.get(['fieldPresets']);
        const presets = data.fieldPresets || {};
        presets['Test Preset'] = testPreset;
        await chrome.storage.local.set({ fieldPresets: presets });
        await popup.loadPresets();
        console.log('Test preset created');
        return testPreset;
    };

    // Add known domains debugging functions
    window.debugKnownDomains = async () => {
        console.log('=== KNOWN DOMAINS DEBUG INFO ===');
        const allData = await chrome.storage.local.get();
        const domainKeys = Object.keys(allData).filter(key =>
            key.startsWith('consent_') || key.startsWith('interval_') || key.startsWith('fields_')
        );
        console.log('Found domain keys:', domainKeys);

        const domains = new Set();
        domainKeys.forEach(key => {
            const parts = key.split('_');
            if (parts.length >= 2) {
                const domain = parts.slice(1).join('_');
                if (domain) {
                    domains.add(domain);
                }
            }
        });

        console.log('Extracted domains:', Array.from(domains));
        console.log('Current domain:', popup.currentDomain);
        console.log('Domains container element:', popup.elements.domainsContainer);
        return {
            domains: Array.from(domains),
            currentDomain: popup.currentDomain,
            storageData: allData
        };
    };
});

// Listen for Chrome runtime messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Received message:', message);

    if (window.popupController) {
        switch (message.action) {
            case 'captureComplete':
                console.log('captureComplete message received:', message);
                if (message.success) {
                    window.popupController.showStatus('Screenshot sent successfully!', 'success');

                    // Update field results if available
                    if (message.results) {
                        console.log('Capture complete with results:', message.results);
                        console.log('Results type:', typeof message.results);
                        console.log('Results keys:', Object.keys(message.results));

                        // Handle the response structure where fields are directly in results
                        const fields = message.results;
                        Object.entries(fields).forEach(([fieldName, fieldData]) => {
                            if (fieldData && typeof fieldData === 'object') {
                                // Handle both 'boolean' and 'result' property names
                                let resultValue = null;
                                let probabilityValue = null;

                                // Check for 'result' or 'boolean' property
                                if ('result' in fieldData) {
                                    resultValue = Array.isArray(fieldData.result) ? fieldData.result[0] : fieldData.result;
                                } else if ('boolean' in fieldData) {
                                    resultValue = Array.isArray(fieldData.boolean) ? fieldData.boolean[0] : fieldData.boolean;
                                }

                                // Get probability
                                if ('probability' in fieldData) {
                                    probabilityValue = Array.isArray(fieldData.probability) ? fieldData.probability[0] : fieldData.probability;
                                }

                                // Only update if we have a result
                                if (resultValue !== null) {
                                    const processedResult = {
                                        result: resultValue,
                                        probability: probabilityValue
                                    };
                                    console.log(`Updating field ${fieldName} with result:`, processedResult);
                                    window.popupController.updateFieldLastResult(fieldName, processedResult);

                                    // Store event ID if available
                                    if (message.eventId) {
                                        window.popupController.updateFieldStatus(fieldName, 'complete', message.eventId);
                                    }
                                }
                            }
                        });
                    }
                } else {
                    window.popupController.showStatus(`Failed: ${message.error}`, 'error');
                }
                // Reload history to show the new event
                if (window.popupController.historyManager && window.popupController.historyManager.loadHistory) {
                    window.popupController.historyManager.loadHistory();
                }
                break;
            case 'captureStarted':
                window.popupController.showStatus('Sending to webhook...', 'info');

                // Set all fields to pending state
                if (message.fields) {
                    message.fields.forEach(field => {
                        window.popupController.updateFieldStatus(field.name, 'pending', null);
                    });
                }

                // Reload history to show the new pending event
                if (window.popupController.historyManager && window.popupController.historyManager.loadHistory) {
                    window.popupController.historyManager.loadHistory();
                }
                break;
            case 'eventUpdated':
                console.log('Event updated:', message.eventId);
                console.log('Event data:', message.event);
                console.log('Event results:', message.event?.results);
                console.log('Event fields:', message.event?.fields);

                if (window.popupController.historyManager && window.popupController.historyManager.updateEvent) {
                    window.popupController.historyManager.updateEvent(message.eventId, message.event);
                }

                // Update field statuses from the event
                if (message.event && message.event.fields) {
                    message.event.fields.forEach(field => {
                        const result = {
                            result: field.result,
                            probability: field.probability
                        };
                        window.popupController.updateFieldLastResult(field.name, result);
                        window.popupController.updateFieldStatus(field.name, 'complete', message.eventId);
                    });
                } else if (message.event && message.results) {
                    // Handle the new response format where results contain field data directly
                    Object.entries(message.results).forEach(([fieldName, fieldData]) => {
                        if (fieldData && typeof fieldData === 'object') {
                            // Check for 'result' or 'boolean' property
                            let resultValue = null;
                            if ('result' in fieldData) {
                                resultValue = Array.isArray(fieldData.result) ? fieldData.result[0] : fieldData.result;
                            } else if ('boolean' in fieldData) {
                                resultValue = Array.isArray(fieldData.boolean) ? fieldData.boolean[0] : fieldData.boolean;
                            }

                            const probabilityValue = fieldData.probability !== undefined ?
                                (Array.isArray(fieldData.probability) ? fieldData.probability[0] : fieldData.probability) : null;

                            if (resultValue !== null) {
                                const result = {
                                    result: resultValue,
                                    probability: probabilityValue
                                };
                                window.popupController.updateFieldLastResult(fieldName, result);
                                window.popupController.updateFieldStatus(fieldName, 'complete', message.eventId);
                            }
                        }
                    });
                }
                break;
            case 'historyReloaded':
                console.log('History reloaded');
                if (window.popupController.historyManager && window.popupController.historyManager.loadHistory) {
                    window.popupController.historyManager.loadHistory();
                }
                break;
            case 'captureResults':
                console.log('=== POPUP CAPTURE RESULTS DEBUG ===');
                console.log('captureResults message received:', message);
                console.log('message.results:', message.results);
                console.log('message.fieldResults:', message.fieldResults);
                console.log('message.hasActualFields:', message.hasActualFields);
                console.log('typeof message.results:', typeof message.results);

                if (message.results) {
                    console.log('Processing capture results...');
                    console.log('Object.keys(message.results):', Object.keys(message.results));

                    // Handle the response structure where fields are directly in results
                    const fields = message.results;
                    let fieldsProcessed = 0;

                    Object.entries(fields).forEach(([fieldName, fieldData]) => {
                        console.log(`=== Processing field: "${fieldName}" ===`);
                        console.log('Field data:', fieldData);
                        console.log('Field data type:', typeof fieldData);
                        console.log('Field data isArray:', Array.isArray(fieldData));

                        // Skip the 'reason' field as it's not a field result
                        if (fieldName === 'reason') {
                            console.log(`Skipping reason field: ${fieldData}`);
                            return;
                        }

                        let resultValue = null;
                        let probabilityValue = null;

                        // Handle array format from LLM: [boolean, probability]
                        if (Array.isArray(fieldData) && fieldData.length >= 1) {
                            resultValue = fieldData[0]; // boolean result
                            probabilityValue = fieldData.length > 1 ? fieldData[1] : null; // probability
                            console.log(`Array format - Field "${fieldName}": result=${resultValue} (type: ${typeof resultValue}), probability=${probabilityValue} (type: ${typeof probabilityValue})`);
                        }
                        // Handle object format: {result: boolean, probability: number}
                        else if (fieldData && typeof fieldData === 'object') {
                            // Check for 'result' or 'boolean' property
                            if ('result' in fieldData) {
                                resultValue = Array.isArray(fieldData.result) ? fieldData.result[0] : fieldData.result;
                            } else if ('boolean' in fieldData) {
                                resultValue = Array.isArray(fieldData.boolean) ? fieldData.boolean[0] : fieldData.boolean;
                            }

                            // Get probability
                            if ('probability' in fieldData) {
                                probabilityValue = Array.isArray(fieldData.probability) ? fieldData.probability[0] : fieldData.probability;
                            }
                            console.log(`Object format - Field "${fieldName}": result=${resultValue}, probability=${probabilityValue}`);
                        }

                        // Only update if we have a valid result
                        if (resultValue !== null && typeof resultValue === 'boolean') {
                            fieldsProcessed++;
                            const processedResult = {
                                result: resultValue,
                                probability: probabilityValue
                            };
                            console.log(`Updating field "${fieldName}" with result:`, processedResult);
                            console.log(`Calling updateFieldLastResult("${fieldName}", processedResult)`);
                            window.popupController.updateFieldLastResult(fieldName, processedResult);

                            // Store event ID if available
                            if (message.eventId) {
                                console.log(`Setting field status for "${fieldName}" to complete with eventId: ${message.eventId}`);
                                window.popupController.updateFieldStatus(fieldName, 'complete', message.eventId);
                            }
                        } else {
                            console.warn(`Invalid field data for "${fieldName}":`, fieldData);
                            console.warn(`resultValue: ${resultValue} (type: ${typeof resultValue})`);
                            console.warn(`Expected: boolean, got: ${typeof resultValue}`);
                        }
                        console.log(`=== End processing field: "${fieldName}" ===`);
                    });

                    console.log(`Processed ${fieldsProcessed} field results from captureResults message`);
                    console.log('=== END POPUP CAPTURE RESULTS DEBUG ===');

                    if (fieldsProcessed === 0) {
                        console.warn('No valid field results found in captureResults message');
                        console.warn('This means either:');
                        console.warn('1. No fields in message.results');
                        console.warn('2. Fields are not in expected format [boolean, probability]');
                        console.warn('3. Field names don\'t match configured fields');
                    }
                } else {
                    console.error('captureResults message received but message.results is missing!');
                }
                break;
        }
    }
});

console.log('WebSophon popup script loaded'); 