import { useCallback, useEffect, useRef, useState } from 'react';
import type { CodexStatus, Message } from './types';
import type { WorkspaceState } from './useWorkspace';
const api = window.kata;
function initialAISettings():{ model:string; effort:string } {
  try {
    const saved = JSON.parse(localStorage.getItem('kata-ai-settings') || 'null');
    return { model:typeof saved?.model === 'string' ? saved.model : '',effort:typeof saved?.effort === 'string' ? saved.effort : '' };
  } catch { return { model:'',effort:'' }; }
}

export function useAssistant(workspace:WorkspaceState, notify:(error:unknown)=>void) {
  const { problem,documentRef,folderEpoch,workspaceVersion } = workspace;
  const id = problem?.id || '';
  const [question,setQuestion] = useState('');
  const [aiSettings,setAISettings] = useState(initialAISettings);
  const [codexStatus,setCodexStatus] = useState<CodexStatus>({ state:'disconnected',message:'未接続',models:[] });
  const selectedModel = codexStatus.models.find(model => model.id === aiSettings.model) || codexStatus.models.find(model => model.id === codexStatus.defaultModel) || codexStatus.models.find(model => model.isDefault) || codexStatus.models[0];
  const model = selectedModel?.id || '';
  const efforts = selectedModel?.supportedReasoningEfforts || [];
  const defaultEffort = model === codexStatus.defaultModel && efforts.some(option => option.effort === codexStatus.defaultReasoningEffort) ? codexStatus.defaultReasoningEffort : selectedModel?.defaultReasoningEffort;
  const effort = efforts.find(option => option.effort === aiSettings.effort)?.effort || efforts.find(option => option.effort === defaultEffort)?.effort || efforts[0]?.effort || '';
  const [chatMap,setChatMap] = useState<Record<string,Message[]>>({});
  const sendingQuestions = useRef(new Set<string>());
  const messages = chatMap[id] || problem?.messages || [];
  const aiBusy = messages.some(x => x.pending);
  const connectCodex = useCallback(async () => {
    const epoch = folderEpoch.current;
    try { const status = await api.codexConnect(); if (epoch === folderEpoch.current) setCodexStatus(status); }
    catch (error) { if (epoch === folderEpoch.current) { setCodexStatus(prev => ({ ...prev,state:'error',message:String(error) })); notify(error); } }
  },[notify]);
  useEffect(() => {
    if (api && id && codexStatus.state === 'disconnected') void connectCodex();
  },[id,codexStatus.state,connectCodex]);
  useEffect(() => {
    try { localStorage.setItem('kata-ai-settings',JSON.stringify(aiSettings)); } catch { notify('AIモデル設定を保存できませんでした。'); }
  },[aiSettings,notify]);
  useEffect(() => {
    setQuestion('');
    if (problem) setChatMap(prev => ({ ...prev,[problem.id]:problem.messages }));
  },[id]);
  useEffect(() => {
    setChatMap({}); setQuestion(''); sendingQuestions.current = new Set();
    let disposed = false;
    if (api) api.codexStatus().then(status => { if (!disposed) setCodexStatus(status); }).catch(notify);
    return () => { disposed = true; };
  },[workspaceVersion,notify]);
  useEffect(() => {
    if (!api) return;
    return api.onEvent(event => {
      if (event.type === 'codex-status') setCodexStatus(event.status);
      if (event.type === 'ai-messages') setChatMap(prev => ({ ...prev,[event.id]:event.messages }));
      if (event.type === 'ai-message') setChatMap(prev => {
        const list = prev[event.id] || [];
        return { ...prev,[event.id]:list.some(m => m.id === event.message.id) ? list.map(m => m.id === event.message.id ? event.message : m) : [...list,event.message] };
      });
    });
  },[]);
  async function sendQuestion(text = question, context = '') {
    if (!text.trim() || !id || aiBusy || sendingQuestions.current.has(id)) return;
    const target = id; const pending = sendingQuestions.current; const epoch = folderEpoch.current; pending.add(target); setQuestion('');
    try { await api.ask(target,text,context,model,effort,documentRef.current.code); }
    catch (e) { if (epoch === folderEpoch.current) notify(e); }
    finally { pending.delete(target); }
  }
  return { question,setQuestion,codexStatus,model,effort,efforts,setAISettings,messages,aiBusy,connectCodex,sendQuestion };
}
