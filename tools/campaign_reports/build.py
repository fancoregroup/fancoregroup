"""Gera páginas e sela os agregados já coletados para a publicação."""
from pathlib import Path
import subprocess,json
from model import build
from collect import save
ROOT=Path(__file__).resolve().parents[2]
def main():
 data=build();save('dashboard',data)
 template=(ROOT/'tools/campaign_reports/template.html').read_text()
 for id,name,crm in [('estica','Estica','RD Station CRM'),('agrobar','Agrobar','ONECRM')]:
  target=ROOT/f'05-dashboard/demo/site/performance/{id}/index.html';target.parent.mkdir(parents=True,exist_ok=True)
  target.write_text(template.replace('__ID__',id).replace('__BRAND__',name).replace('__CRM__',crm))
 subprocess.run(['node',str(ROOT/'tools/campaign_reports/seal.cjs')],check=True)
 print(json.dumps({b:{'anuncios':len(v['media']['ads']),'crm_disponivel':v['crm']['available'],'crm_completo':v['crm'].get('complete'),'reunioes_disponiveis':v['crm'].get('meetingsAvailable')} for b,v in data['brands'].items()},ensure_ascii=False))
if __name__=='__main__':main()
