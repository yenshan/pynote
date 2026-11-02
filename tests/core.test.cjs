const { fakeServer } = require('./fake-server.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../electron/store.cjs');
const { Python, diagnosticText } = require('../electron/python.cjs');
const { Codex } = require('../electron/codex.cjs');
const { diagnosticRange } = require('../electron/diagnostic-range.cjs');
const { PythonDiagnostics,parseDiagnostics } = require('../electron/python-diagnostics.cjs');
const { Workspace, migrateLegacy } = require('../electron/workspace.cjs');
async function temporary(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(),'kata-test-')); t.after(() => fs.rm(root,{ recursive:true,force:true })); return root; }

test('window state survives restart and remains visible after display changes or corrupt settings', async t => {
  const { EventEmitter } = require('node:events');
  const { restoreWindowState,trackWindowState } = require('../electron/window-state.cjs');
  const file = path.join(await temporary(t),'window-state.json');
  const primary = { workArea:{ x:0,y:25,width:1440,height:875 } };
  const secondary = { workArea:{ x:-1920,y:0,width:1920,height:1080 } };
  let displays = [primary,secondary];
  const screen = { getAllDisplays:() => displays,getPrimaryDisplay:() => primary };
  const win = new EventEmitter();
  let minimized = false, maximized = true;
  Object.assign(win,{
    isDestroyed:() => false,isMinimized:() => minimized,isFullScreen:() => false,isMaximized:() => maximized,
    getNormalBounds:() => ({ x:-1800,y:80,width:1200,height:800 })
  });
  trackWindowState(win,file,{ maximized:false });
  win.emit('resize'); win.emit('close');
  assert.deepEqual(restoreWindowState(file,screen).bounds,win.getNormalBounds());
  assert.equal(restoreWindowState(file,screen).maximized,true);
  minimized = true; maximized = false; win.emit('close');
  assert.equal(restoreWindowState(file,screen).maximized,true,'minimizing does not lose maximized state');
  win.emit('closed');
  displays = [primary];
  assert.deepEqual(restoreWindowState(file,screen).bounds,{ x:120,y:63,width:1200,height:800 });
  await fs.writeFile(file,JSON.stringify({ x:1400,y:850,width:3000,height:2000 }));
  assert.deepEqual(restoreWindowState(file,screen).bounds,{ x:0,y:25,width:1440,height:875 });
  await fs.writeFile(file,'broken JSON');
  assert.deepEqual(restoreWindowState(file,screen).bounds,{ x:0,y:25,width:1440,height:875 });
});

test('opens existing Python files sorted by modification date and saves only .py files', async t => {
  const root = await temporary(t);
  await fs.writeFile(path.join(root,'Older.py'),'older = 1');
  await fs.writeFile(path.join(root,'Newer.py'),'newer = 2');
  await fs.utimes(path.join(root,'Older.py'),100,100);
  await fs.utimes(path.join(root,'Newer.py'),200,200);
  await fs.writeFile(path.join(root,'notes.txt'),'leave me alone');
  await fs.mkdir(path.join(root,'nested'));
  await fs.writeFile(path.join(root,'nested','Hidden.py'),'hidden = 3');
  const store = new Store(root); await store.init();
  let list = await store.list();
  assert.deepEqual(list.map(x => x.fileName),['Newer.py','Older.py']);
  const old = list[1]; assert.equal((await store.open(old.id)).code,'older = 1');
  await store.save(old.id,'older = 42');
  list = await store.list(); assert.equal(list[0].id,old.id);
  await Promise.all([store.save(old.id,'older = 43'),store.save(old.id,'older = 44')]);
  const created = await store.create('日本語'); assert.equal(created.fileName,'日本語.py');
  assert.equal((await store.open(old.id)).code,'older = 44');
  assert.equal(await fs.readFile(path.join(root,'notes.txt'),'utf8'),'leave me alone');
  assert.deepEqual((await fs.readdir(root)).sort(),['Newer.py','Older.py','nested','notes.txt','日本語.py'].sort());
  const reopened = new Store(root); await reopened.init();
  assert.equal((await reopened.open(old.id)).code,'older = 44');
  await fs.unlink(path.join(root,'Newer.py'));
  assert.equal((await reopened.list()).some(x => x.fileName==='Newer.py'),false);
  assert.throws(() => reopened.file('../../secret'),/見つかりません/);
});

