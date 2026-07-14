const NEXT_TAG_ID = 'nextTagDisplay';

export function getNextTagElement(): HTMLInputElement | HTMLElement | null {
  return document.getElementById(NEXT_TAG_ID) as HTMLInputElement | HTMLElement | null;
}

export function getNextTagValue(): string {
  const element = getNextTagElement();
  if (!element) return '';
  return (element instanceof HTMLInputElement ? element.value : element.textContent || '').trim();
}

export function setNextTagValue(value: unknown): void {
  const element = getNextTagElement();
  if (!element) return;
  const normalized = String(value ?? '');
  if (element instanceof HTMLInputElement) {
    element.value = normalized;
  } else {
    element.textContent = normalized;
  }
}

export function focusNextTagValue(options: { select?: boolean } = {}): void {
  const element = getNextTagElement();
  if (!element) return;
  element.focus();
  if (options.select === false) return;
  if (element instanceof HTMLInputElement) {
    element.select();
    return;
  }
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}
