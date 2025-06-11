/**
 * Centralized State Management for WebSophon
 * Handles all state operations with proper error handling and event system
 */

export class StateManager {
    constructor() {
        this.state = {
            currentDomain: null,
            currentTabId: null,
            settings: {},
            fields: {},
            presets: {},
            history: [],
            domains: {}
        };

        this.listeners = new Map();
        this.isLoading = false;
        this.loadPromise = null;
    }

    /**
     * Initialize state from storage
     */
    async initialize() {
        if (this.loadPromise) {
            return this.loadPromise;
        }

        this.loadPromise = this._loadFromStorage();
        return this.loadPromise;
    }

    /**
     * Subscribe to state changes
     */
    subscribe(key, callback) {
        if (!this.listeners.has(key)) {
            this.listeners.set(key, new Set());
        }
        this.listeners.get(key).add(callback);

        // Return unsubscribe function
        return () => {
            const listeners = this.listeners.get(key);
            if (listeners) {
                listeners.delete(callback);
                if (listeners.size === 0) {
                    this.listeners.delete(key);
                }
            }
        };
    }

    /**
     * Emit state change to all listeners
     */
    _emit(key, data) {
        const listeners = this.listeners.get(key);
        if (listeners) {
            listeners.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in state listener for ${key}:`, error);
                }
            });
        }
    }

    /**
     * Set current domain and tab
     */
    setCurrentContext(domain, tabId) {
        const changed = this.state.currentDomain !== domain || this.state.currentTabId !== tabId;

        this.state.currentDomain = domain;
        this.state.currentTabId = tabId;

        if (changed) {
            this._emit('context', { domain, tabId });
        }
    }

    /**
     * Get domain-specific settings
     */
    getDomainSettings(domain = null) {
        const targetDomain = domain || this.state.currentDomain;
        if (!targetDomain) return {};

        return this.state.settings[targetDomain] || {};
    }

    /**
     * Update domain-specific settings
     */
    async updateDomainSettings(settings, domain = null) {
        const targetDomain = domain || this.state.currentDomain;
        if (!targetDomain) {
            throw new Error('No domain specified');
        }

        if (!this.state.settings[targetDomain]) {
            this.state.settings[targetDomain] = {};
        }

        Object.assign(this.state.settings[targetDomain], settings);
        await this._saveSettings();
        this._emit('settings', { domain: targetDomain, settings: this.state.settings[targetDomain] });
    }

    /**
     * Get domain-specific fields
     */
    getDomainFields(domain = null) {
        const targetDomain = domain || this.state.currentDomain;
        if (!targetDomain) return [];

        return this.state.fields[targetDomain] || [];
    }

    /**
     * Update domain-specific fields
     */
    async updateDomainFields(fields, domain = null) {
        const targetDomain = domain || this.state.currentDomain;
        if (!targetDomain) {
            throw new Error('No domain specified');
        }

        this.state.fields[targetDomain] = fields;
        await this._saveFields();
        this._emit('fields', { domain: targetDomain, fields });
    }

    /**
     * Get all presets
     */
    getPresets() {
        return this.state.presets;
    }

    /**
     * Save a preset
     */
    async savePreset(name, fields) {
        this.state.presets[name] = fields;
        await this._savePresets();
        this._emit('presets', this.state.presets);
    }

    /**
     * Delete a preset
     */
    async deletePreset(name) {
        delete this.state.presets[name];
        await this._savePresets();
        this._emit('presets', this.state.presets);
    }

    /**
     * Get history
     */
    getHistory() {
        return this.state.history;
    }

    /**
     * Add history entry
     */
    async addHistoryEntry(entry) {
        this.state.history.unshift(entry);

        // Keep only last 100 entries
        if (this.state.history.length > 100) {
            this.state.history = this.state.history.slice(0, 100);
        }

        await this._saveHistory();
        this._emit('history', this.state.history);
    }

    /**
     * Update history entry
     */
    async updateHistoryEntry(eventId, updates) {
        const index = this.state.history.findIndex(entry => entry.id === eventId);
        if (index !== -1) {
            Object.assign(this.state.history[index], updates);
            await this._saveHistory();
            this._emit('history', this.state.history);
        }
    }

    /**
     * Clear history
     */
    async clearHistory() {
        this.state.history = [];
        await this._saveHistory();
        this._emit('history', []);
    }

    /**
     * Get known domains
     */
    getKnownDomains() {
        return Object.keys(this.state.domains).filter(domain =>
            this.state.fields[domain] && this.state.fields[domain].length > 0
        );
    }

    /**
     * Register domain
     */
    async registerDomain(domain) {
        if (!this.state.domains[domain]) {
            this.state.domains[domain] = {
                firstSeen: new Date().toISOString(),
                lastAccessed: new Date().toISOString()
            };
        } else {
            this.state.domains[domain].lastAccessed = new Date().toISOString();
        }

        await this._saveDomains();
        this._emit('domains', this.getKnownDomains());
    }

    /**
     * Delete domain and all its data
     */
    async deleteDomain(domain) {
        delete this.state.domains[domain];
        delete this.state.fields[domain];
        delete this.state.settings[domain];

        // Remove history entries for this domain
        this.state.history = this.state.history.filter(entry => entry.domain !== domain);

        await Promise.all([
            this._saveDomains(),
            this._saveFields(),
            this._saveSettings(),
            this._saveHistory()
        ]);

        this._emit('domains', this.getKnownDomains());
        this._emit('history', this.state.history);
    }

    /**
     * Load state from Chrome storage
     */
    async _loadFromStorage() {
        try {
            this.isLoading = true;

            const keys = [
                'websophon_settings',
                'websophon_fields',
                'websophon_presets',
                'websophon_history',
                'websophon_domains'
            ];

            const data = await chrome.storage.local.get(keys);

            this.state.settings = data.websophon_settings || {};
            this.state.fields = data.websophon_fields || {};
            this.state.presets = data.websophon_presets || {};
            this.state.history = data.websophon_history || [];
            this.state.domains = data.websophon_domains || {};

        } catch (error) {
            console.error('Error loading state from storage:', error);
            throw new Error('Failed to load application state');
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Save settings to storage
     */
    async _saveSettings() {
        try {
            await chrome.storage.local.set({
                websophon_settings: this.state.settings
            });
        } catch (error) {
            console.error('Error saving settings:', error);
            throw new Error('Failed to save settings');
        }
    }

    /**
     * Save fields to storage
     */
    async _saveFields() {
        try {
            await chrome.storage.local.set({
                websophon_fields: this.state.fields
            });
        } catch (error) {
            console.error('Error saving fields:', error);
            throw new Error('Failed to save fields');
        }
    }

    /**
     * Save presets to storage
     */
    async _savePresets() {
        try {
            await chrome.storage.local.set({
                websophon_presets: this.state.presets
            });
        } catch (error) {
            console.error('Error saving presets:', error);
            throw new Error('Failed to save presets');
        }
    }

    /**
     * Save history to storage
     */
    async _saveHistory() {
        try {
            await chrome.storage.local.set({
                websophon_history: this.state.history
            });
        } catch (error) {
            console.error('Error saving history:', error);
            throw new Error('Failed to save history');
        }
    }

    /**
     * Save domains to storage
     */
    async _saveDomains() {
        try {
            await chrome.storage.local.set({
                websophon_domains: this.state.domains
            });
        } catch (error) {
            console.error('Error saving domains:', error);
            throw new Error('Failed to save domains');
        }
    }
} 