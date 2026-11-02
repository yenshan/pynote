// Run with npm run test:electron on a graphical desktop.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { fakeServer } = require('./fake-server.cjs');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'kata-python-electron-'));
process.env.PYNOTE_WORKSPACE = path.join(temporary,'workspace');
process.env.PYNOTE_RUNTIME = path.join(temporary,'runtime');
fs.mkdirSync(process.env.PYNOTE_WORKSPACE);
const source = '# Python practice\ndef solution(n):\n    return sum(x for x in range(n) if x % 3 == 0 or x % 5 == 0)\n';
fs.writeFileSync(path.join(process.env.PYNOTE_WORKSPACE,'solution.py'),source);
const { execFileSync } = require('node:child_process');
const pythonCommand = process.env.PYNOTE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const venv = path.join(temporary,'test venv');
execFileSync(pythonCommand,['-m','venv','--without-pip',venv]);
const venvPython = path.join(venv,process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const venvSite = execFileSync(venvPython,['-c','import sysconfig; print(sysconfig.get_path("purelib"))'],{ encoding:'utf8' }).trim();
const pipRecord = path.join(temporary,'pip-invocation.json');
// GUI tests use a local pip fixture; the unit suite installs a real wheel offline.
fs.writeFileSync(path.join(venvSite,'pip.py'),`
import json, sys, time
with open(${JSON.stringify(pipRecord)}, 'w') as record:
    json.dump({'executable': sys.executable, 'args': sys.argv[1:]}, record)
print('Collecting ' + sys.argv[-1], flush=True)
time.sleep(0.5)
print('Successfully installed ' + sys.argv[-1], flush=True)
`);

process.env.JUPYTER_PATH = path.join(temporary,'jupyter');
const kernelDirectory = path.join(process.env.JUPYTER_PATH,'kernels','pynote-test');
fs.mkdirSync(kernelDirectory,{ recursive:true });
fs.writeFileSync(path.join(kernelDirectory,'kernel.json'),JSON.stringify({ language:'python',display_name:'PyNote test venv',argv:[venvPython,'-m','ipykernel_launcher','-f','{connection_file}'] }));

const script = path.join(temporary,'fake-codex.cjs');
fs.writeFileSync(script,`#!/usr/bin/env node
const send = message => process.stdout.write(JSON.stringify(message)+'\\n');
let serial = 0;
require('node:readline').createInterface({ input:process.stdin }).on('line',line => {
  const message = JSON.parse(line); let result = {};
  if (message.method === 'account/read') result = { requiresOpenaiAuth:false,account:null };
  if (message.method === 'model/list') result = { data:[] };
  if (message.method === 'config/read') result = { config:{} };
  if (message.method === 'thread/start') result = { thread:{ id:'test-'+(++serial) } };
  if (message.method === 'turn/start') {
    result = { turn:{ id:'turn-'+serial } };
    setTimeout(() => {
      const text = message.params.outputSchema ? JSON.stringify({ diagnostics:[{ index:0,displayLine:2,startColumn:9,endColumn:13,targetText:'1 / 0',explanation:'ゼロで除算しています。分母をゼロ以外の値にしてください。' }] }) : 'Pythonの質問に回答します。';
      send({ method:'item/agentMessage/delta',params:{ threadId:message.params.threadId,delta:text } });
      send({ method:'turn/completed',params:{ threadId:message.params.threadId,turn:{ status:'completed' } } });
    },150);
  }
  if (message.id !== undefined) send({ id:message.id,result });
});`,{ mode:0o755 });
let finished = false;
const timeout = setTimeout(() => finish(new Error('Electron smoke timed out')),30000);
function finish(error) {
  if (finished) return;
  finished = true; clearTimeout(timeout);
  if (error) console.error(error);
  else console.log('Electron smoke passed: Python editor, save/run shortcuts, live REPL, rerun, inline AI errors, file switching, terminal layout, Jupyter environments, executable picker, package installation and folder lifecycle.');
  app.exit(error ? 1 : 0);
}
app.on('browser-window-created',(_,win) => {
  win.webContents.on('console-message',(_,details) => { if (details.level >= 3) console.error('Renderer:',details.message); });
  win.webContents.once('did-finish-load',async () => {
    const evaluate = code => win.webContents.executeJavaScript(code,true);
    const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
    async function until(code) {
      for (let i=0;i<100;i++) {
        if (await evaluate(`(async () => Boolean(await (${code})))()`)) return;
        await pause(50);
      }
      throw new Error('Timed out: '+code);
    }
    const key = (keyCode,modifiers=[]) => {
      win.webContents.sendInputEvent({ type:'keyDown',keyCode,modifiers });
      win.webContents.sendInputEvent({ type:'keyUp',keyCode,modifiers });
    };
    const mod = process.platform === 'darwin' ? 'meta' : 'control';
    const run = async () => { key('Enter',[mod]); await pause(80); };
    async function edit(code) {
      await evaluate(`document.querySelector('.cm-content').focus()`);
      key('A',[mod]); await pause(40); await win.webContents.insertText(code); await pause(40);
    }
    try {
      await until(`document.querySelector('.cm-content') && document.querySelector('.xterm')`);
      const item = await evaluate(`window.kata.list().then(items => items[0])`);
      const id = JSON.stringify(item.id);
      assert.equal(await evaluate(`window.kata.pythonSnapshot(${id})`),null);
      assert.match(await evaluate('document.body.innerText'),/Python/);
      await evaluate(`document.querySelector('[aria-label="AIサイドバーを閉じる"]').click()`);
      await edit(source+'# saved by shortcut\n');
      assert.ok(await evaluate(`Boolean(document.querySelector('.dirty-dot'))`));
      key('S',[mod]);
      await until(`!document.querySelector('.dirty-dot')`);
      assert.match(fs.readFileSync(item.id,'utf8'),/saved by shortcut/);
      await run();
      await until(`!document.querySelector('.load-button').disabled && document.querySelector('.run-button').textContent.includes('再実行')`);
      await evaluate(`window.kata.pythonWrite(${id},'solution(10)\\r')`);
      await until(`window.kata.pythonSnapshot(${id}).then(s => /23[\\r\\n]/.test(s?.data || ''))`);
      // The Jupyter row selects a venv, closes old sessions and keeps unsaved code.
      await edit(source+'# environment switch preserves unsaved code\n');
      await evaluate(`document.querySelector('[aria-label="Python環境を選択"]').click()`);
      await until(`Array.from(document.querySelectorAll('.environment-option')).some(row => row.textContent.includes('PyNote test venv') && !row.disabled)`);
      await evaluate(`Array.from(document.querySelectorAll('.environment-option')).find(row => row.textContent.includes('PyNote test venv')).click()`);
      await until(`!document.querySelector('.python-environment-modal')`);
      assert.equal((await evaluate('window.kata.pythonEnvironment()')).selected,venvPython);
      assert.equal(await evaluate(`window.kata.pythonSnapshot(${id})`),null);
      assert.ok(await evaluate(`document.querySelector('.dirty-dot') && document.querySelector('.cm-content').textContent.includes('environment switch preserves')`));
      await evaluate(`document.querySelector('.cm-content').focus()`); await run();
      await until(`!document.querySelector('.load-button').disabled`);
      await evaluate(`window.kata.pythonWrite(${id},'import sys; print(sys.prefix)\\r')`);
      await until(`window.kata.pythonSnapshot(${id}).then(s => s?.data.includes(${JSON.stringify(venv)}))`);
      // Exercise cancellation and the native executable picker without opening a dialog.
      const { dialog:environmentDialog } = require('electron');
      const originalEnvironmentDialog = environmentDialog.showOpenDialog;
      await evaluate(`document.querySelector('[aria-label="Python環境を選択"]').click()`);
      try {
        environmentDialog.showOpenDialog = async () => ({ canceled:true,filePaths:[] });
        await evaluate(`Array.from(document.querySelectorAll('.environment-path button')).find(b => b.textContent.includes('参照')).click()`);
        await until(`!document.querySelector('.environment-path button').disabled`);
        assert.equal((await evaluate('window.kata.pythonEnvironment()')).selected,venvPython);
        environmentDialog.showOpenDialog = async () => ({ canceled:false,filePaths:[venvPython] });
        await evaluate(`Array.from(document.querySelectorAll('.environment-path button')).find(b => b.textContent.includes('参照')).click()`);
        await until(`!document.querySelector('.python-environment-modal')`);
      } finally { environmentDialog.showOpenDialog = originalEnvironmentDialog; }
      // One package-name field installs into the selected environment and streams output.
      await evaluate(`document.querySelector('[aria-label="パッケージをインストール"]').click()`);
      await until(`document.querySelector('.pip-install-modal[open]')`);
      assert.equal(await evaluate(`document.querySelectorAll('.pip-install-modal input').length`),1);
      await evaluate(`document.querySelector('#pip-package-name').focus()`);
      await win.webContents.insertText('numpy');
      await evaluate(`document.querySelector('.pip-install-modal form').requestSubmit()`);
      await until(`document.querySelector('.pip-install-output')?.textContent.includes('Collecting numpy')`);
      assert.ok(await evaluate(`document.querySelector('[aria-label="Python環境を選択"]').disabled && document.querySelector('[aria-label="フォルダー設定"]').disabled`));
      await until(`document.querySelector('.pip-install-result [role="status"]')?.textContent.includes('インストール完了')`);
      const pipInvocation = JSON.parse(fs.readFileSync(pipRecord,'utf8'));
      assert.equal(pipInvocation.executable,venvPython);
      assert.deepEqual(pipInvocation.args,['install','--disable-pip-version-check','--no-input','--','numpy']);
      await evaluate(`document.querySelector('[aria-label="インストールダイアログを閉じる"]').click()`);
      await until(`!document.querySelector('[aria-label="Python環境を選択"]').disabled`);
      // Moving the terminal preserves its instance and live interpreter.
      await evaluate(`window.smokeTerminal = document.querySelector('.xterm'); document.querySelector('[aria-label="Pythonをエディタの右に移動"]').click()`);
      assert.ok(await evaluate(`window.smokeTerminal === document.querySelector('.xterm')`));
      await until(`document.querySelector('.python-at-side')`);
      await evaluate(`document.querySelector('[aria-label="Pythonをエディタの下に移動"]').click()`);
      await edit('value = 42\nprint(value)\n'); await run();
      await until(`!document.querySelector('.load-button').disabled`);
      await evaluate(`window.kata.pythonWrite(${id},'value + 1\\r')`);
      await until(`window.kata.pythonSnapshot(${id}).then(s => /43[\\r\\n]/.test(s?.data || ''))`);
      const chatBefore = await evaluate(`document.querySelector('.chat-area').textContent`);
      await edit('# error example\nvalue = 1 / 0\n'); await run();
      await until(`document.querySelector('.cm-inline-diagnostic')?.textContent.includes('ゼロ')`);
      assert.equal(await evaluate(`document.querySelector('.cm-ai-error-range').textContent`),'1 / 0');
      assert.equal(await evaluate(`document.querySelector('.chat-area').textContent`),chatBefore);
      assert.ok(await evaluate(`document.querySelector('.assistant-overlay').hidden`));
      const artifacts = path.resolve(__dirname,'../artifacts'); fs.mkdirSync(artifacts,{ recursive:true });
      fs.writeFileSync(path.join(artifacts,'python-ide.png'),(await win.webContents.capturePage()).toPNG());
      key('S',[mod]);
      await until(`!document.querySelector('.cm-inline-diagnostic')`);
      await edit('value = 42\n'); await run();
      await until(`!document.querySelector('.load-button').disabled && !document.querySelector('.python-status-popup')`);
      await evaluate(`document.querySelector('.new-button').click()`);
      await until(`document.querySelector('.new-modal')`);
      await evaluate(`document.querySelector('.new-modal').requestSubmit()`);
      await until(`document.querySelector('.problem-item[aria-current="page"] .file-name')?.textContent === 'Untitled.py'`);
      const other = await evaluate(`window.kata.list().then(items => items.find(i => i.fileName === 'Untitled.py'))`);
      assert.equal(await evaluate(`window.kata.pythonSnapshot(${JSON.stringify(other.id)})`),null);
      await evaluate(`document.querySelector('[data-problem-id="'+${id}+ '"]').click()`);
      await until(`document.querySelector('.editor-tab').textContent.includes('solution.py')`);
      assert.ok((await evaluate(`window.kata.pythonSnapshot(${id})`)).alive);
      // Exercise the actual folder switch handler with a native dialog result.
      const { dialog } = require('electron');
      const nextFolder = path.join(temporary,'next'); fs.mkdirSync(nextFolder);
      fs.writeFileSync(path.join(nextFolder,'other.py'),'print("new folder")\n');
      const original = dialog.showOpenDialog;
      try {
        dialog.showOpenDialog = async () => ({ canceled:false,filePaths:[nextFolder] });
        await evaluate(`document.querySelector('[aria-label="フォルダー設定"]').click()`);
        await until(`document.querySelector('.editor-tab').textContent.includes('other.py')`);
        assert.equal((await evaluate('window.kata.workspaceInfo()')).path,fs.realpathSync(nextFolder));
        assert.equal((await evaluate('window.kata.pythonEnvironment()')).selected,null);
        dialog.showOpenDialog = async () => ({ canceled:false,filePaths:[process.env.PYNOTE_WORKSPACE] });
        await evaluate(`document.querySelector('[aria-label="フォルダー設定"]').click()`);
        await until(`document.querySelector('.editor-tab').textContent.includes('Untitled.py')`);
        assert.equal((await evaluate('window.kata.pythonEnvironment()')).selected,venvPython);
      } finally { dialog.showOpenDialog = original; }
      finish();
    } catch (error) {
      console.error(await evaluate('document.body.innerText').catch(() => 'renderer unavailable'));
      finish(error);
    }
  });
});
fakeServer(script).then(executable => {
  process.env.PYNOTE_CODEX = executable;
  require('../electron/main.cjs');
}).catch(finish);
