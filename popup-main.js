// Simplified WebSophon Popup - Basic functionality first
console.log('Starting WebSophon popup...');

// Basic popup functionality without complex architecture
class SimplePopupController {
    constructor() {
        this.elements = {};
        this.currentDomain = null;
        this.currentTabId = null;
        this.historyManager = null;
    }

    async initialize() {
        try {
            console.log('Initializing simple popup...');

            // Get DOM elements
            this.getDOMElements();

            // Initialize theme
            this.initializeTheme();

            // Initialize HistoryManager
            await this.initializeHistoryManager();

            // Get current tab
            await this.getCurrentTab();

            // Setup basic event listeners
            this.setupEventListeners();

            // Load basic settings
            await this.loadBasicSettings();

            // Test history container availability
            this.testHistoryIntegration();

            console.log('Simple popup initialized successfully');
        } catch (error) {
            console.error('Popup initialization failed:', error);
            this.showError('Failed to initialize extension');
        }
    }

    getDOMElements() {
        const elementMap = {
            currentDomain: 'current-domain',
            webhookUrl: 'webhook-url',
            captureInterval: 'capture-interval',
            consentToggle: 'consent-toggle',
            status: 'status',
            captureNow: 'capture-now',
            themeToggle: 'theme-toggle',
            addFieldBtn: 'add-field-btn',
            fieldsContainer: 'fields-container',
            presetSelector: 'preset-selector',
            savePresetBtn: 'save-preset-btn',
            deletePresetBtn: 'delete-preset-btn',
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

            // Load saved fields
            await this.loadFieldsState();

            // Update UI based on manual mode
            this.updateManualModeUI();

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
        } catch (error) {
            console.error('Failed to save interval:', error);
        }
    }

    async saveConsent(enabled) {
        try {
            if (!this.currentDomain) return;
            await chrome.storage.local.set({ [`consent_${this.currentDomain}`]: enabled });
            console.log('Consent saved:', enabled);
        } catch (error) {
            console.error('Failed to save consent:', error);
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
                        <span>Fire webhook on TRUE result</span>
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

    savePreset() {
        const name = prompt('Enter preset name:');
        if (name) {
            this.showStatus(`Preset "${name}" saved (functionality coming soon)`, 'info');
        }
    }

    deletePreset() {
        const presetName = this.elements.presetSelector?.value;
        if (presetName) {
            this.showStatus(`Preset "${presetName}" deleted (functionality coming soon)`, 'info');
        }
    }

    async handleManualCapture() {
        // Check if domain is enabled
        if (!this.elements.consentToggle?.checked) {
            this.showStatus('Please enable WebSophon for this domain first', 'error');
            return;
        }

        const webhookUrl = this.elements.webhookUrl?.value.trim();
        if (!webhookUrl) {
            this.showStatus('Please enter a webhook URL first', 'error');
            return;
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
            this.elements.captureNow.textContent = '⏳ Capturing...';
        }

        try {
            // Set all fields to pending before sending
            console.log('Setting fields to pending:', fields);
            fields.forEach(field => {
                this.updateFieldStatus(field.name, 'pending', null);
            });

            // Save state to ensure pending status persists
            await this.saveFieldsState();

            // Send to background script
            const response = await this.sendMessageToBackground({
                action: 'captureNow',
                domain: this.currentDomain,
                tabId: this.currentTabId,
                webhookUrl: webhookUrl,
                fields: fields
            });

            if (response && response.success) {
                this.showStatus('Screenshot captured and sent!', 'success');

                // Store event ID with fields if available
                if (response.eventId) {
                    fields.forEach(field => {
                        this.updateFieldStatus(field.name, 'pending', response.eventId);
                    });
                }
            } else {
                this.showStatus(`Capture failed: ${response?.error || 'Unknown error'}`, 'error');

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
                this.elements.captureNow.textContent = '📸 Capture Screenshot Now';
            }
        }
    }

    getFieldsFromDOM() {
        const fields = [];
        const fieldItems = document.querySelectorAll('.field-item');

        fieldItems.forEach(item => {
            const nameInput = item.querySelector('.field-name-input');
            const descriptionTextarea = item.querySelector('.field-description');

            if (nameInput && descriptionTextarea) {
                const name = nameInput.value.trim();
                const description = descriptionTextarea.value.trim();

                if (name && description) {
                    fields.push({
                        name: name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase(),
                        criteria: description
                    });
                }
            }
        });

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
            fields: fields
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

                // Auto-save when webhook settings change
                this.saveFieldsState();
                console.log(`Webhook toggle for field ${fieldId}:`, isEnabled);
            });
        }

