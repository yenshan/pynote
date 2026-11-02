// Run with npm run test:electron on a graphical desktop.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { fakeServer } = require('./fake-server.cjs');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'kata-python-electron-'));
process.env.KATA_WORKSPACE = path.join(temporary,'workspace');
process.env.KATA_RUNTIME = path.join(temporary,'runtime');
fs.mkdirSync(process.env.KATA_WORKSPACE);
const source = '# Python practice\ndef solution(n):\n    return sum(x for x in range(n) if x % 3 == 0 or x % 5 == 0)\n';
fs.writeFileSync(path.join(process.env.KATA_WORKSPACE,'solution.py'),source);
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
  else console.log('Electron smoke passed: Python editor, save/run shortcuts, live REPL, rerun, inline AI errors, file switching, terminal layout and folder lifecycle.');
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
    const run = () => key('Enter',[mod]);
    async function edit(code) {
      await evaluate(`document.querySelector('.cm-content').focus()`);
      key('A',[mod]); await win.webContents.insertText(code);
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
      run();
      await until(`!document.querySelector('.load-button').disabled && document.querySelector('.run-button').textContent.includes('再実行')`);
      await evaluate(`window.kata.pythonWrite(${id},'solution(10)\\r')`);
      await until(`window.kata.pythonSnapshot(${id}).then(s => /23[\\r\\n]/.test(s?.data || ''))`);
      // Moving the terminal preserves its instance and live interpreter.
      await evaluate(`window.smokeTerminal = document.querySelector('.xterm'); document.querySelector('[aria-label="Pythonをエディタの右に移動"]').click()`);
      assert.ok(await evaluate(`window.smokeTerminal === document.querySelector('.xterm')`));
      await until(`document.querySelector('.python-at-side')`);
      await evaluate(`document.querySelector('[aria-label="Pythonをエディタの下に移動"]').click()`);
      await edit('value = 42\nprint(value)\n'); run();
      await until(`!document.querySelector('.load-button').disabled`);
      await evaluate(`window.kata.pythonWrite(${id},'value + 1\\r')`);
      await until(`window.kata.pythonSnapshot(${id}).then(s => /43[\\r\\n]/.test(s?.data || ''))`);
      const chatBefore = await evaluate(`document.querySelector('.chat-area').textContent`);
      await edit('# error example\nvalue = 1 / 0\n'); run();
      await until(`document.querySelector('.cm-inline-diagnostic')?.textContent.includes('ゼロ')`);
      assert.equal(await evaluate(`document.querySelector('.cm-ai-error-range').textContent`),'1 / 0');
      assert.equal(await evaluate(`document.querySelector('.chat-area').textContent`),chatBefore);
      assert.ok(await evaluate(`document.querySelector('.assistant-overlay').hidden`));
      const artifacts = path.resolve(__dirname,'../artifacts'); fs.mkdirSync(artifacts,{ recursive:true });
      fs.writeFileSync(path.join(artifacts,'python-ide.png'),(await win.webContents.capturePage()).toPNG());
      key('S',[mod]);
      await until(`!document.querySelector('.cm-inline-diagnostic')`);
      await edit('value = 42\n'); run();
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
      } finally { dialog.showOpenDialog = original; }
      finish();
    } catch (error) {
      console.error(await evaluate('document.body.innerText').catch(() => 'renderer unavailable'));
      finish(error);
    }
  });
});
fakeServer(script).then(executable => {
  process.env.KATA_CODEX = executable;
  require('../electron/main.cjs');
}).catch(finish);
