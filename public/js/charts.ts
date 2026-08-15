import { UsageRecord, PricingConfig } from './types';
import { formatKMG } from './utils';

declare const Chart: any; // Using CDN

export class ChartRenderer {
  private chartInstance: any = null;
  private canvasId: string;

  constructor(canvasId: string) {
    this.canvasId = canvasId;
  }

  public render(records: UsageRecord[], pricing: PricingConfig, unit: 'tokens' | 'dollars', groupBy: string, barScale: string = 'daily') {
    const ctx = document.getElementById(this.canvasId) as HTMLCanvasElement;
    if (!ctx) return;

    if (this.chartInstance) {
      this.chartInstance.destroy();
    }

    if (!records || records.length === 0) {
      // Create empty chart
      this.createEmptyChart(ctx);
      return;
    }

    // Aggregate data
    const labelsSet = new Set<string>();
    const datasetsMap = new Map<string, Map<string, number>>(); // group -> date -> val

    for (const r of records) {
      let labelDate = r.date;
      if (barScale === 'hourly') {
         labelDate = `${r.date} ${String(r.hour).padStart(2, '0')}:00`;
      }
      labelsSet.add(labelDate);
      
      let val = r.tokens;
      if (unit === 'dollars') {
        const rates = pricing[r.model];
        if (rates) {
           val = (r.tokens / 1_000_000) * (rates[r.type as keyof typeof rates] || 0);
        } else {
           val = 0;
        }
      }

      let groupKey = r.type;
      if (groupBy === 'model') groupKey = r.model;
      if (groupBy === 'platform') groupKey = r.platform;
      if (groupBy === 'project') {
         const parts = r.project.split(/[\\/]/);
         groupKey = parts[parts.length - 1] || r.project;
      }

      if (!datasetsMap.has(groupKey)) {
        datasetsMap.set(groupKey, new Map());
      }
      
      const current = datasetsMap.get(groupKey)!.get(labelDate) || 0;
      datasetsMap.get(groupKey)!.set(labelDate, current + val);
    }

    const labels = Array.from(labelsSet).sort();
    
    // Color mapping based on css variables
    const getCssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || 'hsl(200, 50%, 50%)';
    
    const typeColors: Record<string, string> = {
      'input': getCssVar('--type-input'),
      'output': getCssVar('--type-output'),
      'cache_write': getCssVar('--type-cache-write'),
      'cache_read': getCssVar('--type-cache-read')
    };

    const familyHues: Record<string, number> = {
      'fable': 0, // Red
      'opus': 30, // Orange
      'sonnet': 50, // Yellow
      'haiku': 80, // Yellow-Green
      'gemini': 210 // Blue
    };

    const modelTotals = new Map<string, number>();
    const platformTotals = new Map<string, number>();
    const projectTotals = new Map<string, number>();
    for (const r of records) {
        modelTotals.set(r.model, (modelTotals.get(r.model) || 0) + r.tokens);
        platformTotals.set(r.platform, (platformTotals.get(r.platform) || 0) + r.tokens);
        const parts = r.project.split(/[\\/]/);
        const pKey = parts[parts.length - 1] || r.project;
        projectTotals.set(pKey, (projectTotals.get(pKey) || 0) + r.tokens);
    }

    const modelColorMap = new Map<string, string>();
    if (groupBy === 'model') {
       const familyModels = new Map<string, string[]>();
       for (const model of datasetsMap.keys()) {
          let fam = 'other';
          for (const f of Object.keys(familyHues)) {
             if (model.includes(f)) { fam = f; break; }
          }
          if (!familyModels.has(fam)) familyModels.set(fam, []);
          familyModels.get(fam)!.push(model);
       }

       for (const [fam, models] of familyModels.entries()) {
          models.sort((a, b) => (modelTotals.get(b) || 0) - (modelTotals.get(a) || 0));
          const hue = familyHues[fam] ?? Math.floor(Math.random() * 360);
          models.forEach((m, idx) => {
             const l = Math.min(85, 55 + idx * 10);
             const s = Math.max(30, 95 - idx * 15);
             modelColorMap.set(m, `hsl(${hue}, ${s}%, ${l}%)`);
          });
       }
    }

    const platformColorMap = new Map<string, string>();
    if (groupBy === 'platform') {
       const groupProfiles = new Map<string, string[]>();
       for (const p of datasetsMap.keys()) {
          const fam = p.startsWith('claude-code') ? 'claude-code' : (p.startsWith('antigravity') ? 'antigravity' : 'other');
          if (!groupProfiles.has(fam)) groupProfiles.set(fam, []);
          groupProfiles.get(fam)!.push(p);
       }
       for (const [fam, profiles] of groupProfiles.entries()) {
          profiles.sort((a, b) => (platformTotals.get(b) || 0) - (platformTotals.get(a) || 0));
          const hue = fam === 'claude-code' ? 30 : (fam === 'antigravity' ? 210 : 0);
          profiles.forEach((p, idx) => {
             const l = Math.min(85, 55 + idx * 10);
             const s = Math.max(30, 95 - idx * 15);
             platformColorMap.set(p, `hsl(${hue}, ${s}%, ${l}%)`);
          });
       }
    }

    // Hues for the top projects: red, orange, yellow, green, cyan, violet, magenta.
    // Chosen explicitly rather than by a fixed step so no two entries land on
    // neighbouring hues (the old `idx * 50` produced two near-identical greens).
    const projectHues = [0, 32, 55, 120, 195, 255, 305];

    const projectColorMap = new Map<string, string>();
    if (groupBy === 'project') {
       const sortedProjects = Array.from(projectTotals.entries())
                                   .sort((a, b) => b[1] - a[1])
                                   .map(e => e[0]);
       sortedProjects.forEach((p, idx) => {
          const hue = projectHues[idx % projectHues.length];
          if (idx < projectHues.length) {
             projectColorMap.set(p, `hsl(${hue}, 70%, 60%)`);
          } else {
             // Beyond the top group, reuse the hues muted so they recede visually.
             projectColorMap.set(p, `hsl(${hue}, 35%, 45%)`);
          }
       });
    }

    let datasets = Array.from(datasetsMap.keys()).map((group, index) => {
      let color = `hsl(${(index * 50) % 360}, 70%, 60%)`;
      if (groupBy === 'type' && typeColors[group]) color = typeColors[group];
      if (groupBy === 'platform' && platformColorMap.has(group)) color = platformColorMap.get(group)!;
      if (groupBy === 'model' && modelColorMap.has(group)) color = modelColorMap.get(group)!;
      if (groupBy === 'project' && projectColorMap.has(group)) color = projectColorMap.get(group)!;

      return {
        label: group,
        data: labels.map(l => datasetsMap.get(group)!.get(l) || 0),
        backgroundColor: color,
        borderWidth: 0
      };
    });

    const familyOrder = ['fable', 'opus', 'sonnet', 'haiku', 'gemini', 'other'];
    const getModelFamily = (m: string) => {
       for (const f of familyOrder) if (m.includes(f)) return f;
       return 'other';
    };

    datasets.sort((a, b) => {
       if (groupBy === 'model') {
          const famA = getModelFamily(a.label);
          const famB = getModelFamily(b.label);
          if (famA !== famB) return familyOrder.indexOf(famA) - familyOrder.indexOf(famB);
          return (modelTotals.get(b.label) || 0) - (modelTotals.get(a.label) || 0);
       }
       if (groupBy === 'platform') {
          const famA = a.label.startsWith('claude') ? 0 : 1;
          const famB = b.label.startsWith('claude') ? 0 : 1;
          if (famA !== famB) return famA - famB;
          return (platformTotals.get(b.label) || 0) - (platformTotals.get(a.label) || 0);
       }
       if (groupBy === 'project') {
          return (projectTotals.get(b.label) || 0) - (projectTotals.get(a.label) || 0);
       }
       return 0;
    });

    Chart.defaults.color = getCssVar('--text-secondary');
    Chart.defaults.font.family = "'Inter', sans-serif";

    this.chartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { stacked: true, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { stacked: true, grid: { color: 'rgba(255,255,255,0.1)' } }
        },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              label: (context: any) => {
                let label = context.dataset.label || '';
                if (label) label += ': ';
                if (context.parsed.y !== null) {
                  if (unit === 'dollars') {
                    label += new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(context.parsed.y);
                  } else {
                    label += formatKMG(context.parsed.y);
                  }
                }
                return label;
              }
            }
          }
        }
      }
    });
  }

  private createEmptyChart(ctx: HTMLCanvasElement) {
    const getCssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#ffffff';
    Chart.defaults.color = getCssVar('--text-secondary');
    Chart.defaults.font.family = "'Inter', sans-serif";
    
    this.chartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['No Data'],
        datasets: [{
          label: 'No Data',
          data: [0],
          backgroundColor: 'transparent'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: 'No Data Available For Current Filters',
            color: getCssVar('--text-secondary')
          },
          legend: { display: false }
        },
        scales: {
          x: { display: false },
          y: { display: false }
        }
      }
    });
  }
}
