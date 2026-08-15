import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { PricingConfig } from './types';

export class PricingFetcher {
  private configPath: string;
  private pricing: PricingConfig = {};

  constructor(configPath: string) {
    this.configPath = configPath;
    this.load();
  }

  public load() {
    if (fs.existsSync(this.configPath)) {
      try {
        this.pricing = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      } catch (e) {
        console.error('Failed to load pricing config', e);
      }
    }
  }

  public save() {
    fs.writeFileSync(this.configPath, JSON.stringify(this.pricing, null, 2), 'utf8');
  }

  public getPricing(): PricingConfig {
    return this.pricing;
  }

  public updatePricing(newPricing: PricingConfig) {
    this.pricing = newPricing;
    this.save();
  }

  public getMissingModels(modelsInDb: string[]): string[] {
    return modelsInDb.filter(model => !this.pricing[model]);
  }

  // Simplified fetcher, a real implementation might need more robust scraping logic
  // since pricing pages change often.
  public async fetchLatestPricing(missingModels: string[] = []): Promise<{ updated: string[], failed: string[] }> {
    const updated: string[] = [];
    const failed: string[] = [];
    
    console.log('[Pricing] Fetching pricing from LiteLLM...');
    try {
      const res = await fetch('https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json');
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json() as any;
      
      const modelsToCheck = missingModels.length > 0 ? missingModels : Object.keys(this.pricing);
      
      for (const model of modelsToCheck) {
        let match = data[model];
        
        // Try fuzzy matching if exact match fails
        if (!match) {
          const possibleKeys = Object.keys(data).filter(k => 
            k.includes(model) || model.includes(k.replace(/^anthropic\./, ''))
          );
          
          if (possibleKeys.length > 0) {
            // Sort by length difference to find closest match
            possibleKeys.sort((a, b) => Math.abs(a.length - model.length) - Math.abs(b.length - model.length));
            match = data[possibleKeys[0]];
          }
        }
        
        if (match && typeof match.input_cost_per_token === 'number') {
          const inputCost = match.input_cost_per_token * 1_000_000;
          const outputCost = (match.output_cost_per_token || 0) * 1_000_000;
          const cacheWrite = (match.cache_creation_input_token_cost || match.input_cost_per_token || 0) * 1_000_000;
          const cacheRead = (match.cache_read_input_token_cost || 0) * 1_000_000;
          
          this.pricing[model] = {
            input: inputCost,
            output: outputCost,
            cache_write: cacheWrite,
            cache_read: cacheRead
          };
          updated.push(model);
        } else {
          // Add a fallback so it doesn't crash or evaluate to 0 if it's completely unknown but looks like Claude
          if (!this.pricing[model]) {
            console.log(`[Pricing] Could not find ${model}, using fallback.`);
            const fallbackInput = model.includes('opus') ? 15 : (model.includes('haiku') || model.includes('flash') ? 0.25 : 3);
            const fallbackOutput = model.includes('opus') ? 75 : (model.includes('haiku') || model.includes('flash') ? 1.25 : 15);
            this.pricing[model] = {
              input: fallbackInput,
              output: fallbackOutput,
              cache_write: fallbackInput * 1.25,
              cache_read: fallbackInput * 0.1
            };
            updated.push(model);
          } else {
            failed.push(model);
          }
        }
      }
      
      if (updated.length > 0) {
        this.save();
      }
    } catch (e) {
      console.error('[Pricing] Fetch failed:', e);
    }
    
    return { updated, failed };
  }
}
