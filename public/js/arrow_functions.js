function drawArrowLine(ctx, startX, startY, endX, endY, color, lineWidth, arrowStart, arrowEnd) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    
    // Calculate arrow properties
    const arrowLength = Math.max(10, lineWidth * 3);
    const arrowWidth = Math.max(8, lineWidth * 2);
    
    // Calculate line direction
    const dx = endX - startX;
    const dy = endY - startY;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length === 0) return;
    
    const unitX = dx / length;
    const unitY = dy / length;
    
    // Calculate adjusted start and end points for tapering
    let adjustedStartX = startX;
    let adjustedStartY = startY;
    let adjustedEndX = endX;
    let adjustedEndY = endY;
    
    if (arrowStart) {
        adjustedStartX = startX + unitX * (arrowLength * 0.7);
        adjustedStartY = startY + unitY * (arrowLength * 0.7);
    }
    
    if (arrowEnd) {
        adjustedEndX = endX - unitX * (arrowLength * 0.7);
        adjustedEndY = endY - unitY * (arrowLength * 0.7);
    }
    
    // Draw the main line
    ctx.beginPath();
    ctx.moveTo(adjustedStartX, adjustedStartY);
    ctx.lineTo(adjustedEndX, adjustedEndY);
    ctx.stroke();
    
    // Draw arrowheads
    if (arrowStart) {
        drawArrowhead(ctx, adjustedStartX, adjustedStartY, -unitX, -unitY, arrowLength, arrowWidth, color);
    }
    
    if (arrowEnd) {
        drawArrowhead(ctx, adjustedEndX, adjustedEndY, unitX, unitY, arrowLength, arrowWidth, color);
    }
    
    ctx.restore();
}

function drawArrowhead(ctx, x, y, dirX, dirY, length, width, color) {
    ctx.save();
    ctx.fillStyle = color;
    
    // Calculate perpendicular vector
    const perpX = -dirY;
    const perpY = dirX;
    
    // Calculate arrowhead points
    const tipX = x + dirX * length;
    const tipY = y + dirY * length;
    const baseLeftX = x + perpX * (width / 2);
    const baseLeftY = y + perpY * (width / 2);
    const baseRightX = x - perpX * (width / 2);
    const baseRightY = y - perpY * (width / 2);
    
    // Draw filled arrowhead
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseLeftX, baseLeftY);
    ctx.lineTo(baseRightX, baseRightY);
    ctx.closePath();
    ctx.fill();
    
    ctx.restore();
} 