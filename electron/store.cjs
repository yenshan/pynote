const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const starter = `def solve(numbers):\n    return sum(numbers)\n\n\nif __name__ == "__main__":\n    print(solve([1, 2, 3]))\n`;

function fileName(input) {
  const name = String(input || '').trim();
  if (!name || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || name === '..') {
    throw new Error('ファイル名を入力してください。フォルダー区切りや特殊文字は使用できません。');
  }
  const result = /\.py$/i.test(name) ? name : name + '.py';
  if (Buffer.byteLength(result) > 240 || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result)) throw new Error('このファイル名は使用できません。');
  return result;
}

class Store {
  constructor(root) { this.root = path.resolve(root); this.items = []; this.writes = Promise.resolve(); }
  async init() {
    const stat = await fs.stat(this.root);
    if (!stat.isDirectory()) throw new Error('フォルダーを選択してください。');
    this.root = await fs.realpath(this.root);
    await this.list();
  }
  find(id) { const item = this.items.find(x => x.id === id); if (!item) throw new Error('ファイルが見つかりません。フォルダーの一覧を更新してください。'); return item; }
  file(id) { return this.find(id).id; }
  async list() {
    await this.writes;
    const entries = await fs.readdir(this.root, { withFileTypes:true });
    const previous = new Map(this.items.map(item => [item.id,item]));
    const next = await Promise.all(entries.filter(entry => entry.isFile() && /\.py$/i.test(entry.name)).map(async entry => {
      const id = path.join(this.root,entry.name);
      try {
        const stat = await fs.stat(id);
        const item = previous.get(id) || { id, messages:[], threadId:null };
        Object.assign(item, { title:entry.name, fileName:entry.name, createdAt:(stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime).toISOString(), updatedAt:stat.mtime.toISOString() });
        return item;
      } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    }));
    this.items = next.filter(Boolean).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || a.fileName.localeCompare(b.fileName));
    return this.items.map(({ messages, ...item }) => ({ ...item, messageCount:messages.length }));
  }
  enqueue(work) {
    const task = this.writes.catch(() => {}).then(work);
    this.writes = task.catch(() => {});
    return task;
  }
  async create(name, code = starter) {
    const target = path.join(this.root,fileName(name));
    await this.enqueue(async () => {
      try { await fs.writeFile(target,code,{ flag:'wx' }); }
      catch (error) { if (error.code === 'EEXIST') throw new Error('同じ名前のファイルがあります。別の名前を入力してください。'); throw error; }
    });
    await this.list(); return this.open(target);
  }
  async open(id) {
    await this.writes;
    const item = this.find(id);
    return { ...item, code:await fs.readFile(this.file(id),'utf8') };
  }
  async save(id, code) {
    if (typeof code !== 'string' || code.length > 2_000_000) throw new Error('ファイルが大きすぎます');
    const item = this.find(id); const target = this.file(id);
    return this.enqueue(async () => {
      const stat = await fs.lstat(target);
      if (!stat.isFile()) throw new Error('通常の .py ファイルのみ保存できます。');
      if (await fs.readFile(target,'utf8') === code) return { savedAt:stat.mtime.toISOString() };
      const temporary = path.join(this.root,`.kata-${randomUUID()}.tmp`);
      try {
        await fs.writeFile(temporary,code,{ flag:'wx', mode:stat.mode & 0o777 });
        await fs.rename(temporary,target);
      } finally { await fs.rm(temporary,{ force:true }); }
      item.updatedAt = (await fs.stat(target)).mtime.toISOString();
      return { savedAt:item.updatedAt };
    });
  }
}
module.exports = { Store, fileName };
