import fs from 'fs';
import path from 'path';

export class BackupManager {
  private backupPath: string;

  constructor(backupPath: string) {
    this.backupPath = backupPath;
    if (!fs.existsSync(this.backupPath)) {
      fs.mkdirSync(this.backupPath, { recursive: true });
    }
  }

  public backupFile(sourcePath: string, rootProfilePath: string) {
    try {
      // Create relative path from the profile root
      const relativePath = path.relative(path.dirname(rootProfilePath), sourcePath);
      const targetPath = path.join(this.backupPath, relativePath);
      
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // Check if we need to backup (if target doesn't exist or is older)
      if (fs.existsSync(targetPath)) {
        const sourceStat = fs.statSync(sourcePath);
        const targetStat = fs.statSync(targetPath);
        
        if (sourceStat.mtime.getTime() <= targetStat.mtime.getTime()) {
          return false; // Skip backup
        }
      }

      fs.copyFileSync(sourcePath, targetPath);
      return true;
    } catch (e) {
      console.error(`Backup failed for ${sourcePath}:`, e);
      return false;
    }
  }

  public backupDirectory(sourceDir: string, rootProfilePath: string): number {
    let count = 0;
    if (!fs.existsSync(sourceDir)) return 0;
    
    try {
      const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(sourceDir, entry.name);
        if (entry.isDirectory()) {
          count += this.backupDirectory(fullPath, rootProfilePath);
        } else if (entry.isFile() && (entry.name.endsWith('.jsonl') || entry.name.endsWith('.json'))) {
          if (this.backupFile(fullPath, rootProfilePath)) {
            count++;
          }
        }
      }
    } catch (e) {
      console.error(`Failed to read directory ${sourceDir}:`, e);
    }
    
    return count;
  }
}
