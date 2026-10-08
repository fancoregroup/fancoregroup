'use strict';
// Preview em loopback. --demo funciona sem credenciais, fontes privadas ou chamadas externas.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const {parseArgs} = require('node:util');
const {values} = parseArgs({options: {demo: {type: 'boolean', default: false}, port: {type: 'string', default: '8844'}}});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Porta inválida.');
const root = path.resolve(__dirname, '../../05-dashboard/demo/site');
function loadPrivateEnv(file) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('=') || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    process.env[line.slice(0, i)] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '').replace(/\\n/g, '\n');
  }
}
if (values.demo) {
  require('./demo.cjs').installDemoSnapshot();
} else {
  const secrets = path.join(require('node:os').homedir(), '.secrets/fancore');
  try {
    loadPrivateEnv(path.join(secrets, 'performance-vercel-production.env'));
    loadPrivateEnv(path.join(secrets, 'campaign-reports-secret.env'));
  } catch {
    console.error('Ambiente privado indisponível. Para desenvolver sem segredos: node tools/campaign_reports/serve.cjs --demo');
    process.exit(1);
  }
  if (process.env.AGROBAR_MAP_PASSWORD === '[SENSITIVE]') process.env.AGROBAR_MAP_PASSWORD = 'local-preview';
  if (process.env.AGROBAR_MAP_SECRET === '[SENSITIVE]') process.env.AGROBAR_MAP_SECRET = 'local-preview-signing-only';
}
process.env.NODE_ENV = 'development';
const handlers = {
  '/api/campaign-reports': require(path.join(root, 'api/campaign-reports.js')),
  '/api/mapa-agrobar': require(path.join(root, 'api/mapa-agrobar.js'))
};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (handlers[url.pathname]) {
    req.query = Object.fromEntries(url.searchParams);
    let body = '';
    for await (const part of req) {
      body += part;
      if (body.length > 2048) {res.writeHead(413); return res.end();}
    }
    req.body = body;
    res.status = code => (res.statusCode = code, res);
    res.json = data => {res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data));};
    try {return await handlers[url.pathname](req, res);}
    catch {res.statusCode = 500; return res.end(JSON.stringify({error: 'Falha no preview local.'}));}
  }
  let target;
  try {target = path.resolve(root, '.' + decodeURIComponent(url.pathname));}
  catch {res.writeHead(400); return res.end();}
  if ((target !== root && !target.startsWith(root + path.sep)) || url.pathname.startsWith('/api/')) {res.writeHead(404); return res.end();}
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {res.writeHead(404); return res.end();}
  res.setHeader('Content-Type', ({'.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json'})[path.extname(target)] || 'application/octet-stream');
  fs.createReadStream(target).pipe(res);
});
server.listen(port, '127.0.0.1', () => console.log(`Preview ${values.demo ? 'fictício' : 'privado'}: http://127.0.0.1:${server.address().port}/performance/estica/`));
