// Status message handler
// Extracted from index.html inline scripts

type StatusElement = HTMLDivElement & { timer?: ReturnType<typeof setTimeout> | null };

const getStatusElement = (): StatusElement => {
  let statusElement = document.getElementById('statusMessage') as StatusElement | null;
  if (!statusElement) {
    statusElement = document.createElement('div') as StatusElement;
    statusElement.id = 'statusMessage';
    statusElement.style.cssText = `
                      position: fixed;
                      bottom: 80px; /* Moved up to avoid bottom navigation */
                      left: 50%;
                      transform: translateX(-50%);
                      padding: 12px 24px;
                      border-radius: 50px;
                      color: white;
                      font-weight: 500;
                      font-size: 14px;
                      z-index: 9999;
                      opacity: 0;
                      transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                      max-width: 80%;
                      text-align: center;
                      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                      display: flex;
                      align-items: center;
                      gap: 10px;
                      backdrop-filter: blur(8px);
                  `;
    statusElement.setAttribute('role', 'status');
    statusElement.setAttribute('aria-live', 'polite');
    document.body.appendChild(statusElement);
  }

  return statusElement;
};

export function initStatusMessageHandler(): void {
  // Enhanced status message with loading support
  (
    window as Window & { showStatusMessage?: (message: string, type?: string) => void }
  ).showStatusMessage = (message: string, type = 'info') => {
    const statusElement = getStatusElement();

    // Reset any previous styles
    statusElement.className = '';
    statusElement.innerHTML = ''; // Clear content

    // Set content based on type
    if (type === 'loading') {
      // Spinner SVG
      const spinner = document.createElement('div');
      spinner.innerHTML = `<svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>`;
      if (spinner.firstChild) {
        statusElement.appendChild(spinner.firstChild);
      }

      const text = document.createElement('span');
      text.textContent = message;
      statusElement.appendChild(text);

      statusElement.style.backgroundColor = 'rgba(59, 130, 246, 0.9)'; // Blue for loading
    } else {
      statusElement.textContent = message;

      // Set color based on message type
      switch (type) {
        case 'success':
          statusElement.style.backgroundColor = 'rgba(34, 197, 94, 0.95)'; // Green
          break;
        case 'error':
          statusElement.style.backgroundColor = 'rgba(239, 68, 68, 0.95)'; // Red
          break;
        case 'info':
        default:
          statusElement.style.backgroundColor = 'rgba(31, 41, 55, 0.95)'; // Dark Gray
          break;
      }
    }

    // Show
    requestAnimationFrame(() => {
      statusElement.style.opacity = '1';
      statusElement.style.transform = 'translateX(-50%) translateY(0)';
    });

    // Clear existing timer
    if (statusElement.timer) {
      clearTimeout(statusElement.timer);
      statusElement.timer = null;
    }

    // Hide after timeout (longer for loading, or manual clear)
    if (type !== 'loading') {
      statusElement.timer = setTimeout(() => {
        statusElement.style.opacity = '0';
        statusElement.style.transform = 'translateX(-50%) translateY(10px)';
      }, 4000);
    }
  };

  // Helper to hide status message manually (useful for finishing loading states)
  (window as Window & { hideStatusMessage?: () => void }).hideStatusMessage = () => {
    const statusElement = document.getElementById('statusMessage') as StatusElement | null;
    if (statusElement) {
      statusElement.style.opacity = '0';
      statusElement.style.transform = 'translateX(-50%) translateY(10px)';
    }
  };
}
