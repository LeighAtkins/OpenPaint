import { existsSync } from 'node:fs';

/**
 * The measurement guide library lives in `public/measurement-guides/Modular MT /`
 * (the directory name ends with a space). Windows cannot check that directory
 * out, so tests that read guide artwork straight from disk only run where the
 * library exists.
 */
export const GUIDE_LIBRARY_DIR = 'public/measurement-guides/Modular MT /';
export const guideLibraryAvailable = existsSync(`${GUIDE_LIBRARY_DIR}Ottoman`);
