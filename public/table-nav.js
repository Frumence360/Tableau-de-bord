/**
 * Navigation dans les tableaux de données
 * ---------------------------------------
 * Recherche, filtres, tri et pagination, sans dépendance externe.
 *
 * Les fonctions pures (filterRows / sortRows / paginate) sont testables et
 * réutilisées par l'interface via mountTable(), qui se contente de brancher
 * les événements du DOM sur un état unique.
 *
 *   TableNav.mountTable('#recordRows', {
 *     columns: [...],
 *     getSource: () => _allRecords,
 *     toolbar: { search: '#recordSearch', filters: [...], pageSize: '#recordPageSize' },
 *     pager: { root: '#recordPager' }
 *   });
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TableNav = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_PAGE_SIZES = [10, 25, 50, 100];
  const DEFAULT_PAGE_SIZE = 10;

  // ─── Fonctions pures ────────────────────────────────────────────────────────

  /** Minuscules sans accents, pour une recherche insensible à la casse et aux diacritiques. */
  function normalizeText(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  /**
   * Découpe une recherche en jetons : tous doivent être présents
   * (recherche "ET"), chacun dans un champ différent de la ligne.
   */
  function tokenize(search) {
    return normalizeText(search).split(/\s+/).filter(Boolean);
  }

  function matchesSearch(row, search, fields) {
    const tokens = tokenize(search);
    if (!tokens.length) return true;
    const haystack = fields
      .map((field) => row[field])
      .map(normalizeText)
      .join(' ');
    return tokens.every((token) => haystack.includes(token));
  }

  /**
   * Applique une recherche et des filtres.
   * filters : [{ field, test?, value?, label? }] — `test(row, value)` par défaut
   * est une égalité stricte, `value` vide ou null signifie « non filtré ».
   */
  function filterRows(rows, { search = '', fields = [], filters = [] } = {}) {
    let out = rows;
    if (search && fields.length) {
      out = out.filter((row) => matchesSearch(row, search, fields));
    }
    for (const filter of filters || []) {
      if (!filter || filter.value === '' || filter.value === null || filter.value === undefined) continue;
      const value = filter.value;
      out = out.filter((row) => {
        if (typeof filter.test === 'function') return !!filter.test(row, value);
        return String(row[filter.field] ?? '') === String(value);
      });
    }
    return out;
  }

  /** Compare deux valeurs ; renvoie null si l'une des deux est vide. */
  function compareValues(a, b) {
    const aEmpty = a === null || a === undefined || a === '';
    const bEmpty = b === null || b === undefined || b === '';
    if (aEmpty && bEmpty) return 0;
    // Les valeurs vides sont toujours en fin de liste, dans les deux sens :
    // ce traitement est fait en amont, dans sortRows.
    if (aEmpty) return null;
    if (bEmpty) return null;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    const sa = String(a).trim();
    const sb = String(b).trim();
    // Comparaison numérique si les deux valeurs sont des nombres (10 après 9).
    if (/^[-+]?\d+(?:[.,]\d+)?$/.test(sa) && /^[-+]?\d+(?:[.,]\d+)?$/.test(sb)) {
      const na = Number(sa.replace(',', '.'));
      const nb = Number(sb.replace(',', '.'));
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    }
    return sa.localeCompare(sb, 'fr', { numeric: true, sensitivity: 'base' });
  }

  /** Tri stable ; `dir` vaut 'asc' ou 'desc'. Une copie est renvoyée. */
  function sortRows(rows, { field, dir = 'asc' } = {}) {
    if (!field) return rows.slice();
    const sign = dir === 'desc' ? -1 : 1;
    return rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const result = compareValues(a.row[field], b.row[field]);
        // Valeur vide : toujours après, même en tri descendant.
        if (result === null) {
          const aEmpty = a.row[field] === null || a.row[field] === undefined || a.row[field] === '';
          const bEmpty = b.row[field] === null || b.row[field] === undefined || b.row[field] === '';
          if (aEmpty && bEmpty) return a.index - b.index;
          return aEmpty ? 1 : -1;
        }
        return result !== 0 ? result * sign : a.index - b.index;
      })
      .map((entry) => entry.row);
  }

  /** Découpe une liste déjà filtrée/triée. `page` est 1-indexé et borné. */
  function paginate(rows, { page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) {
    const total = rows.length;
    const size = Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE);
    const pages = Math.max(1, Math.ceil(total / size));
    const current = Math.min(Math.max(1, Number(page) || 1), pages);
    const start = (current - 1) * size;
    return {
      rows: rows.slice(start, start + size),
      total,
      page: current,
      pages,
      pageSize: size,
      from: total ? start + 1 : 0,
      to: Math.min(start + size, total)
    };
  }

  /** Pipeline complet : filtres → tri → pagination. */
  function buildView(rows, options = {}) {
    const filtered = filterRows(rows, options);
    const sorted = sortRows(filtered, {
      field: options.sortField,
      dir: options.sortDir
    });
    const page = paginate(sorted, { page: options.page, pageSize: options.pageSize });
    return { ...page, filteredTotal: filtered.length, sortedTotal: sorted.length };
  }

  /** État initial. */
  function createState(overrides = {}) {
    return { search: '', sortField: null, sortDir: 'asc', page: 1, pageSize: DEFAULT_PAGE_SIZE, filters: {}, ...overrides };
  }

  // ─── Branchement DOM ────────────────────────────────────────────────────────

  function debounce(fn, delay = 200) {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function renderPager(pagerEl, view, onChange) {
    if (!pagerEl) return;
    const { page, pages, from, to, total } = view;
    if (total === 0) {
      pagerEl.innerHTML = '<span class="pager-info">Aucun élément</span>';
      return;
    }
    pagerEl.innerHTML = `
      <span class="pager-info">${from}–${to} sur ${total}</span>
      <div class="pager-controls">
        <button type="button" class="btn-action" data-page="1" ${page === 1 ? 'disabled' : ''}>«</button>
        <button type="button" class="btn-action" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>‹</button>
        <span class="pager-page">Page ${page} / ${pages}</span>
        <button type="button" class="btn-action" data-page="${page + 1}" ${page === pages ? 'disabled' : ''}>›</button>
        <button type="button" class="btn-action" data-page="${pages}" ${page === pages ? 'disabled' : ''}>»</button>
      </div>`;

    pagerEl.querySelectorAll('button[data-page]').forEach((button) => {
      button.addEventListener('click', () => {
        const target = Number(button.dataset.page);
        if (target >= 1 && target <= pages) onChange(target);
      });
    });
  }

  function renderSortHeaders(tbodyEl, columns, state, onSort) {
    // Les en-têtes vivent dans le thead de la table parente
    const table = tbodyEl.closest('table');
    if (!table) return;
    const ths = table.querySelectorAll('thead th');
    columns.forEach((column, index) => {
      const th = ths[index];
      if (!th) return;
      const isSorted = state.sortField === column.key;
      th.classList.toggle('sortable', true);
      th.dataset.sortKey = column.key;
      th.setAttribute('role', 'button');
      th.tabIndex = 0;
      th.setAttribute('aria-sort', isSorted ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
      th.innerHTML = `${column.label}<span class="sort-arrow">${isSorted ? (state.sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>`;
      if (!th.dataset.sortBound) {
        th.dataset.sortBound = '1';
        th.addEventListener('click', () => onSort(column.key));
        th.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSort(column.key);
          }
        });
      }
    });
  }

  /**
   * Branche recherche / filtres / tri / pagination sur un tableau.
   *
   * options :
   *   columns    [{ key, label, sort?, render?(row) }]
   *   getSource  () => tableau de lignes
   *   search     sélecteur du champ de recherche
   *   searchFields champs balayés par la recherche
   *   filters    [{ field, selector, test?, label }]
   *   pageSize   sélecteur du choix de taille de page
   *   pager      sélecteur de la zone de pagination
   *   rowRender  (row, index) => HTML
   *   emptyHTML  contenu affiché quand aucune ligne
   *   countEl    sélecteur d'un compteur « n résultats »
   */
  function mountTable(tbodySelector, options = {}) {
    const tbody = typeof tbodySelector === 'string' ? document.querySelector(tbodySelector) : tbodySelector;
    if (!tbody) return null;

    const columns = options.columns || [];
    const state = createState(options.initialState);
    let lastView = null;

    function searchInput() {
      return options.search ? document.querySelector(options.search) : null;
    }

    function readControls() {
      const input = searchInput();
      if (input) state.search = input.value;
      for (const filter of options.filters || []) {
        const el = filter.selector ? document.querySelector(filter.selector) : null;
        state.filters[filter.field] = el ? el.value : '';
      }
      const sizeEl = options.pageSize ? document.querySelector(options.pageSize) : null;
      if (sizeEl && sizeEl.value) state.pageSize = Number(sizeEl.value);
    }

    function render() {
      readControls();
      const source = options.getSource() || [];
      const activeFilters = (options.filters || []).map((filter) => ({
        field: filter.field,
        value: state.filters[filter.field],
        test: filter.test
      }));

      const view = buildView(source, {
        search: state.search,
        fields: options.searchFields || columns.map((c) => c.key),
        filters: activeFilters,
        sortField: state.sortField,
        sortDir: state.sortDir,
        page: state.page,
        pageSize: state.pageSize
      });
      lastView = view;

      if (view.total === 0) {
        tbody.innerHTML = options.emptyHTML || `<tr><td colspan="${columns.length}"><div class="empty-state">Aucun résultat.</div></td></tr>`;
      } else if (typeof options.rowRender === 'function') {
        const start = (view.page - 1) * view.pageSize;
        tbody.innerHTML = view.rows
          .map((row, index) => options.rowRender(row, start + index))
          .join('');
      }

      renderSortHeaders(tbody, columns, state, onSort);
      renderPager(options.pager ? document.querySelector(options.pager) : null, view, (page) => {
        state.page = page;
        render();
      });

      const countEl = options.countEl ? document.querySelector(options.countEl) : null;
      if (countEl) {
        countEl.textContent = view.total === source.length
          ? `${view.total} élément${view.total > 1 ? 's' : ''}`
          : `${view.total} / ${source.length} éléments`;
      }
      if (typeof options.onRender === 'function') options.onRender(view);
    }

    function onSort(key) {
      if (state.sortField === key) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortField = key;
        state.sortDir = 'asc';
      }
      state.page = 1;
      render();
    }

    function reset() {
      state.search = '';
      state.filters = {};
      state.sortField = null;
      state.sortDir = 'asc';
      state.page = 1;
      const input = searchInput();
      if (input) input.value = '';
      for (const filter of options.filters || []) {
        const el = filter.selector ? document.querySelector(filter.selector) : null;
        if (el) el.value = '';
      }
      render();
    }

    // Branchement des contrôles
    const input = searchInput();
    if (input) input.addEventListener('input', debounce(() => {
      state.page = 1;
      render();
    }, 180));

    for (const filter of options.filters || []) {
      const el = filter.selector ? document.querySelector(filter.selector) : null;
      if (!el) continue;
      el.addEventListener('change', () => {
        state.page = 1;
        render();
      });
    }

    const sizeEl = options.pageSize ? document.querySelector(options.pageSize) : null;
    if (sizeEl) {
      if (!sizeEl.options.length) {
        for (const size of DEFAULT_PAGE_SIZES) {
          const option = document.createElement('option');
          option.value = String(size);
          option.textContent = `${size} / page`;
          if (size === state.pageSize) option.selected = true;
          sizeEl.appendChild(option);
        }
      }
      sizeEl.addEventListener('change', () => {
        state.pageSize = Number(sizeEl.value);
        state.page = 1;
        render();
      });
    }

    const resetEl = options.reset ? document.querySelector(options.reset) : null;
    if (resetEl) resetEl.addEventListener('click', reset);

    render();

    return {
      refresh: render,
      reset,
      getState: () => ({ ...state }),
      getView: () => lastView
    };
  }

  return {
    DEFAULT_PAGE_SIZES,
    DEFAULT_PAGE_SIZE,
    normalizeText,
    tokenize,
    matchesSearch,
    filterRows,
    compareValues,
    sortRows,
    paginate,
    buildView,
    createState,
    debounce,
    mountTable
  };
}));
