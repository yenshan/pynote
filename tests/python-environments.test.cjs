const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { PythonEnvironments,probePython,discoverKernels,kernelRoots } = require('../electron/python-environments.cjs');
const { Python } = require('../electron/python.cjs');
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'pynote-env-test-'));
  t.after(() => fs.rm(root,{ recursive:true,force:true }));
  return root;
}
async function kernel(root,name,spec) {
  await fs.mkdir(path.join(root,name),{ recursive:true });
  await fs.writeFile(path.join(root,name,'kernel.json'),JSON.stringify(spec));
}

test('discovers Python kernels with paths and names, respects precedence, and tolerates broken registrations',async t => {
  const root = await temporary(t), first = path.join(root,'first'), second = path.join(root,'second');
  await kernel(first,'shared',{ language:'python',display_name:'日本語 venv',argv:['/a folder/.venv/bin/python','-m','ipykernel_launcher','-f','{connection_file}'] });
  await kernel(second,'shared',{ language:'python',display_name:'shadowed',argv:['/other/python'] });
  await kernel(first,'julia',{ language:'julia',argv:['julia'] });
  await kernel(first,'empty',{ language:'python',argv:[] });
  await kernel(first,'missing',{ language:'python',display_name:'deleted venv',argv:['/missing/python'] });
  await fs.mkdir(path.join(first,'broken')); await fs.writeFile(path.join(first,'broken','kernel.json'),'not JSON');
  const found = await discoverKernels({ roots:[first,second,path.join(root,'absent')] });
  assert.deepEqual(found.kernels.map(k => k.label),['deleted venv','日本語 venv']);
  assert.equal(found.kernels.find(k => k.name === 'shared').executable,'/a folder/.venv/bin/python');
  assert.equal(found.warnings.length,2);
  const roots = kernelRoots({ JUPYTER_PATH:'/extra:/second',JUPYTER_DATA_DIR:'/custom' },'linux','/home/test','/venv');
  assert.deepEqual(roots.slice(0,4),['/extra/kernels','/second/kernels','/custom/kernels','/venv/share/jupyter/kernels']);
  assert.ok(kernelRoots({},'darwin','/Users/test').includes('/Users/test/Library/Jupyter/kernels'));
});

test('environment choices persist per folder; invalid selections keep the current setting and history',async t => {
  const root = await temporary(t), a = path.join(root,'a'), b = path.join(root,'b');
  const exe = path.join(root,'venv','bin','python');
  const options = {
    probe:async executable => { if (executable.includes('missing')) throw new Error('not found'); return { executable:path.isAbsolute(executable) ? executable : '/default/python',version:'3.13.1',prefix:root }; },
    discover:async () => ({ kernels:[{ name:'missing',label:'deleted',executable:'/missing/python' }],warnings:[] })
  };
  const env = new PythonEnvironments(root,options); await env.init();
  await env.select(a,exe);
  assert.equal(env.current(a).selected,exe);
  assert.equal(env.current(b).selected,null);
  await assert.rejects(env.select(a,'/missing/python'),/not found/);
  await assert.rejects(env.select(a,'relative/python'),/絶対パス/);
  assert.equal(env.current(a).selected,exe);
  const reopened = new PythonEnvironments(root,options); await reopened.init();
  assert.equal(reopened.current(a).selected,exe);
  const list = await reopened.list(b);
  assert.equal(list.environments.find(option => option.kind === 'jupyter').available,false);
  assert.equal(list.environments.find(option => option.kind === 'history').executable,exe);
  await reopened.select(a,null);
  assert.equal(reopened.current(a).selected,null);
  assert.deepEqual(reopened.history,[exe]);
});

test('an explicitly selected real venv uses its own site-packages without activation or ipykernel', { timeout:20000 },async t => {
  const root = await temporary(t), venv = path.join(root,'venv with spaces');
  const python = process.env.PYNOTE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  await execFile(python,['-m','venv','--without-pip',venv],{ timeout:10000 });
  const exe = path.join(venv,process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const info = await probePython(exe);
  assert.equal(info.executable,exe,'preserve the venv symlink path');
  assert.equal(info.prefix,venv);
  const { stdout } = await execFile(exe,['-c','import sysconfig; print(sysconfig.get_path("purelib"))']);
  await fs.writeFile(path.join(stdout.trim(),'pynote_environment_probe.py'),'value = "VENV_LIBRARY_OK"\n');
  const file = path.join(root,'test.py');
  await fs.writeFile(file,'import sys, pynote_environment_probe\nprint(pynote_environment_probe.value)\nprint(sys.prefix)\n');
  const runner = new Python(() => {},exe); t.after(() => runner.close());
  const output = await runner.load(file,file);
  assert.match(output,/VENV_LIBRARY_OK/);
  assert.ok(output.includes(venv));
});

test('replacing Python retires sessions and diagnostics while preserving AI and the folder watcher',async () => {
  const { EventEmitter } = require('node:events');
  const { WorkspaceServices } = require('../electron/workspace-services.cjs');
  const instances = [], events = [];
  let codexClosed = false, watcherClosed = false;
  class FakePython {
    constructor(emit,exe) { this.emit = emit; this.exe = exe; instances.push(this); }
    async close() { this.closed = true; this.emit({ type:'python-diagnostic',id:'old' }); }
  }
  class FakeDiagnostics { close() { this.closed = true; } }
  class FakeCodex { close() { codexClosed = true; } }
  const watcher = new EventEmitter(); watcher.close = () => { watcherClosed = true; };
  const services = new WorkspaceServices({ root:'/test',writes:Promise.resolve() },event => events.push(event),{
    Python:FakePython,PythonDiagnostics:FakeDiagnostics,Codex:FakeCodex,watch:() => watcher,pythonExecutable:'/first/python'
  });
  const oldDiagnostics = services.diagnostics, codex = services.codex;
  await services.replacePython('/second/python');
  assert.equal(instances[0].closed,true);
  assert.equal(oldDiagnostics.closed,true);
  assert.equal(services.python.exe,'/second/python');
  assert.equal(services.codex,codex);
  assert.equal(codexClosed,false); assert.equal(watcherClosed,false);
  instances[0].emit({ type:'python-data',id:'old' });
  assert.deepEqual(events,[]);
  instances[1].emit({ type:'python-data',id:'new' });
  assert.equal(events.length,1);
  await services.close();
});
