// Serves the built app for the Supabase end-to-end test: real dist files, the real CSP from public/_headers
// (with the local test API added to connect-src), and a config.js pointing at the local Supabase stand-in.
const http = require('http'); const fs = require('fs'); const path = require('path');
const DIST = path.join(__dirname, '..', 'dist');
const API = process.env.API_URL || 'http://localhost:54321';
const ANON = process.env.ANON_KEY;
const IDLE = process.env.IDLE_MINUTES || '30';
const csp = fs.readFileSync(path.join(DIST, '_headers'), 'utf8').match(/Content-Security-Policy: (.+)/)[1].replace("connect-src 'self'", `connect-src 'self' ${API} ${API.replace('http', 'ws')}`);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  const url = req.url.split('?')[0].split('#')[0];
  if (url === '/config.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    return res.end(`window.CREATE_CONFIG = { supabaseUrl: ${JSON.stringify(API)}, supabaseAnonKey: ${JSON.stringify(ANON)}, idleMinutes: ${IDLE} };`);
  }
  let file = path.join(DIST, url === '/' ? 'index.html' : url);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Security-Policy': csp, 'X-Frame-Options': 'DENY' });
  fs.createReadStream(file).pipe(res);
}).listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log('serving dist on', process.env.PORT || 4173));
