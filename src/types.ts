export interface UsageRecord {
  date: string;           // YYYY-MM-DD
  hour: number;           // 0-23
  platform: string;
  profile: string;
  type: 'input' | 'output' | 'cache_write' | 'cache_read';
  model: string;
  project: string;
  session: string;
  tokens: number;
  isEstimated: boolean;
}

export interface SourceConfig {
  platform: 'claude-code' | 'antigravity';
  profile: string;
  path: string;
}

export interface AppConfig {
  sources: SourceConfig[];
  backupPath: string;
  database: string;
}

export interface PricingEntry {
  input: number;          // USD per million tokens
  output: number;
  cache_write: number;
  cache_read: number;
}

export type PricingConfig = Record<string, PricingEntry>;

