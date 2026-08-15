import { FilterManager } from './filters';
import { HeatmapRenderer } from './heatmap';
import { ChartRenderer } from './charts';
import { TableRenderer } from './table';
import { UsageRecord, PricingConfig, SourceConfig, AppConfig } from './types';
import { formatKMG } from './utils';

class App {
  private filters = new FilterManager();
  private heatmap = new HeatmapRenderer('heatmap-canvas');
  private barChart = new ChartRenderer('bar-chart-canvas');
  private tableRenderer = new TableRenderer('data-table-body', 'data-table-foot');
  private usageData: UsageRecord[] = [];
  private pricing: PricingConfig = {};
  private expandPath: boolean = false;
  private currentSources: SourceConfig[] = [];
  private isFirstRun: boolean = false;

  constructor() {
    this.init();
  }

  private async init() {
    this.filters.setOnChange(() => this.updateData());
    
    document.getElementById('btn-sync')?.addEventListener('click', () => this.sync());
    
    // Database Reset
    document.getElementById('btn-reset')?.addEventListener('click', async () => {
      if (confirm('確定要清空資料庫並重新解析所有原始日誌嗎？這可能需要幾秒鐘。')) {
        this.showToast('正在重置資料庫...');
        try {
          const res = await fetch('/api/reset', { method: 'POST' });
          const data = await res.json();
          this.showToast(`資料庫重置完成，新增 ${data.recordsAdded} 筆記錄。`);
          const timeElem = document.getElementById('last-sync-time');
          if (timeElem && data.lastSyncTime) timeElem.textContent = `Last synced: ${new Date(data.lastSyncTime).toLocaleTimeString()}`;
          await this.updateData();
        } catch (e) {
          this.showToast('重置失敗。');
        }
      }
    });

    // Settings Modal Setup
    this.initSettingsModal();
    
    // Unit & scale event listeners
    document.querySelectorAll('input[name="table-unit-type"], input[name="table-unit-mode"], input[name="heatmap-unit"], input[name="bar-unit"]').forEach(r => {
      r.addEventListener('change', () => this.render());
    });
    document.getElementById('heatmap-scale')?.addEventListener('change', () => this.render());
    document.getElementById('bar-scale')?.addEventListener('change', () => this.render());
    document.getElementById('bar-group-by')?.addEventListener('change', () => this.render());
    
    const tableGroupEl = document.getElementById('table-group-by') as HTMLSelectElement;
    const tableDetailEl = document.getElementById('table-detail-by') as HTMLSelectElement;
    const btnTogglePath = document.getElementById('btn-toggle-path') as HTMLButtonElement;
    
    if (tableGroupEl) {
      if (btnTogglePath) {
        btnTogglePath.style.display = tableGroupEl.value === 'project' ? 'inline-block' : 'none';
      }
      tableGroupEl.addEventListener('change', () => {
        if (btnTogglePath) {
          btnTogglePath.style.display = tableGroupEl.value === 'project' ? 'inline-block' : 'none';
        }
        if (tableDetailEl && tableDetailEl.value === tableGroupEl.value) {
          // Switch detail dropdown to a sensible different option
          const options = Array.from(tableDetailEl.options).map(o => o.value);
          const nextOption = options.find(o => o !== tableGroupEl.value) || 'project';
          tableDetailEl.value = nextOption;
        }
        this.render();
      });
    }

    if (tableDetailEl) {
      tableDetailEl.addEventListener('change', () => {
        this.render();
      });
    }

    if (btnTogglePath) {
      btnTogglePath.addEventListener('click', () => {
        this.expandPath = !this.expandPath;
        btnTogglePath.textContent = this.expandPath ? 'Collapse Path' : 'Expand Path';
        this.render();
      });
    }

    // Load initial config and check first run
    await this.checkConfigOnStartup();
    await this.fetchFilters();
    await this.fetchPricing();
    await this.fetchStats();
    await this.updateData();
  }

