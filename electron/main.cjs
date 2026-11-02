const { app, BrowserWindow, ipcMain, shell, Menu, nativeTheme, dialog, screen, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { Workspace } = require('./workspace.cjs');
const { WorkspaceServices } = require('./workspace-services.cjs');
const { restoreWindowState, trackWindowState } = require('./window-state.cjs');
const root = path.resolve(__dirname, '..');
const env = name => process.env[`PYNOTE_${name}`] || process.env[`KATA_${name}`];
if (!app.isPackaged) {
  const runtime = env('RUNTIME') || path.join(root, '.runtime'); fs.mkdirSync(runtime, { recursive:true });
  app.setPath('userData', runtime); app.setPath('sessionData', runtime);
}
// Finder-launched macOS apps do not inherit the interactive shell PATH.
process.env.PATH = [...new Set([path.join(os.homedir(), '.pyenv/shims'), path.join(os.homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', ...(process.env.PATH || '').split(path.delimiter)])].join(path.delimiter);
let win, store, workspace, services, closeAllowed = false, rendererReady = false;
let serviceTransition = Promise.resolve();
const emit = event => { if (win && !win.isDestroyed()) win.webContents.send('kata:event', event); };
app.whenReady().then(async () => {
  nativeTheme.themeSource = 'light';
  workspace = new Workspace(env('WORKSPACE') || (app.isPackaged ? path.join(app.getPath('userData'),'workspace') : path.join(root,'workspace')), app.getPath('userData'), env('WORKSPACE'));
  await workspace.init(); store = workspace.store;
  function startServices() {
    services = new WorkspaceServices(store,emit,{
      pythonExecutable:env('PYTHON') || (process.platform === 'win32' ? 'python' : 'python3'),
      codexExecutable:env('CODEX') || 'codex'
    });
  }
  startServices();
  async function closeWindow() {
    const closingWindow = win;
    serviceTransition = serviceTransition.then(() => services.close());
    await serviceTransition;
    if (win === closingWindow && !closingWindow.isDestroyed()) {
      closeAllowed = true;
      closingWindow.close();
    }
  }
  const handlers = {
    'problems:list': () => store.list(),
    'problems:create': (_, title) => store.create(title),
    'problems:open': (_, id) => store.open(id),
    'problems:save': (_, id, code) => store.save(id, code),
    'workspace:info': () => workspace.info(),
    'workspace:choose': async () => {
      const result = await dialog.showOpenDialog(win,{ title:'Pythonファイルのフォルダーを選択', defaultPath:store.root, properties:['openDirectory','createDirectory'] });
      if (result.canceled || !result.filePaths[0] || !win || win.isDestroyed()) return null;
      // Serialize switches, including requests made while a native dialog is open.
      const previousTransition = serviceTransition;
      const transition = previousTransition.then(async () => {
        const previous = store.root;
        const info = await workspace.setFolder(result.filePaths[0]);
        if (info.path === previous) return null;
        await services.close();
        store = workspace.store;
        startServices();
        return info;
      });
      serviceTransition = transition.then(() => {}, () => {});
      return transition;
    },
    'problems:reveal': (_, id) => shell.showItemInFolder(store.file(id)),
    'clipboard:write': (_, text) => {
      if (typeof text !== 'string' || text.length > 2_000_000) throw new Error('コピーするテキストの形式またはサイズが不正です');
      return clipboard.writeText(text);
    },
    'python:write': (_, id, data) => { store.find(id); if (typeof data !== 'string' || data.length > 1_000_000) throw new Error('端末入力が大きすぎます'); services.python.write(id,data); },
    'python:resize': (_, id, cols, rows) => { store.find(id); dimensions(cols,rows); services.python.resize(id,cols,rows); },
    'python:stop': (_, id) => { store.find(id); return services.python.stop(id); },
    'codex:connect': () => services.codex.connect(),
    'codex:status': () => services.codex.status,
    'codex:ask': (_, id, text, context, model, effort, source) => services.codex.ask(id, text, context, model, effort, source),
    'codex:interrupt': (_, id) => services.codex.interrupt(id),
    'python:snapshot': (_, id) => { store.find(id); return services.python.peek(id); },
    'python:load': (_, id, cols=80, rows=24) => { dimensions(cols,rows); return services.diagnostics.load(id,cols,rows); },
    'python:diagnostic-report': (_, id) => services.diagnostics.latest(id),
    'python:explain': (_, id, token, model, effort) => services.diagnostics.explain(id,token,services.codex,model,effort),
    'app:close-ready': () => closeWindow()
  };
  function dimensions(cols,rows) { if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols<2 || cols>1000 || rows<1 || rows>500) throw new Error('端末サイズが不正です'); }
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Unknown sender');
    await serviceTransition;
    if (!services.active) throw new Error('ワークスペースを終了しています');
    return handler(event, ...args);
  });
  ipcMain.on('app:renderer-ready', event => { if (event.sender === win?.webContents) rendererReady = true; });
  function createWindow() {
    closeAllowed = false; rendererReady = false;
    const stateFile = path.join(app.getPath('userData'),'window-state.json');
    const state = restoreWindowState(stateFile,screen);
    win = new BrowserWindow({ ...state.bounds, minWidth:state.minWidth, minHeight:state.minHeight, show:false, backgroundColor:'#ffffff', title:'PyNote — Python workspace', titleBarStyle:'default', webPreferences:{ preload:path.join(__dirname,'preload.cjs'), contextIsolation:true, nodeIntegration:false, sandbox:true } });
    if (state.maximized) win.maximize();
    trackWindowState(win,stateFile,state);
    win.once('ready-to-show',() => win.show());
    win.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('render-process-gone', () => { rendererReady = false; });
    win.on('close', event => {
      if (closeAllowed) return;
      event.preventDefault();
      if (rendererReady) emit({ type:'before-close' });
      else closeWindow().catch(error => console.error(error));
    });
    if (env('DEV_URL')) win.loadURL(env('DEV_URL')); else win.loadFile(path.join(root,'dist/index.html'));
    win.on('closed', () => {
      serviceTransition = serviceTransition.then(() => services.close());
      win = null;
    });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label:'PyNote', submenu:[{ role:'about' }, { type:'separator' }, { role:'hide' }, { role:'quit' }] },
    { label:'Edit', submenu:[{ role:'undo' }, { role:'redo' }, { type:'separator' }, { role:'cut' }, { role:'copy' }, { role:'paste' }, { role:'selectAll' }] },
    { label:'View', submenu:[{ role:'reload' }, { role:'toggleDevTools' }, { role:'resetZoom' }, { role:'zoomIn' }, { role:'zoomOut' }, { role:'togglefullscreen' }] }
  ]));
  createWindow(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
}).catch(error => { console.error(error); app.quit(); });
app.on('window-all-closed', async () => { await serviceTransition; app.quit(); });
