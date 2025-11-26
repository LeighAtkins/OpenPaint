// Base Tool Interface

export class BaseTool {
  constructor(canvasManager) {
    this.canvasManager = canvasManager;
    this.canvas = canvasManager.fabricCanvas;
    this.isActive = false;
  }

  activate() {
    this.isActive = true;
    this.canvas = this.canvasManager.fabricCanvas; // Ensure we have the latest canvas instance
  }

  deactivate() {
    this.isActive = false;
  }
}