test('empty folders stay empty, duplicate names never overwrite, invalid paths are rejected', async t => {
  const root = await temporary(t); const store = new Store(root); await store.init();
  assert.deepEqual(await store.list(),[]);
  const item = await store.create('Example.py','answer = 42');
  await assert.rejects(store.create('Example.py','answer = 99'),/同じ名前/);
  assert.equal((await store.open(item.id)).code,'answer = 42');
  for (const name of ['../escape','nested/file','', '..','CON.py','bad:name']) await assert.rejects(store.create(name),/ファイル名/);
  assert.deepEqual(await fs.readdir(root),['Example.py']);
  const at = (await fs.stat(item.id)).mtimeMs;
  await store.save(item.id,'answer = 42');
  assert.equal((await fs.stat(item.id)).mtimeMs,at,'saving unchanged content does not change ordering');
});

test('folder selection survives restart, keeps settings outside the folder, and fails without replacing it', async t => {
  const root = await temporary(t); const defaults=path.join(root,'default'), config=path.join(root,'config'), external=path.join(root,'existing');
  await fs.mkdir(external); await fs.writeFile(path.join(external,'Existing.py'),'existing = 7');
  const workspace = new Workspace(defaults,config); await workspace.init();
  assert.deepEqual(await workspace.store.list(),[]);
  await workspace.setFolder(external);
  assert.equal(workspace.info().path,await fs.realpath(external));
  assert.deepEqual(await fs.readdir(external),['Existing.py']);
  const reopened = new Workspace(defaults,config); await reopened.init();
  assert.equal(reopened.info().path,await fs.realpath(external));
  assert.equal((await reopened.store.list())[0].fileName,'Existing.py');
  await assert.rejects(reopened.setFolder(path.join(root,'missing')));
  assert.equal(reopened.info().path,await fs.realpath(external));
  await fs.rm(external,{ recursive:true });
  const fallback = new Workspace(defaults,config); await fallback.init();
  assert.equal(fallback.info().path,await fs.realpath(defaults));
  assert.ok(fallback.info().warning);
});

test('legacy code is migrated without overwrites and originals are retained outside the source folder', async t => {
  const root=await temporary(t), source=path.join(root,'source'),config=path.join(root,'settings');
  const id='44509081-deeb-44dd-bbbb-1469df8ebd97';
  await fs.mkdir(path.join(source,id),{ recursive:true });
  await fs.writeFile(path.join(source,id,'Solution.py'),'answer = 42');
  await fs.writeFile(path.join(source,id,'revisions.json'),'[]');
  await fs.writeFile(path.join(source,'index.json'),JSON.stringify([{ id,title:'Example' }]));
  await fs.writeFile(path.join(source,'Example.py'),'answer = 99');
  const archive = await migrateLegacy(source,config);
  assert.deepEqual((await fs.readdir(source)).sort(),['Example 2.py','Example.py']);
  assert.equal(await fs.readFile(path.join(source,'Example.py'),'utf8'),'answer = 99');
  assert.equal(await fs.readFile(path.join(source,'Example 2.py'),'utf8'),'answer = 42');
  assert.equal(await fs.readFile(path.join(archive,id,'Solution.py'),'utf8'),'answer = 42');
  assert.equal(await fs.readFile(path.join(archive,id,'revisions.json'),'utf8'),'[]');
  assert.equal(await migrateLegacy(source,config),undefined);
});

const example = 'def solution(n):\n    return sum(x for x in range(1, n) if x % 3 == 0 or x % 5 == 0)\n';

