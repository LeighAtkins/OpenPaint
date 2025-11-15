// HEIC decode worker using heic2any (runs off main thread)
// Loads heic2any from CDN to keep bundle light
/* eslint-disable no-undef */
try {
    // Prefer same-origin to avoid MIME type issues
    importScripts('/vendor/heic2any.min.js');
} catch (e) {
    try {
        importScripts('https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js');
    } catch (e2) { /* no-op */ }
}

self.onmessage = async (e) => {
    const { file, toType = 'image/png', quality = 0.92 } = e.data || {};
    if (!file) {
        self.postMessage({ ok: false, error: 'No file received' });
        return;
    }
    try {
        const out = await heic2any({ blob: file, toType, quality });
        const blob = Array.isArray(out) ? out[0] : out;
        const buf = await blob.arrayBuffer();
        self.postMessage({ ok: true, buf, type: blob.type }, [buf]);
    } catch (err) {
        self.postMessage({ ok: false, error: err?.message || String(err) });
    }
};


