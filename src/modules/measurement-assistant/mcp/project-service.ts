import { measurementPlacementSchema, type MeasurementPlacement } from '../placement-model';

export interface ProjectImage {
  id: string;
  view: 'front' | 'back' | 'side' | 'top' | 'underside' | 'detail';
  width: number;
  height: number;
  mimeType: string;
  storageKey: string;
}
export interface MeasurementDraft {
  id: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  revision: number;
  images: ProjectImage[];
  placement: MeasurementPlacement | null;
  reliabilityVersion?: number;
  landmarkPlan?: MeasurementPlacement;
}
export interface DraftStorage {
  read(id: string): Promise<{ draft: MeasurementDraft; version: string } | null>;
  write(draft: MeasurementDraft, version?: string): Promise<boolean>;
}
export async function hashCapability(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function newCapability(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}
export class DraftService {
  constructor(private readonly storage: DraftStorage) {}
  async create(): Promise<{ draft: MeasurementDraft; token: string }> {
    const token = newCapability();
    const now = Date.now();
    const draft: MeasurementDraft = {
      id: crypto.randomUUID(),
      tokenHash: await hashCapability(token),
      createdAt: now,
      expiresAt: now + 86400000,
      revision: 0,
      images: [],
      placement: null,
      reliabilityVersion: 2,
    };
    if (!(await this.storage.write(draft))) throw new Error('Draft creation failed.');
    return { draft, token };
  }
  async read(id: string, token: string) {
    const record = await this.storage.read(id);
    if (
      !record ||
      record.draft.expiresAt <= Date.now() ||
      record.draft.tokenHash !== (await hashCapability(token))
    )
      throw new Error('Draft unavailable or access expired.');
    return record;
  }
  async addImage(id: string, token: string, image: ProjectImage, expectedRevision: number) {
    const record = await this.read(id, token);
    if (record.draft.revision !== expectedRevision)
      throw new Error('Draft changed. Read the project and retry with its current revision.');
    if (record.draft.images.length >= 10 || record.draft.images.some(item => item.id === image.id))
      throw new Error('Image limit reached or image ID already exists.');
    record.draft.images.push(image);
    record.draft.placement?.images.push({ id: image.id, view: image.view });
    record.draft.revision++;
    if (!(await this.storage.write(record.draft, record.version)))
      throw new Error('Draft changed. Read the project before retrying.');
    return record.draft;
  }
  async place(id: string, token: string, input: unknown, expectedRevision: number) {
    const placement = measurementPlacementSchema.parse(input);
    const record = await this.read(id, token);
    if (record.draft.revision !== expectedRevision)
      throw new Error('Draft changed. Read the project and retry with its current revision.');
    if (
      placement.images.length !== record.draft.images.length ||
      placement.images.some(
        image =>
          !record.draft.images.some(stored => stored.id === image.id && stored.view === image.view)
      )
    )
      throw new Error('Placement must reference the project images and their recorded views.');
    record.draft.placement = placement;
    record.draft.revision++;
    if (!(await this.storage.write(record.draft, record.version)))
      throw new Error('Draft changed. Read the project before retrying.');
    return record.draft;
  }
  async prepare(id: string, token: string, input: unknown, expectedRevision: number) {
    const plan = measurementPlacementSchema.parse(input);
    const record = await this.read(id, token);
    if (record.draft.revision !== expectedRevision)
      throw new Error('Draft changed. Read the project before preparing landmarks.');
    if (
      plan.measurements.length ||
      plan.images.length !== record.draft.images.length ||
      plan.images.some(
        image =>
          !record.draft.images.some(stored => stored.id === image.id && stored.view === image.view)
      )
    )
      throw new Error(
        'Prepare all project images with their recorded views and no measurements yet.'
      );
    record.draft.landmarkPlan = plan;
    record.draft.revision++;
    if (!(await this.storage.write(record.draft, record.version)))
      throw new Error('Draft changed. Read the project before retrying.');
    return record.draft;
  }
}
