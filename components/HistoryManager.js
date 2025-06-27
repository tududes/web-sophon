// History management functionality
import { getTimeAgo, formatResponseData, downloadScreenshot, handleImageZoom, resetImageZoom } from '../utils/formatters.js';

export class HistoryManager {
    constructor() {
        this.recentEvents = [];
        this.showTrueOnly = false;
        this.elements = {};
        this.isScrolling = false; // Prevent multiple scroll operations
    }

    // Set DOM element references
    setElements(elements) {
        this.elements = elements;
    }

    // Set show true only filter
    setShowTrueOnly(showTrueOnly) {
        this.showTrueOnly = showTrueOnly;
    }

    // Load history from background and storage
    async loadHistory() {
        console.log('Loading history...');

        try {
            // First try to get from background script (most current)
            const response = await this.getEventsFromBackground();

            if (response && response.events && Array.isArray(response.events)) {
                console.log('Loaded events from background:', response.events.length);
                this.recentEvents = response.events;
                this.renderHistory();
            } else {
                console.log('No valid response from background, loading from storage directly');
                await this.loadFromStorageDirect();
            }
        } catch (error) {
            console.error('Error loading history:', error);
            // Fallback to direct storage loading
            await this.loadFromStorageDirect();
        }
    }

    // Get events from background with promise wrapper
    async getEventsFromBackground() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Background request timeout'));
            }, 3000); // 3 second timeout

            chrome.runtime.sendMessage({ action: 'getRecentEvents' }, (response) => {
                clearTimeout(timeout);

                if (chrome.runtime.lastError) {
                    console.log('Background communication error:', chrome.runtime.lastError.message);
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(response);
                }
            });
        });
    }

    // Load directly from storage as fallback
    async loadFromStorageDirect() {
        try {
            const storage = await chrome.storage.local.get(['recentEvents']);
            if (storage.recentEvents && Array.isArray(storage.recentEvents)) {
                this.recentEvents = storage.recentEvents;
                console.log('Loaded events from storage:', this.recentEvents.length);
            } else {
                console.log('No events found in storage');
                this.recentEvents = [];
            }
            this.renderHistory();
        } catch (error) {
            console.error('Error loading events from storage:', error);
            this.recentEvents = [];
            this.renderHistory();
        }
    }

    // Save events to storage for persistence
    async saveToStorage() {
        try {
            await chrome.storage.local.set({ recentEvents: this.recentEvents });
            console.log('Events saved to storage:', this.recentEvents.length);
        } catch (error) {
            console.error('Failed to save events to storage:', error);
        }
    }

    // Clear history
    clearHistory() {
        if (confirm('Clear all event history?')) {
            // Clear local array
            this.recentEvents = [];

            // Save empty state to storage
            this.saveToStorage();
            this.renderHistory();

            // Tell background script to clear its array too
            chrome.runtime.sendMessage({ action: 'clearHistory' }, (response) => {
                if (response && response.success) {
                    return { success: true, message: 'History cleared' };
                }
            });
        }
    }

    // Update specific event when response arrives
    updateEvent(eventId, event) {
        console.log('Received eventUpdated message for event:', eventId);
        // An event has been updated with response data
        // Update the specific event in our local array
        const eventIndex = this.recentEvents.findIndex(e => e.id === eventId);
        if (eventIndex !== -1) {
            console.log('Updating event in local array:', event);
            this.recentEvents[eventIndex] = event;

            // Save updated events to storage
            this.saveToStorage();
            this.renderHistory();
        } else {
            console.log('Event not found in local array, reloading history');
            // Event not in our array, reload history
            this.loadHistory();
        }
    }

    // Find event by ID and scroll to it
    scrollToEvent(eventId, showTrueOnly, onToggleFilter) {
        // Prevent multiple simultaneous scroll operations
        if (this.isScrolling) {
            console.log('Scroll operation already in progress, ignoring');
            return;
        }

        const eventIndex = this.recentEvents.findIndex(e => e.id == eventId || e.id == parseInt(eventId));
        if (eventIndex !== -1) {
            this.isScrolling = true;

            // Show all events if needed
            if (showTrueOnly && !this.recentEvents[eventIndex].hasTrueResult) {
                onToggleFilter(false);
                this.setShowTrueOnly(false);
                this.renderHistory();
            }

            // Scroll to history section with instant behavior to avoid conflicts
            const historySection = Array.from(document.querySelectorAll('.section')).find(
                section => section.querySelector('#history-container')
            );
            if (historySection) {
                // Use instant scroll to prevent fighting with user scrolling
                historySection.scrollIntoView({ behavior: 'auto', block: 'start' });
            }

            // Highlight and expand the event with a shorter delay
            setTimeout(() => {
                const historyItem = document.querySelector(`[data-event-id="${eventId}"]`);
                if (historyItem) {
                    // Add highlight class
                    historyItem.classList.add('highlight');

                    // Expand the item by directly manipulating the details instead of clicking
                    const details = historyItem.querySelector('.history-details');
                    if (details && details.style.display === 'none') {
                        details.style.display = 'block';
                        historyItem.classList.add('expanded');
                    }

                    // Scroll the specific item into view without smooth behavior
                    historyItem.scrollIntoView({ behavior: 'auto', block: 'center' });

                    // Remove highlight after animation
                    setTimeout(() => {
                        historyItem.classList.remove('highlight');
                        // Reset scroll flag after animation completes
                        this.isScrolling = false;
                    }, 2000);
                } else {
                    // Reset flag if item not found
                    this.isScrolling = false;
                }
            }, 200); // Reduced delay
        }
    }

    // Create test events for debugging
    createTestEvents(currentDomain) {
        const testEvents = [
            {
                id: Date.now() + 1,
                timestamp: new Date().toISOString(),
                domain: currentDomain,
                url: 'https://example.com/test-pending',
                success: true,
                httpStatus: null,
                error: null,
                fields: [],
                reason: '',
                hasTrueResult: false,
                read: false,
                screenshot: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
                request: { test: 'pending request' },
                response: null,
                status: 'pending',
                source: 'cloud'
            },
            {
                id: Date.now() + 2,
                timestamp: new Date(Date.now() - 60000).toISOString(),
                domain: currentDomain,
                url: 'https://example.com/test-success',
                success: true,
                httpStatus: 200,
                error: null,
                fields: [
                    { name: 'test_field', result: true, probability: 0.95 },
                    { name: 'another_field', result: false, probability: 0.23 }
                ],
                reason: 'Test evaluation completed successfully',
                hasTrueResult: true,
                read: false,
                screenshot: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
                request: { test: 'success request' },
                response: '{"fields":{"test_field":{"boolean":true,"probability":0.95},"another_field":{"boolean":false,"probability":0.23}},"reason":"Test evaluation completed successfully"}',
                status: 'completed',
                source: 'local'
            },
            {
                id: Date.now() + 3,
                timestamp: new Date(Date.now() - 120000).toISOString(),
                domain: currentDomain,
                url: 'https://example.com/test-error',
                success: false,
                httpStatus: 500,
                error: 'Internal Server Error',
                fields: [],
                reason: '',
                hasTrueResult: false,
                read: false,
                screenshot: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
                request: { test: 'error request' },
                response: '{"error":"Internal server error"}',
                status: 'completed'
            }
        ];

        // Add test events to the beginning of the array and maintain limit
        this.recentEvents = testEvents.concat(this.recentEvents);

        // Keep only last 50 events
        if (this.recentEvents.length > 50) {
            this.recentEvents = this.recentEvents.slice(0, 50);
        }

        // Save to storage to persist
        this.saveToStorage();
        this.renderHistory();
        return { success: true, message: 'Test events created' };
    }

    // Cancel a pending request
    cancelRequest(eventId) {
        if (confirm('Cancel this request?')) {
            chrome.runtime.sendMessage({
                action: 'cancelRequest',
                eventId: parseInt(eventId)
            }, (response) => {
                if (response && response.success) {
                    return { success: true, message: 'Request cancelled' };
                } else {
                    return { success: false, message: 'Failed to cancel request' };
                }
            });
        }
    }

    // Render history items with cloud job grouping
    renderHistory() {
        const filteredEvents = this.showTrueOnly
            ? this.recentEvents.filter(e => e.hasTrueResult)
            : this.recentEvents;

        if (filteredEvents.length === 0) {
            this.elements.historyContainer.innerHTML = `
              <div class="history-empty">
                <div class="empty-state">
                    <div class="empty-icon">📊</div>
                    <h3>No History Yet</h3>
                    <p>${this.showTrueOnly ? 'No events with TRUE results found.' : 'No capture events recorded yet.'}</p>
                    <div class="empty-actions">
                        <p>To get started:</p>
                        <ol>
                            <li>Add some fields in the Fields tab</li>
                            <li>Enable WebSophon for this domain</li>
                            <li>Click "Capture Screenshot Now"</li>
                        </ol>
                    </div>
                </div>
              </div>
            `;
            return;
        }

        // Group events by job ID for cloud jobs
        const groupedEvents = this.groupEventsByJob(filteredEvents);

        this.elements.historyContainer.innerHTML = groupedEvents.map((group, groupIndex) => {
            if (group.isGroup) {
                // Render cloud job group
                return this.renderCloudJobGroup(group, groupIndex);
            } else {
                // Render individual event (local/manual)
                return this.renderIndividualEvent(group.event, groupIndex);
            }
        }).join('');

        // Add click handlers after rendering
        this.attachEventHandlers();
    }

    // Group events by job ID for cloud jobs
    groupEventsByJob(events) {
        const groups = [];
        const cloudGroups = new Map();

        events.forEach(event => {
            if (event.source === 'cloud' && event.request && event.request.jobId) {
                // This is a cloud job result
                const jobId = event.request.jobId;
                if (!cloudGroups.has(jobId)) {
                    cloudGroups.set(jobId, {
                        isGroup: true,
                        jobId: jobId,
                        domain: event.domain,
                        events: [],
                        firstTimestamp: event.timestamp,
                        lastTimestamp: event.timestamp,
                        totalEvents: 0,
                        successfulEvents: 0,
                        errorEvents: 0,
                        hasTrueResult: false
                    });
                }

                const group = cloudGroups.get(jobId);
                group.events.push(event);
                group.totalEvents++;

                if (event.success) {
                    group.successfulEvents++;
                }
                if (!event.success || event.error) {
                    group.errorEvents++;
                }
                if (event.hasTrueResult) {
                    group.hasTrueResult = true;
                }

                // Update timestamps
                if (event.timestamp < group.firstTimestamp) {
                    group.firstTimestamp = event.timestamp;
                }
                if (event.timestamp > group.lastTimestamp) {
                    group.lastTimestamp = event.timestamp;
                }
            } else {
                // Individual event (local/manual)
                groups.push({
                    isGroup: false,
                    event: event
                });
            }
        });

        // Add cloud groups to main groups array
        cloudGroups.forEach(group => {
            // Sort events within group by timestamp (newest first)
            group.events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            groups.push(group);
        });

        // Sort groups by most recent activity
        groups.sort((a, b) => {
            const aTime = a.isGroup ? a.lastTimestamp : a.event.timestamp;
            const bTime = b.isGroup ? b.lastTimestamp : b.event.timestamp;
            return new Date(bTime) - new Date(aTime);
        });

        return groups;
    }

    // Render a cloud job group with collapsible entries
    renderCloudJobGroup(group, groupIndex) {
        const timeAgo = getTimeAgo(new Date(group.lastTimestamp));
        const duration = this.getTimeDuration(group.firstTimestamp, group.lastTimestamp);
        const unreadClass = group.hasTrueResult ? 'unread' : '';
        const errorClass = group.errorEvents > 0 ? 'has-errors' : '';

        // Create summary stats
        const statsHtml = `
            <div class="cloud-job-stats">
                <span class="stat-item ${group.successfulEvents > 0 ? 'success' : ''}">${group.successfulEvents} ✓</span>
                ${group.errorEvents > 0 ? `<span class="stat-item error">${group.errorEvents} ✗</span>` : ''}
                <span class="stat-duration">${duration}</span>
            </div>
        `;

        // Render individual events within the group
        const eventsHtml = group.events.map((event, eventIndex) =>
            this.renderIndividualEvent(event, `${groupIndex}_${eventIndex}`, true)
        ).join('');

        return `
            <div class="history-group cloud-job-group ${unreadClass} ${errorClass}" data-group-index="${groupIndex}" data-job-id="${group.jobId}">
                <div class="history-group-header">
                    <div class="history-header-left">
                        <span class="history-source-icon" title="Cloud Job">☁️</span>
                        <div class="history-domain">${group.domain}</div>
                        <div class="history-job-info">
                            <span class="job-id" title="Job ID: ${group.jobId}">Job ${group.jobId.substring(0, 8)}...</span>
                            <span class="event-count">${group.totalEvents} run${group.totalEvents !== 1 ? 's' : ''}</span>
                        </div>
                    </div>
                    <div class="history-header-right">
                        ${statsHtml}
                        <div class="history-time">${timeAgo}</div>
                        <div class="history-group-caret">▶</div>
                    </div>
                </div>
                <div class="history-group-details" style="display: none;">
                    <div class="cloud-job-summary">
                        <div class="summary-item"><strong>Total Runs:</strong> ${group.totalEvents}</div>
                        <div class="summary-item"><strong>Successful:</strong> ${group.successfulEvents}</div>
                        ${group.errorEvents > 0 ? `<div class="summary-item error"><strong>Errors:</strong> ${group.errorEvents}</div>` : ''}
                        <div class="summary-item"><strong>Duration:</strong> ${duration}</div>
                        <div class="summary-item"><strong>Job ID:</strong> ${group.jobId}</div>
                    </div>
                    <div class="cloud-job-events">
                        ${eventsHtml}
                    </div>
                </div>
            </div>
        `;
    }

    // Render an individual event (either standalone or within a group)
    renderIndividualEvent(event, index, isWithinGroup = false) {
        const timeAgo = getTimeAgo(new Date(event.timestamp));
        const unreadClass = event.hasTrueResult && !event.read ? 'unread' : '';
        const errorClass = !event.success ? 'error' : '';
        const groupClass = isWithinGroup ? 'group-event' : '';

        // Handle different types of events with debug info
        let statusHtml = '';
        console.log(`Rendering event ${event.id}: status=${event.status}, success=${event.success}, httpStatus=${event.httpStatus}, fields=${event.fields?.length || 0}`);

        if (event.status === 'pending') {
            statusHtml = `<span class="history-status pending">⏳ Waiting for response...</span>`;
        } else if (!event.success) {
            statusHtml = `<span class="history-status error">❌ Failed: ${event.error || 'Unknown error'}</span>`;
        } else if (event.httpStatus && event.httpStatus !== 200) {
            statusHtml = `<span class="history-status warning">⚠️ HTTP ${event.httpStatus}</span>`;
        } else if (event.fields && event.fields.length > 0) {
            statusHtml = `<span class="history-status success">✓ Evaluated (${event.fields.length} fields)</span>`;
        } else if (event.httpStatus && event.httpStatus === 200) {
            statusHtml = `<span class="history-status success">✓ HTTP 200 (No fields)</span>`;
        } else {
            statusHtml = `<span class="history-status">📸 Captured</span>`;
        }

        const fieldsHtml = event.fields && event.fields.length > 0 ? event.fields.map(field => `
          <div class="history-field ${field.result ? 'true' : 'false'}">
            <span class="history-field-indicator ${field.result ? 'true' : 'false'}"></span>
            <span>${field.name}: ${field.result ? 'TRUE' : 'FALSE'} ${field.probability ? `(${(field.probability * 100).toFixed(0)}%)` : ''}</span>
          </div>
        `).join('') : '<div class="history-no-fields">No field evaluations</div>';

        return `
          <div class="history-item ${unreadClass} ${errorClass} ${groupClass}" data-event-index="${index}" data-event-id="${event.id}">
            <div class="history-header">
              <div class="history-header-left">
                ${!isWithinGroup && event.source === 'cloud' ? '<span class="history-source-icon" title="Cloud Job">☁️</span>' : ''}
                ${!isWithinGroup ? `<div class="history-domain">${event.domain}</div>` : ''}
                ${isWithinGroup ? `<div class="event-time-detail">${new Date(event.timestamp).toLocaleTimeString()}</div>` : ''}
              </div>
              <div class="history-header-right">
                <div class="history-time">${isWithinGroup ? timeAgo : timeAgo}</div>
                <div class="history-header-caret">▶</div>
              </div>
            </div>
            ${statusHtml}
            <div class="history-fields">${fieldsHtml}</div>
            ${event.reason ? `<div class="history-reason">${event.reason}</div>` : ''}
            <div class="history-details" style="display: none;">
              <div class="detail-item"><strong>URL:</strong> ${event.url}</div>
              <div class="detail-item"><strong>Time:</strong> ${new Date(event.timestamp).toLocaleString()}</div>
              ${event.httpStatus ? `<div class="detail-item"><strong>HTTP Status:</strong> ${event.httpStatus}</div>` : ''}
              ${event.error ? `<div class="detail-item"><strong>Error:</strong> ${event.error}</div>` : ''}
              
              ${this.renderPreviousEvaluation(event)}

              ${event.screenshot ? `
                <div class="detail-item screenshot-detail">
                  <div class="screenshot-header">
                    <strong>Screenshot:</strong>
                    <div class="screenshot-controls">
                      <button class="download-screenshot-btn small-button" data-screenshot="${event.screenshot}" data-timestamp="${event.timestamp}">💾 Download</button>
                    </div>
                  </div>
                  <div class="screenshot-container">
                    <img src="${event.screenshot}" alt="Captured screenshot" class="history-screenshot-thumbnail" title="Hover to zoom (400% magnification for fine print reading)">
                  </div>
                </div>
              ` : ''}
              
              ${event.request ? `
                <details class="data-section">
                  <summary class="data-header">
                    <div class="data-header-content">
                      <span class="data-header-title">Request</span>
                      <span class="data-header-status status-200">200 OK</span>
                    </div>
                    <div class="data-header-actions">
                      <button class="copy-data-btn" data-content="${encodeURIComponent(JSON.stringify(event.request, null, 2))}" title="Copy to clipboard">📋</button>
                      <span class="data-header-caret">▶</span>
                    </div>
                  </summary>
                  <div class="data-content">
                    <pre class="json-display">${JSON.stringify(event.request, null, 2)}</pre>
                  </div>
                </details>
              ` : ''}
              
              ${event.status === 'pending' ? `
                <div class="response-pending">
                  <div class="data-header">
                    <div class="data-header-content">
                      <span class="data-header-title">Response</span>
                      <span class="data-header-status status-pending">⏳ Pending</span>
                    </div>
                  </div>
                  <button class="cancel-request-btn small-button danger" data-event-id="${event.id}">Cancel Request</button>
                </div>
              ` : event.response ? `
                <details class="data-section">
                  <summary class="data-header">
                    <div class="data-header-content">
                      <span class="data-header-title">Response</span>
                      <span class="data-header-status ${this.getStatusClass(event.httpStatus || 200)}">${event.httpStatus || 200} ${this.getStatusText(event.httpStatus || 200)}</span>
                    </div>
                    <div class="data-header-actions">
                      <button class="copy-data-btn" data-content="${encodeURIComponent(event.response)}" title="Copy to clipboard">📋</button>
                      <span class="data-header-caret">▶</span>
                    </div>
                  </summary>
                  <div class="data-content">
                    ${formatResponseData(event.response)}
                  </div>
                </details>
              ` : ''}
              
              ${event.fieldWebhooks && event.fieldWebhooks.length > 0 ? event.fieldWebhooks.map(webhook => `
                <details class="data-section field-webhook">
                  <summary class="data-header">
                    <div class="data-header-content">
                      <span class="data-header-title">Webhook: ${webhook.fieldName}</span>
                      <span class="data-header-status ${this.getStatusClass(webhook.httpStatus)}">${webhook.httpStatus || (webhook.success ? '200' : '500')} ${this.getStatusText(webhook.httpStatus || (webhook.success ? 200 : 500))}</span>
                    </div>
                    <div class="data-header-actions">
                      <button class="copy-data-btn" data-content="${encodeURIComponent(JSON.stringify({ request: webhook.request, response: webhook.response }, null, 2))}" title="Copy webhook data">📋</button>
                      <span class="data-header-caret">▶</span>
                    </div>
                  </summary>
                  <div class="data-content">
                    <div class="webhook-request">
                      <strong>Request:</strong>
                      <pre class="json-display">${JSON.stringify(webhook.request, null, 2)}</pre>
                    </div>
                    <div class="webhook-response">
                      <strong>Response:</strong>
                      <div class="response-display">
                        ${formatResponseData(webhook.response)}
                      </div>
                    </div>
                  </div>
                </details>
              `).join('') : ''}
            </div>
          </div>
        `;
    }

    // Helper method to calculate time duration between two timestamps
    getTimeDuration(startTime, endTime) {
        const start = new Date(startTime);
        const end = new Date(endTime);
        const diffMs = end - start;

        if (diffMs < 60000) { // Less than 1 minute
            return 'Less than 1 minute';
        } else if (diffMs < 3600000) { // Less than 1 hour
            const minutes = Math.floor(diffMs / 60000);
            return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
        } else if (diffMs < 86400000) { // Less than 1 day
            const hours = Math.floor(diffMs / 3600000);
            const minutes = Math.floor((diffMs % 3600000) / 60000);
            return `${hours}h ${minutes}m`;
        } else { // More than 1 day
            const days = Math.floor(diffMs / 86400000);
            const hours = Math.floor((diffMs % 86400000) / 3600000);
            return `${days}d ${hours}h`;
        }
    }

    // Attach event handlers to rendered history items
    attachEventHandlers() {
        // Add click handlers for expanding details on individual events
        document.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', function (e) {
                // Don't collapse if clicking on interactive elements
                if (e.target.closest('.history-screenshot') ||
                    e.target.closest('.data-section') ||
                    e.target.closest('.json-display') ||
                    e.target.closest('.copy-data-btn') ||
                    e.target.closest('.download-screenshot-btn') ||
                    e.target.closest('details') ||
                    e.target.closest('summary')) {
                    return;
                }

                const details = this.querySelector('.history-details');
                if (details.style.display === 'none') {
                    details.style.display = 'block';
                    this.classList.add('expanded');
                } else {
                    details.style.display = 'none';
                    this.classList.remove('expanded');
                }
            });
        });

        // Add click handlers for expanding cloud job groups
        document.querySelectorAll('.history-group-header').forEach(header => {
            header.addEventListener('click', function (e) {
                // Don't collapse if clicking on interactive elements
                if (e.target.closest('.copy-data-btn') ||
                    e.target.closest('button') ||
                    e.target.closest('.cloud-job-stats')) {
                    return;
                }

                const group = this.closest('.history-group');
                const details = group.querySelector('.history-group-details');
                const caret = this.querySelector('.history-group-caret');

                if (details.style.display === 'none') {
                    details.style.display = 'block';
                    group.classList.add('expanded');
                    if (caret) caret.textContent = '▼';
                } else {
                    details.style.display = 'none';
                    group.classList.remove('expanded');
                    if (caret) caret.textContent = '▶';
                }
            });
        });

        // Prevent propagation on interactive elements
        document.querySelectorAll('.history-screenshot-thumbnail').forEach(img => {
            img.addEventListener('click', (e) => {
                e.stopPropagation();
            });

            // Add mousemove for zoom positioning and mouseleave to reset
            img.addEventListener('mousemove', handleImageZoom);
            img.addEventListener('mouseleave', resetImageZoom);
        });

        document.querySelectorAll('.data-section').forEach(section => {
            // Prevent clicking inside the content from collapsing the details
            const content = section.querySelector('.data-content');
            if (content) {
                content.addEventListener('click', (e) => {
                    e.stopPropagation();
                });
            }
        });

        // Add click handlers for copy buttons
        document.querySelectorAll('.copy-data-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const content = decodeURIComponent(btn.getAttribute('data-content'));
                navigator.clipboard.writeText(content).then(() => {
                    btn.textContent = '✓';
                    setTimeout(() => {
                        btn.textContent = '📋';
                    }, 1000);
                }).catch((err) => {
                    console.error('Failed to copy: ', err);
                    btn.textContent = '✗';
                    setTimeout(() => {
                        btn.textContent = '📋';
                    }, 1000);
                });
            });
        });

        // Add download handlers for screenshots
        document.querySelectorAll('.download-screenshot-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                downloadScreenshot(btn.getAttribute('data-screenshot'), btn.getAttribute('data-timestamp'));
            });
        });

        // Add cancel request handlers
        document.querySelectorAll('.cancel-request-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.cancelRequest(btn.getAttribute('data-event-id'));
            });
        });
    }

    // Helper methods for status handling
    getStatusClass(httpStatus) {
        if (!httpStatus) return 'status-pending';
        if (httpStatus >= 200 && httpStatus < 300) return 'status-200';
        if (httpStatus >= 400 && httpStatus < 500) return 'status-4xx';
        if (httpStatus >= 500) return 'status-5xx';
        return 'status-200'; // Default for other cases
    }

    getStatusText(httpStatus) {
        if (!httpStatus) return 'Pending';
        if (httpStatus === 200) return 'OK';
        if (httpStatus === 201) return 'Created';
        if (httpStatus === 400) return 'Bad Request';
        if (httpStatus === 401) return 'Unauthorized';
        if (httpStatus === 403) return 'Forbidden';
        if (httpStatus === 404) return 'Not Found';
        if (httpStatus === 500) return 'Internal Server Error';
        if (httpStatus === 502) return 'Bad Gateway';
        if (httpStatus === 503) return 'Service Unavailable';
        if (httpStatus >= 200 && httpStatus < 300) return 'Success';
        if (httpStatus >= 400 && httpStatus < 500) return 'Client Error';
        if (httpStatus >= 500) return 'Server Error';
        return 'Unknown';
    }

    // Render previous evaluation section for an event
    renderPreviousEvaluation(event) {
        if (!event.requestData || !event.requestData.previousEvaluation) {
            return '';
        }

        const prevEval = event.requestData.previousEvaluation;
        const prevEvalEntries = Object.entries(prevEval);

        if (prevEvalEntries.length === 0) {
            return '';
        }

        const prevEvalItems = prevEvalEntries.map(([fieldName, data]) => {
            const resultClass = data.result ? 'prev-eval-true' : 'prev-eval-false';
            const confidencePercent = Math.round(data.confidence * 100);
            const timestamp = new Date(data.timestamp).toLocaleString();

            return `
                <div class="prev-eval-item">
                    <span class="prev-eval-field">${fieldName}:</span>
                    <span class="prev-eval-result ${resultClass}">${data.result ? 'TRUE' : 'FALSE'}</span>
                    <span class="prev-eval-confidence">(${confidencePercent}%)</span>
                    <span class="prev-eval-timestamp">at ${timestamp}</span>
                </div>
            `;
        }).join('');

        return `
            <div class="previous-evaluation-section">
                <div class="previous-evaluation-header" onclick="this.parentElement.classList.toggle('expanded')">
                    <span class="section-title">📊 Previous Evaluation Context</span>
                    <span class="expand-indicator">▼</span>
                </div>
                <div class="previous-evaluation-content">
                    ${prevEvalItems}
                </div>
            </div>
        `;
    }

    // Process and display a single event
}

// Make HistoryManager available globally
window.HistoryManager = HistoryManager; 