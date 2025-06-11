// Simplified WebSophon Popup - Basic functionality first
console.log('Starting WebSophon popup...');

// Basic popup functionality without complex architecture
class SimplePopupController {
    constructor() {
        this.elements = {};
        this.currentDomain = null;
        this.currentTabId = null;
    }

    async initialize() {
        try {
            console.log('Initializing simple popup...');

            // Get DOM elements
            this.getDOMElements();

            // Initialize theme
            this.initializeTheme();

            // Get current tab
            await this.getCurrentTab();

            // Setup basic event listeners
            this.setupEventListeners();

            // Load basic settings
            await this.loadBasicSettings();

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
            deletePresetBtn: 'delete-preset-btn'
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
                    <button class="remove-field-btn" onclick="this.parentElement.parentElement.remove()">✕</button>
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

        this.showStatus('Field added', 'success');
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
            } else {
                this.showStatus(`Capture failed: ${response?.error || 'Unknown error'}`, 'error');
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

    startAutomaticCapture() {
        const interval = this.elements.captureInterval?.value;
        const webhookUrl = this.elements.webhookUrl?.value.trim();

        if (interval === 'manual' || !webhookUrl) return;

        this.sendMessageToBackground({
            action: 'startCapture',
            domain: this.currentDomain,
            tabId: this.currentTabId,
            interval: parseInt(interval),
            webhookUrl: webhookUrl
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

        // Set default payload when enabled
        if (payloadInput && !payloadInput.value.trim()) {
            payloadInput.value = '{"key": "value"}';
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
                    fieldsData.push({
                        id: fieldId,
                        name: nameInput.value || '',
                        description: descriptionInput.value || '',
                        webhookEnabled: webhookToggle ? webhookToggle.checked : false,
                        webhookUrl: webhookUrlInput ? webhookUrlInput.value : '',
                        webhookPayload: webhookPayloadInput ? webhookPayloadInput.value : '{"key": "value"}'
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
                    <button class="remove-field-btn" onclick="this.parentElement.parentElement.remove(); window.popupController.saveFieldsState();">✕</button>
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
                        <textarea class="webhook-payload-input" placeholder='{"key": "value"}'>${fieldData.webhookPayload || '{"key": "value"}'}</textarea>
                    </div>
                </div>
            </div>
        `;

        this.elements.fieldsContainer.insertAdjacentHTML('beforeend', fieldHtml);

        // Add event listeners for the recreated field
        this.setupFieldWebhookListeners(fieldData.id);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM loaded, starting popup...');
    const popup = new SimplePopupController();
    window.popupController = popup;
    await popup.initialize();
});

// Listen for Chrome runtime messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Received message:', message);

    if (window.popupController) {
        switch (message.action) {
            case 'captureComplete':
                if (message.success) {
                    window.popupController.showStatus('Screenshot sent successfully!', 'success');
                } else {
                    window.popupController.showStatus(`Failed: ${message.error}`, 'error');
                }
                break;
            case 'captureStarted':
                window.popupController.showStatus('Sending to webhook...', 'info');
                break;
        }
    }
});

console.log('WebSophon popup script loaded'); 