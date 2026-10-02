/** The single runtime entry point. The library never loads the drawing workspace. */
let returnTo: string | null = null;
try {
  returnTo = sessionStorage.getItem('sofapaint:auth-return');
} catch {
  /* Storage can be disabled. */
}
if (location.pathname === '/' && returnTo?.startsWith('/search') && !returnTo.startsWith('//')) {
  sessionStorage.removeItem('sofapaint:auth-return');
  const target = new URL(returnTo, location.origin);
  const callback = new URLSearchParams(location.search);
  callback.forEach((value, key) => target.searchParams.set(key, value));
  target.hash = location.hash;
  location.replace(target.href);
} else if (location.pathname === '/search' || location.pathname.startsWith('/search/')) {
  void import('./modules/measurement-search/page').then(module => module.initMeasurementSearch());
} else {
  void import('./paint-entry');
}
export {};
