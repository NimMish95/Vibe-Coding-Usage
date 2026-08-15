import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { DbManager } from './db';
import { BackupManager } from './backup';
import { PricingFetcher } from './pricing-fetcher';
import { ClaudeCodeParser } from './parsers/claude-code';
import { AntigravityParser } from './parsers/antigravity';
import { AppConfig, SourceConfig } from './types';

const app = express();
const port = process.env.PORT || 3000;
let lastSyncTime = Date.now();

const configPath = path.resolve(process.cwd(), 'config.json');
let isConfigured = false;
let config: AppConfig;

let db: DbManager | null = null;
let backup: BackupManager | null = null;
const pricing = new PricingFetcher(path.resolve(process.cwd(), 'pricing.json'));

const parsers = {
  'claude-code': new ClaudeCodeParser(),
  'antigravity': new AntigravityParser()
};

function generateDefaultConfig(): AppConfig {
  const homedir = os.homedir().replace(/\\/g, '/');
  const sources: SourceConfig[] = [];

  // Only the paths these tools create themselves. Additional profiles (e.g. a
  // self-made ~/.claude-work) are meant to be added by the user in Settings.
  const candidates: { platform: 'claude-code' | 'antigravity'; profile: string; path: string }[] = [
    { platform: 'claude-code', profile: 'default', path: `${homedir}/.claude` },
    { platform: 'antigravity', profile: 'default', path: `${homedir}/.gemini/antigravity` },
    { platform: 'antigravity', profile: 'default', path: `${homedir}/.gemini` }
  ];

  for (const c of candidates) {
    if (fs.existsSync(c.path)) {
      // Avoid duplicate antigravity paths
      if (!sources.some(s => s.platform === c.platform && s.path === c.path)) {
        sources.push(c);
      }
    }
  }

  // Fallback defaults if none exist
  if (sources.length === 0) {
    sources.push(
      { platform: 'claude-code', profile: 'default', path: `${homedir}/.claude` },
      { platform: 'antigravity', profile: 'default', path: `${homedir}/.gemini/antigravity` }
    );
  }

  let backupPath = `${homedir}/backups/vibe-coding-usage`;
  if (process.platform === 'win32') {
    if (fs.existsSync('D:/') || fs.existsSync('D:\\')) {
      backupPath = 'D:/Backups/vibe-coding-usage';
    }
  }

  return {
    sources,
    backupPath,
    database: 'usage.db'
  };
}

// Check initial config
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    isConfigured = true;
  } catch (e) {
    console.error('Failed to parse existing config.json, generating default fallback.');
    config = generateDefaultConfig();
  }
} else {
  console.log('[Config] No config.json found. Generating default candidate config based on environment.');
  config = generateDefaultConfig();
}

function initManagers(cfg: AppConfig) {
  db = new DbManager(path.resolve(process.cwd(), cfg.database));
  backup = new BackupManager(cfg.backupPath);
}

app.use(express.json());
app.use(express.static(path.resolve(process.cwd(), 'public')));

