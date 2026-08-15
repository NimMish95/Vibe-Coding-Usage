import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { UsageRecord } from './types';

export class DbManager {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL,
          hour INTEGER NOT NULL,
          platform TEXT NOT NULL,
          profile TEXT NOT NULL,
          type TEXT NOT NULL,
          model TEXT NOT NULL,
          project TEXT NOT NULL,
          session TEXT NOT NULL,
          tokens INTEGER NOT NULL,
          is_estimated INTEGER DEFAULT 0,
          UNIQUE(date, hour, platform, profile, type, model, project, session)
      );

      CREATE TABLE IF NOT EXISTS scan_state (
          file_path TEXT PRIMARY KEY,
          last_offset INTEGER NOT NULL,
          last_modified TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS processed_messages (
          message_id TEXT PRIMARY KEY
      );

      CREATE INDEX IF NOT EXISTS idx_usage_date ON usage(date);
      CREATE INDEX IF NOT EXISTS idx_usage_platform ON usage(platform);
      CREATE INDEX IF NOT EXISTS idx_usage_model ON usage(model);
      CREATE INDEX IF NOT EXISTS idx_usage_project ON usage(project);
    `);
  }

  public reset() {
    this.db.exec(`
      DROP TABLE IF EXISTS usage;
      DROP TABLE IF EXISTS scan_state;
      DROP TABLE IF EXISTS processed_messages;
    `);
    this.initSchema();
  }

  public isMessageProcessed(messageId: string): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM processed_messages WHERE message_id = ?');
    return !!stmt.get(messageId);
  }

  public markMessageProcessed(messageId: string) {
    const stmt = this.db.prepare('INSERT OR IGNORE INTO processed_messages (message_id) VALUES (?)');
    stmt.run(messageId);
  }

  public getScanState(filePath: string): { last_offset: number, last_modified: string } | null {
    const stmt = this.db.prepare('SELECT last_offset, last_modified FROM scan_state WHERE file_path = ?');
    return stmt.get(filePath) as any;
  }

  public updateScanState(filePath: string, offset: number, lastModified: string) {
    const stmt = this.db.prepare(`
      INSERT INTO scan_state (file_path, last_offset, last_modified)
      VALUES (?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        last_offset = excluded.last_offset,
        last_modified = excluded.last_modified
    `);
    stmt.run(filePath, offset, lastModified);
  }

  public insertUsageRecords(records: UsageRecord[]) {
    if (records.length === 0) return;

    const insert = this.db.prepare(`
      INSERT INTO usage (date, hour, platform, profile, type, model, project, session, tokens, is_estimated)
      VALUES (@date, @hour, @platform, @profile, @type, @model, @project, @session, @tokens, @isEstimated)
      ON CONFLICT(date, hour, platform, profile, type, model, project, session) DO UPDATE SET
        tokens = usage.tokens + excluded.tokens
    `);

    const insertMany = this.db.transaction((items: UsageRecord[]) => {
      for (const item of items) {
        insert.run({
          ...item,
          isEstimated: item.isEstimated ? 1 : 0
        });
      }
    });

    insertMany(records);
  }

  public getUsage(filters: any) {
    let query = 'SELECT * FROM usage WHERE 1=1';
    const params: any = {};

    if (filters.dateFrom) {
      if (filters.dateFrom.includes('T')) {
        const [d, t] = filters.dateFrom.split('T');
        const h = parseInt(t.split(':')[0]);
        query += ' AND (date > @dateFromDate OR (date = @dateFromDate AND hour >= @dateFromHour))';
        params.dateFromDate = d;
        params.dateFromHour = h;
      } else {
        query += ' AND date >= @dateFrom';
        params.dateFrom = filters.dateFrom;
      }
    }
    if (filters.dateTo) {
      if (filters.dateTo.includes('T')) {
        const [d, t] = filters.dateTo.split('T');
        const h = parseInt(t.split(':')[0]);
        query += ' AND (date < @dateToDate OR (date = @dateToDate AND hour <= @dateToHour))';
        params.dateToDate = d;
        params.dateToHour = h;
      } else {
        query += ' AND date <= @dateTo';
        params.dateTo = filters.dateTo;
      }
    }
    
    const arrayFilters = ['platform', 'profile', 'type', 'model', 'project', 'session'];
    for (const f of arrayFilters) {
      if (filters[f] && filters[f].length > 0) {
        const placeholders = filters[f].map((_: any, i: number) => `@${f}_${i}`).join(',');
        query += ` AND ${f} IN (${placeholders})`;
        filters[f].forEach((val: any, i: number) => {
          params[`${f}_${i}`] = val;
        });
      }
    }

    const stmt = this.db.prepare(query);
    return stmt.all(params);
  }

  public getUniqueValues(column: string) {
    const validColumns = ['platform', 'profile', 'type', 'model', 'project', 'session'];
    if (!validColumns.includes(column)) throw new Error('Invalid column');
    
    const stmt = this.db.prepare(`SELECT DISTINCT ${column} FROM usage WHERE ${column} IS NOT NULL AND ${column} != '' ORDER BY ${column}`);
    return stmt.all().map((r: any) => r[column]);
  }
}
