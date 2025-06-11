// Field management and preset functionality
export class FieldManager {
    constructor(eventService = null) {
        this.fields = [];
        this.presets = {};
        this.currentDomain = '';
        this.currentTabId = null;
        this.lastResults = null;
        this.eventService = eventService; // For recording field webhook events
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
            probability: null,
            // Enhanced tracking fields
            lastStatus: null, // 'success', 'error', 'pending', 'cancelled'
            lastError: null, // Store last error message
            lastHttpStatus: null, // Store HTTP status code
            lastRequestTime: null, // When the request was initiated
            lastResponseTime: null, // When the response was received
            isPending: false // Track if currently pending
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
    updateResults(results, eventId = null) {
        if (!results || !results.fields) return;

        this.fields.forEach(field => {
            const sanitizedName = this.sanitizeFieldName(field.friendlyName || field.name);
            const result = results.fields[sanitizedName];
            if (result) {
                field.result = result.boolean;
                field.probability = result.probability;
                field.lastEventId = eventId; // Store event ID for linking to history
                field.lastResultTime = new Date().toISOString();
                field.lastResponseTime = new Date().toISOString();
                field.lastStatus = 'success';
                field.lastError = null;
                field.isPending = false;
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
        const eventId = Date.now() + Math.random(); // Unique ID for field webhook event

        let logEntry = {
            fieldName: field.friendlyName,
            success: false,
            error: null,
            duration: 0
        };

        let finalError = null;
        let responseText = '';
        let responseData = null;
        let httpStatus = null;

        try {
            let payload = {};
            try {
                payload = JSON.parse(field.webhookPayload);
            } catch (e) {
                logEntry.error = 'Invalid JSON payload';
                finalError = 'Invalid JSON payload';
                responseText = finalError;
                this.addWebhookLog(field.id, logEntry);

                // Record in main event history if EventService is available
                if (this.eventService) {
                    this.eventService.trackEvent(
                        null, // No response data
                        this.currentDomain,
                        `Field Webhook: ${field.friendlyName}`,
                        false, // Not successful
                        finalError,
                        null, // No error (this is validation error)
                        null, // No screenshot for field webhooks
                        {
                            fieldName: field.friendlyName,
                            webhookUrl: this.maskWebhookUrl(field.webhookUrl),
                            payload: field.webhookPayload,
                            type: 'field_webhook'
                        },
                        responseText,
                        eventId,
                        'error'
                    );
                }

                console.error('Invalid JSON payload for field:', field.friendlyName);
                return;
            }

            // Record the pending field webhook event
            if (this.eventService) {
                this.eventService.trackEvent(
                    null, // No response data yet
                    this.currentDomain,
                    `Field Webhook: ${field.friendlyName}`,
                    false, // Not successful yet
                    null,
                    null,
                    null, // No screenshot for field webhooks
                    {
                        fieldName: field.friendlyName,
                        webhookUrl: this.maskWebhookUrl(field.webhookUrl),
                        payload: payload,
                        type: 'field_webhook'
                    },
                    null, // No response yet
                    eventId,
                    'pending'
                );
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
            httpStatus = response.status;

            // ALWAYS try to get response text, regardless of status code
            try {
                responseText = await response.text();
                console.log(`Field webhook response text for ${field.friendlyName}:`, responseText);
            } catch (textError) {
                console.log(`Failed to read response text for field ${field.friendlyName}:`, textError);
                responseText = `Failed to read response: ${textError.message}`;
            }

            // Try to parse response as JSON if we have text
            if (responseText) {
                try {
                    responseData = JSON.parse(responseText);
                    console.log(`Field webhook parsed response for ${field.friendlyName}:`, responseData);
                } catch (e) {
                    console.log(`Field webhook response was not JSON for ${field.friendlyName}:`, e);
                    // responseText is preserved for non-JSON responses
                }
            }

            if (!response.ok) {
                finalError = `HTTP ${response.status}: ${response.statusText}`;
                logEntry.error = finalError;
            }

            console.log(`Webhook fired for field ${field.friendlyName}: ${response.status}`);
        } catch (error) {
            logEntry.duration = Date.now() - startTime;
            logEntry.error = error.message;
            finalError = error.message;
            responseText = error.message; // Use error message as response for fetch errors
            console.error('Error firing webhook:', error);
        }

        this.addWebhookLog(field.id, logEntry);

        // Update the field webhook event in main history if EventService is available
        if (this.eventService) {
            this.eventService.updateEvent(eventId, responseData, httpStatus, finalError, responseText);
        }
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
        await this.saveDomainFields();
        await chrome.storage.sync.set({
            presets: this.presets
        });
    }

    // Load from storage
    async loadFromStorage() {
        // Load domain-specific fields
        const domainKey = `fields_${this.currentDomain}`;
        const data = await chrome.storage.sync.get([domainKey, 'presets']);
        if (data[domainKey]) {
            this.fields = data[domainKey];
        } else {
            this.fields = [];
        }
        if (data.presets) this.presets = data.presets;
    }

    // Save domain-specific fields
    async saveDomainFields() {
        const domainKey = `fields_${this.currentDomain}`;
        const saveData = {};
        saveData[domainKey] = this.fields;
        await chrome.storage.sync.set(saveData);
    }

    // Mark fields as pending when a request starts
    markFieldsPending(eventId = null) {
        this.fields.forEach(field => {
            field.isPending = true;
            field.lastStatus = 'pending';
            field.lastRequestTime = new Date().toISOString();
            field.lastEventId = eventId;
            field.lastError = null;
        });
    }

    // Mark fields with error when request fails
    markFieldsError(error, httpStatus = null, eventId = null) {
        this.fields.forEach(field => {
            field.isPending = false;
            field.lastStatus = 'error';
            field.lastError = error;
            field.lastHttpStatus = httpStatus;
            field.lastResponseTime = new Date().toISOString();
            field.lastEventId = eventId;
            // Clear previous results on error
            field.result = null;
            field.probability = null;
        });
    }

    // Mark fields as cancelled
    markFieldsCancelled(eventId = null) {
        this.fields.forEach(field => {
            if (field.isPending && field.lastEventId === eventId) {
                field.isPending = false;
                field.lastStatus = 'cancelled';
                field.lastResponseTime = new Date().toISOString();
                field.lastError = 'Request cancelled by user';
                // Clear previous results on cancellation
                field.result = null;
                field.probability = null;
            }
        });
    }

    // Update fields with HTTP status (for non-200 responses)
    updateFieldsHttpStatus(httpStatus, eventId = null) {
        this.fields.forEach(field => {
            if (field.lastEventId === eventId) {
                field.lastHttpStatus = httpStatus;
                field.lastResponseTime = new Date().toISOString();
                field.isPending = false;
                if (httpStatus >= 400) {
                    field.lastStatus = 'error';
                } else if (httpStatus >= 200 && httpStatus < 300) {
                    field.lastStatus = 'success';
                }
            }
        });
    }
} 