const fs = require('node:fs/promises');

// Give Node fixtures OS pipes: some sandbox runtimes cannot use Node's socket
// streams on the socketpairs created by child_process.spawn's stdio: 'pipe'.
async function fakeServer(script) {
  if (process.platform === 'win32') return script;
  const executable = script + '.bridge';
  await fs.writeFile(executable, `#!/usr/bin/env python3
import os, signal, subprocess, sys, threading
child = subprocess.Popen(['node', ${JSON.stringify(script)}, *sys.argv[1:]], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
def forward(source, target):
    try:
        while True:
            chunk = os.read(source, 65536)
            if not chunk:
                return
            while chunk:
                chunk = chunk[os.write(target, chunk):]
    except OSError:
        pass
for source, target in [(0, child.stdin.fileno()), (child.stdout.fileno(), 1), (child.stderr.fileno(), 2)]:
    threading.Thread(target=forward, args=(source, target), daemon=True).start()
signal.signal(signal.SIGTERM, lambda *_: child.terminate())
sys.exit(child.wait())
`, { mode:0o755 });
  return executable;
}
module.exports = { fakeServer };
