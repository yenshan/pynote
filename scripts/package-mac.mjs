import { packager } from '@electron/packager';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

if (process.platform !== 'darwin') throw new Error('macOSで実行してください。');
const root = fileURLToPath(new URL('../',import.meta.url));
const require = createRequire(import.meta.url);
const { version:electronVersion } = require('electron/package.json');
const icon = path.join(root,'assets/PyNote.icns');
const temporary = mkdtempSync(path.join(tmpdir(),'kata-icon-'));
try {
  const iconset = path.join(temporary,'PyNote.iconset');
  mkdirSync(iconset);
  for (const size of [16,32,128,256,512]) {
    for (const scale of [1,2]) {
      const pixels = String(size*scale);
      const filename = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
      execFileSync('/usr/bin/sips',['-z',pixels,pixels,path.join(root,'assets/PyNote.png'),'--out',path.join(iconset,filename)],{ stdio:'pipe' });
    }
  }
  execFileSync('/usr/bin/iconutil',['-c','icns',iconset,'-o',icon],{ stdio:'pipe' });
} finally {
  rmSync(temporary,{ recursive:true,force:true });
}
// Include only application files. Practice files, settings, chats and Git stay local.
const included = new Set(['dist','electron','node_modules','package.json']);
const outputs = await packager({
  dir:root,
  name:'PyNote',
  icon,
  executableName:'PyNote',
  appBundleId:'com.yenshan.pynote',
  appCategoryType:'public.app-category.developer-tools',
  platform:'darwin',
  arch:process.arch,
  electronVersion,
  out:path.join(root,'release'),
  overwrite:true,
  prune:true,
  // node-pty's native module and spawn-helper need real filesystem paths.
  asar:false,
  ignore:relative => {
    const parts = relative.split('/').filter(Boolean);
    return parts.length > 0 && (!included.has(parts[0]) || (parts[0] === 'node_modules' && parts.some(part => part.startsWith('.'))));
  }
});
for (const output of outputs) {
  console.log(`\n生成しました: ${path.join(output,'PyNote.app')}`);
}
console.log('PyNote.appをアプリケーションフォルダーへコピーすると、FinderやDockから起動できます。');
console.log('PythonとCodex CLIはMacにインストール済みのものを使用します。');
