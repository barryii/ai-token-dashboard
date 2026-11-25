/* =============================================================
   Tables — sortable, searchable, drill-down rows
   ============================================================= */

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { U } from '../shared/utils.js';
import { sourceIcon, sourceIconScale } from './source-icons.js';
import { paginateRows } from '../shared/pagination.js';
import { EventDetails } from './EventDetails.jsx';

// Source cell: brand icon when available, otherwise the colored dot.
function SourceTag({ source }) {
  const icon = sourceIcon(source);
  return (
    <span className="tag" title={source}>
      {icon
        ? <img className="tag-icon" src={icon} alt="" style={{ transform: `scale(${sourceIconScale(source)})` }} />
        : <span className="tag-dot" style={{ background: U.getSourceColor(source) }}/>}
      {source}
    </span>
  );
}

// Generic data table
function DataTable({ rows, columns, initialSort, search, onSearch, onRowClick, selectedKey, getKey, height, emptyText }) {
  const [sortBy, setSortBy] = useState(initialSort || { field: null, dir: 'desc' });
  const [page, setPage] = useState(1);
  const [activeKey, setActiveKey] = useState(null);
  const wrapRef = useRef(null);
  useEffect(() => setPage(1), [rows, search]);

  const filtered = useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter(r =>
      columns.some(c => {
        const v = typeof c.value === 'function' ? c.value(r) : r[c.field];
        return String(v ?? '').toLowerCase().includes(q);
      })
    );
  }, [rows, columns, search]);

  const sorted = useMemo(() => {
    if (!sortBy.field) return filtered;
    const arr = [...filtered];
    const col = columns.find(c => c.field === sortBy.field);
    if (!col) return arr;
    arr.sort((a, b) => {
      const va = typeof col.value === 'function' ? col.value(a) : a[col.field];
      const vb = typeof col.value === 'function' ? col.value(b) : b[col.field];
      if (typeof va === 'number' && typeof vb === 'number') return sortBy.dir === 'asc' ? va - vb : vb - va;
      const sa = String(va ?? '').toLowerCase();
      const sb = String(vb ?? '').toLowerCase();
      return sortBy.dir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
    return arr;
  }, [filtered, sortBy, columns]);

  const toggleSort = (field) => {
    setPage(1);
    setSortBy(prev =>
      prev.field === field
        ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'desc' }
    );
  };

  const pagination = paginateRows(sorted, page);
  useEffect(() => { if (wrapRef.current) wrapRef.current.scrollTop = 0; }, [pagination.page, search, sortBy]);

  return (
    <>
    <div ref={wrapRef} className="table-wrap" style={{maxHeight: height, overflow: 'auto'}}>
      <table className="dt">
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.field || c.title}
                scope="col"
                aria-sort={c.sortable === false ? undefined : sortBy.field === c.field ? (sortBy.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className={sortBy.field === c.field ? 'sorted' : ''}
                style={{
                  width: c.width,
                  textAlign: c.hozAlign === 'right' ? 'right' : 'left',
                  cursor: c.sortable === false ? 'default' : 'pointer'
                }}>
                <button className="table-sort" disabled={c.sortable === false} onClick={() => toggleSort(c.field)}>
                {c.title}
                {c.sortable !== false && (
                  <span className="sort-ind">
                    {sortBy.field === c.field ? (sortBy.dir === 'asc' ? '▲' : '▼') : '▾'}
                  </span>
                )}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr><td colSpan={columns.length} style={{textAlign:'center', padding:'30px', color:'var(--muted)'}}>{search ? '沒有符合的記錄，請調整搜尋筆件' : emptyText || '暫無資料'}</td></tr>
          )}
          {pagination.rows.map((r, i) => {
            const k = getKey ? getKey(r) : i;
            return (
              <tr key={k}
                className={(selectedKey ?? activeKey) === k ? 'selected' : ''}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={event => {
                  if (onRowClick && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault(); setActiveKey(k); onRowClick(r);
                  }
                }}
                onClick={() => { setActiveKey(k); onRowClick?.(r); }}>
                {columns.map(c => (
                  <td key={c.field || c.title}
                    style={{textAlign: c.hozAlign === 'right' ? 'right' : 'left'}}>
                    {c.render ? c.render(r) : (typeof c.value === 'function' ? c.value(r) : r[c.field])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    <nav className="table-pagination" aria-label="表格分頁">
      <span role="status">{pagination.start}–{pagination.end} / {pagination.total} 筆</span>
      <span className="table-pagination-actions">
        <button className="btn" disabled={pagination.page === 1} onClick={() => setPage(pagination.page - 1)}>上一頁</button>
        <span>{pagination.page} / {pagination.pageCount} 頁</span>
        <button className="btn" disabled={pagination.page === pagination.pageCount} onClick={() => setPage(pagination.page + 1)}>下一頁</button>
      </span>
    </nav>
    </>
  );
}

// ───────────────────────────────────────────────────────────────
// Combined tabbed table panel
// ───────────────────────────────────────────────────────────────
function TablePanel({ daily, sessions, runs, sources, totalTokens, onDrill, pricing }) {
  const [tab, setTab] = useState('sources');
  const [search, setSearch] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const latest = useMemo(() => U.latestRuns(runs), [runs]);
  const formatRunTime = r => U.formatTs(r.collectedAt);

  // Aggregate by source
  const bySource = useMemo(() => {
    const m = new Map();
    for (const r of daily) {
      const k = `${r.source}::${r.device}`;
      if (!m.has(k)) m.set(k, { source: r.source, device: r.device, totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUSD: 0, models: new Set() });
      const x = m.get(k);
      x.totalTokens += r.totalTokens;
      x.inputTokens += r.inputTokens;
      x.outputTokens += r.outputTokens;
      x.cacheReadTokens += r.cacheReadTokens;
      x.costUSD += r.costUSD;
      x.models.add(r.model);
    }
    return Array.from(m.values()).map(x => ({...x, modelCount: x.models.size}));
  }, [daily]);

  const byModel = useMemo(() => {
    const m = new Map();
    for (const r of daily) {
      const k = `${r.source}::${r.model}`;
      if (!m.has(k)) m.set(k, { source: r.source, model: r.model, totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUSD: 0, days: new Set() });
      const x = m.get(k);
      x.totalTokens += r.totalTokens;
      x.inputTokens += r.inputTokens;
      x.outputTokens += r.outputTokens;
      x.cacheReadTokens += r.cacheReadTokens;
      x.costUSD += r.costUSD;
      x.days.add(r.usageDate);
    }
    return Array.from(m.values()).map(x => ({...x, dayCount: x.days.size}));
  }, [daily]);

  const TABS = [
    { id: 'sources', label: '來源 / 裝置', count: bySource.length },
    { id: 'models',  label: '模型',        count: byModel.length },
    { id: 'sessions', label: '專案', count: sessions.length },
    { id: 'runs',    label: '採集記錄',    count: runs.length }
  ];

  // Columns per tab
  const sourceColumns = [
    { field: 'source', title: '來源', render: r => (
      <SourceTag source={r.source} />
    )},
    { field: 'device', title: '裝置', render: r => <span className="muted" style={{fontSize:11.5}}>{r.device}</span> },
    { field: 'modelCount', title: '模型', hozAlign: 'right', render: r => r.modelCount, width: 70 },
    { field: 'totalTokens', title: 'Total', hozAlign: 'right', render: r => (
      <span className="num-strong">{U.fmt.format(r.totalTokens)}</span>
    ), width: 130 },
    { field: 'share', title: '佔比', hozAlign: 'left',
      value: r => r.totalTokens / (totalTokens || 1),
      render: r => {
        const p = (r.totalTokens / (totalTokens || 1)) * 100;
        return (
          <span>
            <span className="share-bar"><span style={{width: `${Math.min(100, p)}%`, background: U.getSourceColor(r.source)}}/></span>
            <span className="share-pct">{U.usageShare(r.totalTokens, totalTokens)}</span>
          </span>
        );
      }, width: 180
    },
    { field: 'inputTokens', title: 'Input', hozAlign: 'right', render: r => U.compact(r.inputTokens), width: 80 },
    { field: 'outputTokens', title: 'Output', hozAlign: 'right', render: r => U.compact(r.outputTokens), width: 80 },
    { field: 'cacheReadTokens', title: 'Cache', hozAlign: 'right', render: r => U.compact(r.cacheReadTokens), width: 80 },
    { field: 'costUSD', title: '費用', hozAlign: 'right', render: r => (
      r.costUSD > 0 ? <span style={{color:'var(--c-amber)'}}>{U.fmtUS.format(r.costUSD)}</span> : <span className="muted">—</span>
    ), width: 90 }
  ];

  const modelColumns = [
    { field: 'source', title: '來源', render: r => (
      <SourceTag source={r.source} />
    )},
    { field: 'model', title: '模型', render: r => <span className="mono">{r.model}
      {pricing?.models?.[r.model] === false && <small className="muted" title="目前目錄未比對到價格，已有記錄費用仍保留"> · 未比對到價格</small>}
    </span> },
    { field: 'dayCount', title: '活躍天', hozAlign: 'right', render: r => r.dayCount, width: 80 },
    { field: 'inputTokens', title: 'Input', hozAlign: 'right', render: r => U.compact(r.inputTokens), width: 90 },
    { field: 'outputTokens', title: 'Output', hozAlign: 'right', render: r => U.compact(r.outputTokens), width: 90 },
    { field: 'cacheReadTokens', title: 'Cache Read', hozAlign: 'right', render: r => U.compact(r.cacheReadTokens), width: 110 },
    { field: 'totalTokens', title: 'Total', hozAlign: 'right', render: r => (
      <span className="num-strong">{U.fmt.format(r.totalTokens)}</span>
    ), width: 130 },
    { field: 'costUSD', title: '費用', hozAlign: 'right', render: r => (
      r.costUSD > 0 ? <span style={{color:'var(--c-amber)'}}>{U.fmtUS4.format(r.costUSD)}</span> : <span className="muted">—</span>
    ), width: 100 }
  ];

  const sessionColumns = [
    { field: 'source', title: '來源', render: r => (
      <SourceTag source={r.source} />
    ), width: 130 },
    { field: 'projectPath', title: '專案', render: r => {
      const label = r.projectPath && r.projectPath !== 'Unknown Project'
        ? r.projectPath
        : (r.sessionId ? r.sessionId.split('/').slice(-1)[0] || r.sessionId : '—');
      return <span className="mono" title={r.sessionId || ''}>{label}</span>;
    }},
    { field: 'model', title: '模型', render: r => <span className="mono">{r.model}</span> },
    { field: 'lastActivity', title: '最後活動', render: r => (
      <span className="muted" style={{fontSize:11.5}}>{r.lastActivity ? U.formatTs(r.lastActivity) : '未知'}</span>
    ), width: 130 },
    { field: 'inputTokens', title: 'Input', hozAlign: 'right', render: r => U.compact(r.inputTokens), width: 90 },
    { field: 'outputTokens', title: 'Output', hozAlign: 'right', render: r => U.compact(r.outputTokens), width: 90 },
    { field: 'totalTokens', title: 'Total', hozAlign: 'right', render: r => (
      <span className="num-strong">{U.fmt.format(r.totalTokens)}</span>
    ), width: 130 },
    { field: 'costUSD', title: '費用', hozAlign: 'right', render: r => (
      r.costUSD > 0 ? <span style={{color:'var(--c-amber)'}}>{U.fmtUS4.format(r.costUSD)}</span> : <span className="muted">—</span>
    ), width: 100 }
  ];

  const runColumns = [
    { field: 'collectedAt', title: '時間', render: r => (
      <span className="mono" style={{fontSize: 11.5, color: 'var(--text-2)', whiteSpace: 'nowrap'}}>{formatRunTime(r)}</span>
    ), value: formatRunTime, width: 160 },
    { field: 'source', title: '來源', render: r => (
      <SourceTag source={r.source} />
    ), width: 140 },
    { field: 'device', title: '裝置', render: r => <span className="muted run-device" title={r.device}>{r.device}</span>, width: 200 },
    { field: 'status', title: '狀態', render: r => (
      <span className={`status-badge status-${r.status}`} title={r.status}>
        {({ ok: '採集成功', empty: '未採集到用量', error: '採集失敗', warn: '採集警告', skip: '已跳過' })[r.status] || r.status}
      </span>
    ), width: 140 },
    { field: 'message', title: '說明', render: r => (
      <span title={r.message} style={{
        color: 'var(--text-2)', fontSize: 12,
        display: 'block', overflow: 'hidden',
        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        maxWidth: 380
      }}>{r.message}</span>
    )}
  ];

  let columns, rows, initialSort, emptyText;
  if (tab === 'sources')  { columns = sourceColumns;  rows = bySource;  initialSort = { field: 'totalTokens', dir: 'desc' }; emptyText = '目前篩選下無來源'; }
  if (tab === 'models')   { columns = modelColumns;   rows = byModel;   initialSort = { field: 'totalTokens', dir: 'desc' }; emptyText = '目前篩選下無模型'; }
  if (tab === 'sessions') { columns = sessionColumns; rows = sessions;  initialSort = { field: 'totalTokens', dir: 'desc' }; emptyText = '目前範圍沒有可歸屬專案的事件明細'; }
  if (tab === 'runs')     { columns = runColumns;     rows = showHistory ? runs : latest; initialSort = { field: 'collectedAt', dir: 'desc' }; emptyText = '暫無採集記錄'; }

  const exportCSV = () => {
    U.downloadCSV(`tokens-${tab}-${U.daysAgo(0)}.csv`, rows, columns);
  };

  return (
    <div className={`panel table-panel ${tab === 'runs' ? 'table-panel-runs' : ''}`}>
      <div className="table-heading"><div><h2 className="panel-title">用量明細</h2><p className="panel-sub">按來源、模型或專案核對記錄</p></div><span>點選列查看詳情</span></div>
      <div className="panel-header" style={{marginBottom: 14}}>
        <div className="panel-tabs">
          {TABS.map(t => (
            <button key={t.id} aria-pressed={tab === t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => { setTab(t.id); setSearch(''); }}>
              {t.label} <span style={{opacity:0.55, marginLeft:4}}>{t.count}</span>
            </button>
          ))}
        </div>
        <div className="panel-actions">
          <div className="table-search"><input type="search" aria-label="搜尋目前明細清單" className="search-input" placeholder="搜尋目前清單…" value={search} onChange={e => setSearch(e.target.value)}/>{search&&<button type="button" onClick={()=>setSearch('')} aria-label="清空搜尋">×</button>}</div>
          <button className="btn" onClick={exportCSV} title="匯出目前清單全部記錄，不受分頁和搜尋影響">
            <svg className="icon" viewBox="0 0 16 16" fill="none">
              <path d="M8 2v8M5 7l3 3 3-3M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            匯出清單
          </button>
        </div>
      </div>
      {tab === 'runs' && <div className="collection-explainer">
        <label><input type="checkbox" checked={showHistory} onChange={e => setShowHistory(e.target.checked)} /> 展開歷史記錄（{runs.length} 筆）</label>
        <p>預設按工具和裝置顯示最近一次結果（{latest.length} 項）；只受來源和裝置篩選影響。歷史記錄最多保留介面回傳的最近 500 筆。</p>
        <p>沒有用量不代表未安裝。採集失敗請查看說明，檢查日誌目錄和讀取權限後重試；最近採集時間不代表最後使用時間。</p>
      </div>}
      <DataTable
        key={`${tab}-${showHistory}`}
        rows={rows}
        columns={columns}
        initialSort={initialSort}
        search={search}
        height={420}
        emptyText={emptyText}
        getKey={r => r.sessionId || `${r.source}-${r.model || ''}-${r.device || ''}-${r.collectedAt || ''}`}
        onRowClick={r => onDrill?.({ kind: tab.slice(0,-1), row: r })}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────
// Drawer — drill-down panel
// ───────────────────────────────────────────────────────────────
function DrillDrawer({ drill, daily, rangeLabel, eventQuery, revision, onClose }) {
  const open = !!drill;
  const reduceMotion = useReducedMotion();
  const drawerRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement;
    const drawer = drawerRef.current;
    drawer?.querySelector('button')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
      if (e.key !== 'Tab' || !drawer) return;
      const items = [...drawer.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]')].filter(el => el.getClientRects().length);
      const first = items[0], last = items[items.length - 1];
      if (!first) { e.preventDefault(); drawer.focus(); }
      else if (e.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const detail = useMemo(() => {
    if (!drill) return null;
    const { kind, row } = drill;
    let title = '', sub = '', filterFn = () => true;
    if (kind === 'source') { title = row.source; sub = row.device; filterFn = r => r.source === row.source && r.device === row.device; }
    if (kind === 'model')  { title = row.model; sub = drill.allSources ? '目前篩選內的所有來源' : row.source; filterFn = r => (drill.allSources || r.source === row.source) && r.model === row.model; }
    if (kind === 'session'){ title = row.projectPath || row.sessionId; sub = `${row.source} · ${row.device}`;
      filterFn = r => r.source === row.source && r.device === row.device && r.projectPath === row.projectPath && r.model === row.model; }
    if (kind === 'run')    { title = `採集: ${row.source}`; sub = U.formatTs(row.collectedAt); filterFn = () => false; }

    const matching = daily.filter(filterFn);
    const totals = U.aggregateTotals(matching);
    const byDate = U.groupByDate(matching);
    const dates = Array.from(byDate.keys()).sort();
    const values = dates.map(d => {
      let sum = 0;
      const sources = byDate.get(d);
      for (const k of Object.keys(sources)) sum += sources[k];
      return sum;
    });

    return { kind, row, title, sub, totals, dates, values, count: matching.length };
  }, [drill, daily]);

  return (
    <>
      <motion.div className={`drawer-backdrop motion-drawer-backdrop ${open ? 'open' : ''}`}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.18 }} onClick={onClose}/>
      <motion.div ref={drawerRef} tabIndex={-1} className="drawer motion-drawer" role="dialog" aria-modal="true" aria-label="用量詳情"
        initial={{ x: reduceMotion ? 0 : '100%', opacity: reduceMotion ? 0 : 1 }}
        animate={{ x: 0, opacity: 1 }} exit={{ x: reduceMotion ? 0 : '100%', opacity: reduceMotion ? 0 : 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}>
        {detail && (
          <>
            <div className="drawer-header" style={{position: 'relative'}}>
              <button className="drawer-close" onClick={onClose} aria-label="關閉詳情">
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <path d="M3 3l7 7M10 3l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
              <div style={{fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4}}>
                {detail.kind === 'source' && '來源詳情'}
                {detail.kind === 'model' && '模型詳情'}
                {detail.kind === 'session' && '專案詳情'}
                {detail.kind === 'run' && '採集詳情'}
              </div>
              <h3>{detail.title}</h3>
              <div className="sub">{detail.sub}</div>
              {detail.kind !== 'run' && <div className="sub">{rangeLabel} · 目前篩選範圍</div>}
            </div>
            <div className="drawer-body">
              {detail.kind !== 'run' ? (
                <>
                  <div className="drawer-kpi-row">
                    <div className="drawer-kpi">
                      <div className="l">Total</div>
                      <div className="v">{U.compactCN(detail.totals.totalTokens)}</div>
                    </div>
                    <div className="drawer-kpi">
                      <div className="l">費用</div>
                      <div className="v" style={{color: detail.totals.costUSD > 0 ? 'var(--c-amber)' : 'var(--muted)'}}>
                        {detail.totals.costUSD > 0 ? U.fmtUS.format(detail.totals.costUSD) : '—'}
                      </div>
                    </div>
                    <div className="drawer-kpi">
                      <div className="l">活躍天數</div>
                      <div className="v">{detail.dates.length}</div>
                    </div>
                  </div>

                  <div className="detail-section">
                    <h4>趨勢</h4>
                    <DrillSpark dates={detail.dates} values={detail.values}/>
                  </div>

                  <div className="detail-section">
                    <h4>分佈</h4>
                    <div className="detail-row"><span className="k">Input</span><span className="v">{U.fmt.format(detail.totals.inputTokens)}</span></div>
                    <div className="detail-row"><span className="k">Output</span><span className="v">{U.fmt.format(detail.totals.outputTokens)}</span></div>
                    <div className="detail-row"><span className="k">Cache Read</span><span className="v">{U.fmt.format(detail.totals.cacheReadTokens)}</span></div>
                    <div className="detail-row"><span className="k">Cache Creation</span><span className="v">{U.fmt.format(detail.totals.cacheCreationTokens)}</span></div>
                    <div className="detail-row"><span className="k">Reasoning</span><span className="v">{U.fmt.format(detail.totals.reasoningTokens)}</span></div>
                    <div className="detail-row"><span className="k">快取命中率</span><span className="v" style={{color:'var(--c-indigo)', fontWeight: 600}}>{detail.totals.cacheHitRate.toFixed(1)}%</span></div>
                  </div>

                  {eventQuery && <EventDetails key={JSON.stringify([eventQuery, revision])} query={eventQuery} />}
                  {detail.kind === 'session' && (
                    <div className="detail-section">
                      <h4>中繼資料</h4>
                      <div className="detail-row"><span className="k">Session ID</span><span className="v mono" style={{fontSize: 11, maxWidth: '60%', textAlign: 'right'}}>{detail.row.sessionId}</span></div>
                      <div className="detail-row"><span className="k">最後活動</span><span className="v">{detail.row.lastActivity}</span></div>
                    </div>
                  )}

                  {detail.kind === 'model' && (
                    <div className="detail-section">
                      <h4>記錄</h4>
                      <div className="detail-row"><span className="k">活躍天數</span><span className="v">{detail.row.dayCount}</span></div>
                    </div>
                  )}
                </>
              ) : (
                <div className="detail-section">
                  <h4>狀態</h4>
                  <div style={{padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12.5}}>
                    <span className={`status-badge status-${detail.row.status}`}>{detail.row.status}</span>
                    <p style={{margin: '10px 0 0', lineHeight: 1.6}}>{detail.row.message}</p>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </motion.div>
    </>
  );
}

// Small sparkline for drawer
function DrillSpark({ dates, values }) {
  if (!dates.length) return <div className="empty">無資料</div>;
  const w = 480, h = 120;
  const max = Math.max(...values, 1);
  const pad = 16;
  const pts = values.map((v, i) => {
    const x = pad + (i / Math.max(1, values.length - 1)) * (w - pad * 2);
    const y = h - pad - (v / max) * (h - pad * 2);
    return [x, y];
  });
  const d = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
  const dArea = d + ` L${w-pad},${h-pad} L${pad},${h-pad} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{width: '100%', height: 120, display: 'block'}}>
      <defs>
        <linearGradient id="drillGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.55 0.16 265)" stopOpacity="0.25"/>
          <stop offset="100%" stopColor="oklch(0.55 0.16 265)" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={dArea} fill="url(#drillGrad)"/>
      <path d={d} fill="none" stroke="oklch(0.55 0.16 265)" strokeWidth="2" strokeLinejoin="round"/>
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="2" fill="oklch(0.55 0.16 265)" opacity={i === pts.length - 1 ? 1 : 0}/>
      ))}
      <text x={pad} y={h - 2} fontSize="9" fill="oklch(0.62 0.005 80)" style={{fontFamily: 'var(--font-mono)'}}>{dates[0]}</text>
      <text x={w - pad} y={h - 2} textAnchor="end" fontSize="9" fill="oklch(0.62 0.005 80)" style={{fontFamily: 'var(--font-mono)'}}>{dates[dates.length - 1]}</text>
    </svg>
  );
}

export { TablePanel, DrillDrawer };
