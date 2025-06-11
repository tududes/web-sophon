// Domain management functionality
export class DomainManager {
    constructor() {
        this.elements = {};
    }

    // Set DOM element references
    setElements(elements) {
        this.elements = elements;
    }

    // Load and display known domains
    async loadKnownDomains(currentDomain) {
        // Get all stored data
        const allData = await chrome.storage.sync.get(null);
        const domains = new Set();

        // Find all domain-specific field keys
        Object.keys(allData).forEach(key => {
            if (key.startsWith('fields_')) {
                const domain = key.replace('fields_', '');
                if (allData[key] && allData[key].length > 0) {
                    domains.add(domain);
                }
            }
        });

        // Also check local storage for domain-specific settings
        const localData = await chrome.storage.local.get(null);
        Object.keys(localData).forEach(key => {
            if (key.startsWith('consent_') || key.startsWith('interval_')) {
                const domain = key.split('_').slice(1).join('_');
                if (domain) domains.add(domain);
            }
        });

        if (domains.size === 0) {
            this.elements.domainsContainer.innerHTML = '<div class="domains-empty">No domain configurations saved yet</div>';
            return;
        }

        // Filter out current domain and render others
        const otherDomains = Array.from(domains).filter(d => d !== currentDomain);

        if (otherDomains.length === 0) {
            this.elements.domainsContainer.innerHTML = '<div class="domains-empty">No other domain configurations saved</div>';
            return;
        }

        // Render domains
        this.elements.domainsContainer.innerHTML = otherDomains.map(domain => `
        <div class="domain-item" data-domain="${domain}">
          <div class="domain-name">${domain}</div>
          <div class="domain-actions">
            <button class="small-button open-domain" data-domain="${domain}">Open</button>
            <button class="small-button danger delete-domain" data-domain="${domain}">Delete</button>
          </div>
        </div>
      `).join('');

        // Add click handlers
        this.attachDomainHandlers();
    }

    // Attach event handlers for domain actions
    attachDomainHandlers() {
        document.querySelectorAll('.open-domain').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const domain = btn.dataset.domain;
                chrome.tabs.create({ url: `https://${domain}` });
            });
        });

        document.querySelectorAll('.delete-domain').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const domain = btn.dataset.domain;
                if (confirm(`Delete all settings for ${domain}?`)) {
                    // Remove domain-specific data
                    await chrome.storage.sync.remove([`fields_${domain}`]);
                    await chrome.storage.local.remove([`consent_${domain}`, `interval_${domain}`]);
                    this.loadKnownDomains(); // Refresh
                    return { success: true, message: `Deleted settings for ${domain}` };
                }
            });
        });
    }
} 