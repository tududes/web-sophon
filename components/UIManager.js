// UI management and field rendering functionality
import { getTimeAgo } from '../utils/formatters.js';

export class UIManager {
    constructor(fieldManager) {
        this.fieldManager = fieldManager;
        this.elements = {};
    }

    // Set DOM element references
    setElements(elements) {
        this.elements = elements;
    }

    // Show status message
    showStatus(message, type) {
        this.elements.statusDiv.textContent = message;
        this.elements.statusDiv.className = `status-message ${type}`;
        setTimeout(() => {
            this.elements.statusDiv.className = 'status-message';
        }, 3000);
    }

    // Display results from webhook
    displayResults(results) {
        if (!results) return;

        this.elements.resultsContainer.classList.add('show');

        let summaryHtml = '<div class="results-summary">Last Capture Results:</div>';

        if (results.reason) {
            summaryHtml += `<div class="reason-text">"${results.reason}"</div>`;
        }

        this.elements.resultsContainer.innerHTML = summaryHtml;
    }

    // Update preset selector
    updatePresetSelector() {
        this.elements.presetSelector.innerHTML = '<option value="">Select a preset...</option>';
        Object.keys(this.fieldManager.presets).forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            this.elements.presetSelector.appendChild(option);
        });
    }

    // Render all fields
    renderFields() {
        this.elements.fieldsContainer.innerHTML = '';
        this.fieldManager.fields.forEach(field => this.renderFieldItem(field));

        // Save after rendering
        this.fieldManager.saveToStorage();
    }

    // Render a single field item
    renderFieldItem(field) {
        const fieldEl = document.createElement('div');
        fieldEl.className = 'field-item';
        fieldEl.dataset.fieldId = field.id;

        const sanitizedName = this.fieldManager.sanitizeFieldName(field.friendlyName || field.name);
        // Show full URL if toggled to show OR if it hasn't been saved yet
        const displayWebhookUrl = (field.showWebhookUrl || !field.webhookUrlSaved) ? field.webhookUrl : this.fieldManager.maskWebhookUrl(field.webhookUrl);

        // Format last result display
        let lastResultHtml = '';
        if (field.lastResultTime) {
            const timeAgo = getTimeAgo(new Date(field.lastResultTime));
            lastResultHtml = `
                <div class="field-last-result ${field.result === true ? 'true' : field.result === false ? 'false' : ''}" 
                     data-event-id="${field.lastEventId || ''}"
                     title="Click to view in history">
                    <span class="last-result-indicator ${field.result === true ? 'true' : 'false'}"></span>
                    <span class="last-result-text">Last: ${field.result === true ? 'TRUE' : 'FALSE'} ${timeAgo}</span>
                    ${field.probability !== null ? `<span class="last-result-probability">(${(field.probability * 100).toFixed(0)}%)</span>` : ''}
                </div>
            `;
        }

        fieldEl.innerHTML = `
        ${lastResultHtml}
        
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

        // Add event listeners for this field
        this.attachFieldHandlers(fieldEl, field);

        this.elements.fieldsContainer.appendChild(fieldEl);
    }

    // Attach event handlers to a single field item
    attachFieldHandlers(fieldEl, field) {
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
        const lastResultEl = fieldEl.querySelector('.field-last-result');

        // Click last result to view in history (callback will be provided by main popup)
        if (lastResultEl) {
            lastResultEl.addEventListener('click', () => {
                const eventId = lastResultEl.dataset.eventId;
                if (eventId && this.onLastResultClick) {
                    this.onLastResultClick(eventId);
                }
            });
        }

        // Update field name
        nameInput.addEventListener('input', () => {
            field.friendlyName = nameInput.value;
            field.name = this.fieldManager.sanitizeFieldName(nameInput.value);
            sanitizedSpan.textContent = field.name;
            this.fieldManager.saveToStorage();
        });

        // Update description
        descInput.addEventListener('input', () => {
            field.description = descInput.value;
            this.fieldManager.saveToStorage();
        });

        // Remove field
        removeBtn.addEventListener('click', () => {
            if (confirm(`Remove field "${field.friendlyName}"?`)) {
                this.fieldManager.removeField(field.id);
                fieldEl.remove();
                this.fieldManager.saveToStorage();
            }
        });

        // Toggle webhook
        webhookToggle.addEventListener('change', () => {
            field.webhookEnabled = webhookToggle.checked;
            if (field.webhookEnabled || field.webhookUrl) {
                webhookUrlGroup.style.display = '';
                webhookPayloadInput.style.display = '';
            }
            this.fieldManager.saveToStorage();
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
                    webhookUrlInput.value = this.fieldManager.maskWebhookUrl(field.webhookUrl);
                    webhookUrlInput.classList.add('masked');
                    webhookUrlInput.setAttribute('readonly', '');
                    toggleUrlBtn.textContent = '👁️';
                    toggleUrlBtn.title = 'Show/Edit URL';
                }
                this.fieldManager.saveToStorage();
            });
        }

        // Update webhook URL
        webhookUrlInput.addEventListener('input', () => {
            if (!field.showWebhookUrl && field.webhookUrlSaved) return; // Don't update if masked and saved
            field.webhookUrl = webhookUrlInput.value;
            this.fieldManager.saveToStorage();
        });

        // Handle URL field blur to mark as saved and mask
        webhookUrlInput.addEventListener('blur', () => {
            if (field.webhookUrl && !field.webhookUrlSaved) {
                field.webhookUrlSaved = true;
                field.showWebhookUrl = false;

                // Update UI to show masked URL
                setTimeout(() => {
                    webhookUrlInput.value = this.fieldManager.maskWebhookUrl(field.webhookUrl);
                    webhookUrlInput.classList.add('masked');
                    webhookUrlInput.setAttribute('readonly', '');
                    if (toggleUrlBtn) {
                        toggleUrlBtn.style.display = '';
                        toggleUrlBtn.textContent = '👁️';
                        toggleUrlBtn.title = 'Show/Edit URL';
                    }
                }, 100); // Small delay to allow saving

                this.fieldManager.saveToStorage();
            }
        });

        // Update webhook payload
        webhookPayloadInput.addEventListener('input', () => {
            field.webhookPayload = webhookPayloadInput.value;
            this.fieldManager.saveToStorage();
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
    }

    // Set callback for last result click (to be provided by main popup)
    setLastResultClickHandler(callback) {
        this.onLastResultClick = callback;
    }
} 