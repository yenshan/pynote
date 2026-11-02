const fs = require('node:fs');
const path = require('node:path');
if (process.platform !== 'win32') {
  const root = path.dirname(require.resolve('node-pty/package.json'));
  for (const directory of ['build/Release','build/Debug',`prebuilds/${process.platform}-${process.arch}`]) {
    const helper = path.join(root,directory,'spawn-helper');
    if (fs.existsSync(helper)) fs.chmodSync(helper,fs.statSync(helper).mode | 0o111);
  }
}
