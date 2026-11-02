const fs = require('node:fs');
const { Python } = require('./python.cjs');
const { Codex } = require('./codex.cjs');
const { PythonDiagnostics } = require('./python-diagnostics.cjs');

// Own every resource whose lifetime is tied to the selected folder.
class WorkspaceServices {
  constructor(store, emit, options = {}) {
    this.store = store;
    this.active = true;
    this.emit = event => { if (this.active) emit(event); };
    this.python = new (options.Python || Python)(this.emit, options.pythonExecutable || (process.platform === 'win32' ? 'python' : 'python3'));
    this.codex = new (options.Codex || Codex)(store, this.emit, options.codexExecutable || 'codex');
    this.diagnostics = new (options.PythonDiagnostics || PythonDiagnostics)(store, this.python);
    try {
      this.watcher = (options.watch || fs.watch)(store.root, (_, name) => {
        if (!this.active || (name && !/\.py$/i.test(name.toString()))) return;
        clearTimeout(this.watchTimer);
        this.watchTimer = setTimeout(() => this.emit({ type:'workspace-changed' }),180);
      });
      this.watcher.on('error', error => this.emit({ type:'notice', message:`フォルダーの監視に失敗しました: ${error.message}` }));
    } catch (error) { this.emit({ type:'notice', message:error.message }); }
  }
  close() {
    if (this.closing) return this.closing;
    // Disable events synchronously, before any process can report its exit.
    this.active = false;
    this.watcher?.close();
    clearTimeout(this.watchTimer);
    this.diagnostics.close();
    this.closing = Promise.all([this.store.writes, this.python.close(), this.closeCodex()]).then(() => {});
    return this.closing;
  }
  closeCodex() {
    const proc = this.codex.proc;
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) {
      this.codex.close();
      return Promise.resolve();
    }
    return new Promise(resolve => {
      const finish = () => {
        clearTimeout(force);
        proc.removeListener('exit', finish);
        proc.removeListener('error', finish);
        resolve();
      };
      const force = setTimeout(() => { proc.kill('SIGKILL'); },1500);
      proc.once('exit', finish);
      proc.once('error', finish);
      this.codex.close();
    });
  }
}
module.exports = { WorkspaceServices };
