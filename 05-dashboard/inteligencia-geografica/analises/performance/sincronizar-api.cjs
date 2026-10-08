'use strict';
// Uso: node sincronizar-api.cjs <dataset-privado.json> <fonte-agregada.json>
// Atualiza arquivo externo que será lido por FANCORE_GEO_DATA_PATH.
const fs=require('node:fs'),path=require('node:path');
const [target,input]=process.argv.slice(2);
if(!target||!input)throw Error('Informe o dataset privado e a fonte agregada.');
const out=path.resolve(target),repo=path.resolve(__dirname,'../../../..');
if(out===repo||out.startsWith(repo+path.sep))throw Error('Dados reais devem permanecer fora do repositório público.');
const data=JSON.parse(fs.readFileSync(out,'utf8'));
data.performance=JSON.parse(fs.readFileSync(input,'utf8'));
fs.writeFileSync(out,JSON.stringify(data)+'\n',{mode:0o600});
fs.chmodSync(out,0o600);
console.log('Arquivo privado atualizado.');
