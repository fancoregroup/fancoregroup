'use strict';
// Fixture sintética para desenvolvimento. Nenhuma consulta a provedores ou arquivos privados.
const crypto = require('node:crypto');
const zlib = require('node:zlib');
function installDemoSnapshot() {
  Object.assign(process.env, {
    FANCORE_GEO_DATA_PATH: '',
    CAMPAIGN_REPORTS_SNAPSHOT_PATH: '',
    AGROBAR_MAP_PASSWORD: 'local-preview',
    AGROBAR_MAP_SECRET: 'local-demo-signing-only',
    CAMPAIGN_REPORTS_DATA_SECRET: 'local-demo-data-only-never-use-in-production',
    CAMPAIGN_REPORTS_DANIEL_PASSWORD: 'local-daniel'
  });
  const stamp = '2026-10-07T09:00:00-03:00';
  const brands = {};
  for (const brand of ['estica', 'agrobar']) {
    const account = 'demo-' + brand;
    const rows = Array.from({length: 8}, (_, i) => ({
      date: `2026-09-${String(i * 3 + 2).padStart(2, '0')}`,
      account, ad: 'demo-ad', adset: 'demo-adset', campaign: 'demo-campaign',
      spend: 100 + i * 10, impressions: 3000, clicks: 60, linkClicks: 40,
      leads: 5 + i, custom: {}
    }));
    brands[brand] = {
      demo: true,
      media: {
        available: true, from: '2026-09-01', to: '2026-10-07', fetchedAt: stamp,
        accounts: [{id: account, name: 'Conta fictícia · ' + brand, leadComplete: true}],
        rows,
        ads: {'demo-ad': {id: 'demo-ad', name: 'Anúncio fictício para desenvolvimento',
          account, adset: 'demo-adset', adsetName: 'Público fictício', campaignName: 'Campanha fictícia',
          format: 'Imagem', available: true, status: 'ACTIVE', preview: null,
          bodies: ['Exemplo fictício para testar o detalhe do criativo.'], titles: ['Exemplo fictício']}},
        adsets: {'demo-adset': {targeting: {age_min: 30, age_max: 60, geo_locations: {countries: ['BR']}}}},
        placements: rows.map(r => ({...r, platform: 'instagram', position: 'feed'})),
        demographics: rows.map(r => ({...r, age: '35-44', gender: 'unknown'})),
        issues: [{scope: 'demo', message: 'Dados fictícios para desenvolvimento local.'}]
      },
      crm: {
        available: true, complete: true, source: 'CRM fictício', unit: 'registros fictícios',
        fetchedAt: stamp, meetingsAvailable: true,
        entries: rows.map(r => ({date: r.date, origin: 'paid', funnel: 'Closer fictício',
          stage: 'Reunião fictícia', status: 'Aberta', heldAt: r.date, count: 3})),
        meetingEvents: rows.map(r => ({date: r.date, count: 3})),
        notes: ['Dados fictícios. Não usar como resultados da Fancore.']
      }
    };
  }
  const data = {schemaVersion: 'brand-campaigns-v1', generatedAt: stamp, timezone: 'America/Sao_Paulo', brands};
  const key = crypto.createHash('sha256').update('campaign-reports-v1:' + process.env.CAMPAIGN_REPORTS_DATA_SECRET).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(zlib.gzipSync(Buffer.from(JSON.stringify(data)))), cipher.final()]);
  const snapshotPath = require.resolve('../../05-dashboard/demo/site/performance/snapshot.enc.json');
  require.cache[snapshotPath] = {id: snapshotPath, filename: snapshotPath, loaded: true,
    exports: {version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64')}};
}
module.exports = {installDemoSnapshot};
