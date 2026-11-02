const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Store } = require('./store.cjs');

// Convert the old ID-directory layout once; retain originals in app settings.
async function migrateLegacy(root, configRoot) {
  let items;
  try { items = JSON.parse(await fs.readFile(path.join(root,'index.json'),'utf8')); }
  catch (e) { if (e.code === 'ENOENT' || e instanceof SyntaxError) return; throw e; }
  if (!Array.isArray(items) || !items.every(item => /^[a-f0-9-]{36}$/i.test(item.id) && typeof item.title === 'string')) return;
  const archive = path.join(configRoot,`legacy-workspace-${randomUUID()}`);
  await fs.mkdir(archive,{ recursive:true });
  for (const item of items) {
    const directory = path.join(root,item.id); const source = path.join(directory,'Solution.py');
    let code, stat;
    try { [code,stat] = await Promise.all([fs.readFile(source),fs.stat(source)]); }
    catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    const base = item.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/,'').slice(0,100).replace(/\.py$/i,'') || 'Solution';
    for (let suffix=1; ;suffix++) {
      const target = path.join(root,`${base}${suffix===1?'':` ${suffix}`}.py`);
      try { await fs.writeFile(target,code,{ flag:'wx' }); await fs.utimes(target,stat.atime,stat.mtime); break; }
      catch (e) { if (e.code !== 'EEXIST') throw e; if ((await fs.readFile(target)).equals(code)) break; }
    }
    await fs.rename(directory,path.join(archive,item.id));
  }
  await fs.rename(path.join(root,'index.json'),path.join(archive,'index.json'));
  return archive;
}

class Workspace {
  constructor(defaultRoot, configRoot, initialFolder) {
    this.defaultRoot = path.resolve(defaultRoot); this.configRoot = configRoot;
    this.initialFolder = initialFolder; this.settingsFile = path.join(configRoot,'workspace.json');
  }
  async init() {
    await fs.mkdir(this.defaultRoot,{ recursive:true });
    await migrateLegacy(this.defaultRoot,this.configRoot);
    let saved;
    try { saved = JSON.parse(await fs.readFile(this.settingsFile,'utf8')).folder; }
    catch (e) { if (e.code !== 'ENOENT') this.warning = 'フォルダー設定を読み込めなかったため、標準フォルダーを開きました。'; }
    try { await this.setFolder(this.initialFolder || saved || this.defaultRoot,false); }
    catch (error) {
      this.warning = `保存先フォルダーを開けませんでした。フォルダー設定から選び直してください。${error.message}`;
      await this.setFolder(this.defaultRoot,false);
    }
  }
  info() { return { path:this.store.root, name:path.basename(this.store.root), warning:this.warning || null }; }
  async setFolder(folder, remember = true) {
    if (this.store) await this.store.writes;
    const next = new Store(folder); await next.init();
    const unchanged = this.store?.root === next.root;
    if (remember) {
      await fs.mkdir(this.configRoot,{ recursive:true });
      await fs.writeFile(this.settingsFile+'.tmp',JSON.stringify({ folder:next.root }));
      await fs.rename(this.settingsFile+'.tmp',this.settingsFile);
    }
    if (!unchanged) this.store = next;
    if (remember) this.warning = null;
    return this.info();
  }
}
module.exports = { Workspace, migrateLegacy };
