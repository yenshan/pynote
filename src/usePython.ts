import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { Diagnostic, PythonReport } from './types';
import type { TerminalHandle } from './PythonTerminal';
import type { WorkspaceState } from './useWorkspace';
const api = window.kata;
export type PythonLoadState = { source:string; phase:'loading'|'analyzing'|'done'|'error'; report?:PythonReport; note?:string };

export function usePython(workspace:WorkspaceState, terminalRef:RefObject<TerminalHandle|null>, model:string, effort:string) {
  const { items,documentRef,folderEpoch,workspaceVersion,save } = workspace;
  const [diagnostics,setDiagnostics] = useState<Record<string,Diagnostic>>({}); const [busy,setBusy] = useState<Record<string,boolean>>({});
  const [loads,setLoads] = useState<Record<string,PythonLoadState>>({});
  const runtimeEpoch = useRef(0);
  const [sessionEpoch,setSessionEpoch] = useState(0);
  const loadVersions = useRef<Record<string,number>>({});
  const loadingPython = useRef(new Set<string>());
  const [dead,setDead] = useState<Record<string,boolean>>({}); const [generation,setGeneration] = useState<Record<string,number>>({});
  const clearLoadMessages = useCallback((target:string) => {
    loadVersions.current[target] = (loadVersions.current[target] || 0)+1;
    setLoads(prev => { const next = { ...prev }; delete next[target]; return next; });
  },[]);
  const analyzeDiagnosticRef = useRef<(target:string)=>void>(() => {});
  const run = useCallback(async (restartSession = false, diagnosticId?:string) => {
    const p = diagnosticId ? items.find(item => item.id === diagnosticId) : documentRef.current.problem;
    if (!p || loadingPython.current.has(p.id)) return;
    const epoch = folderEpoch.current;
    const runtime = runtimeEpoch.current;
    const source = p.id === documentRef.current.problem?.id ? documentRef.current.code : '';
    const version = (loadVersions.current[p.id] || 0)+1;
    loadVersions.current[p.id] = version;
    const pending = loadingPython.current;
    pending.add(p.id);
    const update = (state:PythonLoadState) => {
      if (epoch === folderEpoch.current && runtime === runtimeEpoch.current && loadVersions.current[p.id] === version) setLoads(prev => ({ ...prev,[p.id]:state }));
    };
    update({ source,phase:diagnosticId ? 'analyzing' : 'loading' });
    setBusy(prev => ({ ...prev,[p.id]:true }));
    let report:PythonReport|undefined;
    try {
      if (diagnosticId) report = await api.pythonDiagnosticReport(p.id);
      else {
        await save();
        if ((epoch !== folderEpoch.current || runtime !== runtimeEpoch.current) || documentRef.current.problem?.id !== p.id || documentRef.current.code !== source) {
          update({ source,phase:'error',note:'コードが変更されました。もう一度読み込んでください。' }); return;
        }
        if (restartSession) {
          await api.pythonStop(p.id);
          if ((epoch !== folderEpoch.current || runtime !== runtimeEpoch.current)) return;
          setGeneration(prev => ({ ...prev,[p.id]:(prev[p.id] || 0)+1 }));
        }
        const size = terminalRef.current?.dimensions();
        report = await api.pythonLoad(p.id,size?.cols,size?.rows);
      }
      if ((epoch !== folderEpoch.current || runtime !== runtimeEpoch.current)) return;
      const errors = report.diagnostics.some(d => d.severity === 'error');
      if (report.success) setDiagnostics(prev => { const next = { ...prev }; delete next[p.id]; return next; });
      else if (errors) setDiagnostics(prev => ({ ...prev,[p.id]:{ output:report!.output,at:new Date().toISOString() } }));
      update({ source:report.source,phase:errors ? 'analyzing' : 'done',report });
      if (errors) {
        report = await api.pythonExplain(p.id,report.token,model,effort);
        update({ source:report.source,phase:'done',report });
      }
    } catch (error) {
      update({ source:report?.source ?? source,phase:'error',report,note:`${report ? 'AI解析に失敗しました。Pythonの出力はターミナルで確認できます。' : ''}${error instanceof Error ? error.message : String(error)}` });
    } finally {
      pending.delete(p.id);
      if (epoch === folderEpoch.current && runtime === runtimeEpoch.current) setBusy(prev => ({ ...prev,[p.id]:false }));
    }
  },[save,model,effort,items]);
  analyzeDiagnosticRef.current = target => { void run(false,target); };
  useEffect(() => {
    setDiagnostics({}); setBusy({}); setLoads({}); setDead({}); setGeneration({});
    loadVersions.current = {}; loadingPython.current = new Set();
  },[workspaceVersion]);
  useEffect(() => {
    if (!api) return;
    return api.onEvent(event => {
      if (event.type === 'python-environment-changed') {
        runtimeEpoch.current++;
        loadVersions.current = {}; loadingPython.current = new Set();
        setDiagnostics({}); setBusy({}); setLoads({}); setDead({}); setGeneration({});
        setSessionEpoch(value => value+1);
      }
      if (event.type === 'python-diagnostic') {
        setDiagnostics(prev => ({ ...prev,[event.id]:event.diagnostic }));
        analyzeDiagnosticRef.current(event.id);
      }
      if (event.type === 'python-exit') setDead(prev => ({ ...prev,[event.id]:true }));
    });
  },[]);
  return { sessionEpoch,diagnostics,busy,loads,dead,generation,run,clearLoadMessages,
    setAlive:(id:string,alive:boolean) => setDead(prev => ({ ...prev,[id]:!alive })) };
}
