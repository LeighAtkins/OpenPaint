// Comprehensive test suite for Phase 4 project management services
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  projectService,
  projectImagesService,
  measurementsService,
  projectExportService,
  authService,
} from '@/services';
import { Result } from '@/utils/result';
import type {
  CreateProjectData,
  CreateMeasurementData,
  ImageUploadOptions,
  ExportOptions,
} from '@/services';

// Mock authentication
const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  emailConfirmed: true,
  createdAt: '2024-01-01T00:00:00Z',
  profile: {
    id: 'test-user-id',
    email: 'test@example.com',
    display_name: 'Test User',
    preferences: {
      theme: 'light' as const,
      defaultUnits: 'px' as const,
      autoSave: true,
      showTooltips: true,
      maxRecentProjects: 10,
      storageQuotaWarning: true,
    },
  },
};

// Mock Supabase operations
vi.mock('@/services/supabase.service', () => ({
  SupabaseService: class MockSupabaseService {
    async insert(table: string, data: any) {
      return Result.ok({
        id: `mock-${Date.now()}`,
        ...data,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    async getById(table: string, id: string) {
      return Result.ok({
        id,
        name: 'Mock Project',
        user_id: 'test-user-id',
        data: {
          version: '2.0.0',
          images: {},
          measurements: {},
          settings: {
            units: 'px',
            defaultStrokeWidth: 2,
            defaultColor: '#000000',
            autoSave: true,
            showGrid: false,
            snapToGrid: false,
            gridSize: 20,
          },
          metadata: {
            createdBy: 'test-user-id',
            createdAt: '2024-01-01T00:00:00Z',
            lastModifiedBy: 'test-user-id',
            lastModifiedAt: '2024-01-01T00:00:00Z',
            totalImages: 0,
            totalMeasurements: 0,
            projectSize: 0,
            exportHistory: [],
          },
        },
        is_public: false,
        version: 1,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });
    }

    async update(table: string, id: string, data: any, version?: number) {
      return Result.ok({
        id,
        ...data,
        updated_at: new Date().toISOString(),
        version: (version || 0) + 1,
      });
    }

    async delete(table: string, id: string) {
      return Result.ok(true);
    }

    async select(table: string, filters: any, options: any) {
      return Result.ok([]);
    }

    async paginate(table: string, page: number, pageSize: number) {
      return Result.ok({
        data: [],
        count: 0,
        page,
        pageSize,
        hasMore: false,
      });
    }
  },
  default: class MockSupabaseService {},
}));

// Mock authentication service
vi.spyOn(authService, 'getCurrentUser').mockReturnValue(mockUser);

describe('ProjectService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createProject', () => {
    it('should create a new project with valid data', async () => {
      const projectData: CreateProjectData = {
        name: 'Test Project',
        description: 'A test project',
        settings: { units: 'mm' },
        isPublic: false,
        tags: ['test', 'sample'],
      };

      const result = await projectService.createProject(projectData);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Test Project');
        expect(result.data.description).toBe('A test project');
        expect(result.data.user_id).toBe('test-user-id');
      }
    });

    it('should validate project name requirements', async () => {
      const invalidProjectData: CreateProjectData = {
        name: '', // Empty name should fail
        description: 'Test',
      };

      const result = await projectService.createProject(invalidProjectData);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('cannot be empty');
      }
    });

    it('should apply default settings when not provided', async () => {
      const projectData: CreateProjectData = {
        name: 'Minimal Project',
      };

      const result = await projectService.createProject(projectData);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.data.settings.units).toBe('px');
        expect(result.data.data.settings.autoSave).toBe(true);
      }
    });
  });

  describe('getProject', () => {
    it('should retrieve project with basic data', async () => {
      const result = await projectService.getProject('mock-project-id');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('mock-project-id');
        expect(result.data.name).toBe('Mock Project');
      }
    });

    it('should handle non-existent projects', async () => {
      // Mock getById to return null
      vi.spyOn(projectService as any, 'getById').mockResolvedValueOnce(Result.ok(null));

      const result = await projectService.getProject('non-existent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('not found');
      }
    });
  });

  describe('updateProject', () => {
    it('should update project with valid data', async () => {
      const updateData = {
        name: 'Updated Project Name',
        description: 'Updated description',
        isPublic: true,
      };

      const result = await projectService.updateProject('mock-project-id', updateData, 1);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Updated Project Name');
        expect(result.data.is_public).toBe(true);
      }
    });

    it('should handle optimistic concurrency conflicts', async () => {
      // Mock update to return optimistic lock error
      vi.spyOn(projectService as any, 'update').mockResolvedValueOnce(
        Result.err(new Error('Optimistic lock error'))
      );

      const result = await projectService.updateProject('mock-project-id', { name: 'New Name' }, 1);

      expect(result.success).toBe(false);
    });
  });

  describe('listProjects', () => {
    it('should return paginated project list', async () => {
      const result = await projectService.listProjects(1, 10);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.pageSize).toBe(10);
        expect(Array.isArray(result.data.data)).toBe(true);
      }
    });

    it('should apply search filters', async () => {
      const options = {
        search: 'test',
        tags: ['sample'],
        sortBy: 'created_at' as const,
        sortOrder: 'desc' as const,
      };

      const result = await projectService.listProjects(1, 10, options);

      expect(result.success).toBe(true);
    });
  });

  describe('duplicateProject', () => {
    it('should create a copy of existing project', async () => {
      const result = await projectService.duplicateProject(
        'mock-project-id',
        'Copy of Test Project'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Copy of Test Project');
        expect(result.data.description).toContain('Copy of');
      }
    });
  });
});

