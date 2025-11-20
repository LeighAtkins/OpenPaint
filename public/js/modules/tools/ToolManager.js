// Tool Manager
import { PencilTool } from './PencilTool.js';
import { CurveTool } from './CurveTool.js';
import { LineTool } from './LineTool.js';
import { ArrowTool } from './ArrowTool.js';
import { TextTool } from './TextTool.js';
import { SelectTool } from './SelectTool.js';

export class ToolManager {
    constructor(canvasManager) {
        this.canvasManager = canvasManager;
        this.activeTool = null;
        this.tools = {};
        this.currentSettings = {
            color: '#3b82f6', // Default to bright blue
            width: 2
        };
    }

    init() {
        console.log('ToolManager initialized');
        
        // Initialize tools
        this.tools = {
            select: new SelectTool(this.canvasManager),
            pencil: new PencilTool(this.canvasManager),
            curve: new CurveTool(this.canvasManager),
            line: new LineTool(this.canvasManager),
            arrow: new ArrowTool(this.canvasManager),
            text: new TextTool(this.canvasManager)
        };
        
        // Select default tool (only if canvas is ready)
        if (this.canvasManager.fabricCanvas) {
            this.selectTool('line'); // Start in straight line mode (drawing by default)
        } else {
            console.warn('ToolManager: Canvas not ready, deferring tool selection');
            // Try again after a short delay
            setTimeout(() => {
                if (this.canvasManager.fabricCanvas) {
                    this.selectTool('line'); // Start in straight line mode
                }
            }, 100);
        }
    }
    
    selectTool(toolName) {
        if (this.activeTool) {
            this.activeTool.deactivate();
        }
        
        const tool = this.tools[toolName];
        if (tool) {
            this.activeTool = tool;
            this.activeTool.activate();
            // Apply current settings to new tool
            this.updateSettings(this.currentSettings);
            console.log(`Tool selected: ${toolName}`);
        } else {
            console.warn(`Tool not found: ${toolName}`);
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
