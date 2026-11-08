import http from 'node:http';
import { Pool } from 'pg';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const REQUIRED=['DATABASE_URL','NEON_AUTH_JWKS_URL','NEON_AUTH_ISSUER','NEON_AUTH_AUDIENCE','FRONTEND_ORIGIN'];
for(const name of REQUIRED)if(!process.env[name])throw new Error('Configuração ausente: '+name);
const allowedOrigins=new Set([new URL(process.env.FRONTEND_ORIGIN).origin,'https://anna-classroom.elisonborg.workers.dev']);
const port=Number(process.env.PORT||3000);
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:4,connectionTimeoutMillis:5000,ssl:{rejectUnauthorized:true}});
const jwks=createRemoteJWKSet(new URL(process.env.NEON_AUTH_JWKS_URL));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
const validName=(x,max)=>typeof x==='string'&&x.trim().length>=1&&x.trim().length<=max;
async function body(req){
 const chunks=[];let bytes=0;
 for await(const chunk of req){bytes+=chunk.length;if(bytes>8192)throw Object.assign(new Error('Corpo grande demais'),{status:413});chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Object.assign(new Error('JSON inválido'),{status:400})}
}
async function authenticate(req){
 const header=req.headers.authorization||'';
 const match=/^Bearer ([A-Za-z0-9._~-]+)$/.exec(header);
 if(!match)throw Object.assign(new Error('Token obrigatório'),{status:401});
 const {payload}=await jwtVerify(match[1],jwks,{issuer:process.env.NEON_AUTH_ISSUER,audience:process.env.NEON_AUTH_AUDIENCE,algorithms:['EdDSA','ES256','RS256']});
 if(typeof payload.sub!=='string'||!UUID.test(payload.sub))throw Object.assign(new Error('Identidade inválida'),{status:401});
 return payload.sub;
}
async function permission(db,userId,institutionId){
 // Permissão institucional ativa E módulo habilitado: nunca confiar no papel enviado pelo cliente.
 // A primeira versão permite apenas a administração institucional.
 const q=await db.query('SELECT anna_classroom.can_manage_institution($1::uuid,$2::uuid) AS permitted',[userId,institutionId]);
 if(q.rows[0]?.permitted!==true)throw Object.assign(new Error('Acesso institucional ou módulo não autorizado'),{status:403});
}
async function handler(req,res){
 res.setHeader('Vary','Origin');
 const requestedOrigin=req.headers.origin;
 if(requestedOrigin&&!allowedOrigins.has(requestedOrigin))return send(res,403,{error:'Origem não autorizada'});
 if(requestedOrigin&&allowedOrigins.has(requestedOrigin)){
  res.setHeader('Access-Control-Allow-Origin',requestedOrigin);
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, X-Institution-Id');
 }
 res.setHeader('X-Frame-Options','DENY');
 if(req.method==='OPTIONS')return requestedOrigin&&allowedOrigins.has(requestedOrigin)?send(res,204,{}):send(res,403,{error:'Origem não autorizada'});
 const pathname=new URL(req.url||'/', 'http://localhost').pathname;
 if(pathname==='/health'&&req.method==='GET')return send(res,200,{status:'ok',service:'anna-classroom-api'});
 if(!['GET','POST'].includes(req.method))return send(res,405,{error:'Método não permitido'});
 if(!['/v1/classes','/v1/students'].includes(pathname))return send(res,404,{error:'Rota inexistente'});
 try{
  let userId;
  try { userId=await authenticate(req); }
  catch { return send(res,401,{error:'Sessão inválida ou expirada'}); }
  const institutionId=req.headers['x-institution-id'];
  if(typeof institutionId!=='string'||!UUID.test(institutionId))return send(res,400,{error:'Instituição inválida'});
  const client=await pool.connect();
  try{
   await permission(client,userId,institutionId);
   if(req.method==='GET'&&pathname==='/v1/classes'){
    const rows=await client.query('SELECT id,name,school_year,created_at FROM anna_classroom.classes WHERE institution_id=$1 ORDER BY created_at DESC LIMIT 100',[institutionId]);
    return send(res,200,{items:rows.rows});
   }
   if(req.method==='GET'&&pathname==='/v1/students'){
    const rows=await client.query('SELECT id,display_name,created_at FROM anna_classroom.students WHERE institution_id=$1 ORDER BY display_name LIMIT 100',[institutionId]);
    return send(res,200,{items:rows.rows});
   }
   if(req.headers['content-type']?.split(';')[0]?.trim()!=='application/json')return send(res,415,{error:'Esperado application/json'});
   const data=await body(req);
   if(!data||typeof data!=='object'||Array.isArray(data))return send(res,400,{error:'Objeto JSON necessário'});
   if(pathname==='/v1/classes'){
    if(!validName(data.name,120)||!Number.isInteger(data.school_year)||data.school_year<2020||data.school_year>2200)return send(res,400,{error:'Nome ou ano inválido'});
    const created=await client.query('INSERT INTO anna_classroom.classes(institution_id,name,school_year,created_by) VALUES($1,$2,$3,$4) RETURNING id,name,school_year,created_at',[institutionId,data.name.trim(),data.school_year,userId]);
    return send(res,201,{item:created.rows[0]});
   }
   if(!validName(data.display_name,150))return send(res,400,{error:'Nome inválido'});
   const created=await client.query('INSERT INTO anna_classroom.students(institution_id,display_name) VALUES($1,$2) RETURNING id,display_name,created_at',[institutionId,data.display_name.trim()]);
   return send(res,201,{item:created.rows[0]});
  }finally{client.release();}
 }catch(e){
  const status=e.status||((e.code==='23503'||e.code==='23514')?400:500);
  // Não expor tokens, SQL, credenciais ou detalhes internos ao cliente.
  return send(res,status,{error:status===500?'Falha interna':e.message});
 }
}
const server=http.createServer(handler);
server.requestTimeout=15000;
server.listen(port,'0.0.0.0',()=>console.log('AnnA Classroom API pronta na porta '+port));