async function waitFor(predicate, timeout=7000) {
  const deadline=Date.now()+timeout;
  while (Date.now()<deadline) { const value=predicate(); if(value) return value; await new Promise(resolve=>setTimeout(resolve,15)); }
  throw new Error('Timed out waiting for Python terminal output');
}
async function pythonHarness(t) {
  const root=await temporary(t); const store=new Store(root); await store.init();
  const item=await store.create('Solution.py',example); const events=[], output={};
  const python=new Python(event=>{ events.push(event); if(event.type==='python-data') output[event.id]=(output[event.id] || '')+event.data; },process.env.KATA_PYTHON || 'python3',{ env:{ HOME:root } });
  t.after(()=>python.close());
  python.start(item.id,store.file(item.id)); await waitFor(()=>/>>>/.test(output[item.id] || ''));
  async function send(command,pattern,id=item.id) {
    const offset=(output[id] || '').length;
    python.write(id,command);
    return waitFor(()=>{ const text=diagnosticText((output[id] || '').slice(offset)); return pattern.test(text) && text; });
  }
  return { root,store,item,python,events,output,send };
}

test('real PTY Python evaluates, captures exceptions, reruns, resizes and isolates files', { timeout:20000 }, async t => {
  const { store,item,python,events,send } = await pythonHarness(t);
  await send('solution(10)\r',/(?:^|\n)23(?:\n|$)/);
  await send('solution("ten")\r',/TypeError/);
  await waitFor(() => events.some(e => e.type === 'python-diagnostic' && /TypeError/.test(e.diagnostic.output)));
  await store.save(item.id,'def solution(n):\n    return n * 2\n');
  await python.reload(item.id);
  await send('solution(10)\r',/(?:^|\n)20(?:\n|$)/);
  python.resize(item.id,100,30);
  await send('import os; print(os.get_terminal_size())\r',/columns=100, lines=30/);
  const snapshot = python.start(item.id,store.file(item.id));
  assert.equal(snapshot.cols,100); assert.equal(snapshot.rows,30); assert.ok(snapshot.seq > 0);
  const other = await store.create('Other');
  await python.load(other.id,store.file(other.id));
  await send('solve([1, 2, 3])\r',/(?:^|\n)6(?:\n|$)/,other.id);
  await send('solution(5)\r',/(?:^|\n)10(?:\n|$)/);
  await send('def double(x):\r    return x * 2\r\r',/>>>/);
  await send('double(4)\r',/(?:^|\n)8(?:\n|$)/);
  await python.reload(item.id);
  await send('double(4)\r',/NameError/); // Old definitions disappear on a rerun.
});

test('real PTY handles input(), interrupt, completion, history, exit and restart', { timeout:20000 }, async t => {
  const { store,item,python,output,send } = await pythonHarness(t);
  python.write(item.id,'print("INPUT:" + input())\r');
  await new Promise(resolve => setTimeout(resolve,100));
  await send('hello\r',/INPUT:hello/);
  python.write(item.id,'while True: pass\r\r');
  await new Promise(resolve => setTimeout(resolve,100));
  await send('\x03',/KeyboardInterrupt/);
  await send('1 + 1\r',/(?:^|\n)2(?:\n|$)/);
  await send('solut\t10)\r',/(?:^|\n)23(?:\n|$)/);
  await send('\x1b[A\r',/(?:^|\n)23(?:\n|$)/);
  python.write(item.id,'exit()\r');
  await waitFor(() => !python.sessions.has(item.id));
  output[item.id] = '';
  await python.restart(item.id,store.file(item.id));
  await waitFor(() => />>>/.test(output[item.id] || ''));
  await send('solution(7)\r',/(?:^|\n)14(?:\n|$)/);
});

