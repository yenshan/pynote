const path = require('node:path');
const { stripVTControlCharacters } = require('node:util');
const pty = require('node-pty');
const fs = require('node:fs');
const os = require('node:os');
const { randomUUID } = require('node:crypto');

function diagnosticText(data) {
  return stripVTControlCharacters(data).replace(/\r\n/g,'\n').replace(/\r/g,'\n').trim();
}
function hasDiagnostic(text) {
  return /(?:^|\n)(?:Traceback \(most recent call last\):|[\w.]*(?:Error|Exception|Interrupt|Exit|Warning|ExceptionGroup)(?::|$))/m.test(text);
}
class Python {
  constructor(emit, executable = process.platform === 'win32' ? 'python' : 'python3', options = {}) {
    this.emit = emit; this.executable = executable; this.options = options; this.sessions = new Map();
  }
  snapshot(session) { return { data:session.history, seq:session.seq, cols:session.cols, rows:session.rows, alive:!session.closed }; }
  peek(id) { const session = this.sessions.get(id); return session ? this.snapshot(session) : null; }
  start(id,file,cols=80,rows=24) {
    if (this.closed) throw new Error('Pythonワークスペースを終了しています。');
    let session = this.sessions.get(id);
    if (session) {
      this.sessions.delete(id); this.sessions.set(id,session);
      return this.snapshot(session);
    }
    if (this.sessions.size >= 6) this.stop(this.sessions.keys().next().value);
    let proc;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(),'kata-python-'));
    // An invisible OSC marker identifies a complete Python prompt, even across PTY chunks.
    const markerId = `kata-${randomUUID()}`;
    const marker = `\x1b]777;${markerId}\x07`;
    const script = path.join(directory,'console.py');
    fs.writeFileSync(script,`
import builtins as _builtins
import sys as _sys
import traceback as _traceback
import tokenize as _tokenize

# Keep the runner outside user globals so re-execution starts with a clean namespace.
def _make_runner(file, namespace):
    builtins, sys, traceback, tokenize = _builtins, _sys, _traceback, _tokenize
    def run():
        namespace.clear()
        namespace.update(__name__='__main__', __file__=file, __builtins__=builtins)
        sys.argv[:] = [file]
        try:
            with tokenize.open(file) as source:
                code = compile(source.read(), file, 'exec')
            exec(code, namespace)
        except BaseException as error:
            traceback.print_exception(type(error), error, error.__traceback__.tb_next)
    return run

_sys.ps1 = ${JSON.stringify(marker + '>>> ')}
_sys.ps2 = '... '
_sys.path.insert(0, ${JSON.stringify(path.dirname(file))})
_builtins.__kata_run__ = _make_runner(${JSON.stringify(file)}, vars(_sys.modules['__main__']))
_builtins.__kata_run__()
`,{ mode:0o600 });
    try {
      proc = pty.spawn(this.executable,['-i','-u','-q',script],{
        name:'xterm-256color',cols,rows,cwd:path.dirname(file),
        env:{ ...process.env,...this.options.env,TERM:'xterm-256color',COLORTERM:'truecolor',PYTHON_BASIC_REPL:'1',PYTHON_COLORS:'0',PYTHONIOENCODING:'utf-8' }
      });
    } catch (error) { fs.rmSync(directory,{ recursive:true,force:true }); throw new Error(`Pythonターミナルを起動できません: ${error.message}`); }
    session = { id,file,proc,history:'',seq:0,closed:false,cols,rows,diagnosticBuffer:'',marker,promptTail:'',ready:false };
    session.initial = new Promise((resolve,reject) => {
      session.initialResolve = resolve; session.initialReject = reject;
      session.initialTimer = setTimeout(() => reject(new Error('Pythonの読み込みがタイムアウトしました。')),60000);
    });
    session.initial.catch(() => {});
    this.sessions.set(id,session);
    proc.onData(data => {
      session.history = (session.history+data).slice(-200_000);
      session.diagnosticBuffer = (session.diagnosticBuffer+data).slice(-20000);
      this.emit({ type:'python-data',id,data,seq:++session.seq });
      if (session.waiting) session.waiting.output = (session.waiting.output + data).slice(-200000);
      const promptData = session.promptTail + data;
      session.promptTail = promptData.slice(-(marker.length-1));
      if (promptData.includes(marker)) {
        this.flushDiagnostics(session);
        session.diagnosticBuffer = '';
        if (!session.ready) { session.ready = true; clearTimeout(session.initialTimer); session.initialResolve(session.history); }
        if (session.waiting) {
          const waiting = session.waiting; session.waiting = null; clearTimeout(waiting.timer); waiting.resolve(waiting.output);
        }
      }
    });
    session.ended = new Promise(resolve => proc.onExit(event => {
      session.closed=true; clearTimeout(session.initialTimer); this.flushDiagnostics(session);
      session.initialReject(new Error('Pythonが読み込み完了前に終了しました。'));
      if (session.waiting) { clearTimeout(session.waiting.timer); session.waiting.reject(new Error('Pythonが終了しました。')); session.waiting = null; }
      fs.rmSync(directory,{ recursive:true,force:true });
      if (this.sessions.get(id) === session) this.sessions.delete(id);
      this.emit({ type:'python-exit',id,message:`Python終了 (${event.signal || event.exitCode})` });
      resolve();
    }));
    return this.snapshot(session);
  }
  flushDiagnostics(session) {
    const output=diagnosticText(session.diagnosticBuffer);
    // Preserve a partial burst so a diagnostic split across PTY chunks is found.
    if (!hasDiagnostic(output)) return;
    session.diagnosticBuffer='';
    session.lastDiagnostic = { output,at:new Date().toISOString() };
    this.emit({ type:'python-diagnostic',id:session.id,diagnostic:session.lastDiagnostic });
  }
  write(id,data) {
    const session=this.sessions.get(id);
    if (!session || session.closed) throw new Error('Pythonが停止しています。再起動してください。');
    session.proc.write(data);
  }
  resize(id,cols,rows) {
    const session=this.sessions.get(id); if (!session || session.closed) return;
    session.cols=cols; session.rows=rows; session.proc.resize(cols,rows);
  }
  async reload(id) {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Pythonが停止しています。');
    return this.load(id,session.file,session.cols,session.rows);
  }
  command(session,command) {
    return new Promise((resolve,reject) => {
      const waiting = { resolve,reject,output:'',timer:setTimeout(() => {
        if (session.waiting === waiting) session.waiting = null;
        reject(new Error('Pythonの読み込みがタイムアウトしました。'));
      },60000) };
      session.waiting = waiting;
      try { session.proc.write(command); } catch (error) { clearTimeout(waiting.timer); session.waiting = null; reject(error); }
    });
  }
  async load(id,file,cols=80,rows=24) {
    let session = this.sessions.get(id);
    if (session?.loading) throw new Error('Pythonでファイルを読み込み中です。');
    if (!session) {
      this.start(id,file,cols,rows); session = this.sessions.get(id); session.loading = true;
      try { return diagnosticText(await session.initial); }
      finally { session.loading = false; }
    }
    session.loading = true;
    try {
      await session.initial;
      await this.command(session,'\x03');
      session.diagnosticBuffer = ''; session.lastDiagnostic = null;
      return diagnosticText(await this.command(session,'__kata_run__()\r'));
    } finally { session.loading = false; }
  }
  async stop(id) {
    const session=this.sessions.get(id); if (!session || session.closed) return;
    try { if (process.platform==='win32') session.proc.kill(); else process.kill(-session.proc.pid,'SIGHUP'); } catch { session.proc.kill(); }
    const force=setTimeout(() => {
      if (!session.closed) { try { if (process.platform==='win32') session.proc.kill(); else process.kill(-session.proc.pid,'SIGKILL'); } catch {} }
    },1500);
    await session.ended; clearTimeout(force);
  }
  async restart(id,file) { await this.stop(id); return this.start(id,file); }
  async close() { this.closed = true; await Promise.all([...this.sessions.keys()].map(id => this.stop(id))); }
}
module.exports = { Python, diagnosticText, hasDiagnostic };
