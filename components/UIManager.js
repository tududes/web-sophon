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

        const sanitizedName = field.name;  // Use the actual field name (already sanitized and unique)
        // Show full URL if toggled to show OR if it hasn't been saved yet
        const displayWebhookUrl = (field.showWebhookUrl || !field.webhookUrlSaved) ? field.webhookUrl : this.fieldManager.maskWebhookUrl(field.webhookUrl);

        fieldEl.innerHTML = `
        <div class="field-header">
          <input type="text" 
                 class="field-name-input" 
                 placeholder="Field Name" 
                 value="${field.friendlyName || field.name}"
                 title="Enter a friendly name for this field">
          <span class="field-name-sanitized" title="LLM field identifier: ${sanitizedName}">${sanitizedName}</span>
          <button class="remove-field-btn">✕</button>
        </div>
        
        <textarea class="field-description" 
                  placeholder="Describe the criteria for evaluating this field...">${field.description}</textarea>
        
        <div class="field-state-config">
          <div class="field-state-header">
            <span>Field State (Previous Context & Meta-Evaluation)</span>
          </div>
          
          <div class="field-state-controls">
            <div class="expected-result-group">
              <label class="state-setting-label">Expected Result:</label>
              <select class="expected-result-dropdown">
                <option value="null" ${field.expectedResult === null ? 'selected' : ''}>Unset</option>
                <option value="true" ${field.expectedResult === true ? 'selected' : ''}>TRUE</option>
                <option value="false" ${field.expectedResult === false ? 'selected' : ''}>FALSE</option>
              </select>
            </div>
            
            <div class="confidence-threshold-group">
              <label class="state-setting-label">Confidence Threshold: <span class="threshold-value">${field.confidenceThreshold || 75}%</span></label>
              <input type="range" 
                     class="confidence-threshold-slider" 
                     min="0" max="100" step="5"
                     value="${field.confidenceThreshold || 75}">
            </div>
          </div>
        </div>
        
        <div class="field-webhook-config">
          <div class="webhook-toggle-group">
            <label class="toggle-switch">
              <input type="checkbox" class="webhook-toggle" ${field.webhookEnabled ? 'checked' : ''}>
              <span class="slider"></span>
            </label>
            <span>Fire webhook on result</span>
            ${field.webhookLogs && field.webhookLogs.length > 0 ?
                `<button class="view-logs-btn" title="View webhook logs">📋 Logs (${field.webhookLogs.length})</button>` : ''}
          </div>
          
          <div class="webhook-settings" style="${field.webhookEnabled ? '' : 'display: none;'}">
            <div class="webhook-trigger-group">
              <label class="webhook-setting-label">Trigger when result is:</label>
              <select class="webhook-trigger-dropdown">
                <option value="true" ${field.webhookTrigger !== false ? 'selected' : ''}>TRUE</option>
                <option value="false" ${field.webhookTrigger === false ? 'selected' : ''}>FALSE</option>
              </select>
            </div>
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

          <div class="webhook-confidence-group" style="${field.webhookEnabled || field.webhookUrl ? '' : 'display: none;'}">
            <label class="webhook-setting-label">Minimum Confidence: <span class="confidence-value">${field.webhookMinConfidence || 75}%</span></label>
            <input type="range" 
                   class="webhook-confidence-slider" 
                   min="0" max="100" step="5"
                   value="${field.webhookMinConfidence || 75}">
          </div>
          
          <textarea class="webhook-payload-input" 
                    placeholder='{ "content": "message" }'
                    style="${field.webhookEnabled ? '' : 'display: none;'}">${field.webhookPayload}</textarea>
          
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
        // Field state controls
        const expectedResultDropdown = fieldEl.querySelector('.expected-result-dropdown');
        const confidenceThresholdSlider = fieldEl.querySelector('.confidence-threshold-slider');
        const thresholdValueSpan = fieldEl.querySelector('.threshold-value');
        // Webhook controls
        const webhookToggle = fieldEl.querySelector('.webhook-toggle');
        const webhookTriggerDropdown = fieldEl.querySelector('.webhook-trigger-dropdown');
        const webhookSettings = fieldEl.querySelector('.webhook-settings');
        const webhookUrlGroup = fieldEl.querySelector('.webhook-url-group');
        const webhookConfidenceGroup = fieldEl.querySelector('.webhook-confidence-group');
        const webhookConfidenceSlider = fieldEl.querySelector('.webhook-confidence-slider');
        const confidenceValueSpan = fieldEl.querySelector('.confidence-value');
        const webhookUrlInput = fieldEl.querySelector('.webhook-url-input');
        const webhookPayloadInput = fieldEl.querySelector('.webhook-payload-input');
        const toggleUrlBtn = fieldEl.querySelector('.toggle-url-visibility');
        const viewLogsBtn = fieldEl.querySelector('.view-logs-btn');
        const webhookLogs = fieldEl.querySelector('.webhook-logs');
        const closeLogsBtn = fieldEl.querySelector('.close-logs-btn');

        // Update field name
        nameInput.addEventListener('input', () => {
            const newFriendlyName = nameInput.value;

            // Get the actual field from the manager to ensure we're updating the right reference
            const actualField = this.fieldManager.getField(field.id);
            if (!actualField) return;

            // Update the friendly name
            actualField.friendlyName = newFriendlyName;

            // Generate new sanitized name with uniqueness check
            const baseSanitizedName = this.fieldManager.sanitizeFieldName(newFriendlyName);
            let sanitizedName = baseSanitizedName;
            let incrementer = 1;

            // Ensure uniqueness (excluding this field)
            while (this.fieldManager.fields.some(f => f.name === sanitizedName && f.id !== actualField.id)) {
                sanitizedName = `${baseSanitizedName}_${incrementer}`;
                incrementer++;
            }

            // Update the sanitized name
            actualField.name = sanitizedName;

            // Update the displayed sanitized name
            sanitizedSpan.textContent = sanitizedName;

            // Save to storage
            this.fieldManager.saveToStorage();
        });

        // Update description
        descInput.addEventListener('input', () => {
            // Get the actual field from the manager to ensure we're updating the right reference
            const actualField = this.fieldManager.getField(field.id);
            if (!actualField) return;

            actualField.description = descInput.value;
            this.fieldManager.saveToStorage();
        });

        // Remove field
        removeBtn.addEventListener('click', () => {
            if (confirm(`Remove field "${field.friendlyName || field.name}"?`)) {
                // Remove from field manager
                this.fieldManager.removeField(field.id);
                // Remove from DOM
                fieldEl.remove();
                // Save to storage
                this.fieldManager.saveToStorage();
            }
        });

        // Field state controls
        // Update expected result
        if (expectedResultDropdown) {
            expectedResultDropdown.addEventListener('change', () => {
                const actualField = this.fieldManager.getField(field.id);
                if (!actualField) return;

                const value = expectedResultDropdown.value;
                if (value === 'null') {
                    actualField.expectedResult = null;
                } else {
                    actualField.expectedResult = value === 'true';
                }
                this.fieldManager.saveToStorage();
            });
        }

        // Update confidence threshold
        if (confidenceThresholdSlider && thresholdValueSpan) {
            confidenceThresholdSlider.addEventListener('input', () => {
                const actualField = this.fieldManager.getField(field.id);
                if (!actualField) return;

                const threshold = parseInt(confidenceThresholdSlider.value);
                actualField.confidenceThreshold = threshold;
                thresholdValueSpan.textContent = `${threshold}%`;
                this.fieldManager.saveToStorage();
            });
        }

        // Toggle webhook
        webhookToggle.addEventListener('change', () => {
            // Get the actual field from the manager to ensure we're updating the right reference
            const actualField = this.fieldManager.getField(field.id);
            if (!actualField) return;

            actualField.webhookEnabled = webhookToggle.checked;

            // Show/hide webhook settings
            if (actualField.webhookEnabled) {
                if (webhookSettings) webhookSettings.style.display = '';
            } else {
                if (webhookSettings) webhookSettings.style.display = 'none';
            }

            // Show/hide URL and confidence groups (show if enabled OR if URL exists)
            if (actualField.webhookEnabled || actualField.webhookUrl) {
                webhookUrlGroup.style.display = '';
                webhookConfidenceGroup.style.display = '';
            } else {
                webhookUrlGroup.style.display = 'none';
                webhookConfidenceGroup.style.display = 'none';
            }

            // Show/hide payload input (only when enabled)
            if (actualField.webhookEnabled) {
                webhookPayloadInput.style.display = '';
            } else {
                webhookPayloadInput.style.display = 'none';
            }

            this.fieldManager.saveToStorage();
        });

        // Toggle URL visibility
        if (toggleUrlBtn) {
            toggleUrlBtn.addEventListener('click', () => {
                // Get the actual field from the manager
                const actualField = this.fieldManager.getField(field.id);
                if (!actualField) return;

                actualField.showWebhookUrl = !actualField.showWebhookUrl;
                if (actualField.showWebhookUrl) {
                    webhookUrlInput.value = actualField.webhookUrl;
                    webhookUrlInput.classList.remove('masked');
                    webhookUrlInput.removeAttribute('readonly');
                    toggleUrlBtn.textContent = '🙈';
                    toggleUrlBtn.title = 'Hide URL';
                } else {
                    webhookUrlInput.value = this.fieldManager.maskWebhookUrl(actualField.webhookUrl);
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
            // Get the actual field from the manager
            const actualField = this.fieldManager.getField(field.id);
            if (!actualField) return;

            if (!actualField.showWebhookUrl && actualField.webhookUrlSaved) return; // Don't update if masked and saved
            actualField.webhookUrl = webhookUrlInput.value;
            this.fieldManager.saveToStorage();
        });

        // Handle URL field blur to mark as saved and mask
        webhookUrlInput.addEventListener('blur', () => {
            // Get the actual field from the manager
            const actualField = this.fieldManager.getField(field.id);
            if (!actualField) return;

            if (actualField.webhookUrl && !actualField.webhookUrlSaved) {
                actualField.webhookUrlSaved = true;
                actualField.showWebhookUrl = false;

                // Update UI to show masked URL
                setTimeout(() => {
                    webhookUrlInput.value = this.fieldManager.maskWebhookUrl(actualField.webhookUrl);
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
            // Get the actual field from the manager
            const actualField = this.fieldManager.getField(field.id);
            if (!actualField) return;

            actualField.webhookPayload = webhookPayloadInput.value;
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

        // Update confidence slider
        if (webhookConfidenceSlider && confidenceValueSpan) {
            webhookConfidenceSlider.addEventListener('input', () => {
                // Get the actual field from the manager
                const actualField = this.fieldManager.getField(field.id);
                if (!actualField) return;

                const confidence = parseInt(webhookConfidenceSlider.value);
                actualField.webhookMinConfidence = confidence;
                confidenceValueSpan.textContent = `${confidence}%`;
                this.fieldManager.saveToStorage();
            });
        }

        // Update webhook trigger (TRUE/FALSE)
        if (webhookTriggerDropdown) {
            webhookTriggerDropdown.addEventListener('change', () => {
                // Get the actual field from the manager
                const actualField = this.fieldManager.getField(field.id);
                if (!actualField) return;

                actualField.webhookTrigger = webhookTriggerDropdown.value === 'true';
                this.fieldManager.saveToStorage();
            });
        }
    }
} 