test('Codex streams ephemeral chats, discovers model efforts, and applies live search and per-turn settings', { timeout:10000 }, async t => {
  const root = await temporary(t); const store = new Store(root); await store.init();
  const script = path.join(root,'fake-codex.cjs');
  const executable = await fakeServer(script);
  await fs.writeFile(script,`#!/usr/bin/env node
const rl = require('node:readline').createInterface({ input:process.stdin });
const fs = require('node:fs');
fs.writeFileSync('argv.log',JSON.stringify(process.argv));
const send = x => process.stdout.write(JSON.stringify(x)+'\\n');
let initialized = false;
rl.on('line', line => { const m = JSON.parse(line); let result = {}; fs.appendFileSync('rpc.log',line+'\\n');
  if (m.method === 'initialize') result = { userAgent:'test' };
  else if (m.method === 'initialized') { initialized = true; return; }
  else if (!initialized) return send({ id:m.id,error:{ message:'Not initialized' } });
  else if (m.method === 'account/read') result = { requiresOpenaiAuth:false,account:null };
  else if (m.method === 'model/list') result = m.params.cursor ? { data:[{ id:'fast',model:'fast',displayName:'Fast',isDefault:false,defaultReasoningEffort:'low',supportedReasoningEfforts:[{ reasoningEffort:'low',description:'Fast' },{ reasoningEffort:'high',description:'Deep' }] }] } : { data:[{ id:'test',model:'test',displayName:'Test',isDefault:true,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{ reasoningEffort:'medium',description:'Balanced' },{ reasoningEffort:'high',description:'Deep' }] }],nextCursor:'second' };
  else if (m.method === 'config/read') result = { config:{ model:'test',model_reasoning_effort:'medium' } };
  else if (m.method === 'thread/start') { if(m.params.sandbox!=='read-only' || !m.params.ephemeral) process.exit(8); result = { thread:{ id:'thread-test' } }; }
  else if (m.method === 'thread/resume') result = { thread:{ id:m.params.threadId } };
  else if (m.method === 'turn/start') {
    if (!m.params.input[0].text.includes('現在のPythonコード')) process.exit(9);
    result = { turn:{ id:'turn-test',status:'inProgress' } };
    setTimeout(() => {
      send({ method:'turn/started',params:{ threadId:m.params.threadId,turn:{ id:'turn-test' } } });
      send({ method:'item/agentMessage/delta',params:{ threadId:m.params.threadId,delta:'型を' } });
      send({ method:'item/agentMessage/delta',params:{ threadId:m.params.threadId,delta:'確認しましょう。' } });
      send({ method:'turn/completed',params:{ threadId:m.params.threadId,turn:{ id:'turn-test',status:'completed' } } });
    },40);
  }
  if(m.id !== undefined) send({ id:m.id,result });
});`,{ mode:0o755 });
  const events = []; const codex = new Codex(store,e => events.push(e),executable); t.after(() => codex.close());
  const item = await store.create('Solution.py',example); await codex.connect(); assert.equal(codex.status.state,'connected');
  assert.deepEqual(codex.status.models.map(model => model.id),['test','fast']);
  assert.deepEqual(codex.status.models[0].supportedReasoningEfforts.map(option => option.effort),['medium','high']);
  assert.equal(codex.status.defaultModel,'test');
  await codex.ask(item.id,'ヒントをください','solution 10\n23','test','high',example+'\n-- unsaved chat context');
  await new Promise(r => setTimeout(r,100));
  assert.equal(store.find(item.id).threadId,'thread-test');
  assert.equal(store.find(item.id).messages.at(-1).text,'型を確認しましょう。');
  assert.equal(store.find(item.id).messages.at(-1).pending,false);
  assert.ok(events.some(x => x.type==='ai-message'));
  codex.loaded.clear();
  await codex.ask(item.id,'もう少し詳しく','','');
  await new Promise(r => setTimeout(r,100));
  assert.equal(store.find(item.id).messages.length,4);
  await codex.ask(item.id,'別のモデルで','','fast','high');
  await new Promise(r => setTimeout(r,100));
  await codex.ask(item.id,'標準の推論レベルで','','fast');
  await new Promise(r => setTimeout(r,100));
  await assert.rejects(codex.ask(item.id,'未対応の推論','','fast','ultra'),/推論レベル/);
  assert.equal(store.find(item.id).messages.at(-1).pending,false);
  const requests = (await fs.readFile(path.join(root,'rpc.log'),'utf8')).trim().split('\n').map(JSON.parse);
  const turns = requests.filter(request => request.method === 'turn/start').map(request => request.params);
  assert.deepEqual(turns.map(turn => [turn.model,turn.effort]),[['test','high'],['test','medium'],['fast','high'],['fast','low']]);
  assert.match(turns[0].input[0].text,/unsaved chat context/);
  assert.equal((await store.open(item.id)).code,example,'asking about unsaved code does not save it');
  for (const request of requests.filter(request => ['thread/start','thread/resume'].includes(request.method))) {
    assert.equal(request.params.config.web_search,'live');
    assert.equal(request.params.config['features.shell_tool'],false);
  }
  const instructions = requests.find(request => request.method === 'thread/start').params.developerInstructions;
  assert.match(instructions,/may use the built-in web search/);
  const argv = JSON.parse(await fs.readFile(path.join(root,'argv.log'),'utf8'));
  assert.ok(argv.includes('web_search="live"'));
  assert.ok(argv.includes('features.shell_tool=false'));
  await store.writes;
  const reopened = new Store(root); await reopened.init();
  assert.deepEqual(reopened.find(item.id).messages,[]);
  assert.equal(reopened.find(item.id).threadId,null);
  assert.equal((await fs.readdir(root)).some(name => name.endsWith('.json')),false);
});