// API Routes
app.get('/api/usage', (req, res) => {
  try {
    if (!db) {
      return res.json([]);
    }
    const filters = {
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      platform: req.query.platform ? (req.query.platform as string).split(',') : null,
      profile: req.query.profile ? (req.query.profile as string).split(',') : null,
      type: req.query.type ? (req.query.type as string).split(',') : null,
      model: req.query.model ? (req.query.model as string).split(',') : null,
      project: req.query.project ? (req.query.project as string).split(',') : null,
      session: req.query.session ? (req.query.session as string).split(',') : null
    };

    const usage = db.getUsage(filters);
    res.json(usage);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/reset', async (req, res) => {
  try {
    if (!db) return res.status(400).json({ error: 'System not yet configured.' });
    db.reset();
    const recordCount = await syncLogs();
    lastSyncTime = Date.now();
    res.json({ success: true, recordsAdded: recordCount, lastSyncTime });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/filters', (req, res) => {
  try {
    if (!db) {
      return res.json({ platform: [], profile: [], type: [], model: [], project: [], session: [] });
    }
    res.json({
      platform: db.getUniqueValues('platform'),
      profile: db.getUniqueValues('profile'),
      type: db.getUniqueValues('type'),
      model: db.getUniqueValues('model'),
      project: db.getUniqueValues('project'),
      session: db.getUniqueValues('session')
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/pricing', (req, res) => {
  res.json(pricing.getPricing());
});

app.post('/api/pricing', (req, res) => {
  try {
    pricing.updatePricing(req.body);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/pricing/fetch', async (req, res) => {
  try {
    if (!db) return res.json({ updated: 0, failed: [] });
    const missingModels = pricing.getMissingModels(db.getUniqueValues('model'));
    const result = await pricing.fetchLatestPricing(missingModels);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/config', (req, res) => {
  try {
    res.json({
      config,
      isFirstRun: !isConfigured
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/config', async (req, res) => {
  try {
    const newConfig: AppConfig = req.body;
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2));
    config = newConfig;
    isConfigured = true;

    initManagers(config);
    console.log('[Config] Config saved. Performing system initialization and log synchronization...');
    const recordsAdded = await initializeSystem();

    res.json({ success: true, recordsAdded, lastSyncTime });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/stats', (req, res) => {
  res.json({ lastSyncTime, isFirstRun: !isConfigured });
});

app.post('/api/sync', async (req, res) => {
  try {
    if (!db) return res.status(400).json({ error: 'System not yet configured.' });
    const recordCount = await syncLogs();
    lastSyncTime = Date.now();
    res.json({ success: true, recordsAdded: recordCount, lastSyncTime });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

async function syncLogs() {
  if (!db || !config) return 0;
  let totalRecords = 0;
  for (const source of config.sources) {
    const parser = parsers[source.platform];
    if (parser && fs.existsSync(source.path)) {
      const records = await parser.parse(
        source.path,
        source.profile,
        (fp) => db!.getScanState(fp),
        (fp, offset, lm) => db!.updateScanState(fp, offset, lm),
        (msgId) => db!.isMessageProcessed(msgId),
        (msgId) => db!.markMessageProcessed(msgId)
      );
      if (records.length > 0) {
        db.insertUsageRecords(records);
        totalRecords += records.length;
      }
    }
  }
  return totalRecords;
}

async function initializeSystem(): Promise<number> {
  if (!config || !db || !backup) return 0;

  // 1. Auto Backup
  console.log('[Backup] Starting automatic backup...');
  let backedUpFiles = 0;
  for (const source of config.sources) {
    if (fs.existsSync(source.path)) {
      backedUpFiles += backup.backupDirectory(source.path, source.path);
    }
  }
  console.log(`[Backup] Completed. Files copied: ${backedUpFiles}`);

  // 2. Parse Logs
  console.log('[Sync] Scanning for new log entries...');
  const synced = await syncLogs();
  console.log(`[Sync] Synced ${synced} new usage records.`);

  // 3. Check for unknown models & fetch pricing
  const modelsInDb = db.getUniqueValues('model');
  const missingModels = pricing.getMissingModels(modelsInDb);
  if (missingModels.length > 0) {
    console.log(`[Pricing] Found ${missingModels.length} unknown models. Attempting to fetch pricing...`);
    await pricing.fetchLatestPricing(missingModels);
  }

  lastSyncTime = Date.now();
  return synced;
}

// Startup Sequence
async function startup() {
  console.log('[Init] Starting Vibe Coding Usage Server...');

  if (isConfigured) {
    initManagers(config);
    await initializeSystem();
  } else {
    console.log('[Init] First run detected. Server ready for configuration at http://localhost:' + port);
  }

  app.listen(port, () => {
    console.log(`[Init] Server startup complete.`);
    console.log(`Server listening on port ${port}`);
    console.log(`You can open it on http://localhost:${port}`);
  });
}

startup();

