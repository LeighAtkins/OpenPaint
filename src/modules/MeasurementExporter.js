// Measurement Exporter
// Handles export of measurements to various formats

export class MeasurementExporter {
  constructor(measurementSystem, projectManager) {
    this.measurementSystem = measurementSystem;
    this.projectManager = projectManager;
  }

  // Create text list of all measurements
  createTextList(imageLabel = null) {
    const labels = imageLabel ? [imageLabel] : Object.keys(this.projectManager.views);
    const lines = [];

    labels.forEach(label => {
      const measurements = this.measurementSystem.getFormattedMeasurementsList(label);

      if (measurements.length > 0) {
        lines.push(`${label.toUpperCase()}`);
        lines.push('='.repeat(label.length));

        measurements.forEach(m => {
          lines.push(`${m.label}: ${m.measurement}`);
        });

        lines.push(''); // Empty line between views
      }
    });

    return lines.join('\n');
  }

  // Copy measurements to clipboard
  async copyToClipboard(imageLabel = null) {
    const text = this.createTextList(imageLabel);

    try {
      await navigator.clipboard.writeText(text);
      return { success: true, message: 'Measurements copied to clipboard' };
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      return { success: false, message: 'Failed to copy to clipboard' };
    }
  }

  // Download measurements as text file
  downloadTextFile(imageLabel = null, filename = 'measurements.txt') {
    const text = this.createTextList(imageLabel);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url);
  }

  // Export measurements as JSON for project saving
  exportToJSON(imageLabel = null) {
    const labels = imageLabel ? [imageLabel] : Object.keys(this.projectManager.views);
    const data = {};

    labels.forEach(label => {
      const measurements = this.measurementSystem.metadataManager.strokeMeasurements[label];
      if (measurements && Object.keys(measurements).length > 0) {
        data[label] = JSON.parse(JSON.stringify(measurements));
      }
    });

    return data;
  }

  // Import measurements from JSON (for project loading)
  importFromJSON(data) {
    if (!data || typeof data !== 'object') {
      console.warn('Invalid measurement data for import');
      return;
    }

    // Clear existing measurements first
    Object.keys(data).forEach(imageLabel => {
      if (!this.measurementSystem.metadataManager.strokeMeasurements[imageLabel]) {
        this.measurementSystem.metadataManager.strokeMeasurements[imageLabel] = {};
      }

      const measurements = data[imageLabel];
      if (measurements && typeof measurements === 'object') {
        Object.entries(measurements).forEach(([strokeLabel, measurement]) => {
          if (this.measurementSystem.validateMeasurement(measurement)) {
            this.measurementSystem.metadataManager.strokeMeasurements[imageLabel][strokeLabel] =
              measurement;
          }
        });
      }
    });
  }

  // Create summary statistics
  getSummaryStats(imageLabel = null) {
    const labels = imageLabel ? [imageLabel] : Object.keys(this.projectManager.views);
    let totalMeasurements = 0;
    let minValue = Infinity;
    let maxValue = 0;
    let sumValue = 0;

    labels.forEach(label => {
      const measurements = this.measurementSystem.getFormattedMeasurementsList(label);
      measurements.forEach(m => {
        totalMeasurements++;
        const totalInches = m.inchWhole + m.inchFraction;
        minValue = Math.min(minValue, totalInches);
        maxValue = Math.max(maxValue, totalInches);
        sumValue += totalInches;
      });
    });

    const avgValue = totalMeasurements > 0 ? sumValue / totalMeasurements : 0;

    return {
      count: totalMeasurements,
      min: minValue === Infinity ? 0 : minValue,
      max: maxValue,
      average: avgValue,
    };
  }

  // Generate CSV format
  createCSV(imageLabel = null) {
    const labels = imageLabel ? [imageLabel] : Object.keys(this.projectManager.views);
    const rows = [
      ['View', 'Label', 'Inches (Whole)', 'Inches (Fraction)', 'Total Inches', 'Centimeters'],
    ];

    labels.forEach(label => {
      const measurements = this.measurementSystem.getFormattedMeasurementsList(label);
      measurements.forEach(m => {
        const totalInches = m.inchWhole + m.inchFraction;
        rows.push([
          label,
          m.label,
          m.inchWhole,
          m.inchFraction,
          totalInches.toFixed(3),
          m.cm.toFixed(1),
        ]);
      });
    });

    return rows.map(row => row.join(',')).join('\n');
  }

  // Download measurements as CSV file
  downloadCSV(imageLabel = null, filename = 'measurements.csv') {
    const csv = this.createCSV(imageLabel);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url);
  }
}