        // Add change listeners to save field state
        if (nameInput) {
            nameInput.addEventListener('input', () => this.saveFieldsState());
        }
        if (descriptionInput) {
            descriptionInput.addEventListener('input', () => this.saveFieldsState());
        }
        if (urlInput) {
            urlInput.addEventListener('input', () => this.saveFieldsState());
        }
        if (payloadInput) {
            payloadInput.addEventListener('input', () => this.saveFieldsState());
        }

        // Don't force default payload - let user set their own
    }

    setupFieldRemoveListener(fieldId) {
        const fieldElement = document.querySelector(`[data-field-id="${fieldId}"]`);
        if (!fieldElement) return;

        const removeBtn = fieldElement.querySelector('.remove-field-btn');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                console.log('Removing field:', fieldId);
                fieldElement.remove();
                this.saveFieldsState();
                this.showFieldStatus('Field removed', 'info');
            });
        }
    }

    async saveFieldsState() {
        try {
            if (!this.currentDomain) return;

            const fieldsData = [];
            const fieldItems = document.querySelectorAll('.field-item');

            fieldItems.forEach(item => {
                const fieldId = item.dataset.fieldId;
                const nameInput = item.querySelector('.field-name-input');
                const descriptionInput = item.querySelector('.field-description');
                const webhookToggle = item.querySelector('.webhook-toggle');
                const webhookUrlInput = item.querySelector('.webhook-url-input');
                const webhookPayloadInput = item.querySelector('.webhook-payload-input');

                if (nameInput && descriptionInput) {
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

                    fieldsData.push({
                        id: fieldId,
                        name: nameInput.value || '',
                        description: descriptionInput.value || '',
                        webhookEnabled: webhookToggle ? webhookToggle.checked : false,
                        webhookUrl: webhookUrlInput ? webhookUrlInput.value : '',
                        webhookPayload: webhookPayloadInput ? webhookPayloadInput.value : '',
                        lastResult: lastResult,
                        eventId: eventId
                    });
                }
            });

            await chrome.storage.local.set({
                [`fields_${this.currentDomain}`]: fieldsData
            });

            console.log('Fields state saved for', this.currentDomain, fieldsData);
        } catch (error) {
            console.error('Failed to save fields state:', error);
        }
    }

    async loadFieldsState() {
        try {
            if (!this.currentDomain) return;

            const data = await chrome.storage.local.get([`fields_${this.currentDomain}`]);
            const fieldsData = data[`fields_${this.currentDomain}`];

            if (fieldsData && fieldsData.length > 0) {
                // Clear existing fields
                if (this.elements.fieldsContainer) {
                    this.elements.fieldsContainer.innerHTML = '';
                }

                // Recreate fields from saved data
                fieldsData.forEach(fieldData => {
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
                        <span>Fire webhook on TRUE result</span>
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
            const nameInput = item.querySelector('.field-name-input');
            if (nameInput) {
                const sanitizedFieldValue = nameInput.value.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

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

                        // Save the field state immediately
                        // Delay save slightly to ensure DOM is updated
                        setTimeout(() => this.saveFieldsState(), 50);

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
        console.log(`Looking for field "${fieldName}" to update with result:`, result);

        // Find field by name and update its last result
        const fieldItems = document.querySelectorAll('.field-item');
        let found = false;

        fieldItems.forEach(item => {
            const nameInput = item.querySelector('.field-name-input');
            if (nameInput) {
                const fieldValue = nameInput.value;
                const sanitizedFieldValue = fieldValue.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

                console.log(`Checking field: original="${fieldValue}", sanitized="${sanitizedFieldValue}", looking for="${fieldName}"`);

                if (sanitizedFieldValue === fieldName) {
                    found = true;
                    const resultContainer = item.querySelector('.field-last-result');
                    const resultText = resultContainer?.querySelector('.result-text');

                    if (resultContainer && resultText) {
                        resultText.innerHTML = this.formatLastResult(result);
                        console.log(`Updated field "${fieldValue}" with result`);

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

                        // Also save the field state with the last result  
                        // Delay save to ensure DOM is updated
                        setTimeout(() => this.saveFieldsState(), 100);
                    }
                }
            }
        });

        if (!found) {
            console.warn(`Field "${fieldName}" not found in DOM`);
        }
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
                console.log('captureResults message received:', message);
                if (message.results) {
                    console.log('Capture results:', message.results);

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
                break;
        }
    }
});

console.log('WebSophon popup script loaded'); 