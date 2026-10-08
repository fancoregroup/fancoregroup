// Criptografa somente agregados. A chave permanece no ambiente privado da Vercel.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const root=path.join(require('node:os').homedir(),'.secrets/fancore');
const env=Object.fromEntries(fs.readFileSync(path.join(root,'campaign-reports-secret.env'),'utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'').replace(/\\n/g,'\n')]}));
if(!env.CAMPAIGN_REPORTS_DATA_SECRET || env.CAMPAIGN_REPORTS_DATA_SECRET.includes('[SENSITIVE]') || env.CAMPAIGN_REPORTS_DATA_SECRET.length<32)throw Error('Chave de criptografia ausente');
const input=process.argv[2]||path.join(require('node:os').homedir(),'.local/share/fancore/campaign-reports/dashboard.json');
const data=JSON.parse(fs.readFileSync(input));
if(data.schemaVersion!=='brand-campaigns-v1')throw Error('Contrato inválido');
const iv=crypto.randomBytes(12),key=crypto.createHash('sha256').update('campaign-reports-v1:'+env.CAMPAIGN_REPORTS_DATA_SECRET).digest();
const cipher=crypto.createCipheriv('aes-256-gcm',key,iv),encrypted=Buffer.concat([cipher.update(zlib.gzipSync(Buffer.from(JSON.stringify(data)))),cipher.final()]);
const output=path.resolve(process.argv[3]||path.join(require('node:os').homedir(),'.local/share/fancore/campaign-reports/snapshot.enc.json'));
const repoRoot=path.resolve(__dirname,'../..');
if(output===repoRoot||output.startsWith(repoRoot+path.sep))throw Error('Snapshots reais devem ser gravados fora do repositório público.');
fs.mkdirSync(path.dirname(output),{recursive:true,mode:0o700});
fs.writeFileSync(output,JSON.stringify({version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')}),{mode:0o600});
console.log('Snapshot agregado criptografado:',encrypted.length,'bytes');
