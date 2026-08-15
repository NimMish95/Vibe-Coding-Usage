import fs from 'fs';
import path from 'path';
import { LogParser } from './base';
import { UsageRecord } from '../types';

export class AntigravityParser implements LogParser {
  platform: 'antigravity' = 'antigravity';

  public async parse(
    sourcePath: string, 
    profile: string,
    getScanState: (filePath: string) => { last_offset: number, last_modified: string } | null,
    updateScanState: (filePath: string, offset: number, lastModified: string) => void
  ): Promise<UsageRecord[]> {
    const records: UsageRecord[] = [];
    const brainDir = path.join(sourcePath, 'brain');
    
    if (!fs.existsSync(brainDir)) return records;

    const sessions = fs.readdirSync(brainDir, { withFileTypes: true });

    for (const session of sessions) {
      if (!session.isDirectory()) continue;
      
      const sessionId = session.name;
      const transcriptPath = path.join(brainDir, sessionId, '.system_generated', 'logs', 'transcript.jsonl');
      
      if (!fs.existsSync(transcriptPath)) continue;

      const stat = fs.statSync(transcriptPath);
      const lastModified = stat.mtime.toISOString();
      
      const scanState = getScanState(transcriptPath);
      let startOffset = 0;
      
      if (scanState) {
        if (scanState.last_modified === lastModified && scanState.last_offset === stat.size) {
          continue; // File hasn't changed
        }
        if (scanState.last_offset < stat.size) {
          startOffset = scanState.last_offset;
        }
      }

      // Parse file
      const fileContent = fs.readFileSync(transcriptPath, 'utf8');
      const contentToParse = startOffset === 0 ? fileContent : fileContent.substring(startOffset);
      const lines = contentToParse.split('\n').filter(line => line.trim() !== '');
      
      // Pre-scan for project name and model
      let projectName = "Unknown Project";
      // Fallback when the transcript contains no model-selection event
      let currentModel = 'gemini';

      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (data.type === 'USER_INPUT' && data.content) {
            if (data.content.includes('<user_information>')) {
              const m = data.content.match(/([a-zA-Z]:\\[^\r\n]+)\s+->/);
              if (m) {
                projectName = m[1].trim();
              }
            } else if (data.content.includes('<ADDITIONAL_METADATA>')) {
              const m = data.content.match(/is a \[File\]:\r?\n(.*?)\r?\n/);
              if (m && projectName === 'Unknown Project') {
                projectName = path.dirname(m[1].trim());
              }
            }
          }
        } catch(e) {}
      }

      if (/^[a-z]:[\\/]/i.test(projectName)) {
         projectName = projectName.charAt(0).toUpperCase() + projectName.slice(1);
      }

      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          
          if (data.type === 'USER_INPUT' && data.content && data.content.includes('<USER_SETTINGS_CHANGE>')) {
            const m = data.content.match(/The user changed setting `Model Selection` from .*? to (.*?)\./);
            if (m) {
              currentModel = m[1].trim().toLowerCase().replace(/\s*\(.*?\)\s*/g, '').replace(/[^a-z0-9]/g, '-');
            }
          }

          if (!data.created_at) continue;
          
          const dateObj = new Date(data.created_at);
          const date = dateObj.getFullYear() + '-' + String(dateObj.getMonth() + 1).padStart(2, '0') + '-' + String(dateObj.getDate()).padStart(2, '0');
          const hour = dateObj.getHours();
          const model = currentModel;
          
          let inputChars = 0;
          let outputChars = 0;

          if (data.source === 'USER_EXPLICIT' && data.content) {
            inputChars += data.content.length;
          } else if (data.source === 'MODEL') {
            if (data.content) outputChars += data.content.length;
            if (data.thinking) outputChars += data.thinking.length;
            if (data.tool_calls) {
               // The arguments given to tools
               outputChars += JSON.stringify(data.tool_calls).length;
            }
          } else if (data.source === 'SYSTEM' && data.type === 'TOOL_RESPONSE' && data.content) {
            // Tool output counts as input to the model for the next turn
            inputChars += data.content.length;
          }

          // Estimate tokens: 1 token ~= 4 chars for English/code
          const inputTokens = Math.ceil(inputChars / 4);
          const outputTokens = Math.ceil(outputChars / 4);

          // Helper to add record
          const addRecord = (type: UsageRecord['type'], tokens: number) => {
            if (tokens > 0) {
              records.push({
                date, hour, platform: this.platform + '/' + profile, profile, type,
                model, project: projectName, session: sessionId, tokens, isEstimated: true
              });
            }
          };

          addRecord('input', inputTokens);
          addRecord('output', outputTokens);
          
        } catch (e) {
          // Ignore malformed JSON lines
        }
      }
      
      // Update scan state
      updateScanState(transcriptPath, stat.size, lastModified);
    }

    return records;
  }
}
