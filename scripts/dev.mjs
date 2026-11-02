import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';
const server = await createServer();
await server.listen();
const child = spawn(electron, ['.', '--remote-debugging-port=9223'], { stdio: 'inherit', env: { ...process.env, KATA_DEV_URL: 'http://127.0.0.1:5173' } });
let stopping = false;
async function stop() { if (stopping) return; stopping = true; child.kill(); await server.close(); }
child.on('exit', async code => { await stop(); process.exit(code ?? 0); });
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