test('a running Python file accepts input before its first prompt', { timeout:10000 }, async t => {
  const root = await temporary(t), store = new Store(root); await store.init();
  const item = await store.create('input.py','name = input("Name: ")\nprint("Hello, " + name)\n');
  let output = '';
  const python = new Python(e => { if (e.type === 'python-data') output += e.data; });
  t.after(() => python.close());
  const load = python.load(item.id,store.file(item.id));
  await waitFor(() => output.includes('Name: '));
  python.write(item.id,'Python\r');
  assert.match(await load,/Hello, Python/);
  const rerun = python.reload(item.id);
  await waitFor(() => output.split('Name: ').length >= 3);
  python.write(item.id,'again\r');
  assert.match(await rerun,/Hello, again/);
});

test('explicit Python execution parses current tracebacks, recovers and rejects stale AI results', { timeout:20000 }, async t => {
  const root = await temporary(t), store = new Store(root); await store.init();
  const item = await store.create('日本語.py','answer = 42\n');
  const events = [], python = new Python(e => events.push(e),process.env.KATA_PYTHON || 'python3');
  t.after(() => python.close());
  const diagnostics = new PythonDiagnostics(store,python);
  await store.open(item.id);
  assert.equal(python.peek(item.id),null);
  const success = await diagnostics.load(item.id,100,30);
  assert.equal(success.success,true,success.output);
  const pid = python.sessions.get(item.id).proc.pid;
  await store.save(item.id,'def fail():\n    return 1 / 0\nfail()\n');
  const failure = await diagnostics.load(item.id);
  assert.equal(python.sessions.get(item.id).proc.pid,pid);
  assert.equal(failure.success,false,failure.output);
  assert.equal(failure.diagnostics[0].line,2);
  assert.match(failure.diagnostics[0].message,/ZeroDivisionError/);
  const ai = { explainDiagnostics:async () => new Map([[0,{ displayLine:2,explanation:'ゼロで除算しています。' }]]) };
  assert.match((await diagnostics.explain(item.id,failure.token,ai)).diagnostics[0].explanation,/ゼロ/);
  await store.save(item.id,'answer = 42\n');
  await assert.rejects(diagnostics.explain(item.id,failure.token,ai),/再読み込み/);
  const recovered = await diagnostics.load(item.id);
  assert.equal(recovered.success,true,recovered.output);
  assert.doesNotMatch(recovered.output,/ZeroDivisionError/);
  python.write(item.id,'1 / 0\r');
  await waitFor(() => events.some(e => e.type === 'python-diagnostic' && /<stdin>/.test(e.diagnostic.output)));
  assert.equal((await diagnostics.latest(item.id)).diagnostics[0].line,0);
  await python.stop(item.id);
  await store.save(item.id,'def invalid(:\n    pass\n');
  const syntax = await diagnostics.load(item.id);
  assert.equal(syntax.success,false,syntax.output);
  assert.equal(syntax.diagnostics[0].line,1);
  assert.match(syntax.output,/SyntaxError/);
  await store.save(item.id,'import sys\nprint("before exit")\nsys.exit(2)\n');
  const exited = await diagnostics.load(item.id);
  assert.equal(exited.success,false,exited.output);
  assert.match(exited.output,/SystemExit: 2/);
  await store.save(item.id,'print(">>> ")\nanswer = 42\n');
  assert.equal((await diagnostics.load(item.id)).success,true);
  assert.deepEqual((await fs.readdir(root)).filter(name => !name.startsWith('__pycache__')),['日本語.py']);
});

