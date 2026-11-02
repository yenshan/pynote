import { useCallback, useEffect, useRef, useState } from 'react';
import type { Problem, Summary, WorkspaceInfo } from './types';
const api = window.kata;
type DocumentState = { problem:Problem|null; code:string; dirty:boolean };
const emptyDocument:DocumentState = { problem:null,code:'',dirty:false };

export function useWorkspace(notify:(error:unknown)=>void) {
  const [items,setItems] = useState<Summary[]>([]);
  const [document,setDocument] = useState<DocumentState>(emptyDocument);
  const documentRef = useRef(document);
  // All document updates pass through one function so async work sees the same state as the UI.
  const updateDocument = useCallback((next:DocumentState) => {
    documentRef.current = next;
    setDocument(next);
  },[]);
  const { problem,code,dirty } = document;
  const folderEpoch = useRef(0);
  const [saving,setSaving] = useState(false);
  const [folder,setFolder] = useState<WorkspaceInfo|null>(null);
  const [choosingFolder,setChoosingFolder] = useState(false);
  const [loading,setLoading] = useState(true);
  const [workspaceVersion,setWorkspaceVersion] = useState(0);
  const switching = useRef(false);
  const refresh = useCallback(async () => {
    const epoch = folderEpoch.current;
    const list = await api.list(); if (epoch !== folderEpoch.current) return;
    setItems(list);
    const current = documentRef.current.problem;
    if (!current || documentRef.current.dirty) return;
    if (!list.some(item => item.id === current.id)) {
      updateDocument(emptyDocument);
      return;
    }
    const latest = await api.open(current.id);
    if (epoch === folderEpoch.current && documentRef.current.problem?.id === current.id && !documentRef.current.dirty && documentRef.current.code !== latest.code) {
      updateDocument({ problem:latest,code:latest.code,dirty:false });
    }
  }, [updateDocument]);
  const save = useCallback(async () => {
    const p = documentRef.current.problem; if (!p) return;
    if (!documentRef.current.dirty) return;
    const text = documentRef.current.code; const epoch = folderEpoch.current; setSaving(true);
    try {
      await api.save(p.id, text);
      if (epoch !== folderEpoch.current) return;
      if (documentRef.current.problem?.id === p.id && documentRef.current.code === text) {
        updateDocument({ ...documentRef.current,dirty:false });
      }
      await refresh();
    } finally { if (epoch === folderEpoch.current) setSaving(false); }
  }, [refresh,updateDocument]);
  const activate = useCallback(async (p:Problem) => {
    updateDocument({ problem:p,code:p.code,dirty:false });
    localStorage.setItem('kata-last',p.id);
  }, [updateDocument]);
  const confirmDiscard = useCallback(() => !documentRef.current.dirty || window.confirm('未保存の変更があります。保存せずに続けますか？\n保存する場合はキャンセルして、⌘S / Ctrl+S を押してください。'),[]);
  const open = useCallback(async (next:string) => {
    if (switching.current || next === documentRef.current.problem?.id || !confirmDiscard()) return;
    switching.current = true;
    try { await activate(await api.open(next)); }
    catch (e) { notify(e); } finally { switching.current = false; }
  }, [activate,confirmDiscard,notify]);
  useEffect(() => {
    if (!api) { setLoading(false); return; }
    const unsub = api.onEvent(event => {
      if (event.type === 'before-close' && confirmDiscard()) api.closeReady().catch(notify);
      if (event.type === 'workspace-changed') refresh().catch(notify);
      if (event.type === 'notice') notify(event.message);
    });
    let disposed = false;
    (async () => {
      try {
        const [list,info] = await Promise.all([api.list(),api.workspaceInfo()]);
        if (disposed) return;
        setItems(list); setFolder(info);
        if (info.warning) notify(info.warning);
        const last = localStorage.getItem('kata-last');
        const selected = list.find(x => x.id === last) || list[0];
        if (selected) { const next = await api.open(selected.id); if (!disposed) await activate(next); }
      } catch (e) { if (!disposed) notify(e); }
      finally { if (!disposed) setLoading(false); }
    })();
    return () => { disposed = true; unsub(); };
  },[activate,notify,refresh,confirmDiscard]);
  async function create(title:string) {
    if (switching.current || !confirmDiscard()) return false;
    switching.current = true;
    try { const p = await api.create(title.trim() || 'Untitled.py'); await refresh(); await activate(p); return true; }
    catch (e) { notify(e); return false; }
    finally { switching.current = false; }
  }
  async function chooseFolder() {
    if (switching.current || !confirmDiscard()) return false;
    switching.current = true; setChoosingFolder(true);
    try {
      const info = await api.chooseFolder(); if (!info) return false;
      folderEpoch.current++;
      setWorkspaceVersion(folderEpoch.current);
      updateDocument(emptyDocument); setSaving(false); setFolder(info); setItems([]);
      const list = await api.list(); setItems(list);
      if (list[0]) await activate(await api.open(list[0].id));
      return true;
    } catch (e) { notify(e); return false; }
    finally { switching.current = false; setChoosingFolder(false); }
  }
  const changeCode = useCallback((text:string) => {
    updateDocument({ ...documentRef.current,code:text,dirty:true });
  },[updateDocument]);
  return { items,problem,documentRef,code,dirty,saving,folder,choosingFolder,loading,
    folderEpoch,workspaceVersion,save,open,create,chooseFolder,changeCode };
}
export type WorkspaceState = ReturnType<typeof useWorkspace>;
