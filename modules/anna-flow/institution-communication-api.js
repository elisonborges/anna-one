'use strict';
const auth=require('./auth-api');
const positive=x=>{const n=Number(x);return Number.isSafeInteger(n)&&n>0?n:null};
async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>6500)throw Error('Dados excessivos')}return JSON.parse(raw)}
async function handle(req,res,{pool,send}){
 try{
  const actor=await auth.session(req,pool);
  if(!actor||actor.role!=='admin')return send(res,403,{error:'Administrador institucional necessário'});
  const clientId=positive(actor.client_id);
  if(!clientId)return send(res,403,{error:'Instituição inválida'});
  const institution=await pool.query('SELECT id,name FROM flow_clients WHERE id=$1 AND active=true',[clientId]);
  if(!institution.rowCount)return send(res,403,{error:'Instituição inativa'});
  if(req.method==='GET'){
   const panelId=positive(new URL(req.url,'http://localhost').searchParams.get('panel'));
   if(!panelId){
    const panels=await pool.query('SELECT p.id,p.name,p.unit_id,u.name AS unit_name FROM flow_signage_profiles p JOIN flow_client_units u ON u.id=p.unit_id AND u.client_id=p.client_id AND u.active=true WHERE p.client_id=$1 AND p.active=true ORDER BY u.name,p.name',[clientId]);
    return send(res,200,{institution:institution.rows[0],panels:panels.rows});
   }
   const panel=await pool.query('SELECT p.id,p.name,p.unit_id,p.notice,p.messages,u.name AS unit_name FROM flow_signage_profiles p JOIN flow_client_units u ON u.id=p.unit_id AND u.client_id=p.client_id AND u.active=true WHERE p.id=$1 AND p.client_id=$2 AND p.active=true',[panelId,clientId]);
   if(!panel.rowCount)return send(res,404,{error:'Painel não encontrado nesta instituição'});
   const media=await pool.query('SELECT video_url,enabled FROM flow_signage_media WHERE panel_id=$1',[panelId]);
   return send(res,200,{institution:institution.rows[0],panel:panel.rows[0],media:media.rows[0]||{video_url:'',enabled:false}});
  }
  if(req.method!=='POST')return send(res,405,{error:'Método não permitido'});
  const data=await body(req),panelId=positive(data.panelId);
  if(!panelId||!['communication','media'].includes(data.type))return send(res,400,{error:'Operação inválida'});
  const panel=await pool.query('SELECT p.id FROM flow_signage_profiles p JOIN flow_client_units u ON u.id=p.unit_id AND u.client_id=p.client_id AND u.active=true WHERE p.id=$1 AND p.client_id=$2 AND p.active=true',[panelId,clientId]);
  if(!panel.rowCount)return send(res,404,{error:'Painel não encontrado nesta instituição'});
  if(data.type==='communication'){
   if(typeof data.notice!=='string'||data.notice.length>180||!Array.isArray(data.messages)||data.messages.length>15||data.messages.some(x=>typeof x!=='string'||x.length>220))
    return send(res,400,{error:'Máximo de 180 caracteres na orientação e 15 mensagens de 220 caracteres'});
   const notice=data.notice.trim(),messages=data.messages.map(x=>x.trim()).filter(Boolean);
   await pool.query('UPDATE flow_signage_profiles SET notice=$1,messages=$2::jsonb WHERE id=$3 AND client_id=$4',[notice,JSON.stringify(messages),panelId,clientId]);
   await pool.query('INSERT INTO flow_admin_audit(action,client_id,details) VALUES($1,$2,$3::jsonb)',['institution_communication',clientId,JSON.stringify({panelId,noticeLength:notice.length,messageCount:messages.length})]);
   return send(res,200,{saved:true});
  }
  if(typeof data.videoUrl!=='string'||data.videoUrl.length>1200||typeof data.enabled!=='boolean')
   return send(res,400,{error:'Configuração de vídeo inválida'});
  const videoUrl=data.videoUrl.trim();
  if(data.enabled){
   let u;try{u=new URL(videoUrl)}catch{return send(res,400,{error:'Informe uma URL HTTPS válida'})}
   if(u.protocol!=='https:'||!u.hostname||!/^\/(?!\/)/.test(u.pathname)||!(/\.(mp4|webm)$/i).test(u.pathname))
    return send(res,400,{error:'Use URL HTTPS direta de MP4 ou WebM'});
  }
  await pool.query('INSERT INTO flow_signage_media(panel_id,video_url,enabled) VALUES($1,$2,$3) ON CONFLICT(panel_id) DO UPDATE SET video_url=EXCLUDED.video_url,enabled=EXCLUDED.enabled,updated_at=now()',[panelId,videoUrl,data.enabled]);
  await pool.query('INSERT INTO flow_admin_audit(action,client_id,details) VALUES($1,$2,$3::jsonb)',['institution_media',clientId,JSON.stringify({panelId,enabled:data.enabled})]);
  return send(res,200,{saved:true});
 }catch(e){
  return send(res,503,{error:'Não foi possível atualizar a comunicação'});
 }
}
module.exports={handle};
