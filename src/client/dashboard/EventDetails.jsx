import { useEffect, useRef, useState } from 'react';
import { fetchTimePage } from '../shared/usage-data.js';
import { U } from '../shared/utils.js';

// Mounted only for an open drawer. Keep one page of events in memory; totals
// and rankings come from the separate complete-range summary.
export function EventDetails({ query }) {
  const [cursors, setCursors] = useState([null]);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState({ time: [], nextCursor: null, loading: true, error: null });
  const cursor = cursors.at(-1);
  const wrap = useRef(null);
  useEffect(() => { if (wrap.current) wrap.current.scrollTop = 0; }, [state.time]);
  useEffect(() => {
    const controller = new AbortController();
    setState({ time: [], nextCursor: null, loading: true, error: null });
    fetchTimePage(query, { cursor, signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setState({ ...data, loading: false, error: null }); })
      .catch(error => { if (!controller.signal.aborted) setState({ time: [], nextCursor: null, loading: false, error: error.message }); });
    return () => controller.abort();
  }, [query, cursor, retry]);
  return <section className="detail-section" aria-label="事件明細">
    <h4>事件明細</h4>
    <p className="muted">每頁最多 50 筆，按時間遞增排序。上方統計包含完整篩選範圍。</p>
    {state.loading ? <p role="status">正在載入明細…</p> : state.error ? <p role="alert">明細載入失敗：{state.error} <button className="btn" onClick={() => setRetry(n => n + 1)}>重試明細</button></p> :
      <div ref={wrap} className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}><table className="dt">
        <thead><tr>{['時間', '來源 / 模型', '專案', 'Token', '費用'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{state.time.map(row => <tr key={row.id}>
          <td>{U.formatTs(row.eventTime)}</td><td>{row.source}<br/>{row.model}</td><td>{row.projectPath || '未歸屬專案'}</td>
          <td>{U.fmt.format(row.totalTokens)}</td><td>{U.fmtUS4.format(row.costUSD)}</td>
        </tr>)}{!state.time.length && <tr><td colSpan={5}>目前範圍沒有事件明細</td></tr>}</tbody>
      </table></div>}
    <nav className="table-pagination" aria-label="事件分頁">
      <span>第 {cursors.length} 頁{!state.loading && !state.error ? ` · 本頁 ${state.time.length} 筆` : ''}</span>
      <span className="table-pagination-actions">
        <button className="btn" disabled={state.loading || cursors.length === 1} onClick={() => setCursors(values => values.slice(0, -1))}>上一頁</button>
        <button className="btn" disabled={state.loading || !!state.error || !state.nextCursor} onClick={() => setCursors(values => [...values, state.nextCursor])}>下一頁</button>
      </span>
    </nav>
  </section>;
}
