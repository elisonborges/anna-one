'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Pool}=require('pg');
const adminApi=require('./admin-api');
const tenantApi=require('./tenant-api');
const panelApi=require('./panel-api');
const userAuth=require('./auth-api');
const institutionUnits=require('./institution-units-api');
const institutionPanels=require('./institution-panels-api');
const institutionOverview=require('./institution-overview-api');
const deviceApi=require('./device-api');
const centralAuth=require('./central-auth');
const licenseApi=require('./license-api');
const masterLicenses=require('./master-licenses');
const portalInstitutionAuth=require('./portal-institution-auth');
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:true},max:5});
const token=process.env.FLOW_ADMIN_TOKEN||'';
if(!process.env.DATABASE_URL||token.length<24){console.error('Configure DATABASE_URL e FLOW_ADMIN_TOKEN (mínimo 24 caracteres).');process.exit(1)}
const port=Number(process.env.PORT)||3000;
const defaults={services:['Matrículas','Financeiro','Vendas','Informações'],counters:{},queue:[],current:null,history:[],completed:0,calls:0,messages:['Bem-vindo ao atendimento.','Seu tempo é importante. Obrigado por aguardar.'],notice:'Tenha os documentos em mãos.'};
const send=(res,status,obj)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(obj))};
function legacyAuth(req){let given=(req.headers.authorization||'').replace(/^Bearer /,'');const a=Buffer.from(given),b=Buffer.from(token);return a.length===b.length&&crypto.timingSafeEqual(a,b)}
function act(s,a){const str=(v,n=80)=>typeof v==='string'?v.trim().slice(0,n):'';switch(a.type){
case 'issue': {const service=str(a.service),priority=a.priority==='preferencial'?'preferencial':'normal';const i=s.services.indexOf(service);if(i<0)throw Error('Serviço inválido');const k=(i+1)+'-'+priority;s.counters[k]=(s.counters[k]||0)+1;const code=(priority==='preferencial'?'P':'A')+(i+1)+'-'+String(s.counters[k]).padStart(3,'0');s.queue.push({code,service,priority});return {code}}
case 'call': {const service=str(a.service),desk=str(a.desk,15);if(!s.services.includes(service)||!/^[0-9]{1,3}$/.test(desk))throw Error('Serviço ou guichê inválido');if(s.current)throw Error('Conclua a chamada anterior');let i=s.queue.findIndex(q=>q.service===service&&q.priority==='preferencial');if(i<0)i=s.queue.findIndex(q=>q.service===service);if(i<0)throw Error('Fila vazia');s.current={...s.queue.splice(i,1)[0],desk};s.calls++;s.history.unshift({...s.current,done:false});s.history=s.history.slice(0,30);return {code:s.current.code}}
case 'finish': {if(!s.current)throw Error('Sem chamada ativa');const code=s.current.code;const h=s.history.find(q=>q.code===code);if(h)h.done=true;s.current=null;s.completed++;return {code}}
case 'service': {const name=str(a.name,40);if(!name||s.services.length>=12||s.services.some(x=>x.toLowerCase()===name.toLowerCase()))throw Error('Serviço inválido ou duplicado');s.services.push(name);return {name}}
case 'communication': {s.notice=str(a.notice,180)||defaults.notice;s.messages=Array.isArray(a.messages)?a.messages.filter(x=>typeof x==='string').map(x=>x.trim().slice(0,220)).filter(Boolean).slice(0,15):s.messages;return {ok:true}}
case 'demo': {if(s.queue.length||s.current)throw Error('Limpe a fila primeiro');for(const name of s.services.slice(0,4))act(s,{type:'issue',service:name,priority:'normal'});return {ok:true}}
case 'reset': {Object.assign(s,{queue:[],current:null,history:[],counters:{},completed:0,calls:0});return {ok:true}}
default:throw Error('Ação inválida')}}
async function auth(req){return !!(await centralAuth.session(req,pool))}
const institutionLookups=new Map();
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');
if(url.pathname==='/api/portal-institution-auth')return portalInstitutionAuth.handle(req,res,{pool,send});
if(url.pathname==='/api/master-licenses')return masterLicenses.handle(req,res,{pool,send});
if(url.pathname.startsWith('/api/central/'))return centralAuth.handle(req,res,{pool,send,legacyAuth});
if(url.pathname.startsWith('/api/device/'))return deviceApi.handle(req,res,{pool,auth,send,userAuth});
if(url.pathname==='/api/institutions-by-email'&&req.method==='POST'){
let raw='';try{const ip=String(req.socket.remoteAddress||'unknown'),now=Date.now();if(institutionLookups.size>2000){for(const [k,v] of institutionLookups)if(v.until<now)institutionLookups.delete(k)}const prior=institutionLookups.get(ip),rate=prior&&prior.until>now?prior:{count:0,until:now+600000};if(rate.count>=15)return send(res,429,{error:'Limite de consultas atingido. Tente novamente mais tarde'});rate.count++;institutionLookups.set(ip,rate);
for await(const chunk of req){raw+=chunk;if(raw.length>512)return send(res,413,{error:'Solicitação muito grande'})}
const a=JSON.parse(raw),email=String(a.email||'').trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return send(res,400,{error:'Informe um e-mail válido'});
const production=a.mode==='production';
const sql=production
?"SELECT DISTINCT c.id,c.name FROM flow_users u JOIN flow_clients c ON c.id=u.client_id WHERE u.email=$1 AND u.active=true AND u.role='atendente' AND c.active=true ORDER BY c.name,c.id LIMIT 30"
:"SELECT DISTINCT l.portal_institution_id AS id,c.name FROM flow_users u JOIN flow_portal_admin_links pal ON pal.flow_user_id=u.id AND pal.client_id=u.client_id JOIN flow_portal_institution_links l ON l.client_id=u.client_id JOIN flow_clients c ON c.id=u.client_id WHERE u.email=$1 AND u.active=true AND u.role='admin' AND c.active=true ORDER BY c.name,l.portal_institution_id LIMIT 30";
const q=await pool.query(sql,[email]);return send(res,200,{institutions:q.rows});
}catch{return send(res,503,{error:'Não foi possível consultar as instituições'})}}
if(url.pathname==='/api/admin-page-logout'&&req.method==='POST'){const central=await centralAuth.session(req,pool);if(central)await pool.query('UPDATE flow_master_sessions SET revoked_at=now() WHERE id=$1',[central.session_id]);res.setHeader('Set-Cookie',['flow_central_access=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0','flow_admin_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0','flow_central_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0']);return send(res,200,{ok:true})}
if(url.pathname==='/api/admin-page-access'&&req.method==='GET'){const [institutional,central]=await Promise.all([userAuth.adminPageSession(req,pool).catch(()=>null),auth(req).catch(()=>false)]);return send(res,200,{authorized:central||institutional?.role==='admin',central,clientId:institutional?.client_id||null})}
if(url.pathname==='/api/license')return licenseApi.handle(req,res,{pool,send,auth,userAuth});
if(url.pathname==='/api/institution-staff')return userAuth.institutionStaff(req,res,{pool,send});
if(url.pathname==='/api/institution-units')return institutionUnits.handle(req,res,{pool,send});
if(url.pathname==='/api/institution-panels')return institutionPanels.handle(req,res,{pool,send});
if(url.pathname==='/api/institution-overview')return institutionOverview.handle(req,res,{pool,send});
if(url.pathname==='/api/manage-users')return userAuth.manageUsers(req,res,{pool,auth,send});
if(url.pathname==='/api/me'&&req.method==='GET')return userAuth.me(req,res,{pool,send});
if(url.pathname==='/api/catalog'&&req.method==='GET')return userAuth.unitCatalog(req,res,{pool,send});
if(url.pathname==='/api/login'&&req.method==='POST')return userAuth.login(req,res,{pool,send});
if(url.pathname==='/api/logout'&&req.method==='POST')return userAuth.logout(req,res,{pool,send});
if(url.pathname==='/api/users'&&req.method==='POST')return userAuth.createUser(req,res,{pool,auth,send});
if(url.pathname==='/api/client-panels'&&req.method==='GET'){try{const u=await userAuth.session(req,pool);if(!u||u.role!=='admin')return send(res,403,{error:'Administrador necessário'});const q=await pool.query('SELECT p.id,p.name,p.public_key FROM flow_signage_profiles p JOIN flow_client_units un ON un.id=p.unit_id AND un.client_id=p.client_id AND un.active=true JOIN flow_clients c ON c.id=p.client_id AND c.active=true WHERE p.client_id=$1 AND p.active=true ORDER BY p.name',[u.client_id]);return send(res,200,{panels:q.rows})}catch{return send(res,503,{error:'Consulta indisponível'})}}
if(url.pathname==='/api/panel')return panelApi(req,res,{pool,send,deviceApi});
if(url.pathname==='/api/tenant')return tenantApi(req,res,{pool,auth,send,deviceApi});
if(url.pathname==='/api/admin')return adminApi(req,res,{pool,auth,send});
if(url.pathname==='/health')return send(res,200,{ok:true,service:'anna-flow'});
if(url.pathname==='/api/state'&&req.method==='GET'){try{const q=await pool.query('SELECT revision,state FROM flow_runtime WHERE id=1');return send(res,200,q.rows[0]||{revision:0,state:defaults})}catch{return send(res,503,{error:'Banco indisponível'})}}
if(url.pathname==='/api/action'&&req.method==='POST'){
if(!(await auth(req)))return send(res,401,{error:'Não autorizado'});
let body='';try{for await(const chunk of req){body+=chunk;if(body.length>12000)return send(res,413,{error:'Requisição muito grande'})}}catch{return send(res,400,{error:'Leitura inválida'})}
let a;try{a=JSON.parse(body)}catch{return send(res,400,{error:'JSON inválido'})}
const client=await pool.connect().catch(()=>null);if(!client)return send(res,503,{error:'Banco indisponível'});
try{await client.query('BEGIN');const q=await client.query('SELECT revision,state FROM flow_runtime WHERE id=1 FOR UPDATE');if(!q.rowCount)throw Error('Banco não inicializado');const state=q.rows[0].state;let result=act(state,a);const rev=Number(q.rows[0].revision)+1;await client.query('UPDATE flow_runtime SET state=$1::jsonb,revision=$2,updated_at=now() WHERE id=1',[JSON.stringify(state),rev]);await client.query('COMMIT');return send(res,200,{revision:rev,state,result})}catch(e){await client.query('ROLLBACK').catch(()=>{});return send(res,400,{error:e.message})}finally{client.release()}}
if(url.pathname.startsWith('/api/'))return send(res,404,{error:'Rota inexistente'});
if(req.method!=='GET')return send(res,405,{error:'Método inválido'});
const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
if(name==='admin.html'){const institutional=await userAuth.adminPageSession(req,pool).catch(()=>null);if(!(await auth(req))&&institutional?.role!=='admin'){res.writeHead(302,{'Location':'/flow-login.html','Cache-Control':'no-store'});return res.end()}}
if(!['index.html','app.js','anna-symbol.svg','admin.html','admin.js','tenant-console.js','panel.html','panel.js','panel-demo.html','panel-demo.js','panel-config.js','operator.html','operator.js','users-admin.js','manage-users.js','admin-layout.js','issue.html','issue.js','communication-admin.js','local-media.html','local-media.js','local-player.js','access.html','flow-login.html','flow-login.js','admin-gate.js','device.html','device.js','device-admin.js','institution-staff.js','institution-units.js','institution-panels.js','institution-overview.js'].includes(name))return send(res,404,{error:'Arquivo não encontrado'});
try{const data=fs.readFileSync(path.join(__dirname,name));res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' https://esm.sh; style-src 'self' 'unsafe-inline'; connect-src 'self' https://ep-spring-snow-b6mci3yx.neonauth.c-2.sa-east-1.aws.neon.tech; img-src 'self' data: blob:; media-src 'self' https: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(data)}catch{return send(res,404,{error:'Arquivo inexistente'})}});
server.listen(port,'0.0.0.0',()=>console.log('AnnA Flow online escutando na porta '+port));
