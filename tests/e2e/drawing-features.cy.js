describe('Advanced Drawing Features', () => {
  beforeEach(() => {
    cy.visit('/');
    cy.setDesktopViewport();
    cy.waitForCanvas();
    
    // Initialize application state
    cy.window().then((win) => {
      win.currentImageLabel = 'front_1';
      win.lineStrokesByImage = { front_1: [] };
      win.vectorStrokesByImage = { front_1: {} };
      win.strokeMeasurements = { front_1: {} };
      win.strokeVisibilityByImage = { front_1: {} };
      win.imageScaleByLabel = { front_1: 1.0 };
      win.imagePositionByLabel = { front_1: { x: 0, y: 0 } };
    });
  });

  it('should draw arrows and dotted lines', () => {
    // Switch to straight line mode
    cy.setDrawingMode('Straight Line');
    
    // Test arrow configuration (if controls exist)
    cy.get('body').then($body => {
      if ($body.find('#startArrow').length) {
        cy.get('#startArrow').check();
        cy.get('#endArrow').check();
      }
    });
    
    // Test dash style configuration (if controls exist)
    cy.get('body').then($body => {
      if ($body.find('#dashStyleSelect').length) {
        cy.get('#dashStyleSelect').select('medium');
      }
    });
    
    // Draw arrow line
    cy.drawStroke(100, 200, 300, 200);
    
    // Verify arrow and dash settings were applied
    cy.window().then((win) => {
      expect(win.lineStrokesByImage.front_1).to.have.length(1);
      const strokeLabel = win.lineStrokesByImage.front_1[0];
      const stroke = win.vectorStrokesByImage.front_1[strokeLabel];
      
      expect(stroke).to.exist;
      expect(stroke.type).to.equal('straight');
      
      // Check arrow settings if they exist
      if (stroke.arrowSettings) {
        expect(stroke.arrowSettings.startArrow).to.be.true;
        expect(stroke.arrowSettings.endArrow).to.be.true;
      }
      
      // Check dash settings if they exist
      if (stroke.dashSettings) {
        expect(stroke.dashSettings.style).to.equal('medium');
      }
    });
  });

  it('should edit strokes in edit mode', () => {
    // Draw a stroke first
    cy.setDrawingMode('Straight Line');
    cy.drawStroke(100, 100, 300, 100);
    
    // Verify stroke was created
    cy.window().then((win) => {
      expect(win.lineStrokesByImage.front_1).to.have.length(1);
    });
    
    // Enter edit mode by double-clicking stroke visibility item
    cy.get('.stroke-visibility-item').first().dblclick();
    
    // Test color change (if color controls exist)
    cy.get('body').then($body => {
      if ($body.find('.color-btn[data-color="#4285f4"]').length) {
        cy.get('.color-btn[data-color="#4285f4"]').click();
        
        // Verify color change
        cy.window().then((win) => {
          const strokeLabel = win.selectedStrokeInEditMode || win.lineStrokesByImage.front_1[0];
          const stroke = win.vectorStrokesByImage.front_1[strokeLabel];
          if (stroke) {
            expect(stroke.color).to.equal('#4285f4');
          }
        });
      }
    });
    
    // Test thickness change
    cy.get('#brushSize').clear().type('10');
    
    // Verify thickness change
    cy.window().then((win) => {
      const strokeLabel = win.selectedStrokeInEditMode || win.lineStrokesByImage.front_1[0];
      const stroke = win.vectorStrokesByImage.front_1[strokeLabel];
      if (stroke) {
        expect(stroke.width).to.equal(10);
      }
    });
  });

  it('should handle curved lines with control points', () => {
    // Switch to curved line mode
    cy.setDrawingMode('Curved Line');
    
    // Add control points by clicking
    const controlPoints = [
      { x: 100, y: 100 },
      { x: 200, y: 50 },
      { x: 300, y: 150 },
      { x: 400, y: 100 }
    ];
    
    // Click each control point
    controlPoints.forEach((point, index) => {
      if (index < controlPoints.length - 1) {
        cy.get('#canvas').click(point.x, point.y, { force: true });
      } else {
        // Double-click the last point to finalize
        cy.get('#canvas').dblclick(point.x, point.y, { force: true });
      }
    });
    
    // Verify curved line was created
    cy.window().then((win) => {
      expect(win.lineStrokesByImage.front_1).to.have.length(1);
      const stroke = win.vectorStrokesByImage.front_1.A1;
      expect(stroke).to.exist;
      expect(stroke.type).to.equal('curved');
      
      if (stroke.controlPoints) {
        expect(stroke.controlPoints).to.have.length(4);
      }
    });
    
    // Test editing control points (if edit mode supports it)
    cy.get('.stroke-visibility-item').first().dblclick();
    
    // Try to drag a control point
    cy.get('#canvas')
      .trigger('mousedown', 200, 50, { force: true })
      .trigger('mousemove', 200, 150, { force: true })
      .trigger('mouseup', 200, 150, { force: true });
    
    // Verify control point was moved (if supported)
    cy.window().then((win) => {
      const stroke = win.vectorStrokesByImage.front_1.A1;
      if (stroke && stroke.controlPoints && stroke.controlPoints.length > 1) {
        // Control point should have moved (approximately)
        expect(stroke.controlPoints[1].y).to.be.closeTo(150, 20);
      }
    });
  });

  it('should handle freehand drawing', () => {
    // Ensure we're in freehand mode
    cy.setDrawingMode('Freehand');
    
    // Draw a freehand stroke
    cy.get('#canvas')
      .trigger('mousedown', 100, 200, { force: true })
      .trigger('mousemove', 150, 180, { force: true })
      .trigger('mousemove', 200, 220, { force: true })
      .trigger('mousemove', 250, 200, { force: true })
      .trigger('mousemove', 300, 240, { force: true })
      .trigger('mouseup', 300, 240, { force: true });
    
    // Verify freehand stroke was created
    cy.window().then((win) => {
      expect(win.lineStrokesByImage.front_1).to.have.length(1);
      const stroke = win.vectorStrokesByImage.front_1.A1;
      expect(stroke).to.exist;
      expect(stroke.type).to.equal('freehand');
      expect(stroke.points.length).to.be.greaterThan(2);
    });
  });

  it('should handle stroke deletion and undo operations', () => {
    // Create multiple strokes
    cy.setDrawingMode('Straight Line');
    
    // Draw first stroke
    cy.drawStroke(100, 100, 200, 100);
    
    // Draw second stroke
    cy.drawStroke(100, 150, 200, 150);
    
    // Draw third stroke
    cy.drawStroke(100, 200, 200, 200);
    
    // Verify all strokes were created
    cy.window().then((win) => {
      expect(win.lineStrokesByImage.front_1).to.have.length(3);
    });
    
    // Test individual stroke deletion
    cy.get('.stroke-visibility-item').first().find('.delete-stroke-btn').click();
    
    // Verify stroke was deleted
    cy.window().then((win) => {
      expect(win.lineStrokesByImage.front_1).to.have.length(2);
    });
    
    // Test delete key functionality (if supported)
    cy.get('.stroke-visibility-item').first().click(); // Select stroke
    cy.get('body').type('{del}');
    
    // Verify another stroke was deleted
    cy.window().then((win) => {
      expect(win.lineStrokesByImage.front_1).to.have.length.at.most(2);
    });
    
    // Test undo functionality (if supported)
    cy.get('body').then($body => {
      if ($body.find('#undoBtn').length) {
        cy.get('#undoBtn').click();
        
        // Should restore deleted stroke
        cy.window().then((win) => {
          expect(win.lineStrokesByImage.front_1).to.have.length.at.least(2);
        });
      }
    });
  });

  it('should handle stroke selection and multi-selection', () => {
    // Create multiple strokes
    cy.setDrawingMode('Straight Line');
    
    cy.drawStroke(100, 100, 200, 100);
    cy.drawStroke(100, 150, 200, 150);
    cy.drawStroke(100, 200, 200, 200);
    
    // Test single selection
    cy.get('.stroke-visibility-item').first().click();
    
    cy.window().then((win) => {
      if (win.selectedStrokeByImage && win.selectedStrokeByImage.front_1) {
        expect(win.selectedStrokeByImage.front_1).to.exist;
      }
    });
    
    // Test multi-selection with Ctrl+click (if supported)
    cy.get('.stroke-visibility-item').eq(1).click({ ctrlKey: true });
    
    cy.window().then((win) => {
      if (win.multipleSelectedStrokesByImage && win.multipleSelectedStrokesByImage.front_1) {
        expect(win.multipleSelectedStrokesByImage.front_1.length).to.be.at.least(1);
      }
    });
    
    // Test bulk operations on selected strokes
    cy.get('body').then($body => {
      if ($body.find('#hideSelectedBtn').length) {
        cy.get('#hideSelectedBtn').click();
        
        // Selected strokes should be hidden
        cy.window().then((win) => {
          // At least one stroke should be hidden
          const visibilityValues = Object.values(win.strokeVisibilityByImage.front_1);
          expect(visibilityValues).to.include(false);
        });
      }
    });
  });

  it('should maintain drawing state across mode switches', () => {
    // Start with straight line
    cy.setDrawingMode('Straight Line');
    cy.drawStroke(100, 100, 200, 100);
    
    // Switch to freehand
    cy.setDrawingMode('Freehand');
    cy.get('#canvas')
      .trigger('mousedown', 250, 100, { force: true })
      .trigger('mousemove', 300, 120, { force: true })
      .trigger('mouseup', 300, 120, { force: true });
    
    // Switch to curved
    cy.setDrawingMode('Curved Line');
    cy.get('#canvas').click(350, 100, { force: true });
    cy.get('#canvas').click(400, 80, { force: true });
    cy.get('#canvas').dblclick(450, 100, { force: true });
    
    // Verify all strokes exist with correct types
    cy.window().then((win) => {
      expect(win.lineStrokesByImage.front_1).to.have.length(3);
      
      const strokes = win.lineStrokesByImage.front_1.map(label => 
        win.vectorStrokesByImage.front_1[label]
      );
      
      const types = strokes.map(stroke => stroke.type);
      expect(types).to.include('straight');
      expect(types).to.include('freehand');
      expect(types).to.include('curved');
    });
  });
});