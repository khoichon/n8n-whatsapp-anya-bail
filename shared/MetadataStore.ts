import * as fs from 'fs';
import { METADATA_FILE, BASE_DIR } from './Constants';
import type { SessionMetadata } from './Types';
import { rootLogger } from './Logger';

type MetadataMap = Record<string, SessionMetadata>;

function ensureBase(): void {
  if (!fs.existsSync(BASE_DIR)) {
    fs.mkdirSync(BASE_DIR, { recursive: true });
  }
}

export class MetadataStore {
  private static instance: MetadataStore;
  private data: MetadataMap = {};

  private constructor() {
    ensureBase();
    this.load();
  }

  static getInstance(): MetadataStore {
    if (!MetadataStore.instance) {
      MetadataStore.instance = new MetadataStore();
    }
    return MetadataStore.instance;
  }

  private load(): void {
    if (fs.existsSync(METADATA_FILE)) {
      try {
        const raw = fs.readFileSync(METADATA_FILE, 'utf8');
        this.data = JSON.parse(raw) as MetadataMap;
      } catch (err) {
        rootLogger.error('MetadataStore: failed to parse metadata.json', err);
        this.data = {};
      }
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(METADATA_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      rootLogger.error('MetadataStore: failed to save metadata.json', err);
    }
  }

  get(sessionId: string): SessionMetadata | undefined {
    return this.data[sessionId];
  }

  set(sessionId: string, meta: SessionMetadata): void {
    this.data[sessionId] = meta;
    this.save();
  }

  update(sessionId: string, partial: Partial<SessionMetadata>): void {
    if (!this.data[sessionId]) {
      this.data[sessionId] = {
        sessionId,
        connected: false,
        createdAt: new Date().toISOString(),
        reconnectAttempts: 0,
      };
    }
    Object.assign(this.data[sessionId], partial);
    this.save();
  }

  delete(sessionId: string): void {
    delete this.data[sessionId];
    this.save();
  }

  listIds(): string[] {
    return Object.keys(this.data);
  }

  getAll(): SessionMetadata[] {
    return Object.values(this.data);
  }
}
