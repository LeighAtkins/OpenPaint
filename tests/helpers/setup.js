// Jest setup file
require('jest-canvas-mock');

// Mock DOM elements
global.document.getElementById = jest.fn((id) => {
  const elements = {
    'canvas': { 
      getContext: jest.fn(() => ({
        clearRect: jest.fn(),
        beginPath: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        stroke: jest.fn(),
        fill: jest.fn(),
        arc: jest.fn(),
        save: jest.fn(),
        restore: jest.fn(),
        translate: jest.fn(),
        rotate: jest.fn(),
        scale: jest.fn(),
        drawImage: jest.fn(),
        getImageData: jest.fn(() => ({ data: new Uint8ClampedArray(4) })),
        putImageData: jest.fn(),
        createImageData: jest.fn(() => ({ data: new Uint8ClampedArray(4) })),
        setLineDash: jest.fn(),
        measureText: jest.fn(() => ({ width: 100 }))
      })),
      width: 800,
      height: 600,
      getBoundingClientRect: jest.fn(() => ({
        left: 0, top: 0, width: 800, height: 600
      })),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn()
    },
    'colorPicker': { value: '#000000' },
    'brushSize': { value: '5' },
    'unitSelector': { value: 'inch' },
    'drawingModeToggle': { 
      textContent: 'Freehand',
      click: jest.fn(),
      addEventListener: jest.fn()
    }
  };
  return elements[id] || null;
});

// Mock window functions
global.URL = {
  createObjectURL: jest.fn(() => 'blob:mock-url'),
  revokeObjectURL: jest.fn()
};

// Mock performance API
global.performance = {
  now: jest.fn(() => Date.now()),
  memory: {
    usedJSHeapSize: 50 * 1024 * 1024 // 50MB
  }
};

// Initialize global window object with required properties
global.window = {
  ...global,
  getSelection: jest.fn(() => ({
    removeAllRanges: jest.fn(),
    addRange: jest.fn()
  })),
  requestAnimationFrame: jest.fn(cb => setTimeout(cb, 16))
};

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};