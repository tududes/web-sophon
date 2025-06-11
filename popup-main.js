// Main popup entry point
import { FieldManager } from './components/FieldManager.js';
import { HistoryManager } from './components/HistoryManager.js';
import { UIManager } from './components/UIManager.js';
import { DomainManager } from './components/DomainManager.js';

// Initialize managers
const fieldManager = new FieldManager();
const historyManager = new HistoryManager();
const uiManager = new UIManager(fieldManager);
const domainManager = new DomainManager();

// DOM elements
let elements = {};

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
        clearHistoryBtn: document.getElementById('clear-history-btn'),
        domainsContainer: document.getElementById('domains-container'),
        testEventsBtn: document.getElementById('test-events-btn')
    };

    // Set elements in all managers
    uiManager.setElements(elements);
    historyManager.setElements(elements);
    domainManager.setElements(elements);

    // Show test button if in development mode
    if (window.location.href.includes('test') ||
        window.location.href.includes('localhost') ||
        localStorage.getItem('websophon-debug') === 'true') {
        elements.testEventsBtn.style.display = '';
        console.log('Debug mode enabled - showing test events button');
    }

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
    uiManager.renderFields();
    uiManager.updatePresetSelector();

    // Load and display history
    historyManager.loadHistory();

    // Load known domains
    domainManager.loadKnownDomains(fieldManager.currentDomain);

    // Set up last result click handler
    uiManager.setLastResultClickHandler((eventId) => {
        historyManager.scrollToEvent(eventId, historyManager.showTrueOnly, (showTrueOnly) => {
            elements.showTrueOnlyCheckbox.checked = showTrueOnly;
        });
    });

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
            uiManager.showStatus('Webhook URL saved', 'success');
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

        uiManager.showStatus('Interval updated', 'success');
    });

    // Handle consent toggle
    elements.consentToggle.addEventListener('change', async () => {
        const isEnabled = elements.consentToggle.checked;
        const webhookUrl = elements.webhookUrlInput.value.trim();

        if (isEnabled && !webhookUrl) {
            uiManager.showStatus('Please enter a webhook URL first', 'error');
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

        uiManager.showStatus(
            isEnabled ? 'Screenshot capture enabled' : 'Screenshot capture disabled',
            isEnabled ? 'success' : 'info'
        );
    });

    // Handle manual capture button
    elements.captureButton.addEventListener('click', handleManualCapture);

    // Add field button
    elements.addFieldBtn.addEventListener('click', () => {
        const field = fieldManager.addField();
        uiManager.renderFieldItem(field);
        fieldManager.saveToStorage();
    });

    // Preset selector
    elements.presetSelector.addEventListener('change', () => {
        const presetName = elements.presetSelector.value;
        if (presetName) {
            fieldManager.loadPreset(presetName);
            uiManager.renderFields();
            uiManager.showStatus(`Loaded preset: ${presetName}`, 'success');
        }
    });

    // Save preset button
    elements.savePresetBtn.addEventListener('click', () => {
        const name = prompt('Enter preset name:');
        if (name) {
            fieldManager.savePreset(name);
            fieldManager.saveToStorage();
            uiManager.updatePresetSelector();
            uiManager.showStatus(`Saved preset: ${name}`, 'success');
        }
    });

    // Delete preset button
    elements.deletePresetBtn.addEventListener('click', () => {
        const presetName = elements.presetSelector.value;
        if (presetName && confirm(`Delete preset "${presetName}"?`)) {
            fieldManager.deletePreset(presetName);
            fieldManager.saveToStorage();
            uiManager.updatePresetSelector();
            uiManager.showStatus(`Deleted preset: ${presetName}`, 'info');
        }
    });

    // Listen for capture complete messages
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'captureComplete') {
            if (message.success) {
                uiManager.showStatus('Screenshot sent successfully!', 'success');
            } else {
                uiManager.showStatus(`Failed: ${message.error}`, 'error');
            }
        } else if (message.action === 'captureStarted') {
            // A new capture has started
            uiManager.showStatus('Sending to webhook...', 'info');
            // Reload history to show pending event
            historyManager.loadHistory();
        } else if (message.action === 'captureResults') {
            // Handle results from n8n
            fieldManager.updateResults(message.results, message.eventId);
            uiManager.renderFields();
            uiManager.displayResults(message.results);
            // Reload history to show new event
            historyManager.loadHistory();
        } else if (message.action === 'eventUpdated') {
            // An event has been updated with response data
            historyManager.updateEvent(message.eventId, message.event);

            // If it's a field result update, update fields too
            if (message.event.fields && message.event.fields.length > 0) {
                // Convert field array back to object format expected by updateResults
                const fieldsObject = {};
                message.event.fields.forEach(field => {
                    fieldsObject[field.name] = {
                        boolean: field.result,
                        probability: field.probability
                    };
                });

                fieldManager.updateResults({
                    fields: fieldsObject,
                    reason: message.event.reason
                }, message.eventId);
                uiManager.renderFields();

                // Update the popup status to show completion
                if (message.event.error) {
                    uiManager.showStatus(`Request failed: ${message.event.error}`, 'error');
                } else if (message.event.status === 'completed') {
                    uiManager.showStatus('Webhook response received!', 'success');
                }
            } else if (message.event.status === 'completed' && message.event.error) {
                // No fields but there was an error
                uiManager.showStatus(`Request completed with error: ${message.event.error}`, 'error');
            }
        }
    });

    // History controls
    elements.showTrueOnlyCheckbox.addEventListener('change', () => {
        historyManager.setShowTrueOnly(elements.showTrueOnlyCheckbox.checked);
        historyManager.renderHistory();
    });

    elements.clearHistoryBtn.addEventListener('click', () => {
        const result = historyManager.clearHistory();
        if (result && result.success) {
            uiManager.showStatus(result.message, 'info');
        }
    });

    // Test events button (for debugging)
    if (elements.testEventsBtn) {
        elements.testEventsBtn.addEventListener('click', () => {
            const result = historyManager.createTestEvents(fieldManager.currentDomain);
            if (result && result.success) {
                uiManager.showStatus(result.message, 'info');
            }
        });
    }
}

// Handle manual capture
async function handleManualCapture() {
    const webhookUrl = elements.webhookUrlInput.value.trim();

    if (!webhookUrl) {
        uiManager.showStatus('Please enter a webhook URL first', 'error');
        return;
    }

    // Prepare fields data
    const fields = fieldManager.getFieldsForAPI();
    if (fields.length === 0) {
        uiManager.showStatus('Please add at least one field', 'error');
        return;
    }

    // Disable button temporarily
    elements.captureButton.disabled = true;
    elements.captureButton.textContent = '⏳ Capturing...';

    try {
        const response = await new Promise((resolve, reject) => {
            // Much longer timeout for background script communication (60 seconds)
            const timeout = setTimeout(() => {
                reject(new Error('Background script not responding'));
            }, 60000);

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
            uiManager.showStatus('Screenshot captured and sent!', 'success');
        } else {
            uiManager.showStatus(`Capture failed: ${response.error || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        uiManager.showStatus(`Error: ${error.message}`, 'error');
        console.error('Capture error:', error);
    } finally {
        // Re-enable button
        elements.captureButton.disabled = false;
        elements.captureButton.textContent = '📸 Capture Screenshot Now';
    }
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

// Check if capture is currently active
chrome.runtime.sendMessage({
    action: 'checkStatus',
    domain: fieldManager.currentDomain,
    tabId: fieldManager.currentTabId
}, (response) => {
    if (response && response.isActive) {
        uiManager.showStatus('Capture is currently active', 'info');
    }
}); 