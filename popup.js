// Field management and preset functionality
class FieldManager {
    constructor() {
        this.fields = [];
        this.presets = {};
        this.currentDomain = '';
        this.currentTabId = null;
        this.lastResults = null;
    }

    // Generate unique field ID
    generateFieldId() {
        return `field_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Add a new field
    addField(data = {}) {
        const field = {
            id: this.generateFieldId(),
            name: data.name || '',
            friendlyName: data.friendlyName || data.name || '',
            description: data.description || '',
            webhookEnabled: data.webhookEnabled || false,
            webhookUrl: data.webhookUrl || '',
            webhookUrlSaved: data.webhookUrlSaved || false, // Track if URL has been saved
            webhookPayload: data.webhookPayload || '{}',
            webhookLogs: data.webhookLogs || [],
            showWebhookUrl: data.showWebhookUrl !== undefined ? data.showWebhookUrl : !data.webhookUrlSaved, // Show by default if not saved
            result: null,
            probability: null
        };
        this.fields.push(field);
        return field;
    }

    // Convert friendly name to safe field name
    sanitizeFieldName(friendlyName) {
        return friendlyName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, ''); // Remove leading/trailing underscores
    }

    // Mask webhook URL for security
    maskWebhookUrl(url) {
        if (!url) return '';
        try {
            const urlObj = new URL(url);
            const domain = urlObj.hostname;
            return `${urlObj.protocol}//${domain}/***`;
        } catch (e) {
            return url.substring(0, 20) + '***';
        }
    }

    // Add webhook log entry
    addWebhookLog(fieldId, log) {
        const field = this.fields.find(f => f.id === fieldId);
        if (!field) return;

        // Keep only last 50 logs
        field.webhookLogs = field.webhookLogs || [];
        field.webhookLogs.unshift({
            timestamp: new Date().toISOString(),
            ...log
        });

        if (field.webhookLogs.length > 50) {
            field.webhookLogs = field.webhookLogs.slice(0, 50);
        }

        this.saveToStorage();
    }

    // Remove a field
    removeField(fieldId) {
        this.fields = this.fields.filter(f => f.id !== fieldId);
    }

    // Get fields for API
    getFieldsForAPI() {
        return this.fields.map(f => ({
            name: this.sanitizeFieldName(f.friendlyName || f.name),
            criteria: this.escapeJsonString(f.description)
        }));
    }

    // Escape JSON string properly
    escapeJsonString(str) {
        if (!str) return '';
        return str
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
    }

    // Update field results
    updateResults(results) {
        if (!results || !results.fields) return;

        this.fields.forEach(field => {
            const sanitizedName = this.sanitizeFieldName(field.friendlyName || field.name);
            const result = results.fields[sanitizedName];
            if (result) {
                field.result = result.boolean;
                field.probability = result.probability;
            }
        });

        this.lastResults = results;

        // Fire webhooks sequentially for true results
        this.fireWebhooksSequentially();
    }

    // Fire webhooks sequentially with minimal delay
    async fireWebhooksSequentially() {
        const fieldsToFire = this.fields.filter(f => f.webhookEnabled && f.result === true);

        for (const field of fieldsToFire) {
            await this.fireWebhook(field);
            // Small delay between webhooks (100ms)
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    // Fire webhook for a field
    async fireWebhook(field) {
        if (!field.webhookUrl) return;

        const startTime = Date.now();
        let logEntry = {
            fieldName: field.friendlyName,
            success: false,
            error: null,
            duration: 0
        };

        try {
            let payload = {};
            try {
                payload = JSON.parse(field.webhookPayload);
            } catch (e) {
                logEntry.error = 'Invalid JSON payload';
                this.addWebhookLog(field.id, logEntry);
                console.error('Invalid JSON payload for field:', field.friendlyName);
                return;
            }

            const response = await fetch(field.webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            logEntry.duration = Date.now() - startTime;
            logEntry.success = response.ok;
            logEntry.status = response.status;

            if (!response.ok) {
                logEntry.error = `HTTP ${response.status}: ${response.statusText}`;
            }

            console.log(`Webhook fired for field ${field.friendlyName}: ${response.status}`);
        } catch (error) {
            logEntry.duration = Date.now() - startTime;
            logEntry.error = error.message;
            console.error('Error firing webhook:', error);
        }

        this.addWebhookLog(field.id, logEntry);
    }

    // Save current fields as preset
    savePreset(name) {
        if (!name) return false;
        this.presets[name] = JSON.parse(JSON.stringify(this.fields));
        return true;
    }

    // Load preset
    loadPreset(name) {
        if (!this.presets[name]) return false;
        this.fields = JSON.parse(JSON.stringify(this.presets[name]));
        // Reset results and maintain field data
        this.fields.forEach(f => {
            f.result = null;
            f.probability = null;
            f.webhookLogs = f.webhookLogs || [];
            f.showWebhookUrl = false; // Reset URL visibility for security
            // Ensure friendlyName exists
            if (!f.friendlyName && f.name) {
                f.friendlyName = f.name;
            }
        });
        return true;
    }

    // Delete preset
    deletePreset(name) {
        delete this.presets[name];
    }

    // Save to storage
    async saveToStorage() {
        await chrome.storage.sync.set({
            fields: this.fields,
            presets: this.presets
        });
    }

    // Load from storage
    async loadFromStorage() {
        const data = await chrome.storage.sync.get(['fields', 'presets']);
        if (data.fields) this.fields = data.fields;
        if (data.presets) this.presets = data.presets;
    }
}

// Initialize field manager
const fieldManager = new FieldManager();

// DOM elements
let elements = {};
let recentEvents = [];
let showTrueOnly = false;

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    // Get all DOM elements
    elements = {
        domainDisplay: document.getElementById('current-domain'),
        webhookUrlInput: document.getElementById('webhook-url'),
        intervalSelect: document.getElementById('capture-interval'),
        consentToggle: document.getElementById('consent-toggle'),
        statusDiv: document.getElementById('status'),
        captureButton: document.getElementById('capture-now'),
        fieldsContainer: document.getElementById('fields-container'),
        addFieldBtn: document.getElementById('add-field-btn'),
        presetSelector: document.getElementById('preset-selector'),
        savePresetBtn: document.getElementById('save-preset-btn'),
        deletePresetBtn: document.getElementById('delete-preset-btn'),
        resultsContainer: document.getElementById('results-container'),
        historyContainer: document.getElementById('history-container'),
        showTrueOnlyCheckbox: document.getElementById('show-true-only'),
        clearHistoryBtn: document.getElementById('clear-history-btn')
    };

    // Test background script communication
    try {
        chrome.runtime.sendMessage({ action: 'ping' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('Background script not responding:', chrome.runtime.lastError);
            } else {
                console.log('Background script is responsive');
            }
        });
    } catch (e) {
        console.error('Failed to communicate with background script:', e);
    }

    // Get current tab information
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url) {
            const url = new URL(tab.url);
            fieldManager.currentDomain = url.hostname;
            fieldManager.currentTabId = tab.id;
            elements.domainDisplay.textContent = fieldManager.currentDomain;
        }
    } catch (error) {
        elements.domainDisplay.textContent = 'Unable to detect domain';
        console.error('Error getting current tab:', error);
    }

    // Load saved data
    await loadSettings();
    await fieldManager.loadFromStorage();

    // Render UI
    renderFields();
    updatePresetSelector();

    // Load and display history
    loadHistory();

    // Event listeners
    setupEventListeners();

    // Mark events as read
    chrome.runtime.sendMessage({ action: 'markEventsRead' });
});

