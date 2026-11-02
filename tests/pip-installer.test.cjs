const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { PipInstaller,packageName } = require('../electron/pip-installer.cjs');
const python = process.env.PYNOTE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'pynote-pip-test-'));
  t.after(() => fs.rm(root,{ recursive:true,force:true })); return root;
}
async function venv(root,withPip=false) {
  const directory = path.join(root,'selected venv');
  await execFile(python,['-m','venv',...(withPip ? [] : ['--without-pip']),directory],{ timeout:20000 });
  return path.join(directory,process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
}
async function until(predicate) {
  for (let i=0;i<300;i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve,20)); }
  throw new Error('Timed out waiting for pip');
}

test('accepts one package name and rejects options, URLs, paths and version specifiers',() => {
  for (const value of ['numpy','scikit-learn','Pillow','a','zope.interface','my_package']) assert.equal(packageName(value),value);
  assert.equal(packageName(' numpy '),'numpy');
  for (const value of ['',null,42,'--user','-r file','numpy pandas','numpy==1.0','numpy[extra]','https://example.com/a','../package','foo;echo hi','foo\nbar','a'.repeat(201)]) assert.throws(() => packageName(value),/パッケージ名/);
});

test('installs a real local wheel into the selected venv and reports pip failure without network access', { timeout:30000 },async t => {
  const root = await temporary(t), executable = await venv(root,true);
  const wheels = path.join(root,'wheels'); await fs.mkdir(wheels);
  await execFile(python,['-c',`
import zipfile, pathlib, sys
root = pathlib.Path(sys.argv[1])
files = {
'pynote_install_probe/__init__.py': 'value = "INSTALLED_IN_SELECTED_VENV"\\n',
'pynote_install_probe-0.0.1.dist-info/METADATA': 'Metadata-Version: 2.1\\nName: pynote-install-probe\\nVersion: 0.0.1\\n',
'pynote_install_probe-0.0.1.dist-info/WHEEL': 'Wheel-Version: 1.0\\nGenerator: pynote-test\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n'
}
files['pynote_install_probe-0.0.1.dist-info/RECORD'] = ''.join(name + ',,\\n' for name in [*files, 'pynote_install_probe-0.0.1.dist-info/RECORD'])
with zipfile.ZipFile(root/'pynote_install_probe-0.0.1-py3-none-any.whl', 'w') as wheel:
    for name, content in files.items(): wheel.writestr(name, content)
`,wheels]);
  const events = [], installer = new PipInstaller(event => events.push(event),{
    env:{ ...process.env,PIP_NO_INDEX:'1',PIP_FIND_LINKS:wheels,PIP_CONFIG_FILE:os.devNull }
  });
  t.after(() => installer.close());
  const environment = { folder:root,executable };
  const initial = installer.start(environment,'pynote-install-probe');
  assert.equal(initial.status,'running');
  assert.throws(() => installer.start(environment,'numpy'),/インストール中/);
  await installer.job.ended;
  const success = installer.snapshot();
  assert.equal(success.status,'success',success.output);
  assert.equal(success.executable,executable);
  assert.ok(events.length > 2,'stream installation output');
  assert.ok(events.every((event,index) => index === 0 || event.job.seq > events[index-1].job.seq));
  const { stdout } = await execFile(executable,['-c','import sys, pynote_install_probe; print(pynote_install_probe.value); print(sys.prefix)']);
  assert.match(stdout,/INSTALLED_IN_SELECTED_VENV/);
  assert.ok(stdout.includes(path.dirname(path.dirname(executable))));
  installer.start(environment,'pynote-package-that-does-not-exist');
  await installer.job.ended;
  assert.equal(installer.snapshot().status,'error');
  assert.match(installer.snapshot().output,/No matching distribution|Could not find/);
});

test('missing pip is shown as an error in the selected environment', { timeout:15000 },async t => {
  const root = await temporary(t), executable = await venv(root);
  const installer = new PipInstaller(() => {}); t.after(() => installer.close());
  installer.start({ folder:root,executable },'numpy');
  await installer.job.ended;
  assert.equal(installer.snapshot().status,'error');
  assert.match(installer.snapshot().output,/選択中の環境に pip がありません/);
});

test('cancellation terminates the install process and shutdown prevents new jobs', { timeout:15000 },async t => {
  const root = await temporary(t), executable = await venv(root);
  const { stdout } = await execFile(executable,['-c','import sysconfig; print(sysconfig.get_path("purelib"))']);
  await fs.writeFile(path.join(stdout.trim(),'pip.py'),'import time\nprint("WAITING", flush=True)\ntime.sleep(30)\n');
  const installer = new PipInstaller(() => {}); t.after(() => installer.close());
  const job = installer.start({ folder:root,executable },'numpy');
  await until(() => installer.snapshot().output.includes('WAITING'));
  installer.cancel('stale-id'); assert.equal(installer.busy,true);
  installer.cancel(job.id);
  await installer.job.ended;
  assert.equal(installer.snapshot().status,'cancelled');
  assert.equal(installer.busy,false);
  await installer.close();
  assert.throws(() => installer.start({ folder:root,executable },'numpy'),/終了/);
});