describe('ProjectImagesService', () => {
  const mockImageFile = new File(['mock image data'], 'test.jpg', {
    type: 'image/jpeg',
  });

  beforeEach(() => {
    // Mock canvas operations for image processing
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value: () => ({
        drawImage: vi.fn(),
        toBlob: vi.fn(callback => callback(new Blob(['mock'], { type: 'image/jpeg' }))),
      }),
    });

    // Mock Image constructor
    global.Image = class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 800;
      naturalHeight = 600;

      set src(value: string) {
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 0);
      }
    } as any;
  });

  describe('uploadImage', () => {
    it('should upload image with valid data', async () => {
      const result = await projectImagesService.uploadImage(
        'mock-project-id',
        'test-image',
        mockImageFile
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.label).toBe('test-image');
        expect(result.data.filename).toBe('test.jpg');
      }
    });

    it('should validate image file format', async () => {
      const invalidFile = new File(['not an image'], 'test.txt', {
        type: 'text/plain',
      });

      const result = await projectImagesService.uploadImage(
        'mock-project-id',
        'invalid-image',
        invalidFile
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('not allowed');
      }
    });

    it('should handle duplicate labels', async () => {
      // Mock checkLabelExists to return true
      vi.spyOn(projectImagesService as any, 'checkLabelExists').mockResolvedValueOnce(
        Result.ok(true)
      );

      const result = await projectImagesService.uploadImage(
        'mock-project-id',
        'existing-label',
        mockImageFile
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('already exists');
      }
    });
  });

  describe('uploadMultipleImages', () => {
    it('should handle batch upload with progress tracking', async () => {
      const files = [
        { label: 'image1', file: mockImageFile },
        { label: 'image2', file: mockImageFile },
      ];

      const progressCalls: number[] = [];
      const onProgress = (completed: number, total: number) => {
        progressCalls.push(completed);
      };

      const result = await projectImagesService.uploadMultipleImages(
        'mock-project-id',
        files,
        {},
        onProgress
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.successful.length).toBe(2);
        expect(result.data.failed.length).toBe(0);
      }
      expect(progressCalls.length).toBeGreaterThan(0);
    });

    it('should handle partial failures in batch upload', async () => {
      const files = [
        { label: 'valid-image', file: mockImageFile },
        { label: 'invalid-image', file: new File([''], 'test.txt', { type: 'text/plain' }) },
      ];

      const result = await projectImagesService.uploadMultipleImages('mock-project-id', files);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.successful.length).toBe(1);
        expect(result.data.failed.length).toBe(1);
        expect(result.data.failed[0].label).toBe('invalid-image');
      }
    });
  });

  describe('replaceImage', () => {
    it('should replace existing image', async () => {
      const result = await projectImagesService.replaceImage(
        'mock-project-id',
        'mock-image-id',
        mockImageFile
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.filename).toBe('test.jpg');
      }
    });
  });

  describe('deleteImage', () => {
    it('should delete image and update project metadata', async () => {
      const result = await projectImagesService.deleteImage('mock-image-id');

      expect(result.success).toBe(true);
    });
  });
});

