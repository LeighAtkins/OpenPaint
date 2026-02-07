/**
 * TagAttachQueue - Quiet Tag Manager with MutationObserver
 *
 * Reduces console noise by:
 * - Queuing attachment attempts for missing elements
 * - Showing only one warning per missing ID
 * - Using MutationObserver to detect when elements appear
 * - Automatically cleaning up when queue is empty
 * - Optional timeout for hard failures
 */

export interface TagAttachQueueOptions {
  warnOnce?: boolean;
  timeout?: number;
  queueDelay?: number;
}

interface PendingAttachment {
  callback: (element: HTMLElement) => void;
  context: string;
  warned: boolean;
  attempts: number;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

export class TagAttachQueue {
  private options: Required<TagAttachQueueOptions>;
  private pendingAttachments = new Map<string, PendingAttachment>();
  private observer: MutationObserver | null = null;
  private warnedIds = new Set<string>();

  constructor(options: TagAttachQueueOptions = {}) {
    this.options = {
      warnOnce: true,
      timeout: 5000, // 5 seconds to surface hard failures
      queueDelay: 0, // Use queueMicrotask by default
      ...options,
    };

    this.init();
  }

  private init(): void {
    // Create MutationObserver to watch for new elements
    this.observer = new MutationObserver(mutations => {
      this.handleMutations(mutations);
    });

    // Start observing
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    console.log('[TAG-QUEUE] Initialized with MutationObserver');
  }

  /**
   * Queue an attachment for an element that might not exist yet
   */
  queueAttachment(
    elementId: string,
    callback: (element: HTMLElement) => void,
    context = 'unknown'
  ): boolean {
    // Check if element exists immediately
    const element = document.getElementById(elementId);
    if (element) {
      // Element exists, attach immediately
      try {
        callback(element);
        return true;
      } catch (error) {
        console.error(`[TAG-QUEUE] Immediate attachment failed for ${elementId}:`, error);
        return false;
      }
    }

    // Element doesn't exist, queue it
    if (this.pendingAttachments.has(elementId)) {
      // Already queued, just update the callback
      const existing = this.pendingAttachments.get(elementId);
      if (existing) {
        existing.callback = callback;
        existing.attempts++;
      }
      return false;
    }

    // Queue new attachment
    const attachment: PendingAttachment = {
      callback,
      context,
      warned: false,
      attempts: 1,
      timeoutId: null,
    };

    // Set timeout for hard failures
    if (this.options.timeout > 0) {
      attachment.timeoutId = setTimeout(() => {
        this.handleTimeout(elementId);
      }, this.options.timeout);
    }

    this.pendingAttachments.set(elementId, attachment);

    // Warn once per ID if enabled
    if (this.options.warnOnce && !this.warnedIds.has(elementId)) {
      console.warn(
        `[TAG-QUEUE] Element '${elementId}' not found, queuing attachment (context: ${context})`
      );
      this.warnedIds.add(elementId);
      attachment.warned = true;
    }

    return false;
  }

  /**
   * Handle MutationObserver mutations
   */
  private handleMutations(mutations: MutationRecord[]): void {
    if (this.pendingAttachments.size === 0) {
      return; // Nothing to do
    }

    const foundElements = new Set<string>();

    // Check all added nodes
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if this node or any of its children match our pending IDs
            this.checkNodeForPendingIds(node as Element, foundElements);
          }
        }
      }
    }

    // Process found elements
    if (foundElements.size > 0) {
      // Use microtask to avoid racing with initial paint
      if (this.options.queueDelay === 0) {
        queueMicrotask(() => {
          this.processPendingAttachments(foundElements);
        });
      } else {
        setTimeout(() => {
          this.processPendingAttachments(foundElements);
        }, this.options.queueDelay);
      }
    }
  }

  /**
   * Check if a node or its children match any pending IDs
   */
  private checkNodeForPendingIds(node: Element, foundElements: Set<string>): void {
    // Check the node itself
    if (node.id && this.pendingAttachments.has(node.id)) {
      foundElements.add(node.id);
    }

    // Check children
    const children = node.querySelectorAll('[id]');
    for (const child of Array.from(children)) {
      if (this.pendingAttachments.has(child.id)) {
        foundElements.add(child.id);
      }
    }
  }

  /**
   * Process pending attachments for found elements
   */
  private processPendingAttachments(foundElementIds: Set<string>): void {
    for (const elementId of foundElementIds) {
      const attachment = this.pendingAttachments.get(elementId);
      if (!attachment) continue;

      const element = document.getElementById(elementId);
      if (element) {
        try {
          attachment.callback(element);

          // Success - clean up
          if (attachment.timeoutId) {
            clearTimeout(attachment.timeoutId);
          }
          this.pendingAttachments.delete(elementId);

          console.log(
            `[TAG-QUEUE] Successfully attached to '${elementId}' after ${attachment.attempts} attempts`
          );
        } catch (error) {
          console.error(`[TAG-QUEUE] Attachment failed for ${elementId}:`, error);

          // Keep in queue for potential retry, but warn
          if (!attachment.warned) {
            console.warn(
              `[TAG-QUEUE] Attachment callback failed for '${elementId}', keeping in queue`
            );
            attachment.warned = true;
          }
        }
      }
    }

    // Disconnect observer if queue is empty
    if (this.pendingAttachments.size === 0) {
      this.disconnect();
    }
  }

  /**
   * Handle timeout for elements that never appear
   */
  private handleTimeout(elementId: string): void {
    const attachment = this.pendingAttachments.get(elementId);
    if (attachment) {
      console.error(
        `[TAG-QUEUE] Timeout: Element '${elementId}' not found after ${this.options.timeout}ms (context: ${attachment.context})`
      );
      this.pendingAttachments.delete(elementId);

      // Disconnect observer if queue is empty
      if (this.pendingAttachments.size === 0) {
        this.disconnect();
      }
    }
  }

  /**
   * Manually retry all pending attachments
   */
  retryAll(): void {
    const retryIds = Array.from(this.pendingAttachments.keys());
    console.log(`[TAG-QUEUE] Manually retrying ${retryIds.length} pending attachments`);

    for (const elementId of retryIds) {
      const element = document.getElementById(elementId);
      if (element) {
        this.processPendingAttachments(new Set([elementId]));
      }
    }
  }

  /**
   * Get current queue status
   */
  getStatus(): {
    pending: number;
    warned: number;
    observing: boolean;
    pendingIds: string[];
  } {
    return {
      pending: this.pendingAttachments.size,
      warned: this.warnedIds.size,
      observing: this.observer !== null,
      pendingIds: Array.from(this.pendingAttachments.keys()),
    };
  }

  /**
   * Clear all pending attachments and warnings
   */
  clear(): void {
    // Clear timeouts
    for (const attachment of this.pendingAttachments.values()) {
      if (attachment.timeoutId) {
        clearTimeout(attachment.timeoutId);
      }
    }

    this.pendingAttachments.clear();
    this.warnedIds.clear();
    this.disconnect();

    console.log('[TAG-QUEUE] Cleared all pending attachments');
  }

  /**
   * Disconnect the MutationObserver
   */
  private disconnect(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
      console.log('[TAG-QUEUE] Observer disconnected (queue empty)');
    }
  }

  /**
   * Destroy the queue and clean up resources
   */
  destroy(): void {
    this.clear();
    console.log('[TAG-QUEUE] Destroyed');
  }
}
