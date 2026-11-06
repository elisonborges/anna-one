'use strict';
const auth=require('./auth-api');
const clean=(x,n)=>typeof x==='string'?x.trim().replace(/\s+/g,' ').slice(0,n):'';
const num=x=>{const n=Number(x);return Number.isSafeInteger(n)&&n>0?n:null};
async function read(req){let raw='';for await(const piece of req){raw+=piece;if(raw.length>3500)throw Error('Dados excessivos')}return JSON.parse(raw)}
async function handle(req,res,{pool,send}){
 try{
  const actor=await auth.session(req,pool);
  if(!actor||actor.role!=='admin')return send(res,403,{error:'Administrador institucional necessário'});
  const cid=actor.client_id;
  const institution=await pool.query('SELECT id,name FROM flow_clients WHERE id=$1 AND active=true',[cid]);
  if(!institution.rowCount)return send(res,403,{error:'Instituição inativa'});
  if(req.method==='GET'){
   const [units,services,destinations,policies]=await Promise.all([
    pool.query('SELECT id,name FROM flow_client_units WHERE client_id=$1 AND active=true ORDER BY name',[cid]),
    pool.query('SELECT s.id,s.unit_id,s.name FROM flow_client_services s JOIN flow_client_units u ON u.id=s.unit_id AND u.client_id=s.client_id AND u.active=true WHERE s.client_id=$1 AND s.active=true ORDER BY s.name',[cid]),
    pool.query('SELECT d.id,d.unit_id,d.name,d.destination_type FROM flow_client_destinations d JOIN flow_client_units u ON u.id=d.unit_id AND u.client_id=d.client_id AND u.active=true WHERE d.client_id=$1 AND d.active=true ORDER BY d.name',[cid]),
    pool.query("SELECT r.unit_id,r.state->>'transferPolicy' AS policy FROM flow_client_runtime r JOIN flow_client_units u ON u.id=r.unit_id WHERE u.client_id=$1 AND u.active=true",[cid])
   ]);
   return send(res,200,{institution:institution.rows[0],units:units.rows,services:services.rows,destinations:destinations.rows,transferPolicies:policies.rows});
  }
  if(req.method!=='POST')return send(res,405,{error:'Método não permitido'});
  const a=await read(req);
  if(a.type==='transfer_policy'){
   const unit=num(a.unitId),policy=String(a.policy||'');
   if(!unit||!['start','end','original'].includes(policy))return send(res,400,{error:'Regra de encaminhamento inválida'});
   const allowed=await pool.query('SELECT 1 FROM flow_client_units WHERE id=$1 AND client_id=$2 AND active=true',[unit,cid]);
   if(!allowed.rowCount)return send(res,403,{error:'Unidade não pertence à sua instituição'});
   const db=await pool.connect();
   try{
    await db.query('BEGIN');
    await db.query('INSERT INTO flow_client_runtime(unit_id) VALUES($1) ON CONFLICT DO NOTHING',[unit]);
    await db.query("UPDATE flow_client_runtime SET state=jsonb_set(coalesce(state,'{}'::jsonb),'{transferPolicy}',to_jsonb($2::text),true),revision=revision+1,updated_at=now() WHERE unit_id=$1",[unit,policy]);
    await db.query('INSERT INTO flow_admin_audit(action,client_id,unit_id,details) VALUES($1,$2,$3,$4::jsonb)',['transfer_policy',cid,unit,JSON.stringify({policy})]);
    await db.query('COMMIT');
    return send(res,200,{saved:true,unitId:unit,policy});
   }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}finally{db.release()}
  }
  const name=clean(a.name,a.type==='unit'?120:100);
  if(!name||name.length<2)return send(res,400,{error:'Informe um nome com pelo menos 2 caracteres'});
  let result;
  if(a.type==='unit'){
   result=await pool.query('INSERT INTO flow_client_units(client_id,name) VALUES($1,$2) RETURNING id,name',[cid,name]);
  }else if(a.type==='service'||a.type==='destination'){
   const unit=num(a.unitId);
   if(!unit)return send(res,400,{error:'Selecione uma unidade válida'});
   const allowed=await pool.query('SELECT 1 FROM flow_client_units WHERE id=$1 AND client_id=$2 AND active=true',[unit,cid]);
   if(!allowed.rowCount)return send(res,403,{error:'Unidade não pertence à sua instituição'});
   if(a.type==='service')result=await pool.query('INSERT INTO flow_client_services(client_id,unit_id,name) VALUES($1,$2,$3) RETURNING id,name,unit_id',[cid,unit,name]);
   else{
    const kind=String(a.kind||'');
    if(!['guiche','sala','consultorio','setor','outro'].includes(kind))return send(res,400,{error:'Tipo de destino inválido'});
    result=await pool.query('INSERT INTO flow_client_destinations(client_id,unit_id,name,destination_type) VALUES($1,$2,$3,$4) RETURNING id,name,unit_id,destination_type',[cid,unit,name,kind]);
   }
  }else return send(res,400,{error:'Operação inválida'});
  return send(res,201,{created:result.rows[0]});
 }catch(e){
  return send(res,e.code==='23505'?409:e.code==='23503'?400:503,{error:e.code==='23505'?'Cadastro já existente':e.code==='23503'?'Unidade inválida':'Não foi possível concluir o cadastro'});
 }
}
module.exports={handle};
