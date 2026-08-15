const Database = require('better-sqlite3');
const db = new Database('usage.db');

console.log('--- DISTINCT PLATFORMS ---');
console.log(db.prepare('SELECT DISTINCT platform FROM usage').all());

console.log('--- DISTINCT MODELS ---');
console.log(db.prepare('SELECT DISTINCT model FROM usage').all());

console.log('--- TOTAL TOKENS AND COST BY MODEL ---');
const records = db.prepare('SELECT platform, model, type, SUM(tokens) as total_tokens FROM usage GROUP BY platform, model, type').all();
console.log(records);

const pricing = require('./pricing.json');
let totalCost = 0;
const costByPlatformModel = {};

for (const r of records) {
  const rates = pricing[r.model];
  const key = `${r.platform} | ${r.model}`;
  costByPlatformModel[key] = costByPlatformModel[key] || 0;
  if (rates) {
    const c = (r.total_tokens / 1000000) * (rates[r.type] || 0);
    costByPlatformModel[key] += c;
    totalCost += c;
  } else {
    console.log('MISSING PRICING FOR MODEL:', r.model);
  }
}

console.log('--- ESTIMATED COST BY PLATFORM/MODEL ---');
console.log(costByPlatformModel);
