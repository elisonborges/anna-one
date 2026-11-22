'use strict';
const auth=require('./auth-api');
const deviceApi=require('./device-api');
const id=x=>{const n=Number(x);return Number.isSafeInteger(n)&&n>0?n:null};
const defaults=()=>({enabled:false,allowPrivate:true,providers:[]});
function normalized(v){
 const raw=v&&typeof v==='object'&&!Array.isArray(v)?v:{};
 const providers=Array.isArray(raw.providers)?raw.providers.filter(x=>typeof x==='string').slice(0,30):[];
 return {enabled:raw.enabled===true,allowPrivate:raw.allowPrivate!==false,providers};
}
function validate(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Configuração inválida');
 const enabled=input.enabled===true,allowPrivate=input.allowPrivate!==false;
 if(!Array.isArray(input.providers)||input.providers.length>30)throw Error('Máximo de 30 convênios por unidade');
 const names=[],seen=new Set();
 for(const v of input.providers){
  if(typeof v!=='string')throw Error('Nome de convênio inválido');
  const n=v.trim().replace(/\s+/g,' ');
  if(n.length<2||n.length>80||/[<>\r\n\x00-\x1f]/.test(n))throw Error('Nome de convênio inválido (2 a 80 caracteres)');
  const k=n.toLocaleLowerCase('pt-BR');
  if(seen.has(k))throw Error('Convênio duplicado: '+n);
  seen.add(k);names.push(n);
 }
 if(enabled&&!allowPrivate&&!names.length)throw Error('Habilite particular ou cadastre ao menos um convênio');
 return {enabled,allowPrivate,providers:names};
}
async function read(req){let s='';for await(const p of req){s+=p;if(s.length>5000)throw Error('Dados excessivos')}return JSON.parse(s)}
async function handle(req,res,{pool,send}){
 try{
  const unit=id(new URL(req.url,'http://localhost').searchParams.get('unit'));
  if(!unit)return send(res,400,{error:'Unidade inválida'});
  const actor=await auth.session(req,pool);
  const device=await deviceApi.device(req,pool);
  if(!actor&&!device)return send(res,401,{error:'Autenticação necessária'});
  if(device&&(device.kind!=='totem'&&device.kind!=='recepcao'||Number(device.unit_id)!==unit))return send(res,403,{error:'Dispositivo não autorizado para esta unidade'});
  if(actor){
   if(!['admin','atendente'].includes(actor.role))return send(res,403,{error:'Perfil sem permissão'});
   const q=await pool.query('SELECT 1 FROM flow_user_units x JOIN flow_client_units u ON u.id=x.unit_id JOIN flow_clients c ON c.id=u.client_id WHERE x.user_id=$1 AND x.client_id=$2 AND x.unit_id=$3 AND u.active=true AND c.active=true',[actor.id,actor.client_id,unit]);
   if(!q.rowCount)return send(res,403,{error:'Unidade não autorizada'});
  }
  if(req.method==='GET'){
   const q=await pool.query('SELECT r.state->\'coverageOptions\' AS options FROM flow_client_runtime r WHERE r.unit_id=$1',[unit]);
   return send(res,200,{unitId:unit,options:normalized(q.rows[0]?.options||defaults())});
  }
  if(req.method!=='POST')return send(res,405,{error:'Método não permitido'});
  if(!actor||actor.role!=='admin')return send(res,403,{error:'Administrador institucional necessário'});
  const body=await read(req),options=validate(body);
  const cx=await pool.connect();
  try{
   await cx.query('BEGIN');
   const q=await cx.query('SELECT u.id,u.client_id FROM flow_client_units u JOIN flow_clients c ON c.id=u.client_id WHERE u.id=$1 AND u.client_id=$2 AND u.active=true AND c.active=true FOR UPDATE OF u',[unit,actor.client_id]);
   if(!q.rowCount)throw Error('Unidade não pertence à instituição');
   await cx.query('INSERT INTO flow_client_runtime(unit_id) VALUES($1) ON CONFLICT DO NOTHING',[unit]);
   await cx.query("UPDATE flow_client_runtime SET state=jsonb_set(coalesce(state,'{}'::jsonb),'{coverageOptions}',$2::jsonb,true),revision=revision+1,updated_at=now() WHERE unit_id=$1",[unit,JSON.stringify(options)]);
   await cx.query('INSERT INTO flow_admin_audit(action,client_id,unit_id,details) VALUES($1,$2,$3,$4::jsonb)',['coverage_options',actor.client_id,unit,JSON.stringify({enabled:options.enabled,allowPrivate:options.allowPrivate,providersCount:options.providers.length})]);
   await cx.query('COMMIT');
   return send(res,200,{saved:true,options});
  }catch(e){await cx.query('ROLLBACK').catch(()=>{});return send(res,400,{error:e.message})}finally{cx.release()}
 }catch(e){return send(res,400,{error:e.message||'Não foi possível processar as modalidades'})}
}
module.exports={handle,normalized,validate};
