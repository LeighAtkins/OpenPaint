// Tool Manager
import { LineTool } from './LineTool.js';

const TOOL_LOADERS = {
  select: () => import('./SelectTool.js').then(module => module.SelectTool),
  pencil: () => import('./PencilTool.js').then(module => module.PencilTool),
  curve: () => import('./CurveTool.js').then(module => module.CurveTool),
  line: () => Promise.resolve(LineTool),
  arrow: () => import('./ArrowTool.js').then(module => module.ArrowTool),
  privacy: () => import('./PrivacyEraserTool.js').then(module => module.PrivacyEraserTool),
  text: () => import('./TextTool.js').then(module => module.TextTool),
  shape: () => import('./ShapeTool.js').then(module => module.ShapeTool),
  frame: () => import('./FrameTool.js').then(module => module.FrameTool),
};

export class ToolManager {
  constructor(canvasManager) {
    this.canvasManager = canvasManager;
    this.activeTool = null;
    this.activeToolName = null;
    this.previousToolName = null;
    this.tools = {};
    this.toolPromises = {};
    this.pendingToolName = null;
    this.currentSettings = {
      color: '#3b82f6', // Default to bright blue
      width: 2,
    };
  }

  init() {
    console.log('ToolManager initialized');
    this.tools = {};
    this.toolPromises = {};
    this.pendingToolName = null;
    this.selectDefaultTool();
  }

  selectDefaultTool() {
    if (this.canvasManager.fabricCanvas) {
      void this.selectTool('line'); // Start in straight line mode (drawing by default)
    } else {
      console.warn('ToolManager: Canvas not ready, deferring tool selection');
      // Try again after a short delay
      setTimeout(() => {
        if (this.canvasManager.fabricCanvas) {
          void this.selectTool('line'); // Start in straight line mode
        }
      }, 100);
    }
  }

  async ensureTool(toolName) {
    if (this.tools[toolName]) {
      return this.tools[toolName];
    }

    const loader = TOOL_LOADERS[toolName];
    if (!loader) {
      console.warn(`Tool loader not found: ${toolName}`);
      return null;
    }

    if (!this.toolPromises[toolName]) {
      this.toolPromises[toolName] = loader()
        .then(ToolClass => {
          const tool = new ToolClass(this.canvasManager);
          this.tools[toolName] = tool;
          return tool;
        })
        .catch(error => {
          console.error(`Failed to load tool: ${toolName}`, error);
          return null;
        })
        .finally(() => {
          delete this.toolPromises[toolName];
        });
    }

    return this.toolPromises[toolName];
  }

  preloadTools(toolNames) {
    toolNames.forEach(toolName => {
      void this.ensureTool(toolName);
    });
  }

  async selectTool(toolName) {
    this.pendingToolName = toolName;

    const tool = await this.ensureTool(toolName);
    if (!tool || this.pendingToolName !== toolName) {
      return;
    }

    if (this.activeTool && this.activeTool !== tool) {
      this.activeTool.deactivate();
    }

    this.activeTool = tool;
    this.activeToolName = toolName;
    this.activeTool.activate();
    // Apply current settings to new tool
    this.updateSettings(this.currentSettings);
    console.log(`Tool selected: ${toolName}`);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('toolchange', { detail: { tool: toolName } }));
    }
  }

  // Helper to update current tool settings
  updateSettings(settings) {
    this.currentSettings = { ...this.currentSettings, ...settings };

    if (this.activeTool) {
      if (settings.color && this.activeTool.setColor) {
        this.activeTool.setColor(settings.color);
      }
      if (settings.width && this.activeTool.setWidth) {
        this.activeTool.setWidth(settings.width);
      }
      if (settings.fontSize && this.activeTool.setFontSize) {
        this.activeTool.setFontSize(settings.fontSize);
      }
    }
  }
}