test('Python diagnostics select the innermost matching frame and leave unrelated errors unlocated', () => {
  const file = path.resolve('/tmp/日本語.py');
  const source = 'def fail():\n    return 1 / 0\nfail()\n';
  const output = 'Traceback (most recent call last):\n  File "/tmp/日本語.py", line 3, in <module>\n    fail()\n  File "/tmp/日本語.py", line 2, in fail\n    return 1 / 0\n           ~~^~~\nZeroDivisionError: division by zero\n';
  assert.deepEqual(parseDiagnostics(output,file,source).map(d => [d.line,d.severity]),[[2,'error']]);
  assert.deepEqual(parseDiagnostics('Traceback (most recent call last):\n  File "Other.py", line 1\nNameError: unknown',file,source),[]);
  assert.deepEqual(parseDiagnostics('  File "日本語.py", line 99\nSyntaxError: invalid',file,source),[]);
  const { hasDiagnostic } = require('../electron/python.cjs');
  assert.equal(hasDiagnostic('ValueError: bad'),true);
  assert.equal(hasDiagnostic('KeyboardInterrupt'),true);
  assert.equal(hasDiagnostic('42\n>>>'),false);
});

test('background AI uses structured output, isolates chat, validates indexes and handles failures', { timeout:10000 }, async t => {
  const root = await temporary(t), store = new Store(root); await store.init();
  const script = path.join(root,'diagnostic-codex.cjs');
  const executable = await fakeServer(script);
  await fs.writeFile(script,`#!/usr/bin/env node
const fs = require('node:fs');
const send = x => process.stdout.write(JSON.stringify(x)+'\\n');
let serial = 0;
require('node:readline').createInterface({ input:process.stdin }).on('line',line => {
  const m = JSON.parse(line); let result = {};
  fs.appendFileSync('requests.log',line+'\\n');
  if (m.method === 'account/read') result = { requiresOpenaiAuth:false };
  if (m.method === 'model/list') result = { data:[] };
  if (m.method === 'config/read') result = { config:{} };
  if (m.method === 'thread/start') result = { thread:{ id:'thread-'+(++serial) } };
  if (m.method === 'turn/start') {
    result = { turn:{ id:'turn-'+serial } };
    setTimeout(() => {
      const threadId=m.params.threadId, source=m.params.input[0].text;
      if (source.includes('DISCONNECT')) return process.exit(1);
      if (m.params.outputSchema) {
        const text = source.includes('MALFORMED') ? 'invalid JSON' : JSON.stringify({ diagnostics:[...(source.includes('BAD_LINES') ? [] : [{ index:0,displayLine:source.includes('UNLOCATED') ? 0 : 1,startColumn:source.includes('UNLOCATED') ? 0 : 1,endColumn:source.includes('UNLOCATED') ? 0 : 6,targetText:source.includes('UNLOCATED') ? '' : '# Pyth',explanation:source.includes('LONG_MESSAGE') ? '説明'.repeat(400)+'全文の末尾' : 'Intが必要ですが文字列になっています。数値に直してください。' }]),{ index:999,displayLine:1,explanation:'invalid index' },{ index:1,displayLine:1,explanation:'warning is not an error' },...[-1,1.5,999,'2',null,undefined].map(displayLine => ({ index:0,displayLine,explanation:'invalid location' }))] });
        send({ method:'item/agentMessage/delta',params:{ threadId,delta:'This is a preamble.' } });
        send({ method:'item/completed',params:{ threadId,item:{ type:'agentMessage',text } } });
      } else send({ method:'item/agentMessage/delta',params:{ threadId,delta:'チャットの応答' } });
      send({ method:'turn/completed',params:{ threadId,turn:{ status:source.includes('FAILED') ? 'failed' : 'completed',error:{ message:'test failure' } } } });
    },30);
  }
  if (m.id !== undefined) send({ id:m.id,result });
});`,{ mode:0o755 });
  const events = [], codex = new Codex(store,e => events.push(e),executable); t.after(() => codex.close());
  const item = await store.create('Solution.py');
  const report = { source:'# Python example\nx = "wrong"',diagnostics:[{ line:2,column:1,severity:'error',message:'type mismatch' },{ line:1,column:1,severity:'warning',message:'warning' }] };
  const [explanations] = await Promise.all([codex.explainDiagnostics(report),codex.ask(item.id,'ヒント','','','')]);
  await waitFor(() => !store.find(item.id).messages.at(-1).pending);
  assert.equal(explanations.size,1);
  assert.match(explanations.get(0).explanation,/Int/);
  assert.equal(explanations.get(0).displayLine,1,'AI can choose a different line from Python line 2');
  assert.deepEqual([explanations.get(0).startColumn,explanations.get(0).endColumn,explanations.get(0).targetText],[1,6,'# Pyth']);
  assert.equal(item.messages.length,2);
  assert.equal(item.messages.at(-1).text,'チャットの応答');
  assert.ok(events.filter(e => e.type === 'ai-message').every(e => !e.message.text.includes('Int')));
  assert.equal(codex.active.size,0);
  await assert.rejects(codex.explainDiagnostics({ ...report,source:'MALFORMED' }),/JSON/);
  await assert.rejects(codex.explainDiagnostics({ ...report,source:'FAILED' }),/test failure/);
  await assert.rejects(codex.explainDiagnostics({ ...report,source:'BAD_LINES' }),/説明を取得できません/);
  const unlocated = await codex.explainDiagnostics({ ...report,source:'UNLOCATED' });
  assert.equal(unlocated.get(0).displayLine,0,'unlocated explanations stay out of source lines');
  const longMessage = await codex.explainDiagnostics({ ...report,source:'LONG_MESSAGE' });
  assert.equal(longMessage.get(0).explanation,'説明'.repeat(400)+'全文の末尾','AI messages are not truncated at 500 characters');
  const requests = (await fs.readFile(path.join(root,'requests.log'),'utf8')).trim().split('\n').map(JSON.parse);
  const background = requests.find(r => r.method === 'turn/start' && r.params.outputSchema);
  assert.deepEqual(background.params.outputSchema.required,['diagnostics']);
  assert.deepEqual(background.params.outputSchema.properties.diagnostics.items.required,['index','displayLine','startColumn','endColumn','targetText','explanation']);
  const input = JSON.parse(background.params.input[0].text);
  assert.deepEqual(input.source,[{ line:1,text:'# Python example' },{ line:2,text:'x = "wrong"' }]);
  const thread = requests.find(r => r.method === 'thread/start' && r.params.developerInstructions.includes('Python load errors'));
  assert.equal(thread.params.sandbox,'read-only'); assert.equal(thread.params.ephemeral,true);
  assert.equal(thread.params.config.web_search,'disabled');
  assert.ok(requests.some(r => r.method === 'thread/archive'));
  await assert.rejects(codex.explainDiagnostics({ ...report,source:'DISCONNECT' }),/接続が終了/);
  assert.equal(item.messages.length,2,'background failures also leave chat history untouched');
});


