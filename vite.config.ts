import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react(), {
    name:'development-refresh-csp', apply:'serve',
    // React's development refresh preamble is inline. Production keeps the strict CSP.
    transformIndexHtml:html => html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';")
  }], base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { rollupOptions: { output: { manualChunks: { editor:['codemirror','@codemirror/legacy-modes/mode/python'], vim:['@replit/codemirror-vim'], markdown:['react-markdown'], terminal:['@xterm/xterm','@xterm/addon-fit'] } } } }
});
