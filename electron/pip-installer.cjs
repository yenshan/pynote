const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { probePython } = require('./python-environments.cjs');

function packageName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 200 || !/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i.test(name)) {
    throw new Error('パッケージ名を1つ入力してください（例：numpy、scikit-learn）。');
  }
  return name;
}
class PipInstaller {
  constructor(emit,options={}) { this.emit = emit; this.probe = options.probe || probePython; this.spawn = options.spawn || spawn; this.env = options.env || process.env; }
  get busy() { return this.job?.status === 'running'; }
  snapshot() {
    if (!this.job) return null;
    const { id,folder,executable,packageName,status,output,seq } = this.job;
    return { id,folder,executable,packageName,status,output,seq };
  }
  update(job,data='') {
    job.output = (job.output+data).slice(-200_000); job.seq++;
    this.emit({ type:'pip-install',job:this.snapshot() });
  }
  start(environment,input) {
    if (this.closed) throw new Error('アプリを終了しています。');
    if (this.busy) throw new Error('パッケージをインストール中です。完了するか中止してください。');
    const name = packageName(input);
    const job = this.job = { id:randomUUID(),folder:environment.folder,executable:environment.executable,packageName:name,status:'running',output:'',seq:0,cancelled:false };
    job.ended = new Promise(resolve => { job.resolve = resolve; });
    this.update(job,'Python環境を確認しています…\n');
    void this.run(job);
    return this.snapshot();
  }
  async run(job) {
    try {
      const info = await this.probe(job.executable);
      job.executable = info.executable;
      if (job.cancelled) return this.finish(job,'cancelled');
      job.directory = await fs.mkdtemp(path.join(os.tmpdir(),'pynote-pip-'));
      if (job.cancelled) return this.finish(job,'cancelled');
      this.update(job,`インストール先: ${job.executable}\n\n`);
      // A fresh working directory prevents a project-local pip.py or directory
      // with the package's name from changing what is executed or installed.
      const proc = job.proc = this.spawn(job.executable,['-u','-m','pip','install','--disable-pip-version-check','--no-input','--',job.packageName],{
        cwd:job.directory,env:{ ...this.env,PYTHONIOENCODING:'utf-8',PIP_PROGRESS_BAR:'off' },
        stdio:['ignore','pipe','pipe'],windowsHide:true,detached:process.platform !== 'win32'
      });
      proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8');
      proc.stdout.on('data',data => this.update(job,data));
      proc.stderr.on('data',data => this.update(job,data));
      proc.on('error',error => { job.error = error.message; });
      proc.on('close',(code,signal) => {
        clearTimeout(job.force);
        const status = job.cancelled ? 'cancelled' : !job.error && code === 0 ? 'success' : 'error';
        if (job.error) this.update(job,`\n${job.error}\n`);
        else if (status === 'error') this.update(job,`\n終了コード: ${code ?? signal}\n`);
        if (/No module named pip/.test(job.output)) this.update(job,'\n選択中の環境に pip がありません。その環境に pip を用意してから再実行してください。\n');
        void this.finish(job,status);
      });
    } catch (error) {
      this.update(job,`\n${error.message}\n`);
      await this.finish(job,job.cancelled ? 'cancelled' : 'error');
    }
  }
  async finish(job,status) {
    if (job.finished) return;
    job.finished = true;
    if (job.directory) await fs.rm(job.directory,{ recursive:true,force:true }).catch(() => {});
    job.status = status;
    this.update(job,status === 'success' ? '\nインストールが完了しました。\n' : status === 'cancelled' ? '\nインストールを中止しました。\n' : '\nインストールに失敗しました。\n');
    job.resolve();
  }
  cancel(id) {
    const job = this.job;
    if (!job || job.id !== id || !this.busy || job.cancelled) return this.snapshot();
    job.cancelled = true;
    this.update(job,'\n中止しています…\n');
    if (job.proc && !job.finished) {
      const kill = signal => {
        if (process.platform === 'win32') this.spawn('taskkill',['/pid',String(job.proc.pid),'/t','/f'],{ windowsHide:true,stdio:'ignore' }).on('error',() => job.proc.kill());
        else { try { process.kill(-job.proc.pid,signal); } catch { job.proc.kill(signal); } }
      };
      kill('SIGTERM');
      job.force = setTimeout(() => kill('SIGKILL'),1500); job.force.unref();
    }
    return this.snapshot();
  }
  async close() {
    this.closed = true;
    if (this.busy) { this.cancel(this.job.id); await this.job.ended; }
  }
}
module.exports = { PipInstaller,packageName };
