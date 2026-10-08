'use strict';
const states=['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
const primary=document.querySelector('.lead-form');
const secondary=primary.cloneNode(true);secondary.dataset.position='footer';document.querySelector('#second-form').append(secondary);
for(const select of document.querySelectorAll('[data-states]'))for(const state of states){const option=document.createElement('option');option.value=state;option.textContent=state;select.append(option);}
function track(event,properties={}){window.dataLayer=window.dataLayer||[];window.dataLayer.push({event,...properties});}
for(const form of document.querySelectorAll('.lead-form')){
 const phone=form.elements.phone;phone.addEventListener('input',()=>phone.setCustomValidity(''));
 form.addEventListener('submit',event=>{event.preventDefault();let digits=phone.value.replace(/\D/g,'');if(digits.startsWith('55')&&digits.length>11)digits=digits.slice(2);if(!/^[1-9][0-9]{9,10}$/.test(digits)){phone.setCustomValidity('Informe um WhatsApp válido com DDD.');phone.reportValidity();return;}if(!form.reportValidity())return;
 const data=new FormData(form),message=['Olá! Quero conhecer a franquia Estica.','',`Nome: ${String(data.get('name')).trim()}`,`E-mail: ${String(data.get('email')).trim()}`,`WhatsApp: ${data.get('phone')}`,`Cidade de interesse: ${String(data.get('city')).trim()} / ${data.get('state')}`,`Capital disponível: ${data.get('capital')}`,'','Autorizo o contato da Estica sobre a franquia.'].join('\n');
 const status=form.querySelector('.status');status.classList.add('show');status.textContent='Sua mensagem está pronta. Envie no WhatsApp para conversar com a expansão.';
 track('open_whatsapp_estica_franquia',{form_position:form.dataset.position});window.location.assign('https://wa.me/5511945093884?text='+encodeURIComponent(message));
 });
}
for(const a of document.querySelectorAll('a[href="#cadastro"]'))a.addEventListener('click',()=>track('click_cta_estica_franquia'));
const mobile=document.querySelector('.mobile-cta');const forms=[...document.querySelectorAll('.form-panel')];function floating(){mobile.classList.toggle('visible',scrollY>500&&!forms.some(f=>{const r=f.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0;}));}addEventListener('scroll',floating,{passive:true});floating();document.querySelector('#year').textContent=new Date().getFullYear();track('view_estica_captura_franquias');