  private initSettingsModal() {
    const modal = document.getElementById('settings-modal');
    const btnSettings = document.getElementById('btn-settings');
    const btnClose = document.getElementById('btn-close-settings');
    const btnCancel = document.getElementById('btn-cancel-settings');
    const btnSave = document.getElementById('btn-save-settings');
    const btnAddSource = document.getElementById('btn-add-source');
    const searchInput = document.getElementById('settings-search') as HTMLInputElement;

    btnSettings?.addEventListener('click', () => {
      this.openSettingsModal();
    });

    btnClose?.addEventListener('click', () => {
      if (modal) modal.style.display = 'none';
    });

    btnCancel?.addEventListener('click', () => {
      if (modal) modal.style.display = 'none';
    });

    btnAddSource?.addEventListener('click', () => {
      this.currentSources.push({
        platform: 'claude-code',
        profile: 'custom',
        path: ''
      });
      this.renderSourcesTable();
    });

    // Search filter in settings
    searchInput?.addEventListener('input', (e) => {
      const q = (e.target as HTMLInputElement).value.trim().toLowerCase();
      const searchableElements = document.querySelectorAll('.settings-section, .form-field, .sources-panel');
      
      searchableElements.forEach(el => {
        const keywords = (el.getAttribute('data-keywords') || '') + ' ' + (el.textContent || '');
        if (!q || keywords.toLowerCase().includes(q)) {
          (el as HTMLElement).style.display = '';
        } else {
          (el as HTMLElement).style.display = 'none';
        }
      });
    });

    btnSave?.addEventListener('click', async () => {
      await this.saveSettings();
    });
  }

