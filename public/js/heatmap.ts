import { UsageRecord, PricingConfig } from './types';
import { formatKMG } from './utils';

interface CellData {
  input: number; output: number; cache_w: number; cache_r: number; cost: number;
}

export class HeatmapRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private tooltip: HTMLDivElement;
  private cells: { x: number, y: number, size: number, data: CellData, label: string }[] = [];

  constructor(canvasId: string) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d');

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'heatmap-tooltip glass-panel';
    this.tooltip.style.position = 'absolute';
    this.tooltip.style.display = 'none';
    this.tooltip.style.pointerEvents = 'none';
    this.tooltip.style.zIndex = '1000';
    this.tooltip.style.padding = '0.75rem';
    this.tooltip.style.fontSize = '0.75rem';
    this.tooltip.style.color = 'var(--text-primary)';
    document.body.appendChild(this.tooltip);

    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('mouseout', () => { this.tooltip.style.display = 'none'; });
  }

  private onMouseMove(e: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    let found = false;
    for (const cell of this.cells) {
      if (x >= cell.x && x <= cell.x + cell.size && y >= cell.y && y <= cell.y + cell.size) {
        if (cell.data.input + cell.data.output + cell.data.cache_w + cell.data.cache_r > 0) {
          const nfCost = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
          const totalTokens = cell.data.input + cell.data.output + cell.data.cache_w + cell.data.cache_r;
          
          this.tooltip.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 4px; color: var(--claude-color);">${cell.label}</div>
            <div style="display: grid; grid-template-columns: auto auto; gap: 4px 12px;">
              <span>Total Tokens:</span><span style="font-weight: 600; text-align: right;">${formatKMG(totalTokens)}</span>
              <span>Input:</span><span style="text-align: right;">${formatKMG(cell.data.input)}</span>
              <span>Output:</span><span style="text-align: right;">${formatKMG(cell.data.output)}</span>
              <span>Cache W:</span><span style="text-align: right;">${formatKMG(cell.data.cache_w)}</span>
              <span>Cache R:</span><span style="text-align: right;">${formatKMG(cell.data.cache_r)}</span>
              <span style="margin-top: 4px;">Cost:</span><span style="margin-top: 4px; font-weight: bold; color: #fbbf24; text-align: right;">${nfCost.format(cell.data.cost)}</span>
            </div>
          `;
          
          const tooltipRect = this.tooltip.getBoundingClientRect();
          let px = e.pageX + 15;
          let py = e.pageY + 15;
          
          if (px + tooltipRect.width > window.innerWidth) px = e.pageX - tooltipRect.width - 15;
          if (py + tooltipRect.height > window.innerHeight) py = e.pageY - tooltipRect.height - 15;

          this.tooltip.style.left = px + 'px';
          this.tooltip.style.top = py + 'px';
          this.tooltip.style.display = 'block';
          found = true;
          break;
        }
      }
    }
    if (!found) this.tooltip.style.display = 'none';
  }

  public render(records: UsageRecord[], pricing: PricingConfig, unit: 'tokens' | 'dollars', scale: string = 'daily') {
    if (!this.ctx) return;
    
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (!records || records.length === 0) {
      this.renderEmptyGrid(scale);
      return;
    }
    
    this.cells = [];
    let minDateStr = records[0].date;
    let maxDateStr = records[0].date;
    const aggregated = new Map<string, CellData>();
    let maxVal = 0;

    for (const r of records) {
      if (r.date < minDateStr) minDateStr = r.date;
      if (r.date > maxDateStr) maxDateStr = r.date;

      const key = scale === 'hourly' ? `${r.date}-${r.hour}` : r.date;
      const current = aggregated.get(key) || { input: 0, output: 0, cache_w: 0, cache_r: 0, cost: 0 };
      
      const tokens = r.tokens;
      if (r.type === 'input') current.input += tokens;
      else if (r.type === 'output') current.output += tokens;
      else if (r.type === 'cache_write') current.cache_w += tokens;
      else if (r.type === 'cache_read') current.cache_r += tokens;

      const rates = pricing[r.model];
      if (rates) {
        current.cost += (tokens / 1_000_000) * (rates[r.type as keyof typeof rates] || 0);
      }

      aggregated.set(key, current);
      
      let val = current.input + current.output + current.cache_w + current.cache_r;
      if (unit === 'dollars') val = current.cost;
      if (val > maxVal) maxVal = val;
    }

    const today = new Date();
    today.setHours(0,0,0,0);
    const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    if (todayStr > maxDateStr) maxDateStr = todayStr;

    const minD = new Date(minDateStr);
    const maxD = new Date(maxDateStr);
    const totalDays = Math.max(1, Math.ceil((maxD.getTime() - minD.getTime()) / (1000 * 60 * 60 * 24)) + 1);

    const rectSize = 14;
    const gap = 4;
    
    let cols = 0;
    let rows = 7;
    
    if (scale === 'hourly') {
      rows = 8;
      cols = totalDays * 4 - 1; 
    } else {
      // daily
      rows = 7;
      const startDayShift = (minD.getDay() + 6) % 7;
      cols = Math.ceil((totalDays + startDayShift) / 7);
    }

    // Add extra padding for labels
    const leftPad = 40;
    const topPad = 25;

    this.canvas.width = Math.max(800, leftPad + cols * (rectSize + gap) + 20);
    this.canvas.height = topPad + rows * (rectSize + gap) + 20;
    
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.ctx.fillStyle = '#a1a1aa';
    this.ctx.font = '10px sans-serif';
    this.ctx.textBaseline = 'middle';
    
    if (scale === 'hourly') {
      // Omit row labels for hourly since they vary by column (0,8,16)
    } else {
      // Draw row labels (Mon ~ Sun)
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      for (let r = 0; r < 7; r++) {
        const y = topPad + r * (rectSize + gap) + rectSize / 2;
        this.ctx.fillText(days[r], 10, y);
      }
    }

    for (let i = 0; i < totalDays; i++) {
      const cellDate = new Date(minD);
      cellDate.setDate(minD.getDate() + i);
      const dateStr = cellDate.getFullYear() + '-' + String(cellDate.getMonth() + 1).padStart(2, '0') + '-' + String(cellDate.getDate()).padStart(2, '0');
      
      if (scale === 'hourly') {
        const startCol = i * 4; // 3 cols per day + 1 gap
        // Draw date label on top of the day block
        if (i % 2 === 0 || totalDays < 10) {
          const x = leftPad + startCol * (rectSize + gap);
          this.ctx.fillText(dateStr.substring(5), x, 10);
        }

        for (let h = 0; h < 24; h++) {
          const c = startCol + Math.floor(h / 8);
          const r = h % 8;
          const key = `${dateStr}-${h}`;
          const currentData = aggregated.get(key) || { input: 0, output: 0, cache_w: 0, cache_r: 0, cost: 0 };
          const val = unit === 'dollars' ? currentData.cost : (currentData.input + currentData.output + currentData.cache_w + currentData.cache_r);

          if (val === 0) {
            this.ctx.fillStyle = 'hsla(230, 20%, 25%, 0.3)';
          } else {
            const intensity = Math.max(0.2, val / maxVal);
            this.ctx.fillStyle = `hsla(24, 95%, ${60 - intensity * 20}%, ${intensity})`;
          }
          
          const x = leftPad + c * (rectSize + gap);
          const y = topPad + r * (rectSize + gap);
          
          this.ctx.beginPath();
          this.ctx.roundRect(x, y, rectSize, rectSize, 3);
          this.ctx.fill();

          this.cells.push({ x, y, size: rectSize, data: currentData, label: `${dateStr} ${String(h).padStart(2, '0')}:00` });
        }
      } else {
        // daily
        const dayOfWeek = (cellDate.getDay() + 6) % 7; // Monday is 0, Sunday is 6
        const startDayShift = (minD.getDay() + 6) % 7;
        const c = Math.floor((i + startDayShift) / 7);
        const r = dayOfWeek;
        
        // Month label roughly at start of month
        if (cellDate.getDate() === 1) {
          const x = leftPad + c * (rectSize + gap);
          const monthStr = cellDate.toLocaleString('default', { month: 'short' });
          this.ctx.fillStyle = '#ffffff';
          this.ctx.fillText(monthStr, x, 10);
        }

        const key = dateStr;
        const currentData = aggregated.get(key) || { input: 0, output: 0, cache_w: 0, cache_r: 0, cost: 0 };
        const val = unit === 'dollars' ? currentData.cost : (currentData.input + currentData.output + currentData.cache_w + currentData.cache_r);

        if (val === 0) {
          this.ctx.fillStyle = 'hsla(230, 20%, 25%, 0.3)';
        } else {
          const intensity = Math.max(0.2, val / maxVal);
          this.ctx.fillStyle = `hsla(24, 95%, ${60 - intensity * 20}%, ${intensity})`;
        }
        
        const x = leftPad + c * (rectSize + gap);
        const y = topPad + r * (rectSize + gap);

        this.ctx.beginPath();
        this.ctx.roundRect(x, y, rectSize, rectSize, 3);
        this.ctx.fill();

        this.cells.push({ x, y, size: rectSize, data: currentData, label: cellDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) });
      }
    }
  }

  private renderEmptyGrid(scale: string = 'daily') {
    if (!this.ctx) return;
    const rectSize = 14;
    const gap = 4;
    let cols = 52; 
    let rows = 7;
    const leftPad = 40;
    const topPad = 25;

    if (scale === 'hourly') {
      cols = 30 * 4;
      rows = 8;
    }
    
    this.canvas.width = Math.max(800, leftPad + cols * (rectSize + gap) + 20);
    this.canvas.height = topPad + rows * (rectSize + gap) + 20;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (let c = 0; c < cols; c++) {
      // skip gaps in hourly
      if (scale === 'hourly' && c % 4 === 3) continue;

      for (let r = 0; r < rows; r++) {
        this.ctx.fillStyle = 'hsla(230, 20%, 25%, 0.3)';
        const x = leftPad + c * (rectSize + gap);
        const y = topPad + r * (rectSize + gap);
        this.ctx.beginPath();
        this.ctx.roundRect(x, y, rectSize, rectSize, 3);
        this.ctx.fill();
      }
    }
  }
}