describe('MeasurementsService', () => {
  const mockMeasurement: CreateMeasurementData = {
    imageLabel: 'test-image',
    type: 'line',
    label: 'Test Measurement',
    value: 100,
    unit: 'mm',
    coordinates: {
      start: { x: 10, y: 20 },
      end: { x: 110, y: 120 },
    },
    style: {
      color: '#ff0000',
      strokeWidth: 2,
      fontSize: 14,
      labelPosition: 'above',
    },
  };

  describe('createMeasurement', () => {
    it('should create measurement with valid data', async () => {
      const result = await measurementsService.createMeasurement(
        'mock-project-id',
        mockMeasurement
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.label).toBe('Test Measurement');
        expect(result.data.type).toBe('line');
        expect(result.data.value).toBe(100);
        expect(result.data.unit).toBe('mm');
      }
    });

    it('should validate measurement data', async () => {
      const invalidMeasurement: CreateMeasurementData = {
        ...mockMeasurement,
        label: '', // Empty label should fail
      };

      const result = await measurementsService.createMeasurement(
        'mock-project-id',
        invalidMeasurement
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('cannot be empty');
      }
    });

    it('should validate coordinate data', async () => {
      const invalidMeasurement: CreateMeasurementData = {
        ...mockMeasurement,
        coordinates: {
          start: { x: NaN, y: 20 }, // Invalid coordinate
          end: { x: 110, y: 120 },
        },
      };

      const result = await measurementsService.createMeasurement(
        'mock-project-id',
        invalidMeasurement
      );

      expect(result.success).toBe(false);
    });
  });

  describe('updateMeasurement', () => {
    it('should update measurement with valid data', async () => {
      const updateData = {
        label: 'Updated Measurement',
        value: 150,
        unit: 'cm',
      };

      const result = await measurementsService.updateMeasurement(
        'mock-project-id',
        'mock-measurement-id',
        updateData
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.label).toBe('Updated Measurement');
        expect(result.data.value).toBe(150);
        expect(result.data.unit).toBe('cm');
      }
    });
  });

  describe('getMeasurements', () => {
    it('should retrieve measurements with filters', async () => {
      const options = {
        imageLabel: 'test-image',
        type: 'line' as const,
      };

      const result = await measurementsService.getMeasurements('mock-project-id', options);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(Array.isArray(result.data)).toBe(true);
      }
    });
  });

  describe('bulkUpdateMeasurements', () => {
    it('should handle multiple measurement updates', async () => {
      const updates = [
        {
          measurementId: 'measurement-1',
          data: { label: 'Updated 1' },
        },
        {
          measurementId: 'measurement-2',
          data: { label: 'Updated 2' },
        },
      ];

      const result = await measurementsService.bulkUpdateMeasurements('mock-project-id', updates);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.successful.length).toBeGreaterThanOrEqual(0);
        expect(result.data.failed.length).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('exportMeasurements', () => {
    it('should export measurements as JSON', async () => {
      const result = await measurementsService.exportMeasurements('mock-project-id', 'json');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.filename).toContain('.json');
        expect(result.data.mimeType).toBe('application/json');
      }
    });

    it('should export measurements as CSV', async () => {
      const result = await measurementsService.exportMeasurements('mock-project-id', 'csv');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.filename).toContain('.csv');
        expect(result.data.mimeType).toBe('text/csv');
        expect(typeof result.data.data).toBe('string');
      }
    });
  });
});

describe('ProjectExportService', () => {
  const mockExportOptions: ExportOptions = {
    includeImages: true,
    includeMeasurements: true,
    includeMetadata: true,
    imageFormat: 'original',
    measurementFormat: 'embedded',
  };

  beforeEach(() => {
    // Mock Blob constructor
    global.Blob = class MockBlob {
      size = 1000;
      type = '';

      constructor(parts: any[], options: any = {}) {
        this.type = options.type || '';
      }
    } as any;
  });

  describe('exportProject', () => {
    it('should export project as JSON', async () => {
      const result = await projectExportService.exportProject(
        'mock-project-id',
        'json',
        mockExportOptions
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.format).toBe('json');
        expect(result.data.filename).toContain('.json');
        expect(result.data.metadata.projectId).toBe('mock-project-id');
      }
    });

    it('should export project as ZIP', async () => {
      const result = await projectExportService.exportProject(
        'mock-project-id',
        'zip',
        mockExportOptions
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.format).toBe('zip');
        expect(result.data.filename).toContain('.zip');
      }
    });

    it('should export project as CSV', async () => {
      const result = await projectExportService.exportProject('mock-project-id', 'csv', {
        ...mockExportOptions,
        includeImages: false,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.format).toBe('csv');
        expect(result.data.filename).toContain('.csv');
      }
    });

    it('should handle unsupported export formats', async () => {
      const result = await projectExportService.exportProject(
        'mock-project-id',
        'xml' as any,
        mockExportOptions
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Unsupported export format');
      }
    });
  });

  describe('importProject', () => {
    it('should validate import file format', async () => {
      const invalidFile = new File(['test'], 'test.txt', { type: 'text/plain' });

      const result = await projectExportService.importProject(invalidFile, {
        overwriteExisting: false,
        preserveIds: false,
        skipInvalid: true,
        createBackup: false,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Unsupported file format');
      }
    });

    it('should handle JSON import', async () => {
      const exportData = {
        version: '2.0.0',
        project: {
          name: 'Imported Project',
          description: 'Test import',
          data: {
            version: '2.0.0',
            images: {},
            measurements: {},
            settings: {},
            metadata: {},
          },
        },
        measurements: [],
      };

      const jsonFile = new File([JSON.stringify(exportData)], 'export.json', {
        type: 'application/json',
      });

      // Mock file reading
      const mockFileReader = {
        onload: null as any,
        onerror: null as any,
        readAsText: vi.fn().mockImplementation(function (this: any) {
          setTimeout(() => {
            this.result = JSON.stringify(exportData);
            this.onload();
          }, 0);
        }),
      };

      global.FileReader = vi.fn().mockImplementation(() => mockFileReader);

      const result = await projectExportService.importProject(jsonFile, {
        overwriteExisting: false,
        preserveIds: false,
        skipInvalid: true,
        createBackup: false,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.success).toBe(true);
        expect(result.data.projectId).toBeDefined();
      }
    });
  });

  describe('getExportHistory', () => {
    it('should retrieve export history for project', async () => {
      const result = await projectExportService.getExportHistory('mock-project-id');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(Array.isArray(result.data)).toBe(true);
      }
    });
  });
});

