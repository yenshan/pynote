export type PipJob = { id:string; folder:string; executable:string; packageName:string; status:'running'|'success'|'error'|'cancelled'; output:string; seq:number };
export type PythonEnvironment = { folder:string; selected:string|null; executable:string };
export type PythonEnvironmentOption = { executable:string; label:string; kind:'default'|'selected'|'jupyter'|'history'; available:boolean; version?:string; error?:string };
export type PythonEnvironmentList = PythonEnvironment & { environments:PythonEnvironmentOption[]; warnings:string[] };
export type Message = { id:string; role:'user'|'assistant'; text:string; at:string; pending?:boolean };
export type Problem = { id:string; title:string; fileName:string; createdAt:string; updatedAt:string; threadId:string|null; messages:Message[]; code:string };
export type Summary = Omit<Problem, 'code'|'messages'> & { messageCount:number };
export type WorkspaceInfo = { path:string; name:string; warning:string|null };
export type Diagnostic = { output:string; at:string };
export type InlineDiagnostic = { line:number; column:number; severity:'error'|'warning'; message:string; displayLine?:number; startColumn?:number; endColumn?:number; targetText?:string; explanation?:string };
export type PythonReport = { token:string; source:string; success:boolean; output:string; diagnostics:InlineDiagnostic[] };
export type TerminalSnapshot = { data:string; seq:number; cols:number; rows:number; alive:boolean };
export type CodexModel = { id:string; name:string; isDefault:boolean; defaultReasoningEffort:string; supportedReasoningEfforts:{ effort:string; description:string }[] };
export type CodexStatus = { state:'disconnected'|'connecting'|'connected'|'error'; message:string; authenticated?:boolean; defaultModel?:string; defaultReasoningEffort?:string; models:CodexModel[] };
export type AppEvent = { type:'workspace-changed' } | { type:'pip-install'; job:PipJob } | { type:'python-environment-changed'; environment:PythonEnvironment } | { type:'before-close' } | { type:'python-data'; id:string; data:string; seq:number } | { type:'python-diagnostic'; id:string; diagnostic:Diagnostic } | { type:'python-exit'; id:string; message:string } | { type:'codex-status'; status:CodexStatus } | { type:'ai-message'; id:string; message:Message } | { type:'ai-messages'; id:string; messages:Message[] } | { type:'notice'; message:string };
export interface Bridge {
  pipStatus():Promise<PipJob|null>;
  pipInstall(folder:string, executable:string, name:string):Promise<PipJob>;
  pipCancel(id:string):Promise<PipJob|null>;
  pythonEnvironment():Promise<PythonEnvironment>;
  pythonEnvironments():Promise<PythonEnvironmentList>;
  selectPythonEnvironment(folder:string, executable:string|null):Promise<PythonEnvironment>;
  choosePythonEnvironment():Promise<PythonEnvironment|null>;
  list():Promise<Summary[]>; create(title:string):Promise<Problem>; open(id:string):Promise<Problem>;
  save(id:string, code:string):Promise<{ savedAt:string }>;
  workspaceInfo():Promise<WorkspaceInfo>; chooseFolder():Promise<WorkspaceInfo|null>;
  pythonWrite(id:string, data:string):Promise<void>; pythonResize(id:string, cols:number, rows:number):Promise<void>;
  pythonStop(id:string):Promise<void>;
  codexConnect():Promise<CodexStatus>; codexStatus():Promise<CodexStatus>;
  ask(id:string, text:string, context:string, model:string, effort?:string, source?:string):Promise<unknown>; stopAI(id:string):Promise<void>;
  pythonSnapshot(id:string):Promise<TerminalSnapshot|null>;
  pythonLoad(id:string, cols?:number, rows?:number):Promise<PythonReport>;
  pythonDiagnosticReport(id:string):Promise<PythonReport>; pythonExplain(id:string, token:string, model:string, effort:string):Promise<PythonReport>;
  reveal(id:string):Promise<void>; closeReady():Promise<void>; onEvent(callback:(e:AppEvent)=>void):()=>void;
  copyText(text:string):Promise<void>;
}
declare global { interface Window { kata:Bridge } }
