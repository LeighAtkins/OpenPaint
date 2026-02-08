// Tool Manager
import { LineTool } from './LineTool.js';

type CanvasManagerLike = {
  fabricCanvas?: unknown;
};

export interface ToolSettings {
  color?: string;
  width?: number;
  fontSize?: number;
}

export interface ToolInstance {
  activate: () => void;
  deactivate: () => void;
  setColor?: (color: string) => void;
  setWidth?: (width: number) => void;
  setFontSize?: (fontSize: number) => void;
}

type ToolConstructor = new (canvasManager: CanvasManagerLike) => ToolInstance;

type ToolLoader = () => Promise<ToolConstructor>;

const TOOL_LOADERS = {
  select: () => import('./SelectTool.js').then(module => module.SelectTool as ToolConstructor),
  pencil: () => import('./PencilTool.js').then(module => module.PencilTool as ToolConstructor),
  curve: () => import('./CurveTool.js').then(module => module.CurveTool as ToolConstructor),
  line: () => Promise.resolve(LineTool as ToolConstructor),
  arrow: () => import('./ArrowTool.js').then(module => module.ArrowTool as ToolConstructor),
  privacy: () =>
    import('./PrivacyEraserTool.js').then(module => module.PrivacyEraserTool as ToolConstructor),
  text: () => import('./TextTool.js').then(module => module.TextTool as ToolConstructor),
  shape: () => import('./ShapeTool.js').then(module => module.ShapeTool as ToolConstructor),
  frame: () => import('./FrameTool.js').then(module => module.FrameTool as ToolConstructor),
} satisfies Record<string, ToolLoader>;

type ToolName = keyof typeof TOOL_LOADERS;

type ToolLookup = Partial<Record<ToolName, ToolInstance>>;

type ToolPromiseLookup = Partial<Record<ToolName, Promise<ToolInstance | null>>>;

export class ToolManager {
  canvasManager: CanvasManagerLike;
  activeTool: ToolInstance | null;
  activeToolName: ToolName | null;
  previousToolName: ToolName | null;
  tools: ToolLookup;
  toolPromises: ToolPromiseLookup;
  pendingToolName: ToolName | null;
  currentSettings: ToolSettings;

  constructor(canvasManager: CanvasManagerLike) {
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

  async ensureTool(toolName: ToolName) {
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

    return this.toolPromises[toolName] ?? null;
  }

  preloadTools(toolNames: ToolName[]) {
    toolNames.forEach(toolName => {
      void this.ensureTool(toolName);
    });
  }

  async selectTool(toolName: ToolName) {
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
  updateSettings(settings: ToolSettings) {
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
