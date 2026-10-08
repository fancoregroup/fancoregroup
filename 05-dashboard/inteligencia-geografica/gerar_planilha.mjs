import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Workbook,SpreadsheetFile} from '@oai/artifact-tool';
const root=path.dirname(fileURLToPath(import.meta.url));
const data=JSON.parse(await fs.readFile(path.join(root,'../demo/site/inteligencia-geografica/dados/municipios.json'),'utf8'));
const wb=Workbook.create();
const palettes={ink:'#111516',orange:'#ed6c05',cream:'#f4f1ee',muted:'#545454',white:'#ffffff'};
function letter(n){let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
const plans=[
  ['Territorio',['population','censusPopulation','area','density']],
  ['Renda e idade',['income','medianIncome','youngAdults','youngAdultsShare','seniors','seniorsShare']],
  ['Economia',['gdp','agroGva','agroShare','establishments','companies','employment','salaried','salary','foodEstablishments','foodEmployment']],
];
for(const [name,keys] of plans){
  const s=wb.worksheets.add(name);s.showGridLines=false;
  const geo=name==='Territorio';
  const fixed=geo?['Código IBGE','Município','UF','Região','Latitude','Longitude']:['Código IBGE','Município','UF'];
  const header=[...fixed,...keys.flatMap(k=>[data.indicators[k].label+' ('+data.indicators[k].unit+')','Ano']), 'Fontes dos indicadores'];
  const source=[...new Set(keys.map(k=>data.indicators[k].source))].join(' ; ');
  const rows=data.cities.map(c=>[c.id,c.name,c.uf,...(geo?[c.region,c.lat,c.lng]:[]),...keys.flatMap(k=>[c.metrics[k]?.value??null,c.metrics[k]?.year??null]),source]);
  s.getRange('A1').values=[['Fancore Geo · '+name]];s.getRange('A1').format.font={name:'Arial',size:18,bold:true,color:palettes.ink};
  s.getRange('A2').values=[['Coleta '+data.generatedAt.slice(0,10)+' · 5.571 registros municipais. Célula vazia significa dado ausente, não zero.']];
  s.getRange('A1').format.rowHeight=30;s.getRange('A2').format.rowHeight=22;
  s.getRange('A2').format.font={name:'Arial',size:10,color:palettes.muted};
  const last=letter(header.length-1),end=rows.length+4;
  s.getRange(`A4:${last}${end}`).values=[header,...rows];
  s.getRange(`A4:${last}${end}`).format.font={name:'Arial',size:10,color:palettes.ink};
  s.getRange(`A4:${last}4`).format={fill:palettes.ink,font:{name:'Arial',size:10,bold:true,color:palettes.white},wrapText:true,rowHeight:56};
  s.getRange(`A5:${last}${end}`).format.rowHeight=20;
  s.getRange(`A4:${last}${end}`).format.columnWidth=19;
  s.getRange(`B4:B${end}`).format.columnWidth=29;
  s.getRange(`C4:C${end}`).format.columnWidth=7;
  s.getRange(`A5:A${end}`).setNumberFormat('@');
  if(geo){s.getRange(`D4:D${end}`).format.columnWidth=17;s.getRange(`E5:F${end}`).setNumberFormat('0.0000');}
  keys.forEach((key,i)=>{const meta=data.indicators[key],col=letter(fixed.length+i*2),year=letter(fixed.length+i*2+1);s.getRange(`${col}5:${col}${end}`).setNumberFormat(meta.unit==='R$'?'"R$" #,##0':meta.unit==='R$/mês'?'"R$" #,##0.00':meta.unit==='%'?'0.0"%"':key==='area'||key==='density'?'#,##0.00':'#,##0');s.getRange(`${year}4:${year}${end}`).format.columnWidth=10;s.getRange(`${year}5:${year}${end}`).format.horizontalAlignment='center';if(meta.unit==='R$')s.getRange(`${col}4:${col}${end}`).format.columnWidth=28;});
  s.getRange(`${last}4:${last}${end}`).format.columnWidth=60;
  s.freezePanes.freezeRows(4);s.freezePanes.freezeColumns(3);
  const table=s.tables.add(`A4:${last}${end}`,true,name==='Territorio'?'TerritorioMunicipal':name==='Economia'?'EconomiaMunicipal':'RendaMunicipal');table.style='TableStyleLight1';table.showBandedRows=false;
  console.log(name,rows.length,header.length);
}
const sources=wb.worksheets.add('Fontes e leitura');sources.showGridLines=false;
const rows=[
  ['Fancore Geo · Fontes e leitura','','','',''],
  ['Coleta (Brasília)',new Date(data.generatedAt.slice(0,19)+'Z'),'','',''],
  ['Escala','Dados municipais. Não distribuir população ou renda municipal em um raio ou bairro.','','',''],
  ['Comparabilidade','Anos distintos ficam explícitos nas colunas. Renda nominal 2022 não corrigida pela inflação.','','',''],
  ['Geometria','5.570 polígonos municipais na malha obtida. Cadastro atual tem 5.571 registros.','','',''],
  ['Coordenadas','Pontos municipais aproximados da base Municípios Brasileiros, licença MIT. Não são endereços de lojas.','','',''],
  ['Fonte coordenadas','https://github.com/kelvins/municipios-brasileiros','','',''],
  ['Atualização','Snapshot reproduzível por coleta controlada. Não é uma conexão contínua do Excel.','','',''],
  ['Dados ausentes','Ausência, sigilo e não aplicável permanecem vazios. Zero absoluto da fonte é mantido como zero.','','',''],
  ['Indicador','Definição','Fonte','Anos','Municípios com dado'],
  ...Object.values(data.indicators).map(m=>[m.label,m.note,m.source,m.years.join(', '),m.coverage]),
];
sources.getRange(`A1:E${rows.length}`).values=rows;
sources.getRange(`A1:E${rows.length}`).format={font:{name:'Arial',size:11,color:palettes.ink},rowHeight:50,wrapText:true,verticalAlignment:'center'};
sources.getRange('B2').setNumberFormat('yyyy-mm-dd hh:mm');
sources.getRange('A1').format.font={name:'Arial',size:18,bold:true,color:palettes.ink};
sources.getRange(`A1:A${rows.length}`).format.columnWidth=37;sources.getRange(`B1:B${rows.length}`).format.columnWidth=84;sources.getRange(`C1:C${rows.length}`).format.columnWidth=55;sources.getRange(`D1:E${rows.length}`).format.columnWidth=17;
sources.getRange('A10:E10').format={fill:palettes.ink,font:{name:'Arial',size:11,bold:true,color:palettes.white},wrapText:true};sources.freezePanes.freezeRows(10);
const out=path.join(root,'exportacoes');await fs.mkdir(out,{recursive:true});
for(const name of [...plans.map(p=>p[0]),'Fontes e leitura']){
  const rendered=await wb.render({sheetName:name,range:name==='Fontes e leitura'?'A1:C10':'A1:H11',scale:1,format:'png'});
  await fs.writeFile(path.join(root,'qa','planilha-'+name.replaceAll(' ','-')+'.png'),new Uint8Array(await rendered.arrayBuffer()));
}
console.log((await wb.inspect({kind:'table',range:'Territorio!A4:H7',include:'values',tableMaxRows:4,tableMaxCols:8,maxChars:1400})).ndjson);
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:20},maxChars:800});console.log(errors.ndjson);
const xlsx=await SpreadsheetFile.exportXlsx(wb);await xlsx.save(path.join(out,'fancore-geo-municipios.xlsx'));
await fs.copyFile(path.join(out,'fancore-geo-municipios.xlsx'),path.join(root,'../demo/site/inteligencia-geografica/dados/municipios-brasil.xlsx'));
console.log('Excel exportado.');
