import { vi, beforeAll, afterAll, afterEach } from 'vitest';

// Mock fabric.js
vi.mock('fabric', () => ({
  fabric: {
    Canvas: vi.fn().mockImplementation(() => ({
      on: vi.fn(),
      off: vi.fn(),
      renderAll: vi.fn(),
      toJSON: vi.fn().mockReturnValue({ version: '5.3.0', objects: [] }),
      toDataURL: vi.fn().mockReturnValue('data:image/png;base64,'),
      loadFromJSON: vi.fn((_json: unknown, callback: () => void) => callback()),
      getObjects: vi.fn().mockReturnValue([]),
      getActiveObject: vi.fn().mockReturnValue(null),
      setActiveObject: vi.fn(),
      discardActiveObject: vi.fn(),
      dispose: vi.fn(),
      setDimensions: vi.fn(),
      getWidth: vi.fn().mockReturnValue(1200),
      getHeight: vi.fn().mockReturnValue(800),
      getZoom: vi.fn().mockReturnValue(1),
      setZoom: vi.fn(),
      setViewportTransform: vi.fn(),
      zoomToPoint: vi.fn(),
      clear: vi.fn(),
    })),
    PencilBrush: vi.fn(),
    CircleBrush: vi.fn(),
    ActiveSelection: vi.fn(),
  },
}));

// Mock environment variables
vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');
vi.stubEnv('DEV', true);
vi.stubEnv('PROD', false);
vi.stubEnv('MODE', 'test');

beforeAll(() => {
  // Global setup
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  vi.unstubAllEnvs();
});
