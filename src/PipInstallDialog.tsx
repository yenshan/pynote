import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, X } from 'lucide-react';
import type { PipJob, PythonEnvironment } from './types';

export function PipInstallDialog({ folder,disabled,onBusyChange }:{ folder:string; disabled:boolean; onBusyChange:(busy:boolean)=>void }) {
  const [open,setOpen] = useState(false);
  const [environment,setEnvironment] = useState<PythonEnvironment|null>(null);
  const [name,setName] = useState('');
  const [job,setJob] = useState<PipJob|null>(null);
  const [starting,setStarting] = useState(false);
  const [error,setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const output = useRef<HTMLPreElement>(null);
  const running = job?.status === 'running';
  const valid = name.length <= 200 && /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i.test(name.trim());
  function receive(next:PipJob|null) {
    if (next) setJob(previous => previous?.id === next.id && previous.seq > next.seq ? previous : next);
  }
  useEffect(() => {
    let disposed = false;
    setEnvironment(null); setOpen(false); setJob(null);
    window.kata.pythonEnvironment().then(info => { if (!disposed && info.folder === folder) setEnvironment(info); }).catch(reason => { if (!disposed) setError(String(reason)); });
    window.kata.pipStatus().then(info => {
      if (!disposed && info?.folder === folder) setJob(previous => previous || info);
    }).catch(reason => { if (!disposed) setError(String(reason)); });
    const unsubscribe = window.kata.onEvent(event => {
      if (event.type === 'pip-install' && event.job.folder === folder) receive(event.job);
      if (event.type === 'python-environment-changed' && event.environment.folder === folder) { setEnvironment(event.environment); setJob(null); }
    });
    return () => { disposed = true; unsubscribe(); };
  },[folder]);
  useEffect(() => { onBusyChange(Boolean(running || starting)); },[running,starting,onBusyChange]);
  useEffect(() => { if (open) dialog.current?.showModal(); },[open]);
  useEffect(() => { if (output.current) output.current.scrollTop = output.current.scrollHeight; },[job?.output,open]);
  const message = (reason:unknown) => reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': Error: /,'') : String(reason);
  async function install() {
    if (!environment || !valid || running || starting) return;
    setStarting(true); setError('');
    try { receive(await window.kata.pipInstall(folder,environment.executable,name.trim())); }
    catch (reason) { setError(message(reason)); }
    finally { setStarting(false); }
  }
  async function cancel() {
    if (!job) return;
    try { receive(await window.kata.pipCancel(job.id)); }
    catch (reason) { setError(message(reason)); }
  }
  return <>
    <button className="pip-install-button" aria-label="パッケージをインストール" disabled={disabled || !environment} onClick={() => { setError(''); setOpen(true); }}>
      {running ? <Loader2 size={14} className="spin"/> : <Download size={14}/>}<span>{running ? 'インストール中…' : 'パッケージを追加'}</span>
    </button>
    {open && <dialog ref={dialog} className="modal pip-install-modal" aria-labelledby="pip-install-title" onCancel={() => setOpen(false)}>
      <button className="modal-close icon-button" aria-label="インストールダイアログを閉じる" onClick={() => setOpen(false)}><X size={17}/></button>
      <h2 id="pip-install-title">パッケージをインストール</h2>
      <p>選択中の Python 環境にインストールします。</p>
      <div className="pip-install-target"><span>インストール先</span><code>{running ? job.executable : environment?.executable}</code></div>
      <form onSubmit={event => { event.preventDefault(); void install(); }}>
        <label htmlFor="pip-package-name">パッケージ名</label>
        <input id="pip-package-name" autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="例：numpy" maxLength={200} disabled={running || starting} autoComplete="off" spellCheck={false}/>
        <p>パッケージ名を1つ入力してください。例：numpy、pandas、scikit-learn</p>
        <div className="modal-actions">
          {running && <button className="secondary-button" type="button" onClick={() => void cancel()}>中止</button>}
          <button className="primary-button" type="submit" disabled={!valid || running || starting}>{running || starting ? <Loader2 size={13} className="spin"/> : <Download size={13}/>}インストール</button>
        </div>
      </form>
      {job && <div className="pip-install-result">
        <p role="status">{job.packageName}：{job.status === 'running' ? 'インストール中（閉じても処理は続きます）' : job.status === 'success' ? 'インストール完了' : job.status === 'cancelled' ? '中止しました' : 'インストール失敗'}</p>
        <pre ref={output} className="pip-install-output" aria-label="インストールの出力">{job.output}</pre>
      </div>}
      {error && <p role="alert" className="environment-error">{error}</p>}
    </dialog>}
  </>;
}
