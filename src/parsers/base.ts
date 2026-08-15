import { UsageRecord } from '../types';

export interface LogParser {
  platform: 'claude-code' | 'antigravity';
  
  /**
   * Parse logs from the given source path and return usage records.
   * @param sourcePath The root path for the profile
   * @param profile The profile name
   * @param getScanState Function to get the last scan state for a file
   * @param updateScanState Function to update the scan state for a file
   */
  parse(
    sourcePath: string, 
    profile: string,
    getScanState: (filePath: string) => { last_offset: number, last_modified: string } | null,
    updateScanState: (filePath: string, offset: number, lastModified: string) => void,
    isMessageProcessed?: (msgId: string) => boolean,
    markMessageProcessed?: (msgId: string) => void
  ): Promise<UsageRecord[]>;
}
