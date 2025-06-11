// Content script to monitor navigation changes
let currentDomain = window.location.hostname;

// Function to check if domain has changed
function checkDomainChange() {
    const newDomain = window.location.hostname;
    if (newDomain !== currentDomain) {
        // Notify background script of navigation
        chrome.runtime.sendMessage({
            action: 'tabNavigated',
            oldDomain: currentDomain,
            newDomain: newDomain
        });
        currentDomain = newDomain;
    }
}

// Monitor for navigation changes using multiple methods

// 1. Listen for popstate events (back/forward navigation)
window.addEventListener('popstate', checkDomainChange);

// 2. Override pushState and replaceState for programmatic navigation
const originalPushState = history.pushState;
const originalReplaceState = history.replaceState;

history.pushState = function () {
    originalPushState.apply(history, arguments);
    setTimeout(checkDomainChange, 0);
};

history.replaceState = function () {
    originalReplaceState.apply(history, arguments);
    setTimeout(checkDomainChange, 0);
};

// 3. Monitor for hash changes
window.addEventListener('hashchange', checkDomainChange);

// 4. Use MutationObserver as a fallback for SPAs
const observer = new MutationObserver(() => {
    checkDomainChange();
});

// Start observing when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    });
} else {
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// 5. Periodic check as last resort (for edge cases)
setInterval(checkDomainChange, 1000);

// Log initial domain
console.log(`WebSophon: Monitoring domain ${currentDomain}`); 