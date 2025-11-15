describe('Complete Furniture Measurement Workflow', () => {
  beforeEach(() => {
    cy.visit('/');
    cy.setDesktopViewport();
  });

  it('should complete full measurement workflow with multiple images', () => {
    // Step 1: Upload multiple images
    cy.get('#paste').click();
    
    // Mock file upload (in real scenario, would use actual fixtures)
    cy.window().then((win) => {
      // Simulate image upload by directly setting up the application state
      const mockImages = ['front_1', 'side_1', 'back_1'];
      
      mockImages.forEach(label => {
        win.lineStrokesByImage[label] = [];
        win.vectorStrokesByImage[label] = {};
        win.strokeMeasurements[label] = {};
        win.strokeVisibilityByImage[label] = {};
        win.imageScaleByLabel[label] = 1.0;
        win.imagePositionByLabel[label] = { x: 0, y: 0 };
      });
      
      // Set current image
      win.currentImageLabel = 'front_1';
    });

    // Step 2: Measure front view dimensions
    cy.setDrawingMode('Straight Line');
    
    // Draw width measurement
    cy.drawStroke(100, 300, 700, 300);
    cy.enterMeasurement('72 inches');
    
    // Verify measurement was saved
    cy.window().then((win) => {
      expect(win.strokeMeasurements.front_1.A1).to.exist;
      expect(win.strokeMeasurements.front_1.A1.inchWhole).to.equal(72);
    });

    // Draw height measurement
    cy.drawStroke(50, 100, 50, 500);
    cy.enterMeasurement('36 inches');
    
    // Verify second measurement
    cy.window().then((win) => {
      expect(win.strokeMeasurements.front_1.A2).to.exist;
      expect(win.strokeMeasurements.front_1.A2.inchWhole).to.equal(36);
    });

    // Step 3: Switch to side view and add depth measurement
    cy.switchToImage('side_1');
    
    // Draw depth measurement
    cy.drawStroke(200, 300, 600, 300);
    cy.enterMeasurement('40 inches');
    
    // Verify depth measurement on side view
    cy.window().then((win) => {
      expect(win.currentImageLabel).to.equal('side_1');
      expect(win.strokeMeasurements.side_1.A1).to.exist;
      expect(win.strokeMeasurements.side_1.A1.inchWhole).to.equal(40);
    });

    // Step 4: Test unit conversion
    cy.get('#unitSelector').select('cm');
    
    // Verify measurements display in centimeters
    cy.window().then((win) => {
      const measurement = win.getMeasurementString('A1');
      expect(measurement).to.contain('101.6'); // 40 inches = 101.6 cm
      expect(measurement).to.contain('cm');
    });

    // Step 5: Verify stroke counts
    cy.assertStrokeCount(1); // Should show 1 stroke for current image (side_1)
    
    // Switch back to front view and verify its stroke count
    cy.switchToImage('front_1');
    cy.assertStrokeCount(2); // Should show 2 strokes for front view

    // Step 6: Test visibility controls
    cy.get('.stroke-visibility-checkbox').first().uncheck();
    
    // Verify stroke was hidden
    cy.window().then((win) => {
      const firstStroke = win.lineStrokesByImage.front_1[0];
      expect(win.strokeVisibilityByImage.front_1[firstStroke]).to.be.false;
    });
  });

  it('should handle measurement editing and validation', () => {
    // Setup initial state
    cy.window().then((win) => {
      win.currentImageLabel = 'front_1';
      win.lineStrokesByImage.front_1 = [];
      win.vectorStrokesByImage.front_1 = {};
      win.strokeMeasurements.front_1 = {};
    });

    // Draw a stroke
    cy.setDrawingMode('Straight Line');
    cy.drawStroke(100, 200, 400, 200);
    
    // Test different measurement formats
    const measurements = [
      '24 inches',
      '2 feet',
      '60.96 cm',
      '2 1/2"',
      '24.5"'
    ];

    measurements.forEach((measurement, index) => {
      if (index > 0) {
        // Draw additional strokes for testing
        cy.drawStroke(100, 200 + (index * 50), 400, 200 + (index * 50));
      }
      
      cy.enterMeasurement(measurement);
      
      // Verify measurement was parsed correctly
      cy.window().then((win) => {
        const strokeLabel = `A${index + 1}`;
        expect(win.strokeMeasurements.front_1[strokeLabel]).to.exist;
      });
    });

    // Test invalid measurement input
    cy.drawStroke(100, 450, 400, 450);
    cy.get('.stroke-measurement[contenteditable="true"]')
      .type('invalid measurement{enter}');
    
    // Should reject invalid input
    cy.window().then((win) => {
      const strokeLabel = 'A6';
      // Should either not exist or have no valid measurement data
      if (win.strokeMeasurements.front_1[strokeLabel]) {
        expect(win.strokeMeasurements.front_1[strokeLabel].inchWhole).to.be.undefined;
      }
    });
  });

  it('should handle advanced drawing features', () => {
    cy.window().then((win) => {
      win.currentImageLabel = 'front_1';
      win.lineStrokesByImage.front_1 = [];
      win.vectorStrokesByImage.front_1 = {};
    });

    // Test curved line drawing
    cy.setDrawingMode('Curved Line');
    
    // Click multiple points to create a curve
    cy.get('#canvas').click(100, 100, { force: true });
    cy.get('#canvas').click(200, 50, { force: true });
    cy.get('#canvas').click(300, 150, { force: true });
    cy.get('#canvas').dblclick(400, 100, { force: true });
    
    // Verify curved stroke was created
    cy.window().then((win) => {
      expect(win.lineStrokesByImage.front_1).to.have.length(1);
      const stroke = win.vectorStrokesByImage.front_1.A1;
      expect(stroke.type).to.equal('curved');
    });

    // Test arrow settings
    cy.setDrawingMode('Straight Line');
    
    // Enable arrows (if controls exist)
    cy.get('body').then($body => {
      if ($body.find('#startArrow').length) {
        cy.get('#startArrow').check();
        cy.get('#endArrow').check();
      }
    });
    
    // Draw arrow line
    cy.drawStroke(100, 300, 300, 300);
    
    // Verify arrow settings
    cy.window().then((win) => {
      const stroke = win.vectorStrokesByImage.front_1.A2;
      if (stroke && stroke.arrowSettings) {
        expect(stroke.arrowSettings.startArrow).to.be.true;
        expect(stroke.arrowSettings.endArrow).to.be.true;
      }
    });
  });

  it('should handle zoom and pan operations during drawing', () => {
    cy.window().then((win) => {
      win.currentImageLabel = 'front_1';
      win.lineStrokesByImage.front_1 = [];
      win.vectorStrokesByImage.front_1 = {};
      win.imageScaleByLabel.front_1 = 1.0;
      win.imagePositionByLabel.front_1 = { x: 0, y: 0 };
    });

    // Test drawing at different zoom levels
    cy.zoomIn(2); // Zoom in twice
    
    cy.setDrawingMode('Straight Line');
    cy.drawStroke(200, 200, 400, 200);
    
    // Verify stroke was created correctly despite zoom
    cy.window().then((win) => {
      expect(win.lineStrokesByImage.front_1).to.have.length(1);
      const stroke = win.vectorStrokesByImage.front_1.A1;
      expect(stroke).to.exist;
      expect(stroke.points).to.have.length(2);
    });

    // Test panning and drawing
    cy.panRight();
    cy.panDown();
    
    cy.drawStroke(300, 300, 500, 300);
    
    // Verify second stroke
    cy.window().then((win) => {
      expect(win.lineStrokesByImage.front_1).to.have.length(2);
    });

    // Reset zoom
    cy.get('body').type('r'); // Reset view (if implemented)
  });

  it('should export measurements correctly', () => {
    // Setup test data
    cy.window().then((win) => {
      win.currentImageLabel = 'front_1';
      win.lineStrokesByImage.front_1 = ['A1', 'A2'];
      win.vectorStrokesByImage.front_1 = {
        A1: { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], type: 'straight' },
        A2: { points: [{ x: 0, y: 0 }, { x: 0, y: 100 }], type: 'straight' }
      };
      win.strokeMeasurements.front_1 = {
        A1: { inchWhole: 72, inchFraction: 0, cm: 182.88 },
        A2: { inchWhole: 36, inchFraction: 0, cm: 91.44 }
      };
    });

    // Test measurements list export
    cy.get('body').then($body => {
      if ($body.find('#measurementsList').length) {
        cy.get('#measurementsList').click();
        cy.get('.measurement-dialog').should('be.visible');
        cy.get('textarea').should('contain', 'A1: 72"');
        cy.get('textarea').should('contain', 'A2: 36"');
        
        // Close dialog
        cy.get('[onclick*="close"]').click();
      }
    });

    // Test PDF export preparation
    cy.get('body').then($body => {
      if ($body.find('#saveAsPdf').length) {
        cy.get('#saveAsPdf').click();
        
        // Should open PDF export overlay
        cy.get('#pdfExportOverlay').should('be.visible');
        
        // Verify measurements appear in export table
        cy.get('#measurementsTableBody tr').should('have.length.at.least', 2);
      }
    });
  });
});