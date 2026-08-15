import { UsageRecord, PricingConfig } from './types';
import { formatKMG } from './utils';

export class TableRenderer {
  private tbody: HTMLTableSectionElement;
  private tfoot: HTMLTableSectionElement;
  private currentSort: string = 'cost';
  private sortDesc: boolean = true;
  private records: UsageRecord[] = [];
  private pricing: PricingConfig = {};
  private groupBy: string = 'model';
  private detailBy: string = 'project';
  private expandedKeys: Set<string> = new Set();
  private expandPath: boolean = false;
  private unitType: 'tokens' | 'dollars' = 'tokens';
  private unitMode: 'value' | 'percent' = 'value';

  constructor(tbodyId: string, tfootId: string) {
    this.tbody = document.getElementById(tbodyId) as HTMLTableSectionElement;
    this.tfoot = document.getElementById(tfootId) as HTMLTableSectionElement;
    
    // Setup sorting headers
    const ths = document.querySelectorAll('th[data-sort]');
    ths.forEach(th => {
      th.addEventListener('click', () => {
        const sortKey = th.getAttribute('data-sort');
        if (sortKey) {
          if (this.currentSort === sortKey) {
            this.sortDesc = !this.sortDesc;
          } else {
            this.currentSort = sortKey;
            this.sortDesc = true;
          }
          this.reRender();
        }
      });
    });
  }

  public render(
    records: UsageRecord[], 
    pricing: PricingConfig, 
    groupBy: string, 
    detailBy: string = 'project',
    unitType: 'tokens' | 'dollars' = 'tokens', 
    unitMode: 'value' | 'percent' = 'value', 
    expandPath: boolean = false
  ) {
    // If groupBy changes, clear expanded keys to avoid stale state
    if (this.groupBy !== groupBy) {
      this.expandedKeys.clear();
    }
    this.records = records;
    this.pricing = pricing;
    this.groupBy = groupBy;
    this.detailBy = detailBy;
    this.unitType = unitType;
    this.unitMode = unitMode;
    this.expandPath = expandPath;
    this.reRender();
  }

  private getRecordGroupKey(r: UsageRecord, dimension: string): string {
    let key = String(r[dimension as keyof UsageRecord] || 'Unknown');
    if (dimension === 'project' && !this.expandPath) {
      const parts = key.split(/[\\/]/);
      key = parts[parts.length - 1] || key;
    }
    return key;
  }

  private aggregateRecords(records: UsageRecord[], dimension: string) {
    const groups = new Map<string, {
      input: number, output: number, cache_w: number, cache_r: number, cost: number, group: string,
      cost_input: number, cost_output: number, cost_cache_w: number, cost_cache_r: number
    }>();

    for (const r of records) {
      const key = this.getRecordGroupKey(r, dimension);
      const current = groups.get(key) || {
        input: 0, output: 0, cache_w: 0, cache_r: 0,
        cost_input: 0, cost_output: 0, cost_cache_w: 0, cost_cache_r: 0,
        cost: 0, group: key
      };
      
      const tokens = r.tokens;
      const rates = this.pricing[r.model];
      let itemCost = 0;
      if (rates) {
        itemCost = (tokens / 1_000_000) * (rates[r.type as keyof typeof rates] || 0);
        current.cost += itemCost;
      }

      if (r.type === 'input') {
        current.input += tokens;
        current.cost_input += itemCost;
      } else if (r.type === 'output') {
        current.output += tokens;
        current.cost_output += itemCost;
      } else if (r.type === 'cache_write') {
        current.cache_w += tokens;
        current.cost_cache_w += itemCost;
      } else if (r.type === 'cache_read') {
        current.cache_r += tokens;
        current.cost_cache_r += itemCost;
      }

      groups.set(key, current);
    }

    return Array.from(groups.values());
  }

  private sortGroupData(arr: any[]) {
    arr.sort((a, b) => {
      let aVal: any, bVal: any;
      if (this.currentSort === 'group') {
        aVal = a.group; bVal = b.group;
      } else if (this.currentSort === 'total') {
        aVal = this.unitType === 'dollars' ? a.cost : (a.input + a.output + a.cache_w + a.cache_r);
        bVal = this.unitType === 'dollars' ? b.cost : (b.input + b.output + b.cache_w + b.cache_r);
      } else if (this.currentSort === 'excl_cache') {
        aVal = this.unitType === 'dollars' ? (a.cost_input + a.cost_output + a.cost_cache_w) : (a.input + a.output + a.cache_w);
        bVal = this.unitType === 'dollars' ? (b.cost_input + b.cost_output + b.cost_cache_w) : (b.input + b.output + b.cache_w);
      } else if (this.currentSort === 'hit_rate') {
        const aPrompt = a.input + a.cache_w + a.cache_r;
        const bPrompt = b.input + b.cache_w + b.cache_r;
        aVal = aPrompt > 0 ? (a.cache_r / aPrompt) : 0;
        bVal = bPrompt > 0 ? (b.cache_r / bPrompt) : 0;
      } else if (this.currentSort === 'cost') {
        aVal = a.cost; bVal = b.cost;
      } else {
        const key = this.currentSort;
        if (this.unitType === 'dollars') {
          const costKey = `cost_${key}` as keyof typeof a;
          aVal = a[costKey] ?? (a as any)[key];
          bVal = b[costKey] ?? (b as any)[key];
        } else {
          aVal = (a as any)[key];
          bVal = (b as any)[key];
        }
      }
      
      if (aVal < bVal) return this.sortDesc ? 1 : -1;
      if (aVal > bVal) return this.sortDesc ? -1 : 1;
      return 0;
    });
  }

