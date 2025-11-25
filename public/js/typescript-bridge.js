/**
 * TypeScript Bridge Script
 * 
 * This script loads the TypeScript modules alongside the existing JavaScript
 * modules during the migration period. This allows both systems to coexist.
 */

(async function() {
    console.log('[TypeScript Bridge] Loading TypeScript modules...');
    
    try {
        // Load the TypeScript main module
        const tsModule = await import('/src/main.ts');
        console.log('[TypeScript Bridge] TypeScript modules loaded successfully');
        
        // The TypeScript app will initialize itself
        window.__typescript_loaded = true;
        
    } catch (error) {
        console.warn('[TypeScript Bridge] Failed to load TypeScript modules:', error);
        console.warn('[TypeScript Bridge] Continuing with JavaScript-only mode');
        
        // Don't break the existing app if TypeScript fails to load
        window.__typescript_loaded = false;
    }
})();