describe('Integration Tests', () => {
  it('should handle complete project workflow', async () => {
    // Create project
    const createResult = await projectService.createProject({
      name: 'Integration Test Project',
      description: 'Testing complete workflow',
    });

    expect(createResult.success).toBe(true);
    if (!createResult.success) return;

    const project = createResult.data;

    // Add image
    const imageFile = new File(['mock'], 'test.jpg', { type: 'image/jpeg' });
    const imageResult = await projectImagesService.uploadImage(project.id, 'test-image', imageFile);

    expect(imageResult.success).toBe(true);

    // Add measurement
    const measurementResult = await measurementsService.createMeasurement(project.id, {
      imageLabel: 'test-image',
      type: 'line',
      label: 'Test Line',
      value: 50,
      unit: 'mm',
      coordinates: {
        start: { x: 0, y: 0 },
        end: { x: 50, y: 0 },
      },
    });

    expect(measurementResult.success).toBe(true);

    // Export project
    const exportResult = await projectExportService.exportProject(project.id, 'json', {
      includeImages: true,
      includeMeasurements: true,
      includeMetadata: true,
    });

    expect(exportResult.success).toBe(true);

    // Get project statistics
    const statsResult = await projectService.getUserProjectStats();
    expect(statsResult.success).toBe(true);
  });

  it('should handle error cases gracefully', async () => {
    // Test with invalid project ID
    const result = await projectService.getProject('non-existent-id');
    expect(result.success).toBe(false);

    // Test measurement creation without valid project
    const measurementResult = await measurementsService.createMeasurement('non-existent-project', {
      imageLabel: 'test',
      type: 'line',
      label: 'Test',
      value: 1,
      unit: 'px',
      coordinates: {
        start: { x: 0, y: 0 },
        end: { x: 1, y: 0 },
      },
    });
    expect(measurementResult.success).toBe(false);
  });
});

describe('Permission Tests', () => {
  it('should enforce project ownership for modifications', async () => {
    // Mock different user
    vi.spyOn(authService, 'getCurrentUser').mockReturnValue({
      ...mockUser,
      id: 'different-user-id',
    });

    const result = await projectService.updateProject('mock-project-id', {
      name: 'Unauthorized Update',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('Not authorized');
    }

    // Restore original mock
    vi.spyOn(authService, 'getCurrentUser').mockReturnValue(mockUser);
  });

  it('should allow public project access', async () => {
    // Mock public project
    vi.spyOn(projectService as any, 'getById').mockResolvedValueOnce(
      Result.ok({
        id: 'public-project-id',
        user_id: 'other-user-id',
        is_public: true,
        name: 'Public Project',
        data: { metadata: {}, images: {}, measurements: {} },
      })
    );

    const result = await measurementsService.getMeasurements('public-project-id');
    expect(result.success).toBe(true);
  });
});

describe('Performance Tests', () => {
  it('should handle large measurement datasets efficiently', async () => {
    const startTime = Date.now();

    // Simulate bulk measurement operations
    const measurements = Array.from({ length: 100 }, (_, i) => ({
      measurementId: `measurement-${i}`,
      data: { label: `Updated ${i}` },
    }));

    const result = await measurementsService.bulkUpdateMeasurements(
      'mock-project-id',
      measurements
    );

    const endTime = Date.now();
    const duration = endTime - startTime;

    expect(result.success).toBe(true);
    expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
  });

  it('should handle multiple concurrent uploads', async () => {
    const uploadPromises = Array.from({ length: 5 }, (_, i) => {
      const file = new File(['mock'], `test-${i}.jpg`, { type: 'image/jpeg' });
      return projectImagesService.uploadImage('mock-project-id', `image-${i}`, file);
    });

    const results = await Promise.all(uploadPromises);
    results.forEach(result => {
      expect(result.success).toBe(true);
    });
  });
});