  private async checkConfigOnStartup() {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      this.isFirstRun = !!data.isFirstRun;

      if (this.isFirstRun) {
        // Pop up the settings modal automatically with draft config
        this.populateSettingsForm(data.config);
        const modal = document.getElementById('settings-modal');
        const firstRunAlert = document.getElementById('first-run-alert');
        const btnCancel = document.getElementById('btn-cancel-settings');
        const btnClose = document.getElementById('btn-close-settings');
        const btnSave = document.getElementById('btn-save-settings');

        if (modal) modal.style.display = 'flex';
        if (firstRunAlert) firstRunAlert.style.display = 'block';
        if (btnCancel) btnCancel.style.display = 'none';
        if (btnClose) btnClose.style.display = 'none';
        if (btnSave) btnSave.textContent = '儲存並初始化 (Save & Initialize)';
      }
    } catch (e) {
      console.error('Failed to check config on startup:', e);
    }
  }

  private async openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      this.isFirstRun = !!data.isFirstRun;
      this.populateSettingsForm(data.config);
      
      const firstRunAlert = document.getElementById('first-run-alert');
      const btnCancel = document.getElementById('btn-cancel-settings');
      const btnClose = document.getElementById('btn-close-settings');
      const btnSave = document.getElementById('btn-save-settings');

      if (firstRunAlert) firstRunAlert.style.display = this.isFirstRun ? 'block' : 'none';
      if (btnCancel) btnCancel.style.display = this.isFirstRun ? 'none' : 'inline-block';
      if (btnClose) btnClose.style.display = this.isFirstRun ? 'none' : 'inline-block';
      if (btnSave) btnSave.textContent = this.isFirstRun ? '儲存並初始化 (Save & Initialize)' : '儲存並套用 (Save & Apply)';

      modal.style.display = 'flex';
    } catch (e) {
      this.showToast('無法讀取系統設定');
    }
  }

  private populateSettingsForm(cfg: AppConfig) {
    const backupInput = document.getElementById('setting-backup-path') as HTMLInputElement;
    const dbInput = document.getElementById('setting-db-path') as HTMLInputElement;

    if (backupInput) backupInput.value = cfg.backupPath || '';
    if (dbInput) dbInput.value = cfg.database || 'usage.db';

    this.currentSources = Array.isArray(cfg.sources) ? [...cfg.sources] : [];
    this.renderSourcesTable();
  }

  private renderSourcesTable() {
    const tbody = document.getElementById('settings-sources-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (this.currentSources.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="4" style="text-align: center; color: var(--text-secondary); padding: 1rem;">尚無資料來源，請點擊上方「+ 新增來源」按鈕新增</td>`;
      tbody.appendChild(tr);
      return;
    }

    this.currentSources.forEach((source, index) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <select class="source-platform-select" data-index="${index}">
            <option value="claude-code" ${source.platform === 'claude-code' ? 'selected' : ''}>claude-code</option>
            <option value="antigravity" ${source.platform === 'antigravity' ? 'selected' : ''}>antigravity</option>
          </select>
        </td>
        <td>
          <input type="text" class="source-profile-input" data-index="${index}" value="${source.profile || ''}" placeholder="e.g. default, work" />
        </td>
        <td>
          <input type="text" class="source-path-input" data-index="${index}" value="${source.path || ''}" placeholder="e.g. C:/Users/name/.claude" />
        </td>
        <td style="text-align: center;">
          <button type="button" class="btn-icon-danger btn-delete-source" data-index="${index}" title="刪除來源">🗑</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Bind row events
    tbody.querySelectorAll('.source-platform-select').forEach(el => {
      el.addEventListener('change', (e) => {
        const idx = Number((e.target as HTMLElement).getAttribute('data-index'));
        this.currentSources[idx].platform = (e.target as HTMLSelectElement).value as any;
      });
    });

    tbody.querySelectorAll('.source-profile-input').forEach(el => {
      el.addEventListener('input', (e) => {
        const idx = Number((e.target as HTMLElement).getAttribute('data-index'));
        this.currentSources[idx].profile = (e.target as HTMLInputElement).value;
      });
    });

    tbody.querySelectorAll('.source-path-input').forEach(el => {
      el.addEventListener('input', (e) => {
        const idx = Number((e.target as HTMLElement).getAttribute('data-index'));
        this.currentSources[idx].path = (e.target as HTMLInputElement).value;
      });
    });

    tbody.querySelectorAll('.btn-delete-source').forEach(el => {
      el.addEventListener('click', (e) => {
        const idx = Number((e.currentTarget as HTMLElement).getAttribute('data-index'));
        this.currentSources.splice(idx, 1);
        this.renderSourcesTable();
      });
    });
  }

  private async saveSettings() {
    const backupInput = document.getElementById('setting-backup-path') as HTMLInputElement;
    const dbInput = document.getElementById('setting-db-path') as HTMLInputElement;
    const modal = document.getElementById('settings-modal');

    // Clean sources
    const validSources = this.currentSources
      .map(s => ({
        platform: s.platform,
        profile: (s.profile || 'default').trim(),
        path: (s.path || '').trim()
      }))
      .filter(s => s.path !== '');

    const newConfig: AppConfig = {
      sources: validSources,
      backupPath: backupInput?.value.trim() || 'D:/Backups/vibe-coding-usage',
      database: dbInput?.value.trim() || 'usage.db'
    };

    this.showToast(this.isFirstRun ? '正在儲存設定並同步日誌資料...' : '正在儲存設定...');
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast(`設定已儲存！同步了 ${data.recordsAdded ?? 0} 筆日誌。`);
        this.isFirstRun = false;
        if (modal) modal.style.display = 'none';
        
        await this.fetchFilters();
        await this.fetchPricing();
        await this.fetchStats();
        await this.updateData();
      } else {
        this.showToast('儲存失敗：' + (data.error || '未知錯誤'));
      }
    } catch (e) {
      this.showToast('儲存失敗，請檢查伺服器連線');
    }
  }

  private showToast(message: string) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  private async sync() {
    this.showToast('正在同步數據...');
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const data = await res.json();
      this.showToast(`同步完成，新增 ${data.recordsAdded} 筆記錄。`);
      
      const timeElem = document.getElementById('last-sync-time');
      if (timeElem && data.lastSyncTime) timeElem.textContent = `Last synced: ${new Date(data.lastSyncTime).toLocaleTimeString()}`;
      
      await this.updateData();
    } catch (e) {
      this.showToast('同步失敗。');
      console.error(e);
    }
  }

  private async fetchFilters() {
    try {
      const res = await fetch('/api/filters');
      const filtersData = await res.json();
      this.filters.populateOptions(filtersData);
    } catch (e) {
      console.error('Failed to fetch filter options:', e);
    }
  }

  private async fetchPricing() {
    try {
      const res = await fetch('/api/pricing');
      this.pricing = await res.json();
    } catch (e) {
      console.error('Failed to fetch pricing:', e);
    }
  }

  private async fetchStats() {
    try {
      const res = await fetch('/api/stats');
      const stats = await res.json();
      const timeElem = document.getElementById('last-sync-time');
      if (timeElem && stats.lastSyncTime) {
        timeElem.textContent = `Last synced: ${new Date(stats.lastSyncTime).toLocaleTimeString()}`;
      }
    } catch (e) {
      console.error('Failed to fetch stats:', e);
    }
  }

  private async updateData() {
    const filters = this.filters.getFilters();
    const queryParams = new URLSearchParams();
    
    if (filters.dateFrom) queryParams.append('dateFrom', filters.dateFrom);
    if (filters.dateTo) queryParams.append('dateTo', filters.dateTo);
    if (filters.platform.length) queryParams.append('platform', filters.platform.join(','));
    if (filters.project.length) queryParams.append('project', filters.project.join(','));
    if (filters.model && filters.model.length) queryParams.append('model', filters.model.join(','));
    if (filters.type && filters.type.length) queryParams.append('type', filters.type.join(','));

    try {
      const res = await fetch(`/api/usage?${queryParams.toString()}`);
      const data = await res.json();
      if (res.ok) {
        this.usageData = data;
      } else {
        this.showToast('Error: ' + data.error);
        this.usageData = [];
      }
      this.render();
    } catch (e) {
      console.error('Failed to fetch usage data:', e);
    }
  }

  private render() {
    // Update summary cards
    let totalTokens = 0;
    let tokensExclCache = 0;
    let totalCost = 0;
    let activeProjects = new Set<string>();

    for (const r of this.usageData) {
      totalTokens += r.tokens;
      if (r.type !== 'cache_read') tokensExclCache += r.tokens;
      activeProjects.add(r.project);
      
      const rates = this.pricing[r.model];
      if (rates) {
        totalCost += (r.tokens / 1_000_000) * (rates[r.type as keyof typeof rates] || 0);
      }
    }

    const tElem = document.querySelector('#card-tokens .value');
    if (tElem) tElem.textContent = formatKMG(totalTokens);

    const tcElem = document.querySelector('#card-tokens-excl-cache .value');
    if (tcElem) tcElem.textContent = formatKMG(tokensExclCache);

    const cElem = document.querySelector('#card-cost .value');
    if (cElem) cElem.textContent = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalCost);

    const apElem = document.querySelector('#card-active .value');
    if (apElem) apElem.textContent = activeProjects.size.toString();

    // Render charts & table
    const heatmapUnit = ((document.querySelector('input[name="heatmap-unit"]:checked') as HTMLInputElement)?.value || 'tokens') as 'tokens' | 'dollars';
    const heatmapScale = (document.getElementById('heatmap-scale') as HTMLSelectElement).value;
    this.heatmap.render(this.usageData, this.pricing, heatmapUnit, heatmapScale);
    
    const tableUnitType = ((document.querySelector('input[name="table-unit-type"]:checked') as HTMLInputElement)?.value || 'tokens') as 'tokens' | 'dollars';
    const tableUnitMode = ((document.querySelector('input[name="table-unit-mode"]:checked') as HTMLInputElement)?.value || 'value') as 'value' | 'percent';

    const barUnit = ((document.querySelector('input[name="bar-unit"]:checked') as HTMLInputElement)?.value || 'tokens') as 'tokens' | 'dollars';
    const barScale = (document.getElementById('bar-scale') as HTMLSelectElement).value;
    const barGroup = (document.getElementById('bar-group-by') as HTMLSelectElement).value;
    this.barChart.render(this.usageData, this.pricing, barUnit, barGroup, barScale);
    
    const tableGroup = (document.getElementById('table-group-by') as HTMLSelectElement)?.value || 'model';
    const tableDetail = (document.getElementById('table-detail-by') as HTMLSelectElement)?.value || 'project';
    this.tableRenderer.render(this.usageData, this.pricing, tableGroup, tableDetail, tableUnitType, tableUnitMode, this.expandPath);
  }
}

// Start app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new App();
});

