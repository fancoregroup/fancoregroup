const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
 const results=[];
 for(const [route,login,ready] of [['/','',null],['/performance/estica/','local-daniel','#dashboard'],['/performance/agrobar/','local-daniel','#dashboard'],['/inteligencia-geografica/','local-preview','#main'],['/mapa-agrobar/','local-preview','#main'],['/campanhas-setembro-2026/','',null]]){
  console.log('Conferindo '+route);
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('Erro JS: '+e.message)});
  await page.goto((process.env.PREVIEW_URL || 'http://127.0.0.1:8844')+route,{waitUntil:'domcontentloaded',timeout:15000});
  if(login){await page.locator('#password').fill(login);await page.locator('#login-form button:not([type="button"])').click();await page.locator(ready).waitFor({state:'visible',timeout:30000});}
  await page.waitForTimeout(700);
  if(route==='/inteligencia-geografica/'){
   for(const tab of ['competition','performance','leads']){if(tab!=='competition') await page.locator('#decision-more summary').click(); await page.locator(`[data-tab="${tab}"]`).click();await page.waitForTimeout(150);}
  }
  results.push({route,title:await page.title(),errors,demo:(await page.locator('body').innerText()).includes('DEMONSTRAÇÃO')});await page.close();
 }
 await browser.close();console.log(JSON.stringify(results,null,2));if(results.some(r=>r.errors.length||!r.demo))process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exit(1);});
