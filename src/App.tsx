import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Search, ChevronDown, Check, Circle, Command, FolderOpen, Loader2, PanelLeftClose, PanelLeftOpen, Play, RotateCcw, Save, Sparkles, Terminal, X, CheckCheck, Type, PanelBottom, PanelRight } from 'lucide-react';
import { AssistantPanel } from './AssistantPanel';
import { Editor } from './Editor';
import { PipInstallDialog } from './PipInstallDialog';
import { PythonEnvironmentPicker } from './PythonEnvironmentPicker';
import { PythonTerminal, type TerminalHandle } from './PythonTerminal';
import { SidebarResizer } from './SidebarResizer';
import { FontSettings } from './FontSettings';
import { fontSettingsKey, loadFontSettings } from './fonts';
import { editorThemeKey, loadEditorTheme } from './editorThemes';
import { usePaneNavigation } from './usePaneNavigation';
import type { PythonReport } from './types';
import { useWorkspace } from './useWorkspace';
import { useAssistant } from './useAssistant';
import { usePython } from './usePython';
import type { PythonLoadState } from './usePython';

const api = window.kata;
const fileDate = (value:string) => new Date(value).toLocaleDateString('ja-JP', { year:'numeric', month:'2-digit', day:'2-digit' });
function Logo({ small = false }:{ small?:boolean }) { return <span className={`python-logo ${small?'small':''}`}>Py</span>; }

type SidebarWidths = { left:number; right:number };
const noInlineDiagnostics:PythonReport['diagnostics'] = [];
function initialSidebarWidths():SidebarWidths {
  const fallback = { left:window.innerWidth >= 1500 ? 254 : window.innerWidth <= 1200 ? 216 : 244,right:window.innerWidth >= 1500 ? 380 : 330 };
  try {
    const saved = JSON.parse(localStorage.getItem('kata-sidebar-widths') || 'null');
    return { left:Number.isFinite(saved?.left) ? Math.max(180,Math.min(480,saved.left)) : fallback.left,
      right:Number.isFinite(saved?.right) ? Math.max(280,Math.min(640,saved.right)) : fallback.right };
  } catch { return fallback; }
}
function initialAssistantOpen() {
  try { return localStorage.getItem('kata-ai-sidebar-open') !== 'off'; } catch { return true; }
}

