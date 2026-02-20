export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>): void => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delay);
  };
}

export function throttle<T extends (...args: any[]) => void>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  let lastArgs: Parameters<T> | null = null;

  return (...args: Parameters<T>): void => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
        if (lastArgs !== null) {
          fn(...lastArgs);
          lastArgs = null;
        }
      }, limit);
    } else {
      lastArgs = args;
    }
  };
}

export function createDebouncedAsync<T, Args extends unknown[]>(
  fn: (...args: Args) => Promise<T>,
  delay: number
): (...args: Args) => Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let pendingResolve: ((value: T) => void) | null = null;
  let pendingReject: ((reason: unknown) => void) | null = null;

  return (...args: Args): Promise<T> => {
    return new Promise((resolve, reject) => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        pendingReject?.(new Error('Debounced'));
      }

      pendingResolve = resolve;
      pendingReject = reject;

      timeoutId = setTimeout(() => {
        void (async () => {
          try {
            const result = await fn(...args);
            pendingResolve?.(result);
          } catch (error) {
            pendingReject?.(error);
          } finally {
            timeoutId = null;
            pendingResolve = null;
            pendingReject = null;
          }
        })();
      }, delay);
    });
  };
}