test('AI source ranges validate exact fragments, Unicode columns and ambiguous locations', () => {
  const source = ['value = "😀あbad"','foo + foo','\tvalue = 42'];
  assert.deepEqual(diagnosticRange(source,{ displayLine:1,startColumn:9,endColumn:15,targetText:'"😀あbad"' }),{ startColumn:9,endColumn:15,targetText:'"😀あbad"' });
  assert.deepEqual(diagnosticRange(source,{ displayLine:1,startColumn:10,endColumn:16,targetText:'"😀あbad"' }),{ startColumn:9,endColumn:15,targetText:'"😀あbad"' },'a unique exact quote corrects mistaken column counting');
  assert.deepEqual(diagnosticRange(source,{ displayLine:3,startColumn:10,endColumn:11,targetText:'42' }),{ startColumn:10,endColumn:11,targetText:'42' },'tabs count as one code point');
  const empty = { startColumn:0,endColumn:0,targetText:'' };
  for (const d of [
    { displayLine:0,startColumn:1,endColumn:3,targetText:'foo' },
    { displayLine:99,startColumn:1,endColumn:3,targetText:'foo' },
    { displayLine:2,startColumn:-1,endColumn:99,targetText:'foo' },
    { displayLine:2,startColumn:5,endColumn:6,targetText:'foo' },
    { displayLine:1,startColumn:1,endColumn:1,targetText:'missing' },
    { displayLine:1,startColumn:10,endColumn:10,targetText:'\uD83D' },
    { displayLine:1,startColumn:0,endColumn:0,targetText:'' },
    { displayLine:1,startColumn:1,endColumn:2,targetText:'value\nbad' }
  ]) assert.deepEqual(diagnosticRange(source,d),empty);
  assert.deepEqual(diagnosticRange(source,{ displayLine:2,startColumn:7,endColumn:9,targetText:'foo' }),{ startColumn:7,endColumn:9,targetText:'foo' },'a valid range disambiguates repeated source text');
});

