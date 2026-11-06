(()=>{'use strict';
const $=id=>document.getElementById(id);
const make=(tag,value)=>{const x=document.createElement(tag);if(value!==undefined)x.textContent=value;return x};
const segments={educacao:'Educação',saude:'Saúde',empresa:'Empresa',publico:'Setor público',outro:'Outro'};
let clients=[],query='';
function status(s){$('ccStatus').textContent=s}
const button=(label,action)=>{const b=make('button',label);b.type='button';b.onclick=action;return b};
function selected(id){
 $('client').value=String(id);
 $('client').dispatchEvent(new Event('change',{bubbles:true}));
}
function openUsers(id){
 selected(id);
 document.querySelector('[data-view-btn="users"]')?.click();
}
async function update(c,name,segment){
 const token=$('token').value.trim();
 if(!token)return status('Conecte a administração central.');
 const r=await fetch('/api/admin',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({type:'client_update',clientId:Number(c.id),name,segment})});
 const data=await r.json();if(!r.ok)throw Error(data.error||'Não foi possível editar o cliente');
 $('refresh').click();
 status('Cliente atualizado: '+name);
}
function card(c){
 const root=make('article');root.className='cc-card';
 const head=make('div');head.className='cc-head';
 const name=make('strong',c.name);
 const badge=make('span',c.active?'Ativo':'Inativo');badge.className='cc-badge'+(c.active?'':' inactive');
 head.append(name,badge);
 root.append(head,make('small',(segments[c.segment]||c.segment)+' · '+Number(c.units_count||0)+' unidade(s)'));
 const admins=make('div');admins.className='cc-admins';admins.append(make('strong','Administradores vinculados'));
 if(!Array.isArray(c.administrators)||!c.administrators.length)admins.append(make('small','Nenhum administrador ativo cadastrado.'));
 else for(const a of c.administrators){
  const units=(Array.isArray(a.units)?a.units:[]).map(x=>x.name).join(', ')||'Sem unidade associada';
  admins.append(make('small',(a.name||a.email)+' · '+units));
 }
 root.append(admins);
 const actions=make('div');actions.className='cc-actions';
 const edit=button('Editar cliente',()=>{form.hidden=!form.hidden});edit.className='cc-secondary';
 const access=button('Gerenciar acessos',()=>openUsers(c.id));access.className='cc-secondary';
 actions.append(edit,access);
 const form=make('div');form.className='cc-form';form.hidden=true;
 const namelabel=make('label','Nome da instituição');const input=make('input');input.maxLength=160;input.value=c.name;namelabel.append(input);
 const seglabel=make('label','Segmento'),select=make('select');
 for(const [code,label] of Object.entries(segments)){const op=make('option',label);op.value=code;select.append(op)}select.value=c.segment;seglabel.append(select);
 const buttons=make('div');buttons.className='cc-form-actions';
 const save=button('Salvar',async()=>{const val=input.value.trim().replace(/\\s+/g,' ');if(val.length<2)return status('Informe um nome com pelo menos dois caracteres.');save.disabled=true;try{await update(c,val,select.value)}catch(e){status(e.message)}finally{save.disabled=false}});
 const cancel=button('Cancelar',()=>{input.value=c.name;select.value=c.segment;form.hidden=true});cancel.className='cc-secondary';
 buttons.append(save,cancel);form.append(namelabel,seglabel,buttons);root.append(actions,form);return root;
}
function render(){
 const list=clients.filter(c=>(c.name+' '+(segments[c.segment]||c.segment)).toLocaleLowerCase('pt-BR').includes(query));
 const root=$('ccCards');root.replaceChildren(...list.map(card));
 if(!list.length)root.append(make('p',clients.length?'Nenhum cliente encontrado.':'Nenhum cliente cadastrado.'));
 $('ccTotal').textContent=String(clients.length);
 $('ccActive').textContent=String(clients.filter(x=>x.active).length);
 $('ccInactive').textContent=String(clients.filter(x=>!x.active).length);
 status(list.length+' cliente(s) na listagem. Gerencie os administradores pela guia Usuários e acessos.');
}
$('ccSearch').addEventListener('input',()=>{query=$('ccSearch').value.trim().toLocaleLowerCase('pt-BR');render()});
window.flowCentralClientsRender=data=>{clients=Array.isArray(data?.clients)?data.clients:[];render()};
})();
