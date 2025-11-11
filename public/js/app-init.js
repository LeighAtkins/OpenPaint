/**
 * Application Initialization Manager
 * Coordinates module loading and readiness state
 * Prevents race conditions by ensuring dependencies are met before execution
 */

(function() {
  'use strict';

  const readyModules = new Set();
  const readyPromises = new Map();
  const readyCallbacks = new Map();

  window.AppInit = {
    /**
     * Mark a module as ready
     * @param {string} moduleName - Name of the module
     */
    markReady(moduleName) {
      if (readyModules.has(moduleName)) {
        console.warn(`[AppInit] Module "${moduleName}" already marked as ready`);
        return;
      }

      console.log(`[AppInit] Module "${moduleName}" is now ready`);
      readyModules.add(moduleName);

      // Resolve any waiting promises
      const resolver = readyPromises.get(moduleName);
      if (resolver) {
        resolver.resolve();
        readyPromises.delete(moduleName);
      }

      // Execute any registered callbacks
      const callbacks = readyCallbacks.get(moduleName);
      if (callbacks) {
        callbacks.forEach(callback => {
          try {
            callback();
          } catch (error) {
            console.error(`[AppInit] Error in callback for module "${moduleName}":`, error);
          }
        });
        readyCallbacks.delete(moduleName);
      }
    },

    /**
     * Check if a module is ready
     * @param {string} moduleName - Name of the module
     * @returns {boolean}
     */
    isReady(moduleName) {
      return readyModules.has(moduleName);
    },

    /**
     * Wait for a module to be ready
     * @param {string} moduleName - Name of the module
     * @param {number} timeout - Timeout in milliseconds (default: 10000)
     * @returns {Promise<void>}
     */
    whenReady(moduleName, timeout = 10000) {
      if (readyModules.has(moduleName)) {
        return Promise.resolve();
      }

      // Check if a promise already exists for this module
      if (readyPromises.has(moduleName)) {
        return readyPromises.get(moduleName).promise;
      }

      // Create a new promise
      let resolver;
      const promise = new Promise((resolve, reject) => {
        resolver = { resolve, reject };

        // Set timeout
        setTimeout(() => {
          if (!readyModules.has(moduleName)) {
            reject(new Error(`[AppInit] Timeout waiting for module "${moduleName}"`));
            readyPromises.delete(moduleName);
          }
        }, timeout);
      });

      readyPromises.set(moduleName, { promise, ...resolver });
      return promise;
    },

    /**
     * Wait for multiple modules to be ready
     * @param {string[]} moduleNames - Array of module names
     * @param {number} timeout - Timeout in milliseconds (default: 10000)
     * @returns {Promise<void>}
     */
    whenAllReady(moduleNames, timeout = 10000) {
      return Promise.all(moduleNames.map(name => this.whenReady(name, timeout)));
    },

    /**
     * Register a callback to execute when module is ready
     * @param {string} moduleName - Name of the module
     * @param {Function} callback - Callback to execute
     */
    onReady(moduleName, callback) {
      if (readyModules.has(moduleName)) {
        // Already ready, execute immediately
        try {
          callback();
        } catch (error) {
          console.error(`[AppInit] Error in callback for module "${moduleName}":`, error);
        }
        return;
      }

      // Store for later execution
      if (!readyCallbacks.has(moduleName)) {
        readyCallbacks.set(moduleName, []);
      }
      readyCallbacks.get(moduleName).push(callback);
    },

    /**
     * Get all ready modules
     * @returns {string[]}
     */
    getReadyModules() {
      return Array.from(readyModules);
    },

    /**
     * Reset the initialization state (for testing)
     */
    reset() {
      readyModules.clear();
      readyPromises.clear();
      readyCallbacks.clear();
      console.log('[AppInit] Reset complete');
    }
  };

  console.log('[AppInit] Initialization manager loaded');
})();
