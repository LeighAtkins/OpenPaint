// Toolbar layout calculation - determines compact vs full mode
(function() {
    'use strict';

    let resizeTimer = null;
    let isCalculating = false;

    const calculateToolbarMode = () => {
        // Prevent concurrent calculations
        if (isCalculating) return;
        isCalculating = true;

        const toolbarWrap = document.getElementById('toolbarWrap') || document.querySelector('.toolbar-wrap');
        if (!toolbarWrap) {
            isCalculating = false;
            return;
        }

        const windowWidth = window.innerWidth;
        const isMobile = windowWidth <= 768;

        // Desktop: always use full mode
        if (!isMobile) {
            document.documentElement.setAttribute('data-toolbar-mode', 'full');
            isCalculating = false;
            return;
        }

        // Mobile: Measure if compact is needed
        // Temporarily set to full mode for measurement
        document.documentElement.setAttribute('data-toolbar-mode', 'full');

        // Force layout calculation
        void toolbarWrap.offsetWidth;

        // Measure if content overflows
        const toolbarWidth = toolbarWrap.clientWidth;
        const toolbarScrollWidth = toolbarWrap.scrollWidth;
        const needsCompact = toolbarScrollWidth > toolbarWidth;

        // Set the correct mode based on measurement
        document.documentElement.setAttribute('data-toolbar-mode', needsCompact ? 'compact' : 'full');

        isCalculating = false;
    };

    // Calculate immediately when toolbar exists
    const initCalculation = () => {
        const toolbarWrap = document.getElementById('toolbarWrap') || document.querySelector('.toolbar-wrap');
        if (toolbarWrap) {
            calculateToolbarMode();
        } else if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initCalculation);
        } else {
            setTimeout(initCalculation, 0);
        }
    };

    // Start calculation
    initCalculation();

    // Recalculate after fonts load (for accurate text measurement)
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            setTimeout(calculateToolbarMode, 50);
        });
    }

    // Recalculate on window resize (throttled)
    window.addEventListener('resize', () => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(calculateToolbarMode, 150);
    });

    // Expose function globally if needed
    window.calculateToolbarMode = calculateToolbarMode;
})();
