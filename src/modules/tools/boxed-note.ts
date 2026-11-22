// Install on IText so Fabric also draws the box on deserialized project notes.
let calloutRenderingInstalled = false;
export function installCalloutRendering(fabric: any) {
  if (calloutRenderingInstalled) return;
  const prototype = fabric.IText.prototype;
  const renderBackground = prototype._renderBackground;
  prototype._renderBackground = function (ctx: CanvasRenderingContext2D) {
    if (
      !this.customData?.boxedNote ||
      !this.backgroundColor ||
      this.backgroundColor === 'transparent'
    ) {
      return renderBackground.call(this, ctx);
    }
    const pad = Math.max(3, this.fontSize * 0.18);
    const width = this.width + 2 * pad;
    const height = this.height + 2 * pad;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(-width / 2, -height / 2, width, height, pad);
    ctx.fillStyle = this.backgroundColor;
    ctx.fill();
    ctx.strokeStyle = '#52636b';
    ctx.lineWidth = Math.max(1, this.fontSize / 24);
    ctx.stroke();
    ctx.restore();
  };
  calloutRenderingInstalled = true;
}
