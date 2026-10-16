import { memo, useId, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { ArtifactWorkbenchHandle, ArtifactWorkbenchProps } from './types';
import './workbench.css';

export type { ArtifactRevision, ArtifactStage, ArtifactWorkbenchHandle, ArtifactWorkbenchProps } from './types';

const stageLabels: Readonly<Record<string, string>> = {
  queued: '等待处理', understanding: '正在理解需求', generating: '正在生成',
  building: '正在构建', checking: '正在检查', repairing: '正在修复',
  preparing: '正在读取当前场景', validating: '正在校验内容', reviewing: '正在核对规则', saving: '正在保存版本',
  ready: '已就绪', failed: '未能完成', cancelled: '已取消',
};

/** React never reconciles the island's children, including live sandbox frames. */
const CompatibilityIsland = memo(function CompatibilityIsland({ html, onContentMount }: Pick<ArtifactWorkbenchProps, 'html' | 'onContentMount'>) {
  const island = useRef<HTMLDivElement>(null);
  const mountCallback = useRef(onContentMount);
  mountCallback.current = onContentMount;
  useLayoutEffect(() => {
    const element = island.current!;
    element.innerHTML = html ?? '';
    return mountCallback.current?.(element);
  }, [html]);
  return <div className="artifact-workbench-content" data-artifact-content ref={island} />;
});

function ArtifactWorkbench(props: ArtifactWorkbenchProps) {
  const { title, summary, html = '', busy = false, stage, error, revisions = [], currentRevision, onRestore, onRetry, onCancel, onExport, onImport, onContentMount } = props;
  const [expanded, setExpanded] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const id = useId();
  const visible = Boolean(title || html || busy || error);
  const stageLabel = stage ? stageLabels[stage] : undefined;
  return <section className="artifact-workbench" data-artifact-workbench hidden={!visible} aria-labelledby={`${id}-title`}>
    <header className="artifact-workbench-header">
      <div className="artifact-workbench-heading">
        <p className="artifact-workbench-eyebrow">交互作品</p>
        <h3 id={`${id}-title`}>{title || '交互工作区'}</h3>
        {summary && <p className="artifact-workbench-summary">{summary}</p>}
      </div>
      <nav className="artifact-workbench-actions" aria-label="作品操作">
        {onExport && revisions.length>0 && <button type="button" disabled={busy} onClick={()=>void onExport()}>导出作品</button>}
        {onImport && <label className="artifact-workbench-import">导入作品<input aria-label="导入交互作品" type="file" accept=".json,application/json" disabled={busy} onChange={event=>{const file=event.currentTarget.files?.[0];if(file)void onImport(file);event.currentTarget.value='';}} /></label>}
        {revisions.length > 0 && <button type="button" aria-expanded={historyOpen} aria-controls={`${id}-history`} onClick={() => setHistoryOpen(value => !value)}>版本历史</button>}
        <button type="button" aria-expanded={expanded} aria-controls={`${id}-body`} onClick={() => setExpanded(value => !value)}>{expanded ? '收起作品' : '展开作品'}</button>
      </nav>
    </header>
    {(busy || stageLabel) && <div className="artifact-workbench-progress">
      <p className="artifact-workbench-status" role="status" aria-live="polite" data-busy={busy}>{stageLabel || '正在处理'}</p>
      {busy && onCancel && <button type="button" className="artifact-workbench-cancel" onClick={() => void onCancel()}>取消生成</button>}
    </div>}
    {error && <div className="artifact-workbench-error" role="alert">
      <p>{error}</p>
      {onRetry && <button type="button" disabled={busy} onClick={() => void onRetry()}>重试</button>}
    </div>}
    <div className="artifact-workbench-history" id={`${id}-history`} hidden={!historyOpen || revisions.length === 0}>
      <h4>版本历史</h4>
      <ol>
        {revisions.map((revision, index) => <li key={revision.id} aria-current={revision.id === currentRevision ? 'true' : undefined}>
          <div><strong>{revision.title || `版本 ${index + 1}`}</strong>{revision.reason && <p>{revision.reason}</p>}{revision.createdAt && <time dateTime={revision.createdAt}>{revision.createdAt}</time>}</div>
          {revision.id === currentRevision ? <span className="artifact-workbench-current">当前版本</span> : <button type="button" aria-label={`恢复版本 ${index + 1}`} disabled={busy || !onRestore} onClick={() => void onRestore?.(revision.id)}>恢复</button>}
        </li>)}
      </ol>
    </div>
    <div id={`${id}-body`} hidden={!expanded}>
      <CompatibilityIsland html={html} onContentMount={onContentMount} />
    </div>
  </section>;
}

/** The host owns this element exclusively until dispose(). No browser work runs on import. */
export function mountArtifactWorkbench(element: HTMLElement, props: ArtifactWorkbenchProps = {}): ArtifactWorkbenchHandle {
  const root = createRoot(element);
  let disposed = false;
  const update = (nextProps: ArtifactWorkbenchProps) => {
    if (disposed) return;
    flushSync(() => root.render(<ArtifactWorkbench {...nextProps} />));
  };
  update(props);
  return {
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      flushSync(() => root.unmount());
    },
  };
}
