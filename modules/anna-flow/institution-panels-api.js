'use strict';
const auth=require('./auth-api');
const num=x=>{const n=Number(x);return Number.isSafeInteger(n)&&n>0?n:null};
const clean=(x,n)=>typeof x==='string'?x.trim().replace(/\s+/g,' ').slice(0,n):'';
const themes=new Set(['escuro','claro','acolhedor']);
async function body(req){let raw='';for await(const c of req){raw+=c;if(raw.length>5000)throw Error('Requisição excessiva')}return JSON.parse(raw)}
async function handle(req,res,{pool,send}){
 try{
  const actor=await auth.session(req,pool);
  if(!actor||actor.role!=='admin')return send(res,403,{error:'Administrador institucional necessário'});
  const clientId=Number(actor.client_id);
  const institution=await pool.query('SELECT id,name FROM flow_clients WHERE id=$1 AND active=true',[clientId]);
  if(!institution.rowCount)return send(res,403,{error:'Instituição inativa'});
  if(req.method==='GET'){
   const [units,services,panels,links,devices]=await Promise.all([
    pool.query('SELECT id,name FROM flow_client_units WHERE client_id=$1 AND active=true ORDER BY name',[clientId]),
    pool.query('SELECT s.id,s.name,s.unit_id FROM flow_client_services s JOIN flow_client_units u ON u.id=s.unit_id AND u.client_id=s.client_id AND u.active=true WHERE s.client_id=$1 AND s.active=true ORDER BY s.name',[clientId]),
    pool.query('SELECT p.id,p.unit_id,p.name,p.theme,p.public_key FROM flow_signage_profiles p JOIN flow_client_units u ON u.id=p.unit_id AND u.client_id=p.client_id AND u.active=true WHERE p.client_id=$1 AND p.active=true ORDER BY p.name',[clientId]),
    pool.query('SELECT l.panel_id,l.service_id FROM flow_panel_service_links l JOIN flow_signage_profiles p ON p.id=l.panel_id AND p.active=true AND p.client_id=$1 JOIN flow_client_units u ON u.id=p.unit_id AND u.client_id=$1 AND u.active=true JOIN flow_client_services s ON s.id=l.service_id AND s.unit_id=p.unit_id AND s.active=true',[clientId]),
    pool.query("SELECT panel_id,count(*)::int AS total FROM flow_devices WHERE client_id=$1 AND kind='tv' AND active=true AND revoked_at IS NULL AND panel_id IS NOT NULL GROUP BY panel_id",[clientId])
   ]);
   return send(res,200,{institution:institution.rows[0],units:units.rows,services:services.rows,
    panels:panels.rows.map(p=>({...p,serviceIds:links.rows.filter(l=>Number(l.panel_id)===Number(p.id)).map(l=>Number(l.service_id)),tvCount:Number(devices.rows.find(d=>Number(d.panel_id)===Number(p.id))?.total||0)}))});
  }
  if(req.method!=='POST')return send(res,405,{error:'Método não permitido'});
  const a=await body(req);
  if(a.type==='panel_create'){
   const name=clean(a.name,100),theme=String(a.theme||''),unitId=num(a.unitId);
   if(name.length<2||!themes.has(theme)||!unitId)return send(res,400,{error:'Dados do painel inválidos'});
   const unit=await pool.query('SELECT id FROM flow_client_units WHERE id=$1 AND client_id=$2 AND active=true',[unitId,clientId]);
   if(!unit.rowCount)return send(res,403,{error:'Unidade não autorizada'});
   const db=await pool.connect();
   try{
    await db.query('BEGIN');
    const created=await db.query('INSERT INTO flow_signage_profiles(client_id,unit_id,name,theme) VALUES($1,$2,$3,$4) RETURNING id,name,unit_id,theme',[clientId,unitId,name,theme]);
    await db.query('INSERT INTO flow_admin_audit(action,client_id,unit_id,details) VALUES($1,$2,$3,$4::jsonb)',['panel_create',clientId,unitId,JSON.stringify({panelId:created.rows[0].id,name,theme})]);
    await db.query('COMMIT');return send(res,201,{created:created.rows[0]});
   }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}finally{db.release()}
  }
  if(a.type==='panel_update'||a.type==='panel_services'){
   const panelId=num(a.panelId);
   if(!panelId)return send(res,400,{error:'Painel inválido'});
   const db=await pool.connect();
   try{
    await db.query('BEGIN');
    const found=await db.query('SELECT p.id,p.unit_id,p.name,p.theme FROM flow_signage_profiles p JOIN flow_client_units u ON u.id=p.unit_id AND u.client_id=$2 AND u.active=true WHERE p.id=$1 AND p.client_id=$2 AND p.active=true FOR UPDATE OF p',[panelId,clientId]);
    if(!found.rowCount){await db.query('ROLLBACK');return send(res,404,{error:'Painel não encontrado nesta instituição'})}
    const p=found.rows[0];
    if(a.type==='panel_update'){
     const name=clean(a.name,100),theme=String(a.theme||'');
     if(name.length<2||!themes.has(theme)){await db.query('ROLLBACK');return send(res,400,{error:'Nome ou tema inválido'})}
     await db.query('UPDATE flow_signage_profiles SET name=$1,theme=$2 WHERE id=$3 AND client_id=$4',[name,theme,panelId,clientId]);
     await db.query('INSERT INTO flow_admin_audit(action,client_id,unit_id,details) VALUES($1,$2,$3,$4::jsonb)',['panel_update',clientId,p.unit_id,JSON.stringify({panelId,previousName:p.name,name,theme})]);
    }else{
     const ids=Array.isArray(a.serviceIds)?a.serviceIds.map(num):null;
     if(!ids||ids.length>60||ids.some(x=>!x)||new Set(ids).size!==ids.length){await db.query('ROLLBACK');return send(res,400,{error:'Seleção inválida de serviços'})}
     const allowed=await db.query('SELECT id FROM flow_client_services WHERE unit_id=$1 AND client_id=$2 AND active=true',[p.unit_id,clientId]);
     const valid=new Set(allowed.rows.map(x=>Number(x.id)));
     if(ids.some(x=>!valid.has(x))){await db.query('ROLLBACK');return send(res,403,{error:'Serviço de outra unidade'})}
     await db.query('DELETE FROM flow_panel_service_links WHERE panel_id=$1',[panelId]);
     for(const serviceId of ids)await db.query('INSERT INTO flow_panel_service_links(panel_id,service_id) VALUES($1,$2)',[panelId,serviceId]);
     await db.query('INSERT INTO flow_admin_audit(action,client_id,unit_id,details) VALUES($1,$2,$3,$4::jsonb)',['panel_services',clientId,p.unit_id,JSON.stringify({panelId,serviceIds:ids})]);
    }
    await db.query('COMMIT');return send(res,200,{saved:true,panelId});
   }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}finally{db.release()}
  }
  return send(res,400,{error:'Operação não permitida'});
 }catch(e){return send(res,e.code==='23505'?409:503,{error:e.code==='23505'?'Cadastro já existente':'Não foi possível concluir a operação'})}
}
module.exports={handle};
