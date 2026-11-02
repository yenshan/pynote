const fs = require('node:fs');
const path = require('node:path');

function restoreWindowState(file, screen) {
  let saved;
  try { saved = JSON.parse(fs.readFileSync(file,'utf8')); } catch { /* Use defaults. */ }
  const valid = saved && ['x','y','width','height'].every(key => Number.isSafeInteger(saved[key])) && saved.width > 0 && saved.height > 0;
  const displays = screen.getAllDisplays();
  // Prefer the display containing most of the saved window; disconnected displays fall back to primary.
  let display = screen.getPrimaryDisplay(), largest = 0;
  if (valid) for (const candidate of displays) {
    const area = candidate.workArea;
    const overlap = Math.max(0,Math.min(saved.x+saved.width,area.x+area.width)-Math.max(saved.x,area.x)) *
      Math.max(0,Math.min(saved.y+saved.height,area.y+area.height)-Math.max(saved.y,area.y));
    if (overlap > largest) { display = candidate; largest = overlap; }
  }
  const area = display.workArea;
  const minWidth = Math.min(1100,area.width), minHeight = Math.min(700,area.height);
  const width = Math.min(area.width,Math.max(minWidth,valid ? saved.width : 1512));
  const height = Math.min(area.height,Math.max(minHeight,valid ? saved.height : 980));
  const x = valid && largest ? saved.x : area.x+Math.round((area.width-width)/2);
  const y = valid && largest ? saved.y : area.y+Math.round((area.height-height)/2);
  return {
    bounds:{ width,height,x:Math.max(area.x,Math.min(x,area.x+area.width-width)),y:Math.max(area.y,Math.min(y,area.y+area.height-height)) },
    minWidth,minHeight,maximized:valid && saved.maximized === true
  };
}

function trackWindowState(win, file, initial) {
  let timer, maximized = initial.maximized;
  function save() {
    clearTimeout(timer);
    if (win.isDestroyed()) return;
    if (!win.isMinimized() && !win.isFullScreen()) maximized = win.isMaximized();
    const state = { ...win.getNormalBounds(),maximized };
    try {
      fs.mkdirSync(path.dirname(file),{ recursive:true });
      fs.writeFileSync(file+'.tmp',JSON.stringify(state));
      fs.renameSync(file+'.tmp',file);
    } catch (error) { console.error('ウィンドウの状態を保存できませんでした:',error.message); }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(save,300); }
  for (const event of ['move','resize','maximize','unmaximize','leave-full-screen']) win.on(event,schedule);
  win.on('close',save);
  win.on('closed',() => clearTimeout(timer));
}

module.exports = { restoreWindowState,trackWindowState };
