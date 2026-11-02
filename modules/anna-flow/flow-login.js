(()=>{'use strict';
const $=id=>document.getElementById(id),msg=s=>$('msg').textContent=s;
const configs={institution:{form:'institutionForm',email:'email',select:'client',password:'password',mode:'institution'},production:{form:'centralForm',email:'centralEmail',select:'productionClient',password:'centralPassword',mode:'production'}};
let active='institution';const states={institution:{seq:0,email:'',pending:null},production:{seq:0,email:'',pending:null}};
function setMode(production){active=production?'production':'institution';$('centralForm').hidden=!production;$('institutionForm').hidden=production;$('central').classList.toggle('active',production);$('institution').classList.toggle('active',!production);msg('')}
$('institution').onclick=()=>setMode(false);$('central').onclick=()=>setMode(true);
function reset(mode){const c=configs[mode],st=states[mode];st.seq++;st.email='';st.pending=null;const select=$(c.select);select.disabled=true;select.replaceChildren(new Option('Informe o e-mail primeiro',''))}
async function resolve(mode){const c=configs[mode],st=states[mode],mail=$(c.email).value.trim().toLowerCase(),select=$(c.select);
if(!$(c.email).validity.valid||!mail){reset(mode);return false}
if(mail===st.email&&select.value)return true;
if(st.pending&&st.pending.email===mail)return st.pending.promise;
const seq=++st.seq;select.disabled=true;select.replaceChildren(new Option('Consultando instituições...',''));
const promise=(async()=>{try{
const r=await fetch('/api/institutions-by-email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:mail,mode:mode==='production'?'production':'institution'})});
const data=await r.json();if(seq!==st.seq)return false;if(!r.ok)throw Error(data.error||'Consulta indisponível');
st.email=mail;const records=Array.isArray(data.institutions)?data.institutions:[];
if(records.length===0){select.replaceChildren(new Option('Nenhuma instituição vinculada',''));msg('Verifique o e-mail cadastrado.');return false}
const options=records.map(x=>new Option(x.name+' · ID '+x.id,String(x.id)));
if(records.length>1){select.replaceChildren(new Option('Selecione a instituição',''),...options);select.disabled=false;msg('Selecione a instituição para continuar.')}else{select.replaceChildren(...options);select.disabled=true;msg('Instituição identificada automaticamente.')}
return true
}catch(e){if(seq===st.seq){st.email='';select.replaceChildren(new Option('Consulta indisponível',''));msg(e.message)}return false}
finally{if(seq===st.seq)st.pending=null}})();st.pending={email:mail,promise};return promise}
for(const mode of Object.keys(configs)){const c=configs[mode];$(c.email).addEventListener('input',()=>reset(mode));$(c.email).addEventListener('blur',()=>resolve(mode));$(c.password).addEventListener('focus',()=>resolve(mode))}
$('institutionForm').onsubmit=async e=>{e.preventDefault();try{if(!await resolve('institution')||!$('client').value)throw Error('Selecione a instituição');const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:Number($('client').value),email:$('email').value,password:$('password').value,adminPortal:true})});const d=await r.json();$('password').value='';if(!r.ok)throw Error(d.error||'Acesso negado');if(d.role!=='admin')throw Error('Esta área exige perfil de administrador');sessionStorage.setItem('flowInstitutionAdmin',JSON.stringify({token:d.token,clientId:d.clientId}));location.replace('/admin.html#devices')}catch(e){msg(e.message)}};
$('centralForm').onsubmit=async e=>{e.preventDefault();try{if(!await resolve('production')||!$('productionClient').value)throw Error('Selecione a instituição');const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:Number($('productionClient').value),email:$('centralEmail').value,password:$('centralPassword').value})});const d=await r.json();$('centralPassword').value='';if(!r.ok)throw Error(d.error||'Acesso negado');if(d.role!=='atendente')throw Error('A guia Produção exige perfil operacional autorizado');sessionStorage.setItem('flowProductionSession',JSON.stringify({token:d.token,clientId:d.clientId}));location.replace('/operator.html')}catch(e){msg(e.message)}};
})();