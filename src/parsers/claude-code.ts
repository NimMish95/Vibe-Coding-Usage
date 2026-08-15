import fs from 'fs';
import path from 'path';
import { LogParser } from './base';
import { UsageRecord } from '../types';

export class ClaudeCodeParser implements LogParser {
  platform: 'claude-code' = 'claude-code';

  public async parse(
    sourcePath: string, 
    profile: string,
    getScanState: (filePath: string) => { last_offset: number, last_modified: string } | null,
    updateScanState: (filePath: string, offset: number, lastModified: string) => void,
    isMessageProcessed?: (msgId: string) => boolean,
    markMessageProcessed?: (msgId: string) => void
  ): Promise<UsageRecord[]> {
    const records: UsageRecord[] = [];
    const projectsDir = path.join(sourcePath, 'projects');
    
    if (!fs.existsSync(projectsDir)) return records;

    const projects = fs.readdirSync(projectsDir, { withFileTypes: true });

    for (const project of projects) {
      if (!project.isDirectory()) continue;
      
      const projectPath = path.join(projectsDir, project.name);
      // Decode project name (Claude Code encodes path with dashes)
      const defaultProjectName = project.name.replace(/--/g, '/').replace(/-/g, ' ').replace('C//', 'C:/').replace('c//', 'c:/');
      
      const getJsonlFiles = (dir: string): string[] => {
        let results: string[] = [];
        try {
          const list = fs.readdirSync(dir, { withFileTypes: true });
          for (const item of list) {
            const fullPath = path.join(dir, item.name);
            if (item.isDirectory()) {
              results = results.concat(getJsonlFiles(fullPath));
            } else if (item.isFile() && item.name.endsWith('.jsonl')) {
              results.push(fullPath);
            }
          }
        } catch (e) {}
        return results;
      };
      
      const sessionFiles = getJsonlFiles(projectPath);
      
      let projectName = defaultProjectName;

      // Scan all session files in this project to find a valid cwd
      for (const filePath of sessionFiles) {
        try {
          const fileContent = fs.readFileSync(filePath, 'utf8');
          const lines = fileContent.split('\n');
          for (const line of lines) {
             if (!line.trim()) continue;
             try {
                const d = JSON.parse(line);
                if (d.cwd) {
                   projectName = d.cwd;
                   break;
                }
             } catch (e) {}
          }
        } catch (e) {}
        if (projectName !== defaultProjectName) break;
      }
      
      if (/^[a-z]:[\\/]/i.test(projectName)) {
         projectName = projectName.charAt(0).toUpperCase() + projectName.slice(1);
      }

      for (const filePath of sessionFiles) {
        const stat = fs.statSync(filePath);
        const lastModified = stat.mtime.toISOString();
        
        const scanState = getScanState(filePath);
        let startOffset = 0;
        
        if (scanState) {
          if (scanState.last_modified === lastModified && scanState.last_offset === stat.size) {
            continue; // File hasn't changed
          }
          if (scanState.last_offset < stat.size) {
            startOffset = scanState.last_offset; // Append
          }
        }

        // Parse file
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const contentToParse = startOffset === 0 ? fileContent : fileContent.substring(startOffset);
        const lines = contentToParse.split('\n').filter(line => line.trim() !== '');

        
        // Keep track of processed message IDs to avoid duplicates (thinking + text blocks)
        const processedMessageIds = new Set<string>();

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            
            if (data.type === 'assistant' && data.message && data.message.usage) {
              const msgId = data.message.id || data.requestId;
              if (msgId) {
                if (processedMessageIds.has(msgId)) continue;
                if (isMessageProcessed && isMessageProcessed(msgId)) continue;

                processedMessageIds.add(msgId);
                if (markMessageProcessed) markMessageProcessed(msgId);
              }

              const dateObj = new Date(data.timestamp);
              const date = dateObj.getFullYear() + '-' + String(dateObj.getMonth() + 1).padStart(2, '0') + '-' + String(dateObj.getDate()).padStart(2, '0');
              const hour = dateObj.getHours();
              const model = data.message.model || 'unknown';
              const sessionId = path.basename(filePath).replace('.jsonl', '');
              
              const usage = data.message.usage;
              
              // Helper to add record
              const addRecord = (type: UsageRecord['type'], tokens: number) => {
                if (tokens > 0) {
                  records.push({
                    date, hour, platform: this.platform + '/' + profile, profile, type,
                    model, project: projectName, session: sessionId, tokens, isEstimated: false
                  });
                }
              };

              addRecord('input', usage.input_tokens || 0);
              addRecord('output', usage.output_tokens || 0);
              addRecord('cache_write', usage.cache_creation_input_tokens || 0);
              addRecord('cache_read', usage.cache_read_input_tokens || 0);
            }
          } catch (e) {
            // Ignore malformed JSON lines
          }
        }
        
        // Update scan state
        updateScanState(filePath, stat.size, lastModified);
      }
    }

    return records;
  }
}