  private reRender() {
    if (!this.tbody) return;
    this.tbody.innerHTML = '';
    if (this.tfoot) this.tfoot.innerHTML = '';

    const arr = this.aggregateRecords(this.records, this.groupBy);
    this.sortGroupData(arr);

    let sumInput = 0, sumOutput = 0, sumCacheW = 0, sumCacheR = 0, sumCost = 0;
    let sumCost_input = 0, sumCost_output = 0, sumCost_cache_w = 0, sumCost_cache_r = 0;

    for (const data of arr) {
      sumInput += data.input;
      sumOutput += data.output;
      sumCacheW += data.cache_w;
      sumCacheR += data.cache_r;
      sumCost += data.cost;
      sumCost_input += data.cost_input;
      sumCost_output += data.cost_output;
      sumCost_cache_w += data.cost_cache_w;
      sumCost_cache_r += data.cost_cache_r;
    }

    const sumExclCacheTokens = sumInput + sumOutput + sumCacheW;
    const sumExclCacheCost = sumCost_input + sumCost_output + sumCost_cache_w;
    const sumTotalTokens = sumInput + sumOutput + sumCacheW + sumCacheR;

    const nfCost = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

    const formatCell = (
      valTokens: number, valCost: number, 
      totalTokensSum: number, totalCostSum: number, 
      options: { forceAbsolute?: boolean, alwaysCost?: boolean, alwaysTokens?: boolean } = {}
    ) => {
      let isPercent = this.unitMode === 'percent';
      if (options.forceAbsolute && isPercent) {
        isPercent = false;
      }

      if (isPercent) {
        const useCost = options.alwaysCost || (this.unitType === 'dollars' && !options.alwaysTokens);
        const val = useCost ? valCost : valTokens;
        const sum = useCost ? totalCostSum : totalTokensSum;
        return sum > 0 ? (val / sum * 100).toFixed(2) + '%' : '0.00%';
      }

      if (options.alwaysCost || (this.unitType === 'dollars' && !options.alwaysTokens)) {
        return valCost > 0 ? nfCost.format(valCost) : (valCost === 0 ? '-' : nfCost.format(valCost));
      }

      return valTokens > 0 ? formatKMG(valTokens) : '-';
    };

    for (const data of arr) {
      const isExpanded = this.expandedKeys.has(data.group);
      const tr = document.createElement('tr');
      tr.className = 'row-expandable';
      tr.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
      
      const exclCacheTokens = data.input + data.output + data.cache_w;
      const exclCacheCost = data.cost_input + data.cost_output + data.cost_cache_w;
      const totalTokens = data.input + data.output + data.cache_w + data.cache_r;
      const promptTokens = data.input + data.cache_w + data.cache_r;
      const hitRate = promptTokens > 0 ? (data.cache_r / promptTokens * 100).toFixed(1) + '%' : '-';

      tr.innerHTML = `
        <td class="col-group" style="padding: 0.75rem; display: flex; align-items: center; user-select: none;">
          <span class="row-expand-icon ${isExpanded ? 'expanded' : ''}">▶</span>
          <span style="font-weight: 500;">${data.group}</span>
        </td>
        <td class="col-metric" style="padding: 0.75rem; color: #a1a1aa;">${formatCell(data.input, data.cost_input, sumInput, sumCost_input)}</td>
        <td class="col-metric" style="padding: 0.75rem; color: #a1a1aa;">${formatCell(data.output, data.cost_output, sumOutput, sumCost_output)}</td>
        <td class="col-metric" style="padding: 0.75rem; color: #a1a1aa;">${formatCell(data.cache_w, data.cost_cache_w, sumCacheW, sumCost_cache_w)}</td>
        <td class="col-metric" style="padding: 0.75rem; color: #a1a1aa;">${formatCell(data.cache_r, data.cost_cache_r, sumCacheR, sumCost_cache_r)}</td>
        <td class="col-metric" style="padding: 0.75rem; color: #a1a1aa;">${formatCell(exclCacheTokens, exclCacheCost, sumExclCacheTokens, sumExclCacheCost)}</td>
        <td class="col-metric" style="padding: 0.75rem; font-weight: 600;">${formatCell(totalTokens, 0, sumTotalTokens, 0, { alwaysTokens: true })}</td>
        <td class="col-metric" style="padding: 0.75rem; color: #38bdf8;">${hitRate}</td>
        <td class="col-metric" style="padding: 0.75rem; font-weight: 600; color: #ff9d00;">${formatCell(0, data.cost, 0, sumCost, { alwaysCost: true })}</td>
      `;

      tr.addEventListener('click', () => {
        if (this.expandedKeys.has(data.group)) {
          this.expandedKeys.delete(data.group);
        } else {
          this.expandedKeys.add(data.group);
        }
        this.reRender();
      });

      this.tbody.appendChild(tr);

      // Render Drill-Down Sub-Rows if expanded
      if (isExpanded) {
        const childRecords = this.records.filter(r => this.getRecordGroupKey(r, this.groupBy) === data.group);
        const childArr = this.aggregateRecords(childRecords, this.detailBy);
        this.sortGroupData(childArr);

        for (const child of childArr) {
          const subTr = document.createElement('tr');
          subTr.className = 'sub-row';
          
          const cExclCacheTokens = child.input + child.output + child.cache_w;
          const cExclCacheCost = child.cost_input + child.cost_output + child.cost_cache_w;
          const cTotalTokens = child.input + child.output + child.cache_w + child.cache_r;
          const cPromptTokens = child.input + child.cache_w + child.cache_r;
          const cHitRate = cPromptTokens > 0 ? (child.cache_r / cPromptTokens * 100).toFixed(1) + '%' : '-';

          subTr.innerHTML = `
            <td class="col-group sub-row-name" style="padding: 0.5rem 0.75rem;">
              <span class="sub-row-branch">└─</span>
              <span>${child.group}</span>
            </td>
            <td class="col-metric" style="padding: 0.5rem 0.75rem; color: #80808a;">${formatCell(child.input, child.cost_input, sumInput, sumCost_input)}</td>
            <td class="col-metric" style="padding: 0.5rem 0.75rem; color: #80808a;">${formatCell(child.output, child.cost_output, sumOutput, sumCost_output)}</td>
            <td class="col-metric" style="padding: 0.5rem 0.75rem; color: #80808a;">${formatCell(child.cache_w, child.cost_cache_w, sumCacheW, sumCost_cache_w)}</td>
            <td class="col-metric" style="padding: 0.5rem 0.75rem; color: #80808a;">${formatCell(child.cache_r, child.cost_cache_r, sumCacheR, sumCost_cache_r)}</td>
            <td class="col-metric" style="padding: 0.5rem 0.75rem; color: #80808a;">${formatCell(cExclCacheTokens, cExclCacheCost, sumExclCacheTokens, sumExclCacheCost)}</td>
            <td class="col-metric" style="padding: 0.5rem 0.75rem; font-weight: 500;">${formatCell(cTotalTokens, 0, sumTotalTokens, 0, { alwaysTokens: true })}</td>
            <td class="col-metric" style="padding: 0.5rem 0.75rem; color: #38bdf8; opacity: 0.85;">${cHitRate}</td>
            <td class="col-metric" style="padding: 0.5rem 0.75rem; font-weight: 500; color: #ffb74d;">${formatCell(0, child.cost, 0, sumCost, { alwaysCost: true })}</td>
          `;
          this.tbody.appendChild(subTr);
        }
      }
    }
    
    if (this.tfoot && arr.length > 0) {
      const sumPrompt = sumInput + sumCacheW + sumCacheR;
      const totalHitRate = sumPrompt > 0 ? (sumCacheR / sumPrompt * 100).toFixed(1) + '%' : '-';

      this.tfoot.innerHTML = `
        <tr>
          <td class="col-group" style="padding: 0.75rem; font-weight: bold;">TOTAL</td>
          <td class="col-metric" style="padding: 0.75rem; text-align: right; color: #a1a1aa;">${formatCell(sumInput, sumCost_input, sumInput, sumCost_input, { forceAbsolute: true })}</td>
          <td class="col-metric" style="padding: 0.75rem; text-align: right; color: #a1a1aa;">${formatCell(sumOutput, sumCost_output, sumOutput, sumCost_output, { forceAbsolute: true })}</td>
          <td class="col-metric" style="padding: 0.75rem; text-align: right; color: #a1a1aa;">${formatCell(sumCacheW, sumCost_cache_w, sumCacheW, sumCost_cache_w, { forceAbsolute: true })}</td>
          <td class="col-metric" style="padding: 0.75rem; text-align: right; color: #a1a1aa;">${formatCell(sumCacheR, sumCost_cache_r, sumCacheR, sumCost_cache_r, { forceAbsolute: true })}</td>
          <td class="col-metric" style="padding: 0.75rem; text-align: right; color: #a1a1aa;">${formatCell(sumExclCacheTokens, sumExclCacheCost, sumExclCacheTokens, sumExclCacheCost, { forceAbsolute: true })}</td>
          <td class="col-metric" style="padding: 0.75rem; text-align: right; font-weight: 600;">${formatCell(sumTotalTokens, 0, sumTotalTokens, 0, { forceAbsolute: true, alwaysTokens: true })}</td>
          <td class="col-metric" style="padding: 0.75rem; text-align: right; color: #38bdf8; font-weight: 600;">${totalHitRate}</td>
          <td class="col-metric" style="padding: 0.75rem; text-align: right; font-weight: 600; color: #ff9d00;">${formatCell(0, sumCost, 0, sumCost, { forceAbsolute: true, alwaysCost: true })}</td>
        </tr>
      `;
    }
  }
}

