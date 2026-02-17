// Supabase database types
// This file contains comprehensive types for all database tables and operations

export interface Database {
  public: {
    Tables: {
      projects: {
        Row: {
          id: string;
          created_by: string;
          project_name: string;
          customer_name?: string;
          sofa_model?: string;
          data: ProjectData;
          tags: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          created_by: string;
          project_name: string;
          customer_name?: string;
          sofa_model?: string;
          data: ProjectData;
          tags?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          created_by?: string;
          project_name?: string;
          customer_name?: string;
          sofa_model?: string;
          data?: ProjectData;
          tags?: string[];
          created_at?: string;
          updated_at?: string;
        };
      };

      project_images: {
        Row: {
          id: string;
          project_id: string;
          label: string;
          filename: string;
          storage_path: string;
          mime_type: string;
          size_bytes: number;
          width: number;
          height: number;
          uploaded_at: string;
          metadata?: Record<string, unknown>;
        };
        Insert: {
          id?: string;
          project_id: string;
          label: string;
          filename: string;
          storage_path: string;
          mime_type: string;
          size_bytes: number;
          width: number;
          height: number;
          uploaded_at?: string;
          metadata?: Record<string, unknown>;
        };
        Update: {
          id?: string;
          project_id?: string;
          label?: string;
          filename?: string;
          storage_path?: string;
          mime_type?: string;
          size_bytes?: number;
          width?: number;
          height?: number;
          uploaded_at?: string;
          metadata?: Record<string, unknown>;
        };
      };

      user_profiles: {
        Row: {
          id: string;
          email: string;
          display_name?: string;
          avatar_url?: string;
          preferences: UserPreferences;
          created_at: string;
          updated_at: string;
          last_login_at?: string;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string;
          avatar_url?: string;
          preferences?: UserPreferences;
          created_at?: string;
          updated_at?: string;
          last_login_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          display_name?: string;
          avatar_url?: string;
          preferences?: UserPreferences;
          created_at?: string;
          updated_at?: string;
          last_login_at?: string;
        };
      };
    };

    Views: {
      public_projects: {
        Row: {
          id: string;
          name: string;
          description?: string;
          thumbnail_url?: string;
          tags: string[];
          created_at: string;
          updated_at: string;
          user_display_name?: string;
        };
      };
    };

    Functions: {
      get_project_with_images: {
        Args: { project_id: string };
        Returns: {
          project: Database['public']['Tables']['projects']['Row'];
          images: Database['public']['Tables']['project_images']['Row'][];
        };
      };
    };

    Enums: {
      project_status: 'draft' | 'published' | 'archived';
    };
  };
}

// Project data structure types
export interface ProjectData {
  version: string;
  images: Record<string, ImageData>;
  measurements: Record<string, MeasurementData>;
  settings: ProjectSettings;
  metadata: ProjectMetadata;
}

export interface ImageData {
  label: string;
  filename: string;
  storageUrl?: string;
  localUrl?: string;
  width: number;
  height: number;
  objects: FabricObjectData[];
  measurements: string[]; // Array of measurement IDs
  tags: string[];
  metadata: ImageMetadata;
}

export interface MeasurementData {
  id: string;
  imageLabel: string;
  type: 'line' | 'area' | 'angle';
  label: string;
  value: number;
  unit: string;
  coordinates: {
    start: { x: number; y: number };
    end: { x: number; y: number };
    control?: { x: number; y: number }; // For curves/angles
  };
  style: {
    color: string;
    strokeWidth: number;
    fontSize: number;
    labelPosition: 'above' | 'below' | 'inline';
  };
  createdAt: string;
  updatedAt: string;
}

export interface FabricObjectData {
  type: string;
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  angle: number;
  visible: boolean;
  selectable: boolean;
  // Type-specific properties
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  points?: number[];
  path?: string;
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  // Custom properties
  isDrawnObject?: boolean;
  measurementId?: string;
  metadata?: Record<string, unknown>;
}

export interface ProjectSettings {
  units: 'px' | 'mm' | 'cm' | 'in';
  defaultStrokeWidth: number;
  defaultColor: string;
  backgroundColor?: string;
  autoSave: boolean;
  showGrid: boolean;
  snapToGrid: boolean;
  gridSize: number;
}

export interface ProjectMetadata {
  createdBy: string;
  createdAt: string;
  lastModifiedBy: string;
  lastModifiedAt: string;
  totalImages: number;
  totalMeasurements: number;
  projectSize: number; // in bytes
  exportHistory: ExportRecord[];
}

export interface ExportRecord {
  timestamp: string;
  format: string;
  includeImages: boolean;
  includeMeasurements: boolean;
  filename: string;
}

export interface ImageMetadata {
  uploadedAt: string;
  originalSize: number;
  processedSize?: number;
  exifData?: Record<string, unknown>;
  thumbnailGenerated: boolean;
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'auto';
  defaultUnits: 'px' | 'mm' | 'cm' | 'in';
  autoSave: boolean;
  showTooltips: boolean;
  maxRecentProjects: number;
  storageQuotaWarning: boolean;
}

// Database operation types
export type DatabaseTable = keyof Database['public']['Tables'];
export type DatabaseView = keyof Database['public']['Views'];
export type DatabaseFunction = keyof Database['public']['Functions'];

// Helper types for common operations
export type ProjectRow = Database['public']['Tables']['projects']['Row'];
export type ProjectInsert = Database['public']['Tables']['projects']['Insert'];
export type ProjectUpdate = Database['public']['Tables']['projects']['Update'];

export type ProjectImageRow = Database['public']['Tables']['project_images']['Row'];
export type ProjectImageInsert = Database['public']['Tables']['project_images']['Insert'];
export type ProjectImageUpdate = Database['public']['Tables']['project_images']['Update'];

export type UserProfileRow = Database['public']['Tables']['user_profiles']['Row'];
export type UserProfileInsert = Database['public']['Tables']['user_profiles']['Insert'];
export type UserProfileUpdate = Database['public']['Tables']['user_profiles']['Update'];

// Storage bucket types
export interface StorageBucket {
  id: string;
  name: string;
  public: boolean;
  created_at: string;
  updated_at: string;
}

export interface StorageObject {
  id: string;
  bucket_id: string;
  name: string;
  owner: string;
  created_at: string;
  updated_at: string;
  last_accessed_at: string;
  metadata: Record<string, unknown>;
}

// Real-time subscription types
export interface RealtimePayload<T = any> {
  schema: string;
  table: string;
  commit_timestamp: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: T;
  old: T;
  errors?: string[];
}

// API response types for common patterns
export interface PaginatedResponse<T> {
  data: T[];
  count: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  image_count: number;
  measurement_count: number;
}
