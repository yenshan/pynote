import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, FolderOpen, Loader2, RefreshCw, X } from 'lucide-react';
import type { PythonEnvironment, PythonEnvironmentList, PythonEnvironmentOption } from './types';

export function PythonEnvironmentPicker({ folder,disabled,onError }:{ folder:string; disabled:boolean; onError:(error:unknown)=>void }) {
  const [current,setCurrent] = useState<PythonEnvironment|null>(null);
  const [open,setOpen] = useState(false);
  const [data,setData] = useState<PythonEnvironmentList|null>(null);
  const [loading,setLoading] = useState(false);
  const [applying,setApplying] = useState(false);
  const [error,setError] = useState('');
  const [manual,setManual] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef(0);
  useEffect(() => {
    let disposed = false;
    setCurrent(null); setOpen(false); setData(null);
    window.kata.pythonEnvironment().then(info => { if (!disposed && info.folder === folder) setCurrent(info); }).catch(onError);
    const unsubscribe = window.kata.onEvent(event => {
      if (event.type === 'python-environment-changed' && event.environment.folder === folder) setCurrent(event.environment);
    });
    return () => { disposed = true; request.current++; unsubscribe(); };
  },[folder,onError]);
  useEffect(() => { if (open) dialog.current?.showModal(); },[open]);
  async function refresh() {
    const version = ++request.current;
    setLoading(true); setError('');
    try {
      const result = await window.kata.pythonEnvironments();
      if (version === request.current && result.folder === folder) setData(result);
    } catch (reason) { if (version === request.current) setError(String(reason)); }
    finally { if (version === request.current) setLoading(false); }
  }
  function show() { setOpen(true); setManual(''); void refresh(); }
  async function apply(executable:string|null, browse=false) {
    setApplying(true); setError('');
    try {
      const info = browse ? await window.kata.choosePythonEnvironment() : await window.kata.selectPythonEnvironment(folder,executable);
      if (info) { setCurrent(info); setOpen(false); request.current++; }
    } catch (reason) { setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': Error: /,'') : String(reason)); }
    finally { setApplying(false); }
  }
  function selected(option:PythonEnvironmentOption) {
    return option.kind === 'default' ? !current?.selected : option.executable === current?.selected;
  }
  return <>
    <button className="python-environment-button" aria-label="Python環境を選択" title={current?.executable || 'Python環境を選択'} disabled={disabled} onClick={show}>
      <span><strong>Python 環境</strong><small>{current?.selected ? current.executable : `既定 · ${current?.executable || 'Python'}`}</small></span><ChevronDown size={13}/>
    </button>
    {open && <dialog ref={dialog} className="modal python-environment-modal" aria-labelledby="python-environment-title" onCancel={event => { if (applying) event.preventDefault(); else setOpen(false); }}>
      <button className="modal-close icon-button" aria-label="Python環境の設定を閉じる" disabled={applying} onClick={() => setOpen(false)}><X size={17}/></button>
      <h2 id="python-environment-title">Python 環境</h2>
      <p>このフォルダーで使う Python を選びます。切り替えると全ファイルの Python セッションを終了し、次の実行から選んだ環境を使います。編集中のコードは保持します。</p>
      <div className="environment-list-heading"><span>Jupyter 登録環境・選択履歴</span><button className="secondary-button" disabled={loading || applying} onClick={() => void refresh()}>{loading ? <Loader2 size={13} className="spin"/> : <RefreshCw size={13}/>}再取得</button></div>
      {loading && <p role="status">Python 環境を確認中…</p>}
      <div className="environment-options" aria-label="Python環境の一覧" aria-busy={loading}>
        {data?.environments.map((option,index) => <button key={`${option.kind}:${index}`} className={`environment-option ${selected(option) ? 'selected' : ''}`} disabled={!option.available || applying || loading} onClick={() => void apply(option.kind === 'default' ? null : option.executable)}>
          <span><strong>{option.label}{option.version && ` · Python ${option.version}`}</strong><small>{option.executable}</small><small>{option.kind === 'jupyter' ? 'Jupyter 登録環境' : option.kind === 'history' ? '履歴' : option.kind === 'default' ? '環境変数の指定、または PATH の Python' : 'このフォルダーで選択中'}</small>{option.error && <small className="environment-error">利用できません：{option.error}</small>}</span>{selected(option) && <Check size={15}/>}
        </button>)}
      </div>
      {!loading && data && !data.environments.some(option => option.kind === 'jupyter') && <p>Jupyter に登録された Python 環境は見つかりませんでした。実行ファイルを指定して利用できます。</p>}
      {data?.warnings.map((warning,index) => <p key={index} className="environment-error">{warning}</p>)}
      <form onSubmit={event => { event.preventDefault(); void apply(manual.trim()); }}>
        <label htmlFor="python-executable-path">Python 実行ファイルの絶対パス</label>
        <div className="environment-path"><input id="python-executable-path" value={manual} onChange={event => setManual(event.target.value)} placeholder="例：/path/to/.venv/bin/python" disabled={applying}/><button className="secondary-button" type="button" disabled={applying} onClick={() => void apply(null,true)}><FolderOpen size={14}/>参照…</button><button className="primary-button" disabled={applying || !manual.trim()} type="submit">適用</button></div>
        <p>venv 内の Python を指定すると、その環境のライブラリが使われます。activate や ipykernel の追加インストールは不要です。</p>
      </form>
      {applying && <p role="status">環境を切り替えています…</p>}
      {error && <p role="alert" className="environment-error">{error}</p>}
    </dialog>}
  </>;
}
