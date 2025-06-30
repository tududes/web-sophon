// History management functionality
import { getTimeAgo, formatResponseData, downloadScreenshot, handleImageZoom, resetImageZoom } from '../utils/formatters.js';

export class HistoryManager {
    constructor() {
        this.recentEvents = [];
        this.showTrueOnly = false;
        this.elements = {};
        this.isScrolling = false; // Prevent multiple scroll operations
        this.updateTimeout = null; // For debouncing updates
        this.pendingUpdates = new Set(); // Track pending event updates
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
    async loadHistory(forceReload = false) {
        console.log('Loading history...', forceReload ? '(forced reload)' : '');

        try {
            // First try to get from background script (most current)
            const response = await this.getEventsFromBackground();

            if (response && response.events && Array.isArray(response.events)) {
                console.log('Loaded events from background:', response.events.length);

                // Check if this is a new load or just an update
                const hadEvents = this.recentEvents && this.recentEvents.length > 0;
                const isSignificantChange = !hadEvents ||
                    forceReload ||
                    Math.abs(response.events.length - this.recentEvents.length) > 5; // More than 5 new events

                if (isSignificantChange) {
                    // Significant change - preserve state during full re-render
                    const expandedState = this.captureExpandedState();
                    this.recentEvents = response.events;
                    this.renderHistoryWithStatePreservation(expandedState);
                } else {
                    // Minor change - try selective update
                    this.updateHistorySelectively(response.events);
                }
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

    // Capture the current expanded state of events
    captureExpandedState() {
        const expandedState = new Map();

        document.querySelectorAll('.history-item[data-event-id]').forEach(item => {
            const eventId = item.getAttribute('data-event-id');
            const isExpanded = item.classList.contains('expanded');
            const detailsElement = item.querySelector('.history-details');
            const detailsVisible = detailsElement && detailsElement.style.display !== 'none';

            if (isExpanded || detailsVisible) {
                expandedState.set(eventId, {
                    expanded: isExpanded,
                    detailsVisible: detailsVisible
                });
            }
        });

        // Also capture reason section states
        document.querySelectorAll('.history-reason-section.expanded').forEach(section => {
            const eventItem = section.closest('.history-item[data-event-id]');
            if (eventItem) {
                const eventId = eventItem.getAttribute('data-event-id');
                const current = expandedState.get(eventId) || {};
                current.reasonExpanded = true;
                expandedState.set(eventId, current);
            }
        });

        console.log('Captured expanded state for', expandedState.size, 'events');
        return expandedState;
    }

    // Render history while preserving expanded state
    renderHistoryWithStatePreservation(expandedState) {
        // Perform normal render
        this.renderHistory();

        // Restore expanded state after a brief delay to allow DOM to settle
        setTimeout(() => {
            this.restoreExpandedState(expandedState);
        }, 50);
    }

    // Restore the expanded state of events
    restoreExpandedState(expandedState) {
        if (!expandedState || expandedState.size === 0) return;

        expandedState.forEach((state, eventId) => {
            const eventElement = document.querySelector(`[data-event-id="${eventId}"]`);
            if (!eventElement) return;

            if (state.expanded || state.detailsVisible) {
                eventElement.classList.add('expanded');
                const detailsElement = eventElement.querySelector('.history-details');
                if (detailsElement) {
                    detailsElement.style.display = 'block';
                }
            }

            if (state.reasonExpanded) {
                const reasonSection = eventElement.querySelector('.history-reason-section');
                if (reasonSection) {
                    reasonSection.classList.add('expanded');
                    const content = reasonSection.querySelector('.history-reason-content');
                    const caret = reasonSection.querySelector('.history-reason-caret');
                    if (content) content.style.display = 'block';
                    if (caret) caret.textContent = '▼';
                }
            }
        });

        console.log('Restored expanded state for', expandedState.size, 'events');
    }

    // Update history selectively for minor changes
    updateHistorySelectively(newEvents) {
        const oldEventIds = new Set(this.recentEvents.map(e => e.id));
        const newEventIds = new Set(newEvents.map(e => e.id));

        // Find truly new events (not just updates)
        const addedEvents = newEvents.filter(e => !oldEventIds.has(e.id));
        const removedEventIds = [...oldEventIds].filter(id => !newEventIds.has(id));

        console.log(`Selective update: ${addedEvents.length} new, ${removedEventIds.length} removed`);

        // Update our local array
        this.recentEvents = newEvents;

        // Remove deleted events from DOM
        removedEventIds.forEach(eventId => {
            const element = document.querySelector(`[data-event-id="${eventId}"]`);
            if (element) {
                element.remove();
            }
        });

        // Add new events to DOM (insert at the top)
        if (addedEvents.length > 0) {
            const container = this.elements.historyContainer;
            if (container && container.children.length > 0) {
                // Check if we need to respect the filter
                const filteredNewEvents = this.showTrueOnly
                    ? addedEvents.filter(e => e.hasTrueResult)
                    : addedEvents;

                // Insert new events at the beginning
                filteredNewEvents.reverse().forEach((event, index) => {
                    const eventHtml = this.renderIndividualEvent(event, index, false);
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = eventHtml;
                    const eventElement = tempDiv.firstElementChild;

                    // Insert at the beginning
                    container.insertBefore(eventElement, container.firstChild);

                    // Attach handlers
                    this.attachSingleEventHandlers(eventElement);
                });
            } else {
                // Container is empty or not found, fall back to full render
                this.renderHistory();
            }
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
                // Preserve state if we already have events displayed
                const hadEvents = this.recentEvents && this.recentEvents.length > 0;
                if (hadEvents) {
                    const expandedState = this.captureExpandedState();
                    this.recentEvents = storage.recentEvents;
                    this.renderHistoryWithStatePreservation(expandedState);
                } else {
                    this.recentEvents = storage.recentEvents;
                    this.renderHistory();
                }
                console.log('Loaded events from storage:', this.recentEvents.length);
            } else {
                console.log('No events found in storage');
                this.recentEvents = [];
                this.renderHistory();
            }
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

            // Add to pending updates and debounce the UI update
            this.pendingUpdates.add(eventId);
            this.debouncedUpdateEvent(eventId, event);
        } else {
            console.log('Event not found in local array, reloading history');
            // Event not in our array, reload history
            this.loadHistory();
        }
    }

    // Debounced event update to prevent rapid UI thrashing
    debouncedUpdateEvent(eventId, event) {
        // Clear any existing timeout
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
        }

        // Set a new timeout to batch updates
        this.updateTimeout = setTimeout(() => {
            // Process all pending updates
            const updatesToProcess = Array.from(this.pendingUpdates);
            this.pendingUpdates.clear();

            console.log(`Processing ${updatesToProcess.length} pending UI updates`);

            // For multiple rapid updates, just do a full refresh with state preservation
            if (updatesToProcess.length > 3) {
                const expandedState = this.captureExpandedState();
                this.renderHistoryWithStatePreservation(expandedState);
            } else {
                // For few updates, update them individually
                updatesToProcess.forEach(updateEventId => {
                    const updateEvent = this.recentEvents.find(e => e.id === updateEventId);
                    if (updateEvent) {
                        this.updateEventInPlace(updateEventId, updateEvent);
                    }
                });
            }

            this.updateTimeout = null;
        }, 250); // 250ms debounce delay
    }

    // Save event to storage without triggering UI updates
    async saveEventToStorageQuietly(event) {
        try {
            // Update the event in our local array
            const eventIndex = this.recentEvents.findIndex(e => e.id === event.id);
            if (eventIndex !== -1) {
                this.recentEvents[eventIndex] = event;
            }

            // Save to storage directly
            await chrome.storage.local.set({ recentEvents: this.recentEvents });
            console.log('Event saved quietly to storage:', event.id);
        } catch (error) {
            console.error('Failed to save event quietly:', error);
        }
    }

    // Update a specific event in place without full re-render
    updateEventInPlace(eventId, updatedEvent) {
        try {
            const existingEventElement = document.querySelector(`[data-event-id="${eventId}"]`);
            if (!existingEventElement) {
                console.log('Event element not found, falling back to full re-render');
                this.renderHistory();
                return;
            }

            // Preserve the current expanded state
            const wasExpanded = existingEventElement.classList.contains('expanded');
            const detailsElement = existingEventElement.querySelector('.history-details');
            const detailsWasVisible = detailsElement && detailsElement.style.display !== 'none';

            // Find the event's position in the filtered list
            const filteredEvents = this.showTrueOnly
                ? this.recentEvents.filter(e => e.hasTrueResult)
                : this.recentEvents;

            const eventIndex = filteredEvents.findIndex(e => e.id == eventId);
            if (eventIndex === -1) {
                console.log('Event not in filtered list, falling back to full re-render');
                this.renderHistory();
                return;
            }

            // Create new HTML for the updated event
            const newEventHtml = this.renderIndividualEvent(updatedEvent, eventIndex, false);

            // Create a temporary container to parse the new HTML
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = newEventHtml;
            const newEventElement = tempDiv.firstElementChild;

            // Restore expanded state if it was expanded
            if (wasExpanded && detailsWasVisible) {
                newEventElement.classList.add('expanded');
                const newDetailsElement = newEventElement.querySelector('.history-details');
                if (newDetailsElement) {
                    newDetailsElement.style.display = 'block';
                }
            }

            // Replace the old element with the new one
            existingEventElement.replaceWith(newEventElement);

            // Re-attach event handlers for the new element
            this.attachSingleEventHandlers(newEventElement);

            console.log('Event updated in place:', eventId);

        } catch (error) {
            console.error('Error updating event in place:', error);
            // Fall back to full re-render if selective update fails
            this.renderHistory();
        }
    }

    // Attach event handlers to a single event element
    attachSingleEventHandlers(eventElement) {
        // Add click handler for expanding details
        eventElement.addEventListener('click', function (e) {
            // Don't collapse if clicking on interactive elements
            if (e.target.closest('.history-screenshot') ||
                e.target.closest('.data-section') ||
                e.target.closest('.json-display') ||
                e.target.closest('.copy-data-btn') ||
                e.target.closest('.download-screenshot-btn') ||
                e.target.closest('.load-screenshot-btn') ||
                e.target.closest('.cancel-request-btn') ||
                e.target.closest('.history-reason-section')) {
                return;
            }

            const details = this.querySelector('.history-details');
            if (details) {
                const isExpanded = details.style.display !== 'none';
                details.style.display = isExpanded ? 'none' : 'block';
                this.classList.toggle('expanded', !isExpanded);
            }
        });

        // Add handlers for reason sections
        const reasonHeaders = eventElement.querySelectorAll('.history-reason-header');
        reasonHeaders.forEach(header => {
            header.addEventListener('click', function (e) {
                e.stopPropagation();
                const section = this.closest('.history-reason-section');
                const content = section.querySelector('.history-reason-content');
                const caret = this.querySelector('.history-reason-caret');

                const isExpanded = section.classList.contains('expanded');

                if (!isExpanded) {
                    content.style.display = 'block';
                    section.classList.add('expanded');
                    if (caret) caret.textContent = '▼';
                } else {
                    content.style.display = 'none';
                    section.classList.remove('expanded');
                    if (caret) caret.textContent = '▶';
                }
            });
        });

        // Add handlers for screenshots
        const screenshots = eventElement.querySelectorAll('.history-screenshot-thumbnail');
        screenshots.forEach(img => {
            img.addEventListener('click', (e) => e.stopPropagation());
            img.addEventListener('mousemove', handleImageZoom);
            img.addEventListener('mouseleave', resetImageZoom);
        });

        // Add handlers for copy buttons
        const copyBtns = eventElement.querySelectorAll('.copy-data-btn');
        copyBtns.forEach(btn => {
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

        // Add handlers for download buttons
        const downloadBtns = eventElement.querySelectorAll('.download-screenshot-btn');
        downloadBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const screenshotData = btn.getAttribute('data-screenshot');
                const timestamp = btn.getAttribute('data-timestamp');
                const eventId = btn.getAttribute('data-event-id');

                console.log('Download button clicked:', { eventId, hasScreenshotData: !!screenshotData, timestamp });

                if (screenshotData && screenshotData.startsWith('data:image/')) {
                    downloadScreenshot(screenshotData, timestamp);
                } else {
                    console.error('Download button has invalid screenshot data:', screenshotData);
                    // Optionally try to load the screenshot first
                    const loadBtn = document.querySelector(`[data-event-id="${eventId}"].load-screenshot-btn`);
                    if (loadBtn) {
                        console.log('Attempting to load screenshot first...');
                        this.loadScreenshot(eventId);
                    }
                }
            });
        }, this);

        // Add handlers for load screenshot buttons
        const loadBtns = eventElement.querySelectorAll('.load-screenshot-btn');
        loadBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const eventId = btn.getAttribute('data-event-id');
                this.loadScreenshot(eventId);
            });
        }, this);

        // Add handlers for cancel buttons
        const cancelBtns = eventElement.querySelectorAll('.cancel-request-btn');
        cancelBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.cancelRequest(btn.getAttribute('data-event-id'));
            });
        }, this);
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

    // Render history items as individual entries with cloud/local icons
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

        // Render each event as an individual item (no grouping)
        this.elements.historyContainer.innerHTML = filteredEvents.map((event, index) => {
            return this.renderIndividualEvent(event, index, false); // Not within a group
        }).join('');

        // Add click handlers after rendering
        this.attachEventHandlers();
    }

    // Group events by job ID for cloud jobs, and by domain+time for local jobs
    groupEventsByJob(events) {
        const groups = [];
        const cloudGroups = new Map();
        const localGroups = [];

        events.forEach(event => {
            console.log(`Grouping event ${event.id}: source=${event.source}, hasRequest=${!!event.request}, jobId=${event.request?.jobId}`);
            if (event.source === 'cloud' && event.request && event.request.jobId) {
                // This is a cloud job result - group by jobId
                const jobId = event.request.jobId;
                if (!cloudGroups.has(jobId)) {
                    cloudGroups.set(jobId, {
                        isGroup: true,
                        groupType: 'cloud',
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
                // This is a local/manual event - group by domain and time proximity
                localGroups.push(event);
            }
        });

        // Group local events by domain and time proximity (within 10 minutes)
        const processedLocalEvents = new Set();
        localGroups.forEach(event => {
            if (processedLocalEvents.has(event.id)) return;

            // Find all events from same domain within 10 minutes
            const relatedEvents = localGroups.filter(otherEvent =>
                !processedLocalEvents.has(otherEvent.id) &&
                otherEvent.domain === event.domain &&
                Math.abs(new Date(otherEvent.timestamp) - new Date(event.timestamp)) <= 10 * 60 * 1000 // 10 minutes
            );

            // Mark all related events as processed
            relatedEvents.forEach(e => processedLocalEvents.add(e.id));

            if (relatedEvents.length === 1) {
                // Single event - still wrap in group for consistency
                groups.push({
                    isGroup: true,
                    groupType: 'local',
                    domain: event.domain,
                    events: [event],
                    firstTimestamp: event.timestamp,
                    lastTimestamp: event.timestamp,
                    totalEvents: 1,
                    successfulEvents: event.success ? 1 : 0,
                    errorEvents: event.success ? 0 : 1,
                    hasTrueResult: event.hasTrueResult || false
                });
            } else {
                // Multiple related events - create a proper group
                const sortedEvents = relatedEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

                const group = {
                    isGroup: true,
                    groupType: 'local',
                    domain: event.domain,
                    events: sortedEvents,
                    firstTimestamp: sortedEvents[sortedEvents.length - 1].timestamp,
                    lastTimestamp: sortedEvents[0].timestamp,
                    totalEvents: sortedEvents.length,
                    successfulEvents: 0,
                    errorEvents: 0,
                    hasTrueResult: false
                };

                // Calculate group statistics
                sortedEvents.forEach(e => {
                    if (e.success) group.successfulEvents++;
                    if (!e.success || e.error) group.errorEvents++;
                    if (e.hasTrueResult) group.hasTrueResult = true;
                });

                groups.push(group);
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
            const aTime = new Date(a.lastTimestamp);
            const bTime = new Date(b.lastTimestamp);
            return bTime - aTime;
        });

        return groups;
    }

    // Render a job group (both cloud and local) with collapsible entries
    renderJobGroup(group, groupIndex) {
        const timeAgo = getTimeAgo(new Date(group.lastTimestamp));
        const duration = this.getTimeDuration(group.firstTimestamp, group.lastTimestamp);
        const unreadClass = group.hasTrueResult ? 'unread' : '';
        const errorClass = group.errorEvents > 0 ? 'has-errors' : '';

        // Determine group icon and label based on type
        const isCloudGroup = group.groupType === 'cloud';
        const groupIcon = isCloudGroup ? '☁️' : '🖥️';
        const groupLabel = isCloudGroup ? 'Cloud Job' : 'Local Capture';

        // Create concise summary for the header
        const summaryText = isCloudGroup
            ? `${group.totalEvents} run${group.totalEvents !== 1 ? 's' : ''}`
            : `${group.totalEvents} capture${group.totalEvents !== 1 ? 's' : ''}`;

        // Build results summary with better formatting
        const resultsHtml = group.successfulEvents > 0
            ? `<span class="result-success">${group.successfulEvents} ✓</span>`
            : '';
        const errorsHtml = group.errorEvents > 0
            ? `<span class="result-error">${group.errorEvents} ✗</span>`
            : '';
        const resultsDisplay = [resultsHtml, errorsHtml].filter(Boolean).join(' ');

        // Create timing display - show duration for multi-run jobs, otherwise just time ago
        const timingDisplay = group.totalEvents > 1 && duration !== 'instant'
            ? `<span class="timing-duration">${duration}</span> • <span class="timing-ago">${timeAgo}</span>`
            : `<span class="timing-ago">${timeAgo}</span>`;

        // Render individual events within the group
        const eventsHtml = group.events.map((event, eventIndex) =>
            this.renderIndividualEvent(event, `${groupIndex}_${eventIndex}`, true)
        ).join('');

        // Build clean job identifier
        const jobIdentifier = isCloudGroup
            ? `<span class="job-id-short">Job ${group.jobId.substring(0, 8)}</span>`
            : `<span class="job-type-label">${groupLabel}</span>`;

        return `
            <div class="history-group ${isCloudGroup ? 'cloud-job-group' : 'local-job-group'} ${unreadClass} ${errorClass}" data-group-index="${groupIndex}" ${isCloudGroup ? `data-job-id="${group.jobId}"` : ''}>
                <div class="history-group-header">
                    <div class="group-header-main">
                        <div class="group-header-top">
                            <div class="group-icon-domain">
                                <span class="history-source-icon">${groupIcon}</span>
                                <span class="history-domain-name">${group.domain}</span>
                            </div>
                            <div class="group-timing">
                                ${timingDisplay}
                            </div>
                        </div>
                        <div class="group-header-bottom">
                            <div class="group-job-info">
                                ${jobIdentifier}
                                <span class="job-summary-text">${summaryText}</span>
                            </div>
                            <div class="group-results">
                                ${resultsDisplay}
                            </div>
                        </div>
                    </div>
                    <div class="group-header-caret">
                        <span class="history-group-caret">▶</span>
                    </div>
                </div>
                <div class="history-group-details" style="display: none;">
                    <div class="job-summary">
                        <div class="summary-grid">
                            <div class="summary-item"><strong>Total ${isCloudGroup ? 'Runs' : 'Captures'}:</strong> ${group.totalEvents}</div>
                            <div class="summary-item"><strong>Successful:</strong> ${group.successfulEvents}</div>
                            ${group.errorEvents > 0 ? `<div class="summary-item error"><strong>Errors:</strong> ${group.errorEvents}</div>` : ''}
                            ${group.totalEvents > 1 ? `<div class="summary-item"><strong>Duration:</strong> ${duration}</div>` : ''}
                            ${isCloudGroup ? `<div class="summary-item full-width"><strong>Job ID:</strong> <code>${group.jobId}</code></div>` : ''}
                        </div>
                    </div>
                    <div class="job-events">
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
        console.log(`Rendering event ${event.id}: status=${event.status}, success=${event.success}, httpStatus=${event.httpStatus}, fields=${event.fields?.length || 0}, summary="${event.summary}"`);

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

        // Format the summary with proper styling and make it collapsible
        // Always start collapsed by default to reduce visual clutter
        console.log(`Event ${event.id} summary check: hasSummary=${!!event.summary}, summaryText="${event.summary}"`);
        const isInitiallyExpanded = false; // Always collapsed by default
        const summaryHtml = event.summary ? `
          <div class="history-reason-section collapsible ${isInitiallyExpanded ? 'expanded' : ''}">
            <div class="history-reason-header">
              <span class="history-reason-label">📝 Evaluation Summary</span>
              <span class="history-reason-caret">${isInitiallyExpanded ? '▼' : '▶'}</span>
            </div>
            <div class="history-reason-content" style="display: ${isInitiallyExpanded ? 'block' : 'none'};">
              <div class="history-reason-text">${event.summary}</div>
            </div>
          </div>
        ` : '';

        return `
          <div class="history-item ${unreadClass} ${errorClass} ${groupClass}" data-event-index="${index}" data-event-id="${event.id}">
            <div class="history-header">
              <div class="history-header-left">
                <span class="history-source-icon" title="${event.source === 'cloud' ? 'Cloud Job' : 'Local Capture'}">${event.source === 'cloud' ? '☁️' : '🖥️'}</span>
                <div class="history-domain">${event.domain}</div>
                ${isWithinGroup ? `<div class="event-time-detail">${new Date(event.timestamp).toLocaleTimeString()}</div>` : ''}
              </div>
              <div class="history-header-right">
                <div class="history-time">${timeAgo}</div>
                <div class="history-header-caret">▶</div>
              </div>
            </div>
            ${statusHtml}
            <div class="history-fields">${fieldsHtml}</div>
            ${summaryHtml}
            <div class="history-details" style="display: none;">
              <div class="detail-item"><strong>URL:</strong> ${event.url}</div>
              ${event.error ? `<div class="detail-item"><strong>Error:</strong> ${event.error}</div>` : ''}
              
              ${this.renderPreviousEvaluation(event)}

              ${this.renderScreenshotSection(event)}
              
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
                    e.target.closest('.cancel-request-btn') ||
                    e.target.closest('.history-reason-section')) {
                    return;
                }

                const details = this.querySelector('.history-details');
                if (details) {
                    const isExpanded = details.style.display !== 'none';
                    details.style.display = isExpanded ? 'none' : 'block';
                    this.classList.toggle('expanded', !isExpanded);
                }
            });
        });

        // Add click handlers for collapsible evaluation summaries
        document.querySelectorAll('.history-reason-header').forEach(header => {
            header.addEventListener('click', function (e) {
                e.stopPropagation();
                const section = this.closest('.history-reason-section');
                const content = section.querySelector('.history-reason-content');
                const caret = this.querySelector('.history-reason-caret');

                const isExpanded = section.classList.contains('expanded');

                if (!isExpanded) {
                    content.style.display = 'block';
                    section.classList.add('expanded');
                    if (caret) caret.textContent = '▼';
                } else {
                    content.style.display = 'none';
                    section.classList.remove('expanded');
                    if (caret) caret.textContent = '▶';
                }
            });
        });

        // Add click handlers for expanding job groups
        document.querySelectorAll('.history-group-header').forEach(header => {
            header.addEventListener('click', function (e) {
                // Don't collapse if clicking on interactive elements
                if (e.target.closest('.copy-data-btn') ||
                    e.target.closest('button') ||
                    e.target.closest('.group-results') ||
                    e.target.closest('.result-success') ||
                    e.target.closest('.result-error')) {
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

                const screenshotData = btn.getAttribute('data-screenshot');
                const timestamp = btn.getAttribute('data-timestamp');
                const eventId = btn.getAttribute('data-event-id');

                console.log('Download button clicked (main):', { eventId, hasScreenshotData: !!screenshotData, timestamp });

                if (screenshotData && screenshotData.startsWith('data:image/')) {
                    const result = downloadScreenshot(screenshotData, timestamp);
                    if (!result.success) {
                        console.error('Download failed:', result.message);
                    }
                } else {
                    console.error('Download button has invalid screenshot data:', screenshotData);
                }
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

        // Add load screenshot handlers
        document.querySelectorAll('.load-screenshot-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const eventId = btn.getAttribute('data-event-id');
                this.loadScreenshot(eventId);
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

    // Render screenshot section with lazy loading support
    renderScreenshotSection(event) {
        // If we have immediate screenshot data, show it
        if (event.screenshot && event.screenshot.startsWith('data:image/')) {
            return `
                <div class="detail-item screenshot-detail">
                    <div class="screenshot-header">
                        <strong>Screenshot:</strong>
                        <div class="screenshot-controls">
                            <button class="download-screenshot-btn small-button" data-screenshot="${event.screenshot}" data-timestamp="${event.timestamp}" data-event-id="${event.id}">💾 Download</button>
                        </div>
                    </div>
                    <div class="screenshot-container">
                        <img src="${event.screenshot}" alt="Captured screenshot" class="history-screenshot-thumbnail" title="Hover to zoom (3.5x) and pan - move mouse across image to explore different areas">
                    </div>
                </div>
            `;
        }

        // For local events with special markers, show appropriate messages
        if (event.source === 'local' && event.screenshot) {
            let message, icon;
            if (event.screenshot === 'SCREENSHOT_CLEANED_UP') {
                icon = '❌';
                message = 'Local screenshot was removed during storage cleanup';
            } else if (event.screenshot === 'SCREENSHOT_TOO_LARGE') {
                icon = '📏';
                message = 'Screenshot was too large to store (over 100KB limit)';
            }

            if (message) {
                return `
                    <div class="detail-item screenshot-detail">
                        <div class="screenshot-header">
                            <strong>Screenshot:</strong>
                        </div>
                        <div class="screenshot-container">
                            <div class="screenshot-placeholder">
                                <div class="placeholder-icon">${icon}</div>
                                <div class="placeholder-text">Screenshot unavailable</div>
                                <div class="placeholder-source">${message}</div>
                            </div>
                        </div>
                    </div>
                `;
            }
        }

        // For cloud events with screenshot URL but no data, show lazy loading UI
        if (event.source === 'cloud' && event.screenshotUrl && (!event.screenshot || !event.screenshot.startsWith('data:image/'))) {
            const loadingId = `screenshot-loading-${event.id}`;
            const containerId = `screenshot-container-${event.id}`;

            return `
                <div class="detail-item screenshot-detail">
                    <div class="screenshot-header">
                        <strong>Screenshot:</strong>
                        <div class="screenshot-controls">
                            <button class="load-screenshot-btn small-button" data-event-id="${event.id}" data-timestamp="${event.timestamp}">📸 Load Screenshot</button>
                            <button class="download-screenshot-btn small-button" data-event-id="${event.id}" data-timestamp="${event.timestamp}" style="display: none;">💾 Download</button>
                        </div>
                    </div>
                    <div class="screenshot-container" id="${containerId}">
                        <div class="screenshot-placeholder" id="${loadingId}">
                            <div class="placeholder-icon">📸</div>
                            <div class="placeholder-text">Click "Load Screenshot" to view</div>
                            <div class="placeholder-source">Available on demand</div>
                        </div>
                    </div>
                </div>
            `;
        }

        // If no screenshot data or URL, don't show section
        return '';
    }

    // Load screenshot on demand
    async loadScreenshot(eventId) {
        const event = this.recentEvents.find(e => e.id == eventId);
        if (!event) {
            console.error('Event not found for screenshot loading:', eventId);
            return;
        }

        const containerId = `screenshot-container-${eventId}`;
        const loadingId = `screenshot-loading-${eventId}`;
        const container = document.getElementById(containerId);
        const loadingDiv = document.getElementById(loadingId);
        const loadBtn = document.querySelector(`[data-event-id="${eventId}"].load-screenshot-btn`);
        const downloadBtn = document.querySelector(`[data-event-id="${eventId}"].download-screenshot-btn`);

        if (!container || !loadBtn) {
            console.error('Screenshot UI elements not found');
            return;
        }

        try {
            // Show loading state
            loadBtn.disabled = true;
            loadBtn.textContent = '⏳ Loading...';
            if (loadingDiv) {
                loadingDiv.innerHTML = `
                    <div class="placeholder-icon">⏳</div>
                    <div class="placeholder-text">Loading screenshot...</div>
                    <div class="loading-progress"></div>
                `;
            }

            // Request screenshot from EventService
            const response = await chrome.runtime.sendMessage({
                action: 'fetchScreenshot',
                eventId: eventId
            });

            console.log('Screenshot fetch response:', response);

            // Handle different response formats
            let screenshotData = null;
            if (typeof response === 'string' && response.startsWith('data:image/')) {
                // Direct base64 data
                screenshotData = response;
            } else if (response && response.success && response.data) {
                // Response object with data
                screenshotData = response.data;
            } else if (response && !response.success) {
                // Error response
                throw new Error(response.error || 'Screenshot not available');
            } else if (response && typeof response === 'string') {
                // String response that might be the data
                screenshotData = response;
            }

            if (screenshotData && screenshotData.startsWith('data:image/')) {
                // Update event with loaded screenshot (but don't trigger re-render)
                event.screenshot = screenshotData;

                // Replace placeholder with actual image
                container.innerHTML = `
                    <img src="${screenshotData}" alt="Captured screenshot" class="history-screenshot-thumbnail" title="Hover to zoom (3.5x) and pan - move mouse across image to explore different areas">
                `;

                // Update buttons
                loadBtn.style.display = 'none';
                downloadBtn.style.display = 'inline-block';
                downloadBtn.setAttribute('data-screenshot', screenshotData);
                downloadBtn.setAttribute('data-timestamp', event.timestamp);

                // Re-attach image event handlers
                const img = container.querySelector('.history-screenshot-thumbnail');
                if (img) {
                    img.addEventListener('click', (e) => e.stopPropagation());
                    img.addEventListener('mousemove', handleImageZoom);
                    img.addEventListener('mouseleave', resetImageZoom);
                }

                // Re-attach download handler for the download button
                downloadBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    downloadScreenshot(screenshotData, event.timestamp);
                });

                console.log('Screenshot loaded successfully for event:', eventId);

                // Save updated event to storage WITHOUT re-rendering the entire history
                this.saveEventToStorageQuietly(event);

            } else {
                throw new Error('Invalid screenshot data received');
            }

        } catch (error) {
            console.error('Error loading screenshot:', error);

            // Show appropriate error message
            let errorMessage;
            if (event.source === 'cloud') {
                errorMessage = 'Cloud screenshot not available - may have been cleaned up by server';
            } else {
                errorMessage = 'Local screenshot was removed during storage cleanup';
            }

            // Show error state
            if (loadingDiv) {
                loadingDiv.innerHTML = `
                    <div class="placeholder-icon">❌</div>
                    <div class="placeholder-text">Screenshot unavailable</div>
                    <div class="placeholder-source">${errorMessage}</div>
                `;
            }

            // Reset button for retry (especially useful for cloud screenshots)
            loadBtn.disabled = false;
            loadBtn.textContent = '🔄 Retry';
        }
    }

    // Process and display a single event
}

// Make HistoryManager available globally
window.HistoryManager = HistoryManager; 