// Setup all event listeners
function setupEventListeners() {
    // Save webhook URL when changed
    elements.webhookUrlInput.addEventListener('change', async () => {
        const webhookUrl = elements.webhookUrlInput.value.trim();
        if (webhookUrl) {
            await chrome.storage.local.set({ webhookUrl });
            showStatus('Webhook URL saved', 'success');
        }
    });

    // Save interval when changed
    elements.intervalSelect.addEventListener('change', async () => {
        const interval = elements.intervalSelect.value;
        await chrome.storage.local.set({ [`interval_${fieldManager.currentDomain}`]: interval });

        // If capture is active, update the interval
        if (elements.consentToggle.checked) {
            chrome.runtime.sendMessage({
                action: 'updateInterval',
                domain: fieldManager.currentDomain,
                interval: parseInt(interval),
                tabId: fieldManager.currentTabId
            });
        }

        showStatus('Interval updated', 'success');
    });

    // Handle consent toggle
    elements.consentToggle.addEventListener('change', async () => {
        const isEnabled = elements.consentToggle.checked;
        const webhookUrl = elements.webhookUrlInput.value.trim();

        if (isEnabled && !webhookUrl) {
            showStatus('Please enter a webhook URL first', 'error');
            elements.consentToggle.checked = false;
            return;
        }

        // Save consent state
        await chrome.storage.local.set({ [`consent_${fieldManager.currentDomain}`]: isEnabled });

        // Send message to background script
        chrome.runtime.sendMessage({
            action: isEnabled ? 'startCapture' : 'stopCapture',
            domain: fieldManager.currentDomain,
            tabId: fieldManager.currentTabId,
            interval: parseInt(elements.intervalSelect.value),
            webhookUrl: webhookUrl
        });

        showStatus(
            isEnabled ? 'Screenshot capture enabled' : 'Screenshot capture disabled',
            isEnabled ? 'success' : 'info'
        );
    });

    // Handle manual capture button
    elements.captureButton.addEventListener('click', handleManualCapture);

    // Add field button
    elements.addFieldBtn.addEventListener('click', () => {
        const field = fieldManager.addField();
        renderFieldItem(field);
        fieldManager.saveToStorage();
    });

    // Preset selector
    elements.presetSelector.addEventListener('change', () => {
        const presetName = elements.presetSelector.value;
        if (presetName) {
            fieldManager.loadPreset(presetName);
            renderFields();
            showStatus(`Loaded preset: ${presetName}`, 'success');
        }
    });

    // Save preset button
    elements.savePresetBtn.addEventListener('click', () => {
        const name = prompt('Enter preset name:');
        if (name) {
            fieldManager.savePreset(name);
            fieldManager.saveToStorage();
            updatePresetSelector();
            showStatus(`Saved preset: ${name}`, 'success');
        }
    });

    // Delete preset button
    elements.deletePresetBtn.addEventListener('click', () => {
        const presetName = elements.presetSelector.value;
        if (presetName && confirm(`Delete preset "${presetName}"?`)) {
            fieldManager.deletePreset(presetName);
            fieldManager.saveToStorage();
            updatePresetSelector();
            showStatus(`Deleted preset: ${presetName}`, 'info');
        }
    });

    // Listen for capture complete messages
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'captureComplete') {
            if (message.success) {
                showStatus('Screenshot sent successfully!', 'success');
            } else {
                showStatus(`Failed: ${message.error}`, 'error');
            }
        } else if (message.action === 'captureResults') {
            // Handle results from n8n
            fieldManager.updateResults(message.results);
            renderFields();
            displayResults(message.results);
            // Reload history to show new event
            loadHistory();
        }
    });

    // History controls
    elements.showTrueOnlyCheckbox.addEventListener('change', () => {
        showTrueOnly = elements.showTrueOnlyCheckbox.checked;
        renderHistory();
    });

    elements.clearHistoryBtn.addEventListener('click', () => {
        if (confirm('Clear all event history?')) {
            chrome.storage.local.set({ recentEvents: [] });
            recentEvents = [];
            renderHistory();
            chrome.runtime.sendMessage({ action: 'markEventsRead' });
        }
    });
}

