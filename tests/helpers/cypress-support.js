// Cypress support file

// Custom commands
Cypress.Commands.add('drawStroke', (startX, startY, endX, endY) => {
  cy.get('#canvas')
    .trigger('mousedown', startX, startY, { force: true })
    .trigger('mousemove', endX, endY, { force: true })
    .trigger('mouseup', endX, endY, { force: true });
});

Cypress.Commands.add('enterMeasurement', measurement => {
  cy.get('.stroke-measurement[contenteditable="true"]')
    .should('be.focused')
    .clear()
    .type(`${measurement}{enter}`);
});

Cypress.Commands.add('switchToImage', label => {
  cy.get(`.image-container[data-label="${label}"]`).click();
  cy.get('#canvas').should('be.visible');
});

// Fixture loading helper
Cypress.Commands.add('loadTestImages', () => {
  const images = ['front', 'side', 'back'];
  const files = [];

  images.forEach(name => {
    cy.fixture(`${name}.jpg`, 'base64').then(content => {
      files.push({
        contents: Cypress.Blob.base64StringToBlob(content),
        fileName: `${name}.jpg`,
      });
    });
  });

  cy.wrap(files).as('testImages');
});

// Viewport presets
Cypress.Commands.add('setDesktopViewport', () => {
  cy.viewport(1920, 1080);
});

Cypress.Commands.add('setTabletViewport', () => {
  cy.viewport(1024, 768);
});

// Wait helpers
Cypress.Commands.add('waitForCanvas', () => {
  cy.get('#canvas').should('be.visible');
  cy.wait(100); // Small delay for canvas initialization
});

// Assertion helpers
Cypress.Commands.add('assertStrokeCount', expectedCount => {
  cy.get('.stroke-visibility-item').should('have.length', expectedCount);
  cy.get('#strokeCounter').should('contain', `Lines: ${expectedCount}`);
});

// Drawing mode helpers
Cypress.Commands.add('setDrawingMode', mode => {
  // Click the drawing mode toggle until we get the desired mode
  cy.get('#drawingModeToggle').then($btn => {
    const currentMode = $btn.text();
    if (currentMode !== mode) {
      cy.get('#drawingModeToggle').click();
      cy.get('#drawingModeToggle').should('contain', mode);
    }
  });
});

// File upload helper
Cypress.Commands.add('uploadImage', fileName => {
  cy.fixture(fileName, 'base64').then(fileContent => {
    const blob = Cypress.Blob.base64StringToBlob(fileContent);
    const file = new File([blob], fileName, { type: 'image/jpeg' });

    cy.get('#paste').click();
    cy.get('input[type="file"]').selectFile(
      {
        contents: file,
        fileName: fileName,
      },
      { force: true }
    );
  });
});

// Measurement assertion helpers
Cypress.Commands.add('assertMeasurement', (strokeLabel, expectedValue, unit = 'inch') => {
  cy.get(`[data-stroke="${strokeLabel}"] .stroke-measurement`).should('contain', expectedValue);
});

// Zoom and pan helpers
Cypress.Commands.add('zoomIn', (times = 1) => {
  for (let i = 0; i < times; i++) {
    cy.get('body').type('e');
  }
});

Cypress.Commands.add('zoomOut', (times = 1) => {
  for (let i = 0; i < times; i++) {
    cy.get('body').type('q');
  }
});

Cypress.Commands.add('panUp', () => {
  cy.get('body').type('w');
});

Cypress.Commands.add('panDown', () => {
  cy.get('body').type('s');
});

Cypress.Commands.add('panLeft', () => {
  cy.get('body').type('a');
});

Cypress.Commands.add('panRight', () => {
  cy.get('body').type('d');
});
