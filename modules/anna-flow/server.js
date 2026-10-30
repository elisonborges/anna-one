'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Pool}=require('pg');
const adminApi=require('./admin-api');
const tenantApi=require('./tenant-api');
const panelApi=require('./panel-api');
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:true},max:5});
const token=process.env.FLOW_ADMIN_TOKEN||'';
if(!process.env.DATABASE_URL||token.length<24){console.error('Configure DATABASE_URL e FLOW_ADMIN_TOKEN (mínimo 24 caracteres).');process.exit(1)}
const port=Number(process.env.PORT)||3000;
const defaults={services:['Matrículas','Financeiro','Vendas','Informações'],counters:{},queue:[],current:null,history:[],completed:0,calls:0,messages:['Bem-vindo ao atendimento.','Seu tempo é importante. Obrigado por aguardar.'],notice:'Tenha os documentos em mãos.'};
const send=(res,status,obj)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(obj))};
function auth(req){let given=(req.headers.authorization||'').replace(/^Bearer /,'');const a=Buffer.from(given),b=Buffer.from(token);return a.length===b.length&&crypto.timingSafeEqual(a,b)}
function act(s,a){const str=(v,n=80)=>typeof v==='string'?v.trim().slice(0,n):'';switch(a.type){
case 'issue': {const service=str(a.service),priority=a.priority==='preferencial'?'preferencial':'normal';const i=s.services.indexOf(service);if(i<0)throw Error('Serviço inválido');const k=(i+1)+'-'+priority;s.counters[k]=(s.counters[k]||0)+1;const code=(priority==='preferencial'?'P':'A')+(i+1)+'-'+String(s.counters[k]).padStart(3,'0');s.queue.push({code,service,priority});return {code}}
case 'call': {const service=str(a.service),desk=str(a.desk,15);if(!s.services.includes(service)||!/^[0-9]{1,3}$/.test(desk))throw Error('Serviço ou guichê inválido');if(s.current)throw Error('Conclua a chamada anterior');let i=s.queue.findIndex(q=>q.service===service&&q.priority==='preferencial');if(i<0)i=s.queue.findIndex(q=>q.service===service);if(i<0)throw Error('Fila vazia');s.current={...s.queue.splice(i,1)[0],desk};s.calls++;s.history.unshift({...s.current,done:false});s.history=s.history.slice(0,30);return {code:s.current.code}}
case 'finish': {if(!s.current)throw Error('Sem chamada ativa');const code=s.current.code;const h=s.history.find(q=>q.code===code);if(h)h.done=true;s.current=null;s.completed++;return {code}}
case 'service': {const name=str(a.name,40);if(!name||s.services.length>=12||s.services.some(x=>x.toLowerCase()===name.toLowerCase()))throw Error('Serviço inválido ou duplicado');s.services.push(name);return {name}}
case 'communication': {s.notice=str(a.notice,180)||defaults.notice;s.messages=Array.isArray(a.messages)?a.messages.filter(x=>typeof x==='string').map(x=>x.trim().slice(0,220)).filter(Boolean).slice(0,15):s.messages;return {ok:true}}
case 'demo': {if(s.queue.length||s.current)throw Error('Limpe a fila primeiro');for(const name of s.services.slice(0,4))act(s,{type:'issue',service:name,priority:'normal'});return {ok:true}}
case 'reset': {Object.assign(s,{queue:[],current:null,history:[],counters:{},completed:0,calls:0});return {ok:true}}
default:throw Error('Ação inválida')}}
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');
if(url.pathname==='/api/panel')return panelApi(req,res,{pool,send});
if(url.pathname==='/api/tenant')return tenantApi(req,res,{pool,auth,send});
if(url.pathname==='/api/admin')return adminApi(req,res,{pool,auth,send});
if(url.pathname==='/health')return send(res,200,{ok:true,service:'anna-flow'});
if(url.pathname==='/api/state'&&req.method==='GET'){try{const q=await pool.query('SELECT revision,state FROM flow_runtime WHERE id=1');return send(res,200,q.rows[0]||{revision:0,state:defaults})}catch{return send(res,503,{error:'Banco indisponível'})}}
if(url.pathname==='/api/action'&&req.method==='POST'){
if(!auth(req))return send(res,401,{error:'Não autorizado'});
let body='';try{for await(const chunk of req){body+=chunk;if(body.length>12000)return send(res,413,{error:'Requisição muito grande'})}}catch{return send(res,400,{error:'Leitura inválida'})}
let a;try{a=JSON.parse(body)}catch{return send(res,400,{error:'JSON inválido'})}
const client=await pool.connect().catch(()=>null);if(!client)return send(res,503,{error:'Banco indisponível'});
try{await client.query('BEGIN');const q=await client.query('SELECT revision,state FROM flow_runtime WHERE id=1 FOR UPDATE');if(!q.rowCount)throw Error('Banco não inicializado');const state=q.rows[0].state;let result=act(state,a);const rev=Number(q.rows[0].revision)+1;await client.query('UPDATE flow_runtime SET state=$1::jsonb,revision=$2,updated_at=now() WHERE id=1',[JSON.stringify(state),rev]);await client.query('COMMIT');return send(res,200,{revision:rev,state,result})}catch(e){await client.query('ROLLBACK').catch(()=>{});return send(res,400,{error:e.message})}finally{client.release()}}
if(url.pathname.startsWith('/api/'))return send(res,404,{error:'Rota inexistente'});
if(req.method!=='GET')return send(res,405,{error:'Método inválido'});
const name=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!['index.html','app.js','anna-symbol.svg','admin.html','admin.js','tenant-console.js','panel.html','panel.js'].includes(name))return send(res,404,{error:'Arquivo não encontrado'});
try{const data=fs.readFileSync(path.join(__dirname,name));res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(data)}catch{return send(res,404,{error:'Arquivo inexistente'})}});
server.listen(port,'0.0.0.0',()=>console.log('AnnA Flow online escutando na porta '+port));
