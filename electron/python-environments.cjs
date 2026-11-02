const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const runFile = promisify(execFile);

const defaultPython = () => process.env.PYNOTE_PYTHON || process.env.KATA_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
async function probePython(executable) {
  if (typeof executable !== 'string' || !executable || executable.includes('\0')) throw new Error('Python実行ファイルを指定してください。');
  try {
    const { stdout } = await runFile(executable,['-c','import sys, json; print(json.dumps({"executable": sys.executable, "version": ".".join(map(str, sys.version_info[:3])), "prefix": sys.prefix, "major": sys.version_info[0]}))'],{
      timeout:5000,maxBuffer:256_000,windowsHide:true,env:{ ...process.env,PYTHONIOENCODING:'utf-8' }
    });
    const info = JSON.parse(stdout.trim());
    if (info.major !== 3 || !path.isAbsolute(info.executable) || typeof info.version !== 'string' || typeof info.prefix !== 'string') throw new Error('Python 3 が必要です。');
    // Do not realpath: a venv executable is often a symlink to the base Python.
    return { executable:info.executable,version:info.version,prefix:info.prefix };
  } catch (error) { throw new Error(`Pythonを確認できません (${executable}): ${error.message}`); }
}

function kernelRoots(env=process.env, platform=process.platform, home=os.homedir(), prefix) {
  const roots = (env.JUPYTER_PATH || '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  if (env.JUPYTER_DATA_DIR) roots.push(env.JUPYTER_DATA_DIR);
  else if (platform === 'win32') roots.push(path.join(env.APPDATA || path.join(home,'AppData','Roaming'),'jupyter'));
  else if (platform === 'darwin') roots.push(path.join(home,'Library','Jupyter'),path.join(home,'Library','Application Support','Jupyter'));
  else roots.push(path.join(env.XDG_DATA_HOME || path.join(home,'.local','share'),'jupyter'));
  if (prefix) roots.push(path.join(prefix,'share','jupyter'));
  if (platform === 'win32') roots.push(path.join(env.PROGRAMDATA || 'C:\\ProgramData','jupyter'));
  else roots.push('/usr/local/share/jupyter','/usr/share/jupyter');
  return [...new Set(roots.map(root => path.join(root,'kernels')))];
}

async function discoverKernels({ roots,run=runFile }={}) {
  const kernels = new Map(), warnings = [];
  // Let Jupyter account for its own installation, custom paths and precedence.
  if (!roots) {
    try {
      const { stdout } = await run('jupyter',['kernelspec','list','--json'],{ timeout:5000,maxBuffer:2_000_000,windowsHide:true });
      const specs = JSON.parse(stdout).kernelspecs;
      for (const [name,value] of Object.entries(specs || {})) kernels.set(name,value.spec);
    } catch (error) {
      if (error.code !== 'ENOENT') warnings.push('Jupyterコマンドから一覧を取得できなかったため、標準の登録先を参照しています。');
    }
    let prefix;
    try { prefix = (await probePython(defaultPython())).prefix; } catch { /* Manual selection still works without a default Python. */ }
    roots = kernelRoots(process.env,process.platform,os.homedir(),prefix);
  }
  for (const root of roots) {
    let names;
    try { names = await fs.readdir(root); }
    catch (error) { if (error.code !== 'ENOENT') warnings.push(`登録先を読み込めません: ${root}`); continue; }
    for (const name of names.sort()) {
      if (kernels.has(name)) continue;
      try {
        const file = path.join(root,name,'kernel.json');
        if ((await fs.stat(file)).size > 256_000) throw new Error('設定ファイルが大きすぎます');
        kernels.set(name,JSON.parse(await fs.readFile(file,'utf8')));
      } catch { warnings.push(`Jupyter登録を読み込めません: ${name}`); }
    }
  }
  return { kernels:[...kernels].flatMap(([name,spec]) => {
    if (typeof spec?.language !== 'string' || spec.language.toLowerCase() !== 'python') return [];
    const executable = spec.argv?.[0];
    if (typeof executable !== 'string' || !executable) { warnings.push(`Python実行ファイルが未設定です: ${name}`); return []; }
    // Only the interpreter is reused. Never execute a kernelspec's launch arguments.
    return [{ name,label:typeof spec.display_name === 'string' ? spec.display_name : name,executable }];
  }),warnings };
}

class PythonEnvironments {
  constructor(configRoot,options={}) {
    this.file = path.join(configRoot,'python-environments.json');
    this.folders = {}; this.history = []; this.warning = null;
    this.probe = options.probe || probePython;
    this.discover = options.discover || discoverKernels;
  }
  async init() {
    try {
      const data = JSON.parse(await fs.readFile(this.file,'utf8'));
      this.folders = Object.fromEntries(Object.entries(data.folders || {}).filter(([,value]) => typeof value === 'string' && path.isAbsolute(value)));
      this.history = Array.isArray(data.history) ? data.history.filter(value => typeof value === 'string' && path.isAbsolute(value)).slice(0,20) : [];
    } catch (error) { if (error.code !== 'ENOENT') this.warning = 'Python環境の設定を読み込めませんでした。環境を選択し直してください。'; }
  }
  current(folder) {
    const selected = this.folders[folder] || null;
    return { folder,selected,executable:selected || defaultPython() };
  }
  async list(folder) {
    const current = this.current(folder);
    const { kernels,warnings } = await this.discover();
    const candidates = [
      { label:'既定の Python',executable:defaultPython(),kind:'default' },
      ...(current.selected ? [{ label:'選択中',executable:current.selected,kind:'selected' }] : []),
      ...kernels.map(k => ({ ...k,kind:'jupyter' })),
      ...this.history.filter(executable => executable !== current.selected).map(executable => ({ label:path.basename(path.dirname(executable)),executable,kind:'history' }))
    ];
    const cache = new Map();
    const environments = [];
    for (let offset=0;offset<candidates.length;offset+=4) {
      const batch = await Promise.all(candidates.slice(offset,offset+4).map(async candidate => {
        if (!cache.has(candidate.executable)) cache.set(candidate.executable,this.probe(candidate.executable).then(info => ({ ...info,available:true }),error => ({ available:false,error:error.message })));
        return { ...candidate,...await cache.get(candidate.executable) };
      }));
      environments.push(...batch);
    }
    return { ...current,environments,warnings:[...(this.warning ? [this.warning] : []),...warnings] };
  }
  async select(folder,executable) {
    if (executable !== null && (typeof executable !== 'string' || !path.isAbsolute(executable))) throw new Error('Python実行ファイルの絶対パスを指定してください。');
    const info = await this.probe(executable || defaultPython());
    const folders = { ...this.folders };
    if (executable === null) delete folders[folder]; else folders[folder] = info.executable;
    const history = executable === null ? this.history : [info.executable,...this.history.filter(value => value !== info.executable)].slice(0,20);
    await fs.mkdir(path.dirname(this.file),{ recursive:true });
    await fs.writeFile(this.file+'.tmp',JSON.stringify({ folders,history },null,2));
    await fs.rename(this.file+'.tmp',this.file);
    this.folders = folders; this.history = history; this.warning = null;
    return this.current(folder);
  }
}
module.exports = { PythonEnvironments,probePython,discoverKernels,kernelRoots,defaultPython };
