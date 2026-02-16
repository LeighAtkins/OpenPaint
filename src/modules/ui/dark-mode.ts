/**
 * Dark Mode Toggle Module
 *
 * Handles toggling dark mode on/off and persisting the preference
 * in localStorage.
 */

const DARK_MODE_KEY = 'openpaint-dark-mode';
const DARK_MODE_CLASS = 'dark-mode';

/**
 * Initialize dark mode functionality
 */
export function initDarkMode(): void {
  const darkModeToggle = document.getElementById('darkModeToggle') as HTMLButtonElement;
  if (!darkModeToggle) {
    console.warn('[Dark Mode] Toggle button not found');
    return;
  }

  // Load saved preference or use system preference
  const savedMode = localStorage.getItem(DARK_MODE_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  if (savedMode === 'true' || (!savedMode && prefersDark)) {
    enableDarkMode();
  }

  // Toggle dark mode on button click
  darkModeToggle.addEventListener('click', () => {
    const isEnabled = document.body.classList.contains(DARK_MODE_CLASS);

    if (isEnabled) {
      disableDarkMode();
    } else {
      enableDarkMode();
    }
  });

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem(DARK_MODE_KEY)) {
      if (e.matches) {
        enableDarkMode();
      } else {
        disableDarkMode();
      }
    }
  });
}

/**
 * Enable dark mode
 */
function enableDarkMode(): void {
  document.body.classList.add(DARK_MODE_CLASS);
  localStorage.setItem(DARK_MODE_KEY, 'true');

  // Update toggle button icon
  const darkIcon = document.querySelector('.dark-mode-icon');
  const lightIcon = document.querySelector('.light-mode-icon');

  if (darkIcon) (darkIcon as HTMLElement).style.display = 'none';
  if (lightIcon) (lightIcon as HTMLElement).style.display = 'inline';
}

/**
 * Disable dark mode
 */
function disableDarkMode(): void {
  document.body.classList.remove(DARK_MODE_CLASS);
  localStorage.setItem(DARK_MODE_KEY, 'false');

  // Update toggle button icon
  const darkIcon = document.querySelector('.dark-mode-icon');
  const lightIcon = document.querySelector('.light-mode-icon');

  if (darkIcon) (darkIcon as HTMLElement).style.display = 'inline';
  if (lightIcon) (lightIcon as HTMLElement).style.display = 'none';
}