export function App() {
  const [toast,setToast] = useState('');
  const [pipBusy,setPipBusy] = useState(false);
  const notify = useCallback((error:unknown) => setToast(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /,'') : String(error)), []);
  const terminalRef = useRef<TerminalHandle>(null);
  const workspace = useWorkspace(notify);
  const { items,problem,code,dirty,saving,folder,choosingFolder,loading,open,changeCode } = workspace;
  const assistant = useAssistant(workspace,notify);
  const { model,effort,aiBusy } = assistant;
  const { sessionEpoch,diagnostics,busy,loads,dead,generation,run,clearLoadMessages,setAlive } = usePython(workspace,terminalRef,model,effort);
  const save = useCallback(async () => {
    const target = workspace.documentRef.current.problem?.id;
    const epoch = workspace.folderEpoch.current;
    await workspace.save();
    if (target && epoch === workspace.folderEpoch.current) clearLoadMessages(target);
  },[workspace.save,clearLoadMessages]);
  const [query,setQuery] = useState('');
  const [newOpen,setNewOpen] = useState(false); const [newTitle,setNewTitle] = useState('');
  const [left,setLeft] = useState(true);
  const [right,setRight] = useState(initialAssistantOpen);
  const [pythonSide,setPythonSide] = useState(() => {
    try { return localStorage.getItem('kata-python-layout') === 'side'; } catch { return false; }
  });
  const [preferredPythonWidth,setPreferredPythonWidth] = useState(() => {
    try { const saved = Number(localStorage.getItem('kata-python-width')); return saved >= 220 && saved <= 1200 ? saved : 380; } catch { return 380; }
  });
  const [preferredWidths,setPreferredWidths] = useState(initialSidebarWidths);
  const [layoutWidth,setLayoutWidth] = useState(window.innerWidth);
  const layoutRef=useRef<HTMLDivElement>(null);
  const leftMax = Math.max(180,Math.min(480,layoutWidth-467));
  const leftWidth = left ? Math.min(preferredWidths.left,leftMax) : 42;
  const workspaceWidth = layoutWidth-leftWidth-(left ? 5 : 0)-42;
  const rightMax = Math.max(280,Math.min(640,workspaceWidth+42));
  const assistantWidth = Math.min(preferredWidths.right,rightMax);
  const pythonMax = Math.max(220,workspaceWidth-225);
  const pythonWidth = Math.min(preferredPythonWidth,pythonMax);
  const [vimEnabled,setVimEnabled] = useState(() => localStorage.getItem('kata-vim') === 'on');
  const [fontSettings,setFontSettings] = useState(loadFontSettings);
  const [editorTheme,setEditorTheme] = useState(loadEditorTheme);
  const [fontSettingsOpen,setFontSettingsOpen] = useState(false);
  const [mode,setMode] = useState('NORMAL'); const [cursor,setCursor] = useState([1,1]);
  const [help,setHelp] = useState(false);
  const questionInput = useRef<HTMLInputElement>(null); const split = useRef<HTMLDivElement>(null);
  const id = problem?.id || '';
  const lastError = diagnostics[id];
  const loadState = loads[id];
  const [dismissedLoadStatus,setDismissedLoadStatus] = useState<PythonLoadState|null>(null);
  useEffect(() => {
    if (!loadState || loadState.phase !== 'done') return;
    const report = loadState.report;
    // Keep messages that cannot be read again as inline explanations until dismissed.
    if (!report || (!report.success && (!report.diagnostics.length || report.diagnostics.some(d => (d.displayLine ?? d.line) <= 0 || !d.explanation)))) return;
    const timer = setTimeout(() => setDismissedLoadStatus(loadState),6500);
    return () => clearTimeout(timer);
  },[loadState]);
  useEffect(() => {
    try { localStorage.setItem(fontSettingsKey,JSON.stringify(fontSettings)); }
    catch { notify('フォント設定を保存できませんでした。'); }
  },[fontSettings,notify]);
  useEffect(() => {
    try { localStorage.setItem(editorThemeKey,editorTheme); }
    catch { notify('配色テーマを保存できませんでした。'); }
  },[editorTheme,notify]);
  useEffect(() => {
    const layout=layoutRef.current; if (!layout) return;
    const update=() => setLayoutWidth(layout.clientWidth);
    update(); const observer=new ResizeObserver(update); observer.observe(layout);
    return () => observer.disconnect();
  },[]);
  useEffect(() => {
    const timer=setTimeout(() => { try { localStorage.setItem('kata-sidebar-widths',JSON.stringify(preferredWidths)); } catch {} },200);
    return () => clearTimeout(timer);
  },[preferredWidths]);
  useEffect(() => {
    try { localStorage.setItem('kata-python-width',String(preferredPythonWidth)); } catch {}
  },[preferredPythonWidth]);
  useEffect(() => {
    try { localStorage.setItem('kata-python-layout',pythonSide ? 'side' : 'bottom'); } catch {}
  },[pythonSide]);
  useEffect(() => {
    try { localStorage.setItem('kata-ai-sidebar-open',right ? 'on' : 'off'); } catch {}
  },[right]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''),6500); return () => clearTimeout(t); }, [toast]);
  const focusPython = useCallback(() => {
    setRight(false);
    requestAnimationFrame(() => terminalRef.current?.focus());
  },[]);
  useEffect(() => {
    const loadKey = (event:KeyboardEvent) => {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing || document.querySelector('dialog[open],.modal-backdrop')) return;
      // Handle this before Vim and xterm consume Enter or turn it into input.
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) void run();
    };
    window.addEventListener('keydown',loadKey,true);
    return () => window.removeEventListener('keydown',loadKey,true);
  },[run]);
  useEffect(() => {
    const close = (event:KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || !right || document.querySelector('dialog[open],.modal-backdrop')) return;
      event.preventDefault(); setRight(false);
      if (document.activeElement?.closest('#assistant-panel')) requestAnimationFrame(() => document.querySelector<HTMLElement>('.cm-content')?.focus());
    };
    window.addEventListener('keydown',close); return () => window.removeEventListener('keydown',close);
  },[right]);
  useEffect(() => {
    const handler = (e:KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (e.defaultPrevented || !(e.metaKey || e.ctrlKey)) return;
      if ((e.target as HTMLElement).closest('.python-terminal') && !e.metaKey && !e.shiftKey) return;
      if (e.key === 's') { e.preventDefault(); save().catch(notify); }
      if (e.key === 'n') { e.preventDefault(); setNewOpen(true); }
      if (e.key.toLowerCase() === 'j' && (e.metaKey || e.shiftKey)) { e.preventDefault(); focusPython(); }
      if (e.key === '/') { e.preventDefault(); setHelp(prev => !prev); }
    };
    window.addEventListener('keydown',handler); return () => window.removeEventListener('keydown',handler);
  }, [save,run,notify,focusPython]);
  async function create() {
    if (await workspace.create(newTitle)) { setNewOpen(false); setNewTitle(''); }
  }
  usePaneNavigation(() => { if (lastError) void run(false,id); },pythonSide,pane => {
    setRight(pane === 'assistant');
  });
  async function chooseFolder() {
    if (await workspace.chooseFolder()) setQuery('');
  }
  function resize(e:React.PointerEvent) {
    e.preventDefault(); const element = split.current; if (!element) return;
    const rect = element.getBoundingClientRect();
    const move = (event:PointerEvent) => { const ratio = Math.max(25,Math.min(78,(event.clientY - rect.top) / rect.height * 100)); element.style.setProperty('--editor-height',`${ratio}%`); };
    const end = () => { document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',end); document.body.classList.remove('resizing'); };
    document.body.classList.add('resizing'); document.addEventListener('pointermove',move); document.addEventListener('pointerup',end);
  }
  const filtered = items.filter(x => x.fileName.toLowerCase().includes(query.toLowerCase()));
  if (!api) return <div className="browser-notice"><Logo/><h1>PyNote</h1><p>このアプリはElectronで起動してください。</p><code>npm run dev</code></div>;
  return <div className="app">
    <div className="layout" ref={layoutRef}>
      <aside className={`sidebar ${left ? '' : 'collapsed'}`} id="file-sidebar" aria-label="ファイルサイドバー" style={{ width:leftWidth }}>
        <div className="sidebar-heading"><span hidden={!left}>FILES</span><button className="icon-button" title={left ? 'サイドバーを閉じる' : 'サイドバーを開く'} aria-label={left ? 'サイドバーを閉じる' : 'サイドバーを開く'} aria-expanded={left} aria-controls="file-sidebar-content" onClick={() => setLeft(!left)}>{left ? <PanelLeftClose size={15}/> : <PanelLeftOpen size={15}/>}</button></div>
        <div className="sidebar-content" id="file-sidebar-content" hidden={!left}>
        <button className="folder-setting" aria-label="フォルダー設定" title={folder?.path || 'フォルダーを選択'} disabled={choosingFolder || pipBusy} onClick={() => void chooseFolder()}>{choosingFolder?<Loader2 className="spin" size={15}/>:<FolderOpen size={15}/>}<span><strong>{folder?.name || 'フォルダーを設定'}</strong><small>{folder?.path || '.py ファイルの保存先を選択'}</small></span><ChevronDown size={12}/></button>
        <PythonEnvironmentPicker folder={folder?.path || ''} disabled={choosingFolder || pipBusy || Object.values(busy).some(Boolean)} onError={notify}/>
        <PipInstallDialog folder={folder?.path || ''} disabled={choosingFolder} onBusyChange={setPipBusy}/>
        <button className="new-button" onClick={() => setNewOpen(true)}><Plus size={16}/><span>新しいファイル</span><kbd>⌘ N</kbd></button>
        <label className="search-box"><Search size={14}/><input aria-label="ファイルを検索" placeholder="ファイルを検索…" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button className="icon-button" aria-label="検索をクリア" onClick={() => setQuery('')}><X size={12}/></button>}</label>
        <div className="problem-list">{filtered.map(item => <button key={item.id} title={item.fileName} data-problem-id={item.id} aria-current={item.id===id?'page':undefined} onClick={() => void open(item.id)} className={`problem-item ${item.id===id?'selected':''}`}><span className="file-name">{item.fileName}</span><time className="file-date" dateTime={item.updatedAt} title="更新日">{fileDate(item.updatedAt)}</time></button>)}{!filtered.length && <div className="list-empty">ファイルが見つかりません</div>}</div>
        </div>
        <div className="sidebar-bottom"><button title="エディタ設定（フォント・配色）" aria-label="エディタ設定" className="sidebar-settings" onClick={() => setFontSettingsOpen(true)}><Type size={16}/><span hidden={!left}>フォント・配色設定</span></button></div>
      </aside>
      {left && <SidebarResizer side="left" controls="file-sidebar" width={leftWidth} min={180} max={leftMax} onResize={width => setPreferredWidths(prev => ({ ...prev,left:width }))}/>}
      <div className="workspace-area">
      <main className="main-workspace">
        {problem ? <>
        <div ref={split} className={`split-workspace ${pythonSide ? 'python-at-side' : ''}`}>
          <section className="editor-panel"><div className="editor-tabs"><div className="editor-tab"><Logo small/><span>{problem.fileName}</span>{dirty ? <span className="dirty-dot"/> : <span className="tab-saved"><Check size={12}/></span>}</div><div className="editor-tools"><button className="load-button" aria-label="Pythonで実行" title="保存してPythonで実行・エラーをAI解析 (⌘Enter)" disabled={busy[id]} onClick={() => void run()}>{busy[id] ? <Loader2 size={12} className="spin"/> : <CheckCheck size={12}/>}<span>Python実行</span><kbd>⌘ ↵</kbd></button><span className="tool-divider"/><button className={`vim-toggle ${vimEnabled?'on':''}`} onClick={() => { setVimEnabled(!vimEnabled); localStorage.setItem('kata-vim',vimEnabled?'off':'on'); }} title="Vimキーバインドを切り替え">vim <span>{vimEnabled?'ON':'OFF'}</span></button><span className="tool-divider"/><button title={dirty ? '未保存の変更を保存 (⌘S / :w)' : '保存 (⌘S / :w)'} className={`icon-button save-button ${dirty ? 'unsaved' : ''}`} onClick={() => save().catch(notify)}><Save size={14}/></button></div></div>
          <Editor id={id} code={code} diagnostics={loadState?.report?.diagnostics || noInlineDiagnostics} vimEnabled={vimEnabled} fontSettings={fontSettings} theme={editorTheme} onChange={changeCode} onSave={() => save().catch(notify)} onRun={() => void run()} onError={notify} onMode={setMode} onCursor={(line,col) => setCursor([line,col])}/>
          </section>
          {!pythonSide && <div className="split-handle" role="separator" aria-label="エディタと下部パネルの高さを調整" aria-orientation="horizontal" aria-valuemin={25} aria-valuemax={78} aria-valuenow={60} tabIndex={0} onPointerDown={resize} onKeyDown={e => { if (!['ArrowUp','ArrowDown'].includes(e.key)) return; e.preventDefault(); const el=split.current; if (el) el.style.setProperty('--editor-height', `${Math.max(25,Math.min(78,parseFloat(el.style.getPropertyValue('--editor-height') || '60')+(e.key==='ArrowDown'?3:-3)))}%`); }}><span/></div>}
          {pythonSide && <SidebarResizer side="right" controls="python-panel" label="Pythonの幅を調整" width={pythonWidth} min={220} max={pythonMax} onResize={setPreferredPythonWidth}/>}
          <section id="python-panel" className="lower-pane python-panel" aria-labelledby="python-heading" style={pythonSide ? { width:pythonWidth,flex:'0 0 auto' } : undefined}>
            <div className="lower-header"><h2 id="python-heading"><Terminal size={13}/>Python</h2>
              <div className="python-tools"><button className="icon-button" aria-label={pythonSide ? 'Pythonをエディタの下に移動' : 'Pythonをエディタの右に移動'} title={pythonSide ? 'Pythonをエディタの下に移動' : 'Pythonをエディタの右に移動'} onClick={() => setPythonSide(!pythonSide)}>{pythonSide ? <PanelBottom size={14}/> : <PanelRight size={14}/>}</button>{lastError && <button className="ask-error-button" aria-label="Pythonのエラーを解析" title="Pythonのエラーを裏でAI解析 (Ctrl-J → e)" disabled={busy[id]} onClick={() => void run(false,id)}><Sparkles size={12}/><span>エラーを解析</span></button>}<button className="run-button" title="Pythonを起動して実行／再実行・エラーをAI解析 (⌘Enter)" disabled={busy[id]} onClick={() => void run()}>{busy[id]?<Loader2 className="spin" size={12}/>:<Play size={11} fill="currentColor"/>}<span>{dead[id] === false ? '再実行' : '実行'}</span><kbd>⌘ ↵</kbd></button><button title="Pythonを再起動" className="icon-button" disabled={busy[id]} onClick={() => void run(true)}><RotateCcw size={13}/></button></div>
            </div>
            <PythonTerminal key={`${id}:${sessionEpoch}`} ref={terminalRef} id={id} generation={generation[id] || 0} onError={notify} onState={alive => setAlive(id,alive)}/>
          </section>
        </div></> : <div className="workspace-empty"><Logo/><h2>{loading?'ワークスペースを読み込み中…':'.py ファイルを選択するか、新しく作成してください。'}</h2><button className="new-button" onClick={() => setNewOpen(true)}><Plus size={16}/>新しいファイル</button></div>}
      </main>
      {!right && <button className="assistant-launcher" title="AIアシスタントを開く" aria-label="AIサイドバーを開く" aria-expanded={false} aria-controls="assistant-panel" onClick={() => { setRight(true); requestAnimationFrame(() => questionInput.current?.focus()); }}><span className="assistant-launcher-label" aria-hidden="true">AI</span>{aiBusy && <Loader2 size={12} className="spin"/>}</button>}
      <div className="assistant-overlay" style={{ width:assistantWidth }} hidden={!right}>
        <SidebarResizer side="right" controls="assistant-panel" label="AIアシスタントの幅を調整" className="assistant-resizer" width={assistantWidth} min={280} max={rightMax} onResize={width => setPreferredWidths(prev => ({ ...prev,right:width }))}/>
        <AssistantPanel assistant={assistant} id={id} open={right} onClose={() => setRight(false)} questionInput={questionInput} onError={notify}/>
      </div>
      </div>
    </div>
    <footer className="app-status">
      <div><span className="connection-dot"/><span>Local workspace</span>{problem && <><span className="footer-divider"/><span className={`mode-indicator ${mode.toLowerCase()}`}>{mode}</span><span>{vimEnabled?'Vim keybindings':'Standard keybindings'}</span></>}</div>
      <div>{problem && <><span>Ln {cursor[0]}, Col {cursor[1]}</span><span>UTF-8</span><Logo small/><span>Python</span><span className="footer-divider"/></>}{saving?<><Loader2 size={11} className="spin"/>保存中</>:dirty?<><Circle size={7}/>未保存</>:<><CheckCheck size={12}/>すべて保存済み</>}</div>
    </footer>
    {loadState && loadState !== dismissedLoadStatus && !(loadState.phase === 'done' && loadState.report?.success) && <div className="python-status-popup" role="status" aria-live="polite" aria-atomic="true" aria-label="Pythonの処理状況">
      {loadState.phase === 'loading' || loadState.phase === 'analyzing' ? <Loader2 size={16} className="spin"/> : <Sparkles size={16}/>}
      <div className="python-status-message">
      <span>{loadState.phase === 'loading' ? 'Pythonで実行中…' : loadState.phase === 'analyzing' ? 'PythonのエラーをAIが解析中…' : loadState.note || `Pythonでエラー${loadState.report?.diagnostics.some(d => d.severity === 'error') ? ` · ${loadState.report.diagnostics.filter(d => d.severity === 'error').length}件のエラー` : ' · Pythonの出力を確認してください'}`}{loadState.phase === 'done' && loadState.report?.diagnostics.some(d => (d.displayLine ?? d.line) > 0 && d.explanation) && ' · AIの説明を該当行に表示しています'}</span>
      {loadState.report?.diagnostics.filter(d => (d.displayLine ?? d.line) === 0 && d.explanation).map((d,index) => <p key={index}>{d.explanation}</p>)}
      </div>
      <button className="icon-button" aria-label="Pythonの通知を閉じる" onClick={() => setDismissedLoadStatus(loadState)}><X size={14}/></button>
    </div>}
    {toast && <div className="toast" role="status"><span>{toast}</span><button className="icon-button" aria-label="通知を閉じる" onClick={() => setToast('')}><X size={14}/></button></div>}
    {fontSettingsOpen && <FontSettings settings={fontSettings} theme={editorTheme} onThemeChange={setEditorTheme} onChange={setFontSettings} onClose={() => setFontSettingsOpen(false)}/>}
    {newOpen && <div className="modal-backdrop" onMouseDown={e => { if (e.target===e.currentTarget) setNewOpen(false); }}><form className="modal new-modal" onSubmit={e => { e.preventDefault(); void create(); }}><button type="button" className="modal-close icon-button" aria-label="閉じる" onClick={() => setNewOpen(false)}><X size={17}/></button><Logo/><span className="eyebrow">NEW PYTHON FILE</span><h2>新しいファイル</h2><p>選択中のフォルダーに .py ファイルを作成します。</p><label>ファイル名<input autoFocus placeholder="例：SumOfOddNumbers.py" value={newTitle} onChange={e => setNewTitle(e.target.value)} maxLength={160}/></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setNewOpen(false)}>キャンセル</button><button className="primary-button" type="submit"><Plus size={14}/>ファイルを作成</button></div></form></div>}
    {help && <div className="modal-backdrop" onMouseDown={e => { if (e.target===e.currentTarget) setHelp(false); }}><div className="modal help-modal"><button className="modal-close icon-button" aria-label="ヘルプを閉じる" onClick={() => setHelp(false)}><X size={17}/></button><Command size={23}/><h2>キーボードで、軽やかに。</h2>{[['新しいファイル','⌘ N'],['ファイルを保存','⌘ S / :w'],['Pythonで実行／再読込・エラーをAI解析','⌘ Enter / ⌘ ⇧ Enter'],['領域移動（左 / 下 / 上 / 右）','Ctrl J → h / j / k / l'],['Pythonのエラーを裏でAI解析','Ctrl J → e'],['Pythonにフォーカス','⌘ J / Ctrl Shift J'],['ファイル内の単語で補完','Ctrl Space / Tab / Enter'],['Vim 挿入 / ノーマルモード','i / Esc'],['Vim 検索 / 元に戻す','/ / u'],['Python 実行を中断','Ctrl C'],['このヘルプ','⌘ /']].map(([label,key]) => <div className="shortcut" key={label}><span>{label}</span><kbd>{key}</kbd></div>)}<p>Windows / Linux では ⌘ の代わりに Ctrl を使用します。領域移動は全OS共通です。</p></div></div>}
  </div>;
}
