const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { hasDiagnostic } = require('./python.cjs');

function parseDiagnostics(output, file, source) {
  const lines = source.split('\n').length;
  // Python reports frames in call order; the final matching frame is the error site.
  const frames = [...output.matchAll(/^\s*File "([^"\n]+)", line (\d+)(?:, in [^\n]+)?/gm)];
  const frame = frames.reverse().find(match =>
    path.resolve(path.dirname(file),match[1]) === path.resolve(file) && Number(match[2]) >= 1 && Number(match[2]) <= lines);
  if (!frame || !hasDiagnostic(output)) return [];
  const tail = output.slice(frame.index + frame[0].length).split('\n');
  const caret = tail.find(line => /^\s*[~^]+\s*$/.test(line));
  // Tracebacks indent displayed source by four spaces and trim its original indent.
  const sourceLine = source.split('\n')[Number(frame[2])-1];
  const indent = sourceLine.match(/^\s*/)[0].length;
  const column = caret ? Math.max(1,caret.search(/[~^]/)-4+indent+1) : 1;
  return [{ line:Number(frame[2]),column,severity:'error',message:output.slice(frame.index).trim().slice(0,8000) }];
}

class PythonDiagnostics {
  constructor(store, python) { this.store = store; this.python = python; this.reports = new Map(); this.sources = new Map(); }
  report(id,source,output) {
    const diagnostics = parseDiagnostics(output,this.store.file(id),source);
    const success = !hasDiagnostic(output);
    if (!success && !diagnostics.some(d => d.severity === 'error')) {
      // Interactive exceptions and dependency errors cannot be assigned to a source line.
      diagnostics.push({ line:0,column:0,severity:'error',message:output.slice(-20000) });
    }
    const report = { token:randomUUID(),fileName:this.store.find(id).fileName,source,output,success,diagnostics };
    this.reports.set(id,report); return report;
  }
  async load(id,cols,rows) {
    const snapshot = await this.store.open(id);
    this.sources.set(id,snapshot.code);
    const output = await this.python.load(id,this.store.file(id),cols,rows);
    if ((await this.store.open(id)).code !== snapshot.code) throw new Error('読み込み中にコードが変更されました。もう一度読み込んでください。');
    return this.report(id,snapshot.code,output);
  }
  async latest(id) {
    const snapshot = await this.store.open(id), diagnostic = this.python.sessions.get(id)?.lastDiagnostic;
    if (!diagnostic) throw new Error('解析するPythonのエラーがありません。');
    if (this.sources.has(id) && this.sources.get(id) !== snapshot.code) throw new Error('コードが変更されています。Pythonで再読み込みしてください。');
    return this.report(id,snapshot.code,diagnostic.output);
  }
  async explain(id,token,codex,model,effort) {
    const report = this.reports.get(id);
    if (!report || report.token !== token || (await this.store.open(id)).code !== report.source) throw new Error('コードが更新されています。Pythonで再読み込みしてください。');
    if (report.success || !report.diagnostics.some(d => d.severity === 'error')) return report;
    const explanations = await codex.explainDiagnostics(report,model,effort);
    return { ...report,diagnostics:report.diagnostics.map((d,index) => ({ ...d,...(explanations.get(index) ? explanations.get(index) : {}) })) };
  }
  close() { this.reports.clear(); this.sources.clear(); }
}
module.exports = { PythonDiagnostics,parseDiagnostics };