test('workspace services silence retired events and await processes and pending writes exactly once', async () => {
  const { EventEmitter } = require('node:events');
  const { WorkspaceServices } = require('../electron/workspace-services.cjs');
  let finishPython, finishWrites, watchCallback, watcherClosed = 0, pythonClosed = 0, codexClosed = 0;
  const store = { root:'/test',writes:new Promise(resolve => { finishWrites = resolve; }) };
  const watcher = new EventEmitter(); watcher.close = () => { watcherClosed++; };
  const proc = new EventEmitter(); proc.exitCode = null; proc.signalCode = null;
  const events = [];
  class FakePython {
    constructor(emit) { this.emit = emit; }
    close() {
      pythonClosed++; this.emit({ type:'python-exit',id:'old' });
      return new Promise(resolve => { finishPython = resolve; });
    }
  }
  class FakeCodex {
    constructor(_,emit) { this.emit = emit; this.proc = proc; }
    close() { codexClosed++; this.emit({ type:'codex-status',status:{ state:'error' } }); }
  }
  class FakeDiagnostics { close() { this.closed = true; } }
  const services = new WorkspaceServices(store,event => events.push(event),{
    Python:FakePython,Codex:FakeCodex,PythonDiagnostics:FakeDiagnostics,
    watch:(_,callback) => { watchCallback = callback; return watcher; }
  });
  services.python.emit({ type:'python-data',id:'old' });
  watchCallback('change','Solution.py'); // Pending debounce must also be canceled.
  let closed = false;
  const closing = services.close(); closing.then(() => { closed = true; });
  assert.equal(services.close(),closing,'closing is idempotent');
  assert.equal(services.diagnostics.closed,true);
  services.python.emit({ type:'python-diagnostic',id:'old' });
  watcher.emit('error',new Error('late watcher error'));
  watchCallback('change','Solution.py');
  await new Promise(resolve => setTimeout(resolve,220));
  assert.deepEqual(events,[{ type:'python-data',id:'old' }],'no event escapes from retired services');
  finishPython(); finishWrites(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed,false,'Codex exit must be awaited too');
  proc.emit('exit',0);
  await closing;
  assert.equal(closed,true);
  assert.deepEqual([watcherClosed,pythonClosed,codexClosed],[1,1,1]);
});

test('retired services cannot spawn processes from delayed load or connection requests', async () => {
  const python = new Python(() => {});
  let finishRead;
  const store = { open:() => new Promise(resolve => { finishRead = resolve; }),file:() => '/unused.py' };
  const diagnostics = new PythonDiagnostics(store,python);
  const pending = diagnostics.load('file',80,24);
  await python.close();
  finishRead({ code:'answer = 42' });
  await assert.rejects(pending,/終了しています/);
  assert.equal(python.sessions.size,0);
  const codex = new Codex({},() => {});
  codex.close();
  await assert.rejects(codex.connect(),/終了しています/);
  assert.equal(codex.proc,undefined);
});
