/**
 * Error Boundary System for WebSophon
 * Provides graceful error handling and recovery mechanisms
 */

export class ErrorBoundary {
    constructor() {
        this.errorHandlers = new Map();
        this.errorHistory = [];
        this.setupGlobalErrorHandling();
    }

    /**
     * Register an error handler for a specific component or operation
     */
    register(componentName, handler) {
        this.errorHandlers.set(componentName, handler);
    }

    /**
     * Wrap a function with error boundary
     */
    wrap(componentName, fn) {
        return async (...args) => {
            try {
                return await fn(...args);
            } catch (error) {
                return this.handleError(error, componentName);
            }
        };
    }

    /**
     * Handle errors with proper logging and recovery
     */
    handleError(error, context = 'unknown') {
        const errorInfo = {
            message: error.message,
            stack: error.stack,
            context,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            url: window.location.href
        };

        // Log to console for debugging
        console.error(`[${context}] Error:`, error);

        // Store in error history
        this.errorHistory.unshift(errorInfo);
        if (this.errorHistory.length > 50) {
            this.errorHistory = this.errorHistory.slice(0, 50);
        }

        // Try to handle with specific handler
        const handler = this.errorHandlers.get(context);
        if (handler) {
            try {
                return handler(error, errorInfo);
            } catch (handlerError) {
                console.error(`Error handler for ${context} failed:`, handlerError);
            }
        }

        // Fallback to default handling
        return this.defaultErrorHandler(error, errorInfo);
    }

    /**
     * Default error handler
     */
    defaultErrorHandler(error, errorInfo) {
        // For network errors
        if (error.name === 'NetworkError' || error.message.includes('fetch')) {
            return {
                success: false,
                error: 'Network connection failed. Please check your internet connection.',
                recoverable: true
            };
        }

        // For permission errors
        if (error.message.includes('permission') || error.message.includes('not allowed')) {
            return {
                success: false,
                error: 'Permission denied. Please check extension permissions.',
                recoverable: false
            };
        }

        // For storage errors
        if (error.message.includes('storage') || error.message.includes('quota')) {
            return {
                success: false,
                error: 'Storage operation failed. You may need to clear some data.',
                recoverable: true
            };
        }

        // Generic error
        return {
            success: false,
            error: `An unexpected error occurred: ${error.message}`,
            recoverable: true
        };
    }

    /**
     * Setup global error handling
     */
    setupGlobalErrorHandling() {
        // Handle unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            this.handleError(event.reason, 'unhandled_promise');
            event.preventDefault(); // Prevent console spam
        });

        // Handle general errors
        window.addEventListener('error', (event) => {
            this.handleError(new Error(event.message), 'global_error');
        });

        // Handle Chrome extension errors
        if (chrome.runtime.onError) {
            chrome.runtime.onError.addListener((error) => {
                this.handleError(error, 'chrome_runtime');
            });
        }
    }

    /**
     * Get error history for debugging
     */
    getErrorHistory() {
        return this.errorHistory;
    }

    /**
     * Clear error history
     */
    clearErrorHistory() {
        this.errorHistory = [];
    }

    /**
     * Check if system is in error state
     */
    isInErrorState() {
        // Consider system in error state if we had 3+ errors in last 5 minutes
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const recentErrors = this.errorHistory.filter(error => error.timestamp > fiveMinutesAgo);
        return recentErrors.length >= 3;
    }

    /**
     * Create a safe async function that won't throw
     */
    makeSafe(fn, context) {
        return async (...args) => {
            try {
                const result = await fn(...args);
                return { success: true, data: result };
            } catch (error) {
                const errorResult = this.handleError(error, context);
                return { success: false, ...errorResult };
            }
        };
    }

    /**
     * Create a safe UI update function
     */
    makeSafeUIUpdate(fn, context) {
        return (...args) => {
            try {
                return fn(...args);
            } catch (error) {
                console.error(`UI update failed in ${context}:`, error);
                // UI errors shouldn't crash the app, just log them
                return null;
            }
        };
    }
} 