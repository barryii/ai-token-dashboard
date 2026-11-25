import { U } from '../shared/utils.js';
import { useRef } from 'react';
import { Info, Question, X } from '@phosphor-icons/react';

export function InfoButton({ label, children }) {
  const ref = useRef(null);
  return <span className="metric-info">
    <button className="info-button" aria-label={label + '說明'} onClick={() => ref.current.showModal()}><Info size={17}/></button>
    <dialog ref={ref} className="metric-dialog" aria-label={label + '說明'} onClick={e => { if (e.target === ref.current) ref.current.close(); }}>
      <div className="help-heading"><h2>{label}</h2><button className="info-button" aria-label="關閉說明" onClick={() => ref.current.close()}><X size={20}/></button></div>
      <p>{children}</p>
    </dialog>
  </span>;
}

export function UsageNotes({ rows, pricing }) {
  const ref = useRef(null);
  const models = [...new Set(rows.filter(r => r.totalTokens > 0).map(r => r.model))];
  const unmatched = models.filter(model => pricing?.models?.[model] === false);
  const unchecked = models.filter(model => typeof pricing?.models?.[model] !== 'boolean');
  const timestamp = pricing?.primarySnapshotAt;
  const date = timestamp ? new Date(timestamp) : null;
  return <>
    <button className="btn help-trigger" onClick={() => ref.current.showModal()}><Question size={19}/>說明</button>
    <dialog ref={ref} className="help-dialog" aria-labelledby="usage-help-title" onClick={e => { if (e.target === ref.current) ref.current.close(); }}>
    <div className="help-heading"><div><h2 id="usage-help-title">說明與資料說明</h2><p className="muted">了解數字背後的計算方式</p></div><button className="info-button" aria-label="關閉說明" onClick={() => ref.current.close()}><X size={22}/></button></div>
    <div className="usage-notes-grid">
      <section><h3>Token 怎麼算</h3>
        <p>總 Token 彙總採集記錄中的總量；不同工具可能包含快取或未細分用量，不能簡單把所有展示項再次相加。</p>
        <p>輸出是模型生成的用量。部分工具的推理 Token 已包含在輸出中，不重複累加。</p>
      </section>
      <section><h3>快取怎麼算</h3>
        <p>快取 = 快取讀取 + 快取建立；命中率 = 快取讀取 ÷ 總 Token。快取節省費用是估算，不是實際退款。</p>
      </section>
      <section><h3>資料完整性</h3>
        <p>專案歸屬和最後活動來自事件明細，不按最大專案推算。缺少明細的歷史用量不會分配給某個專案。</p>
        <p>目前範圍有 {rows.filter(r => ['legacy_unknown', 'unknown'].includes(r.costBasis)).length} 組費用未儲存完整計價依據；{rows.filter(r => r.reconciliation === 'missing_details').length} 組彙總缺少明細，{rows.filter(r => ['token_difference', 'cost_difference'].includes(r.reconciliation)).length} 組彙總與明細存在差異。不同費用基準保留原值，不自動重算。</p>
      </section>
      <section><h3>匯出 CSV</h3>
        <p>用量明細按目前篩選下載，不包含上一週期比較資料。請在瀏覽器下載清單查看進度、失敗原因或取消下載。</p>
        <p>需要核對固定結果時，請等採集和同步完成後再匯出；下載期間的資料更新可能影響結果。</p>
      </section>
      <section><h3>費用不是帳單</h3>
        <p>顯示已有記錄的費用彙總，可能來自工具記錄或價格估算；舊記錄未儲存計價依據時標為未知基準，不等同於訂閱支出或實際帳單。本頁不會按新價格重算歷史記錄。新增漏算用量單獨補入，既有費用保留。</p>
        <p>主價格目錄快照：{date && Number.isFinite(date.getTime()) ? U.formatTs(date.toISOString()) : '更新時間未知'}。不代表所有模型價格的生效時間或歷史記錄的計價版本。</p>
        <p>未比對到價格且沒有已記錄費用的用量無法估價，總費用可能不完整；零費用不一定代表免費。</p>
        {unmatched.length > 0 && <p>目前未比對到價格：{unmatched.join('、')}。已有費用仍保留。</p>}
        {unchecked.length > 0 && <p>價格狀態待確認：{unchecked.join('、')}。</p>}
      </section>
    </div>
    </dialog>
  </>;
}
