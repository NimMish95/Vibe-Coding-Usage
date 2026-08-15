import { FilterOptions } from './types';

export class FilterManager {
  private onChangeCallback: () => void = () => {};

  constructor() {
    this.setupEventListeners();
  }

  public setOnChange(callback: () => void) {
    this.onChangeCallback = callback;
  }

  private setupEventListeners() {
    const timeRange = document.getElementById('filter-time-range') as HTMLSelectElement;
    const dateFrom = document.getElementById('filter-date-from') as HTMLInputElement;
    const dateTo = document.getElementById('filter-date-to') as HTMLInputElement;
    const separator = document.getElementById('custom-date-separator') as HTMLSpanElement;

    timeRange.addEventListener('change', () => {
      if (timeRange.value === 'custom') {
        dateFrom.style.display = 'inline-block';
        dateTo.style.display = 'inline-block';
        separator.style.display = 'inline-block';
      } else {
        dateFrom.style.display = 'none';
        dateTo.style.display = 'none';
        separator.style.display = 'none';
      }
    });



    document.getElementById('btn-apply-filters')?.addEventListener('click', () => this.onChangeCallback());

    document.getElementById('btn-clear-filters')?.addEventListener('click', () => {
      const selects = document.querySelectorAll('.multi-select');
      selects.forEach(s => {
        const select = s as HTMLSelectElement;
        for (let i = 0; i < select.options.length; i++) {
          select.options[i].selected = false;
        }
      });
      this.onChangeCallback();
    });

    document.querySelectorAll('.clear-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetId = (e.target as HTMLElement).getAttribute('data-target');
        if (targetId) {
          const select = document.getElementById(targetId) as HTMLSelectElement;
          if (select) {
            for (let i = 0; i < select.options.length; i++) select.options[i].selected = false;
            this.onChangeCallback();
          }
        }
      });
    });
  }

  public populateOptions(options: FilterOptions) {
    this.fillSelect('filter-platform', options.platform);
    this.fillSelect('filter-project', options.project);
    this.fillSelect('filter-model', options.model);
    this.fillSelect('filter-type', options.type);
  }

  private fillSelect(id: string, values: string[]) {
    const select = document.getElementById(id) as HTMLSelectElement;
    if (!select) return;
    
    // Save current selection
    const currentSelection = Array.from(select.selectedOptions).map(o => o.value);
    
    select.innerHTML = '';
    values.forEach(v => {
      const option = document.createElement('option');
      option.value = v;
      option.textContent = v;
      if (currentSelection.includes(v)) {
        option.selected = true;
      }
      select.appendChild(option);
    });
  }

  public getFilters() {
    const timeRange = (document.getElementById('filter-time-range') as HTMLSelectElement).value;
    let dateFrom: string | undefined;
    let dateTo: string | undefined;

    const now = new Date();
    
    if (timeRange === 'today') {
      dateFrom = now.toISOString().split('T')[0];
    } else if (timeRange === 'this-week') {
      const firstDay = new Date(now.setDate(now.getDate() - now.getDay()));
      dateFrom = firstDay.toISOString().split('T')[0];
    } else if (timeRange === 'this-month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      dateFrom = firstDay.toISOString().split('T')[0];
    } else if (timeRange === 'custom') {
      const fromVal = (document.getElementById('filter-date-from') as HTMLInputElement).value;
      const toVal = (document.getElementById('filter-date-to') as HTMLInputElement).value;
      if (fromVal) dateFrom = fromVal;
      if (toVal) dateTo = toVal;
    }

    const platform = Array.from((document.getElementById('filter-platform') as HTMLSelectElement).selectedOptions).map(o => o.value);
    const project = Array.from((document.getElementById('filter-project') as HTMLSelectElement).selectedOptions).map(o => o.value);
    const model = Array.from((document.getElementById('filter-model') as HTMLSelectElement).selectedOptions).map(o => o.value);
    const type = Array.from((document.getElementById('filter-type') as HTMLSelectElement).selectedOptions).map(o => o.value);

    return { dateFrom, dateTo, platform, project, model, type };
  }

  public getUnit(): 'tokens' | 'dollars' {
    const el = document.querySelector('input[name="table-unit-type"]:checked') as HTMLInputElement;
    return (el ? el.value : 'tokens') as 'tokens' | 'dollars';
  }
}
