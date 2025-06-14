// LLM-only Field Management
export class FieldManagerLLM {
    constructor() {
        this.fields = [];
        this.presets = {};
        this.currentDomain = '';
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
            name: this.sanitizeFieldName(data.friendlyName || data.name || ''),
            friendlyName: data.friendlyName || data.name || '',
            description: data.description || '',
            // Result tracking
            result: null,
            probability: null,
            lastStatus: null, // 'success', 'error', 'pending'
            lastError: null,
            lastEventId: null,
            lastResultTime: null,
            isPending: false
        };
        this.fields.push(field);
        return field;
    }

    // Convert friendly name to safe field name (must match LLM response format)
    sanitizeFieldName(friendlyName) {
        if (!friendlyName) return 'unnamed_field';
        return friendlyName.toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
            .replace(/^_+|_+$/g, '')
            .replace(/_+/g, '_') || 'unnamed_field';
    }

    // Remove a field
    removeField(fieldId) {
        this.fields = this.fields.filter(f => f.id !== fieldId);
    }

    // Update field properties
    updateField(fieldId, updates) {
        const field = this.fields.find(f => f.id === fieldId);
        if (!field) return false;

        Object.assign(field, updates);

        // Update computed properties
        if (updates.name || updates.friendlyName) {
            field.name = this.sanitizeFieldName(field.friendlyName || field.name);
        }

        return true;
    }

    // Get field by ID
    getField(fieldId) {
        return this.fields.find(f => f.id === fieldId);
    }

    // Get fields for API (clean format expected by LLM)
    getFieldsForAPI() {
        return this.fields
            .filter(f => f.friendlyName && f.description) // Only valid fields
            .map(f => ({
                name: f.name, // Sanitized name
                criteria: f.description.trim()
            }));
    }

    // Mark fields as pending when a request starts
    markFieldsPending(eventId = null) {
        this.fields.forEach(field => {
            field.isPending = true;
            field.lastStatus = 'pending';
            field.lastEventId = eventId;
            field.lastError = null;
            field.lastResultTime = new Date().toISOString();
        });
    }

    // Update field results from LLM response
    updateResults(results, eventId = null) {
        if (!results || !results.fields) {
            console.warn('Invalid results format:', results);
            return;
        }

        console.log('Updating field results:', results.fields);

        // Update each field by matching sanitized names
        this.fields.forEach(field => {
            const result = results.fields[field.name]; // Match by sanitized name
            if (result !== undefined) {
                // Handle different result formats
                let resultValue = null;
                let probabilityValue = null;

                if (Array.isArray(result) && result.length >= 2) {
                    // Format: [boolean, probability]
                    resultValue = result[0];
                    probabilityValue = result[1];
                } else if (typeof result === 'object' && result !== null) {
                    // Format: {boolean: true, probability: 0.95}
                    resultValue = result.boolean !== undefined ? result.boolean : result.result;
                    probabilityValue = result.probability;
                } else {
                    // Simple boolean
                    resultValue = result;
                }

                // Update field state
                field.result = resultValue;
                field.probability = probabilityValue;
                field.lastStatus = 'success';
                field.lastError = null;
                field.isPending = false;
                field.lastEventId = eventId;
                field.lastResultTime = new Date().toISOString();

                console.log(`Updated field "${field.friendlyName}" (${field.name}):`, {
                    result: resultValue,
                    probability: probabilityValue
                });
            } else {
                console.warn(`No result found for field "${field.friendlyName}" (${field.name})`);
            }
        });

        this.lastResults = results;
    }

    // Mark fields with error when request fails
    markFieldsError(error, httpStatus = null, eventId = null) {
        this.fields.forEach(field => {
            if (field.lastEventId === eventId || eventId === null) {
                field.isPending = false;
                field.lastStatus = 'error';
                field.lastError = error;
                field.lastResultTime = new Date().toISOString();
                // Clear previous results on error
                field.result = null;
                field.probability = null;
            }
        });
    }

    // Mark fields as cancelled
    markFieldsCancelled(eventId = null) {
        this.fields.forEach(field => {
            if (field.isPending && (field.lastEventId === eventId || eventId === null)) {
                field.isPending = false;
                field.lastStatus = 'cancelled';
                field.lastError = 'Request cancelled';
                field.lastResultTime = new Date().toISOString();
                // Don't clear results on cancellation, keep previous ones
            }
        });
    }

    // Save current fields as preset
    savePreset(name) {
        if (!name || !name.trim()) return false;

        // Clean field data for preset (remove result state)
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

    // Load preset
    loadPreset(name) {
        const preset = this.presets[name];
        if (!preset || !preset.fields) return false;

        // Replace current fields with preset fields (with new IDs)
        this.fields = preset.fields.map(fieldData => ({
            ...fieldData,
            id: this.generateFieldId(), // Generate new ID to avoid conflicts
            result: null,
            probability: null,
            lastStatus: null,
            lastError: null,
            lastEventId: null,
            lastResultTime: null,
            isPending: false
        }));

        return true;
    }

    // Delete preset
    deletePreset(name) {
        if (this.presets[name]) {
            delete this.presets[name];
            return true;
        }
        return false;
    }

    // Get preset names
    getPresetNames() {
        return Object.keys(this.presets).sort();
    }

    // Save to storage (domain-specific fields + global presets)
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

    // Load from storage
    async loadFromStorage() {
        try {
            const domainKey = `fields_${this.currentDomain}`;
            const data = await chrome.storage.local.get([domainKey, 'fieldPresets']);

            // Load domain-specific fields
            this.fields = data[domainKey] || [];

            // Load global presets
            this.presets = data.fieldPresets || {};

            console.log(`Loaded ${this.fields.length} fields for domain: ${this.currentDomain}`);
            console.log(`Loaded ${Object.keys(this.presets).length} presets`);

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
                isPending: field.isPending || false
            }));

        } catch (error) {
            console.error('Error loading from storage:', error);
            this.fields = [];
            this.presets = {};
        }
    }

    // Get validation errors for current fields
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

        // Check for duplicate sanitized names
        const sanitizedNames = new Set();
        this.fields.forEach((field, index) => {
            if (sanitizedNames.has(field.name)) {
                errors.push(`Field ${index + 1}: Duplicate name "${field.friendlyName}" (conflicts with sanitized name "${field.name}")`);
            }
            sanitizedNames.add(field.name);
        });

        return errors;
    }

    // Get summary of current state
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