// Handle manual capture
async function handleManualCapture() {
    const webhookUrl = elements.webhookUrlInput.value.trim();

    if (!webhookUrl) {
        showStatus('Please enter a webhook URL first', 'error');
        return;
    }

    // Prepare fields data
    const fields = fieldManager.getFieldsForAPI();
    if (fields.length === 0) {
        showStatus('Please add at least one field', 'error');
        return;
    }

    // Disable button temporarily
    elements.captureButton.disabled = true;
    elements.captureButton.textContent = '⏳ Capturing...';

    try {
        const response = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Capture timeout - no response from background script'));
            }, 10000);

            chrome.runtime.sendMessage({
                action: 'captureNow',
                domain: fieldManager.currentDomain,
                tabId: fieldManager.currentTabId,
                webhookUrl: webhookUrl,
                fields: fields
            }, (response) => {
                clearTimeout(timeout);
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response || { success: false, error: 'No response' });
                }
            });
        });

        if (response.success) {
            showStatus('Screenshot captured and sent!', 'success');
        } else {
            showStatus(`Capture failed: ${response.error || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        showStatus(`Error: ${error.message}`, 'error');
        console.error('Capture error:', error);
    } finally {
        // Re-enable button
        elements.captureButton.disabled = false;
        elements.captureButton.textContent = '📸 Capture Screenshot Now';
    }
}

// Render all fields
function renderFields() {
    elements.fieldsContainer.innerHTML = '';
    fieldManager.fields.forEach(field => renderFieldItem(field));

    // Save after rendering
    fieldManager.saveToStorage();
}

// Render a single field item
function renderFieldItem(field) {
    const fieldEl = document.createElement('div');
    fieldEl.className = 'field-item';
    fieldEl.dataset.fieldId = field.id;

    const sanitizedName = fieldManager.sanitizeFieldName(field.friendlyName || field.name);
    // Show full URL if toggled to show OR if it hasn't been saved yet
    const displayWebhookUrl = (field.showWebhookUrl || !field.webhookUrlSaved) ? field.webhookUrl : fieldManager.maskWebhookUrl(field.webhookUrl);

    fieldEl.innerHTML = `
    <div class="field-result" style="${field.result === null ? 'display: none;' : ''}">
      <span class="result-indicator ${field.result === true ? 'true' : field.result === false ? 'false' : 'pending'}"></span>
      <span class="result-text">${field.result === true ? 'TRUE' : field.result === false ? 'FALSE' : ''}</span>
      ${field.probability !== null ? `<span class="result-probability">(${(field.probability * 100).toFixed(1)}%)</span>` : ''}
    </div>
    
    <div class="field-header">
      <input type="text" 
             class="field-name-input" 
             placeholder="Field Name" 
             value="${field.friendlyName || field.name}"
             title="Enter a friendly name for this field">
      <span class="field-name-sanitized" title="Backend field name">${sanitizedName}</span>
      <button class="remove-field-btn">✕</button>
    </div>
    
    <textarea class="field-description" 
              placeholder="Describe the criteria for evaluating this field...">${field.description}</textarea>
    
    <div class="field-webhook-config">
      <div class="webhook-toggle-group">
        <label class="toggle-switch">
          <input type="checkbox" class="webhook-toggle" ${field.webhookEnabled ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
        <span>Fire webhook on TRUE result</span>
        ${field.webhookLogs && field.webhookLogs.length > 0 ?
            `<button class="view-logs-btn" title="View webhook logs">📋 Logs (${field.webhookLogs.length})</button>` : ''}
      </div>
      
      <div class="webhook-url-group" style="${field.webhookEnabled || field.webhookUrl ? '' : 'display: none;'}">
        <input type="url" 
               class="webhook-url-input ${(field.showWebhookUrl || !field.webhookUrlSaved) ? '' : 'masked'}" 
               placeholder="https://webhook.url/endpoint" 
               value="${displayWebhookUrl}"
               ${(field.showWebhookUrl || !field.webhookUrlSaved) ? '' : 'readonly'}>
        <button class="toggle-url-visibility" title="${field.showWebhookUrl ? 'Hide URL' : 'Show/Edit URL'}" style="${field.webhookUrlSaved ? '' : 'display: none;'}">
          ${field.showWebhookUrl ? '🙈' : '👁️'}
        </button>
      </div>
      
      <textarea class="webhook-payload-input" 
                placeholder='{"key": "value"}'
                style="${field.webhookEnabled || field.webhookPayload !== '{}' ? '' : 'display: none;'}">${field.webhookPayload}</textarea>
      
      <div class="webhook-logs" style="display: none;">
        <div class="logs-header">
          <span>Recent Webhook Logs</span>
          <button class="close-logs-btn">✕</button>
        </div>
        <div class="logs-content">
          ${field.webhookLogs && field.webhookLogs.length > 0 ?
            field.webhookLogs.map(log => `
              <div class="log-entry ${log.success ? 'success' : 'error'}">
                <span class="log-time">${new Date(log.timestamp).toLocaleString()}</span>
                <span class="log-status">${log.success ? '✓' : '✗'} ${log.status || 'Failed'}</span>
                <span class="log-duration">${log.duration}ms</span>
                ${log.error ? `<span class="log-error">${log.error}</span>` : ''}
              </div>
            `).join('') : '<div class="no-logs">No logs yet</div>'}
        </div>
      </div>
    </div>
  `;

    // Add event listeners
    const nameInput = fieldEl.querySelector('.field-name-input');
    const sanitizedSpan = fieldEl.querySelector('.field-name-sanitized');
    const descInput = fieldEl.querySelector('.field-description');
    const removeBtn = fieldEl.querySelector('.remove-field-btn');
    const webhookToggle = fieldEl.querySelector('.webhook-toggle');
    const webhookUrlGroup = fieldEl.querySelector('.webhook-url-group');
    const webhookUrlInput = fieldEl.querySelector('.webhook-url-input');
    const webhookPayloadInput = fieldEl.querySelector('.webhook-payload-input');
    const toggleUrlBtn = fieldEl.querySelector('.toggle-url-visibility');
    const viewLogsBtn = fieldEl.querySelector('.view-logs-btn');
    const webhookLogs = fieldEl.querySelector('.webhook-logs');
    const closeLogsBtn = fieldEl.querySelector('.close-logs-btn');

    // Update field name
    nameInput.addEventListener('input', () => {
        field.friendlyName = nameInput.value;
        field.name = fieldManager.sanitizeFieldName(nameInput.value);
        sanitizedSpan.textContent = field.name;
        fieldManager.saveToStorage();
    });

    // Update description
    descInput.addEventListener('input', () => {
        field.description = descInput.value;
        fieldManager.saveToStorage();
    });

    // Remove field
    removeBtn.addEventListener('click', () => {
        if (confirm(`Remove field "${field.friendlyName}"?`)) {
            fieldManager.removeField(field.id);
            fieldEl.remove();
            fieldManager.saveToStorage();
        }
    });

    // Toggle webhook
    webhookToggle.addEventListener('change', () => {
        field.webhookEnabled = webhookToggle.checked;
        if (field.webhookEnabled || field.webhookUrl) {
            webhookUrlGroup.style.display = '';
            webhookPayloadInput.style.display = '';
        }
        fieldManager.saveToStorage();
    });

    // Toggle URL visibility
    if (toggleUrlBtn) {
        toggleUrlBtn.addEventListener('click', () => {
            field.showWebhookUrl = !field.showWebhookUrl;
            if (field.showWebhookUrl) {
                webhookUrlInput.value = field.webhookUrl;
                webhookUrlInput.classList.remove('masked');
                webhookUrlInput.removeAttribute('readonly');
                toggleUrlBtn.textContent = '🙈';
                toggleUrlBtn.title = 'Hide URL';
            } else {
                webhookUrlInput.value = fieldManager.maskWebhookUrl(field.webhookUrl);
                webhookUrlInput.classList.add('masked');
                webhookUrlInput.setAttribute('readonly', '');
                toggleUrlBtn.textContent = '👁️';
                toggleUrlBtn.title = 'Show/Edit URL';
            }
            fieldManager.saveToStorage();
        });
    }

    // Update webhook URL
    webhookUrlInput.addEventListener('input', () => {
        if (!field.showWebhookUrl && field.webhookUrlSaved) return; // Don't update if masked and saved
        field.webhookUrl = webhookUrlInput.value;
        fieldManager.saveToStorage();
    });

    // Handle URL field blur to mark as saved and mask
    webhookUrlInput.addEventListener('blur', () => {
        if (field.webhookUrl && !field.webhookUrlSaved) {
            field.webhookUrlSaved = true;
            field.showWebhookUrl = false;

            // Update UI to show masked URL
            setTimeout(() => {
                webhookUrlInput.value = fieldManager.maskWebhookUrl(field.webhookUrl);
                webhookUrlInput.classList.add('masked');
                webhookUrlInput.setAttribute('readonly', '');
                if (toggleUrlBtn) {
                    toggleUrlBtn.style.display = '';
                    toggleUrlBtn.textContent = '👁️';
                    toggleUrlBtn.title = 'Show/Edit URL';
                }
            }, 100); // Small delay to allow saving

            fieldManager.saveToStorage();
        }
    });

    // Update webhook payload
    webhookPayloadInput.addEventListener('input', () => {
        field.webhookPayload = webhookPayloadInput.value;
        fieldManager.saveToStorage();
    });

    // View logs
    if (viewLogsBtn) {
        viewLogsBtn.addEventListener('click', () => {
            webhookLogs.style.display = 'block';
        });
    }

    // Close logs
    if (closeLogsBtn) {
        closeLogsBtn.addEventListener('click', () => {
            webhookLogs.style.display = 'none';
        });
    }

    elements.fieldsContainer.appendChild(fieldEl);
}

// Update preset selector
function updatePresetSelector() {
    elements.presetSelector.innerHTML = '<option value="">Select a preset...</option>';
    Object.keys(fieldManager.presets).forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        elements.presetSelector.appendChild(option);
    });
}

// Display results
function displayResults(results) {
    if (!results) return;

    elements.resultsContainer.classList.add('show');

    let summaryHtml = '<div class="results-summary">Last Capture Results:</div>';

    if (results.reason) {
        summaryHtml += `<div class="reason-text">"${results.reason}"</div>`;
    }

    elements.resultsContainer.innerHTML = summaryHtml;
}

// Load saved settings
async function loadSettings() {
    try {
        const settings = await chrome.storage.local.get([
            'webhookUrl',
            `consent_${fieldManager.currentDomain}`,
            `interval_${fieldManager.currentDomain}`
        ]);

        if (settings.webhookUrl) {
            elements.webhookUrlInput.value = settings.webhookUrl;
        }

        if (settings[`consent_${fieldManager.currentDomain}`]) {
            elements.consentToggle.checked = settings[`consent_${fieldManager.currentDomain}`];
        }

        if (settings[`interval_${fieldManager.currentDomain}`]) {
            elements.intervalSelect.value = settings[`interval_${fieldManager.currentDomain}`];
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

// Show status message
function showStatus(message, type) {
    elements.statusDiv.textContent = message;
    elements.statusDiv.className = `status-message ${type}`;
    setTimeout(() => {
        elements.statusDiv.className = 'status-message';
    }, 3000);
}

// Load history from background
async function loadHistory() {
    chrome.runtime.sendMessage({ action: 'getRecentEvents' }, (response) => {
        if (response && response.events) {
            recentEvents = response.events;
            renderHistory();
        }
    });
}

// Render history items
function renderHistory() {
    const filteredEvents = showTrueOnly
        ? recentEvents.filter(e => e.hasTrueResult)
        : recentEvents;

    if (filteredEvents.length === 0) {
        elements.historyContainer.innerHTML = `
      <div class="history-empty">
        ${showTrueOnly ? 'No events with TRUE results yet' : 'No capture events yet'}
      </div>
    `;
        return;
    }

    elements.historyContainer.innerHTML = filteredEvents.map(event => {
        const timeAgo = getTimeAgo(new Date(event.timestamp));
        const unreadClass = event.hasTrueResult && !event.read ? 'unread' : '';

        const fieldsHtml = event.fields.map(field => `
      <div class="history-field ${field.result ? 'true' : 'false'}">
        <span class="history-field-indicator ${field.result ? 'true' : 'false'}"></span>
        <span>${field.name}: ${field.result ? 'TRUE' : 'FALSE'} (${(field.probability * 100).toFixed(0)}%)</span>
      </div>
    `).join('');

        return `
      <div class="history-item ${unreadClass}">
        <div class="history-header">
          <div class="history-domain">${event.domain}</div>
          <div class="history-time">${timeAgo}</div>
        </div>
        <div class="history-fields">${fieldsHtml}</div>
        ${event.reason ? `<div class="history-reason">${event.reason}</div>` : ''}
      </div>
    `;
    }).join('');
}

// Get human-readable time ago
function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    const intervals = {
        year: 31536000,
        month: 2592000,
        week: 604800,
        day: 86400,
        hour: 3600,
        minute: 60
    };

    for (const [unit, secondsInUnit] of Object.entries(intervals)) {
        const interval = Math.floor(seconds / secondsInUnit);
        if (interval >= 1) {
            return interval === 1 ? `1 ${unit} ago` : `${interval} ${unit}s ago`;
        }
    }

    return 'just now';
}

// Check if capture is currently active
chrome.runtime.sendMessage({
    action: 'checkStatus',
    domain: fieldManager.currentDomain,
    tabId: fieldManager.currentTabId
}, (response) => {
    if (response && response.isActive) {
        showStatus('Capture is currently active', 'info');
    }
}); 