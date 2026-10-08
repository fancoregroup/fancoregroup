'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const fs = require('node:fs'), path = require('node:path');

test('clone pode executar duas marcas com dados fictícios, login e snapshot versionado preservado', async t => {
  const snapshot = path.resolve(__dirname, '../../05-dashboard/demo/site/performance/snapshot.enc.json');
  const before = fs.readFileSync(snapshot);
  // HOME inexistente comprova que --demo não depende de credenciais na máquina.
  const child = spawn(process.execPath, [path.join(__dirname, 'serve.cjs'), '--demo', '--port', '0'],
    {env: {...process.env, HOME: '/nonexistent-fancore-demo-home', FANCORE_GEO_DATA_PATH: '/nonexistent/private.json', CAMPAIGN_REPORTS_SNAPSHOT_PATH: '/nonexistent/snapshot.json'}, stdio: ['ignore', 'pipe', 'pipe']});
  t.after(async () => {if (child.exitCode === null) {child.kill(); await once(child, 'exit');}});
  const base = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(Error('Preview não iniciou.')), 10000);
    child.once('exit', code => {clearTimeout(timer); reject(Error('Preview encerrou: ' + code));});
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {clearTimeout(timer); resolve(match[0]);}
    });
  });
  const endpoint = base + '/api/campaign-reports';
  assert.equal((await fetch(endpoint + '?brand=estica')).status, 401);
  assert.equal((await fetch(endpoint, {method: 'POST', body: JSON.stringify({password: 'wrong'})})).status, 401);
  const login = await fetch(endpoint, {method: 'POST', body: JSON.stringify({password: 'local-daniel'})});
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  for (const brand of ['estica', 'agrobar']) {
    const response = await fetch(endpoint + '?brand=' + brand, {headers: {cookie}});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const data = await response.json();
    assert.equal(data.brand, brand);
    assert.equal(data.demo, true);
    assert.ok(data.media.rows.length > 0);
    assert.ok(data.crm.entries.length > 0);
    assert.equal(data.brands, undefined, 'Resposta deve isolar a marca solicitada.');
    assert.equal((await fetch(base + '/performance/' + brand + '/')).status, 200);
  }
  assert.equal((await fetch(endpoint + '?brand=folks', {headers: {cookie}})).status, 400);
  const mapEndpoint = base + '/api/mapa-agrobar';
  assert.equal((await fetch(mapEndpoint)).status, 401);
  const mapLogin = await fetch(mapEndpoint, {method: 'POST', body: JSON.stringify({password: 'local-preview'})});
  assert.equal(mapLogin.status, 200);
  const mapCookie = mapLogin.headers.get('set-cookie').split(';')[0];
  const mapResponse = await fetch(mapEndpoint, {headers: {cookie: mapCookie}});
  assert.equal(mapResponse.status, 200);
  const mapData = await mapResponse.json();
  assert.equal(mapData.demo, true);
  assert.equal(mapData.performance.demo, true);
  assert.equal(mapData.leadGeography.demo, true);
  assert.equal(mapData.cities.length, 2);
  for (const route of ['/', '/inteligencia-geografica/', '/mapa-agrobar/', '/campanhas-setembro-2026/', '/recrutamento/', '/carreiras/']) {
    const page = await fetch(base + route);
    assert.equal(page.status, 200, route);
    assert.match(await page.text(), /DEMONSTRAÇÃO/, 'Cada interface deve identificar esta distribuição.');
  }
  assert.deepEqual(fs.readFileSync(snapshot), before, 'Demo não pode alterar a fotografia cifrada de produção.');
});
