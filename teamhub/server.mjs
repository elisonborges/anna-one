import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {neon} from '@neondatabase/serverless';
import {createRemoteJWKSet,jwtVerify} from 'jose';

const vars=['DATABASE_URL','AUTH_JWKS_URL','AUTH_ISSUER','AUTH_AUDIENCE'];
for(const key of vars) if(!process.env[key]) throw Error('Configuração ausente: '+key);
const sql=neon(process.env.DATABASE_URL);
const jwks=createRemoteJWKSet(new URL(process.env.AUTH_JWKS_URL));
const dir=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||3000);
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(res,status,obj)=>{res.writeHead(status,headers);res.end(JSON.stringify(obj));};
const validId=id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id||'');
async function json(req){
 let raw=''; for await(const c of req){raw+=c;if(raw.length>25000)throw Object.assign(Error('Payload grande'),{status:413});}
 try{return raw?JSON.parse(raw):{};}catch{throw Object.assign(Error('JSON inválido'),{status:400});}
}
function bad(message,status=400){throw Object.assign(Error(message),{status});}
async function user(req){
 const token=/^Bearer\s+(.+)$/i.exec(req.headers.authorization||'')?.[1]; if(!token)bad('Faça login no Portal AnnA One.',401);
 try{
  const {payload}=await jwtVerify(token,jwks,{issuer:process.env.AUTH_ISSUER,audience:process.env.AUTH_AUDIENCE,algorithms:['RS256','ES256','EdDSA']});
  if(typeof payload.sub!=='string'||!payload.sub)bad('Identidade inválida',401);
  return payload.sub;
 }catch(e){if(e.status)throw e;bad('Sessão inválida ou expirada.',401);}
}
async function membership(subject,org){
 const r=await sql`SELECT role FROM teamhub.memberships WHERE auth_subject=${subject} AND organization_id=${org} AND active=true`;
 if(!r.length)bad('Acesso à organização negado.',403);return r[0].role;
}
function requireEditor(role){if(!['admin','manager','member'].includes(role))bad('Operação não autorizada.',403);}
function requireManager(role){if(!['admin','manager'].includes(role))bad('Operação reservada ao gestor.',403);}
async function project(org,id){
 const rows=await sql`SELECT id,name,description,created_at FROM teamhub.projects WHERE organization_id=${org} AND id=${id} AND archived_at IS NULL`;
 if(!rows.length)bad('Projeto indisponível.',404);return rows[0];
}
const route=async(req,res)=>{
 if(req.method==='OPTIONS'){res.writeHead(405);return res.end();}
 const url=new URL(req.url,'http://localhost'); const p=url.pathname;
 if(p==='/health')return reply(res,200,{ok:true,service:'anna-nexus'});
 if(!p.startsWith('/api/')){
  if(req.method!=='GET')return reply(res,405,{error:'Método não permitido'});
  const file=p==='/'?'/index.html':p;
  if(!['/index.html','/app.js','/styles.css','/manifest.webmanifest'].includes(file))return reply(res,404,{error:'Não encontrado'});
  const data=await readFile(path.join(dir,'public',file));
  res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.webmanifest')?'application/manifest+json':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' https://esm.sh; connect-src 'self' https://*.neon.tech https://*.neonauth.*; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"});return res.end(data);
 }
 const subject=await user(req);
 if(p==='/api/me'&&req.method==='GET'){
  const orgs=await sql`SELECT o.id,o.name,m.role FROM teamhub.memberships m JOIN teamhub.organizations o ON o.id=m.organization_id WHERE m.auth_subject=${subject} AND m.active=true ORDER BY o.name`;
  return reply(res,200,{organizations:orgs});
 }
 const org=url.searchParams.get('org')||req.headers['x-organization-id'];
 if(!validId(org))bad('Selecione uma organização válida.');
 const role=await membership(subject,org);
 if(p==='/api/projects'&&req.method==='GET'){
  const projects=await sql`SELECT p.id,p.name,p.description,p.created_at, COUNT(t.id)::int AS total, COUNT(t.id) FILTER(WHERE t.status='done')::int AS done FROM teamhub.projects p LEFT JOIN teamhub.tasks t ON t.project_id=p.id AND t.organization_id=p.organization_id WHERE p.organization_id=${org} AND p.archived_at IS NULL GROUP BY p.id ORDER BY p.created_at DESC`;
  return reply(res,200,{projects,role});
 }
 if(p==='/api/projects'&&req.method==='POST'){
  requireManager(role);const body=await json(req);const name=String(body.name||'').trim();if(name.length<2||name.length>160)bad('Nome entre 2 e 160 caracteres.');
  const rows=await sql`INSERT INTO teamhub.projects(organization_id,name,description) VALUES(${org},${name},${String(body.description||'').slice(0,1000)}) RETURNING id,name,description`;
  await sql`INSERT INTO teamhub.activities(organization_id,actor_subject,action,project_id) VALUES(${org},${subject},'project.created',${rows[0].id})`;
  return reply(res,201,{project:rows[0]});
 }
 const pm=/^\/api\/projects\/([0-9a-f-]+)\/tasks$/.exec(p);
 if(pm&&validId(pm[1])){
  const proj=await project(org,pm[1]);
  if(req.method==='GET'){
   const tasks=await sql`SELECT id,title,description,status,priority,assignee_subject,due_at,position,created_at FROM teamhub.tasks WHERE organization_id=${org} AND project_id=${proj.id} ORDER BY position,created_at`;
   return reply(res,200,{project:proj,tasks,role});
  }
  if(req.method==='POST'){
   requireEditor(role);const b=await json(req),title=String(b.title||'').trim();
   if(title.length<2||title.length>240)bad('Título entre 2 e 240 caracteres.');
   const rows=await sql`INSERT INTO teamhub.tasks(organization_id,project_id,title,description,created_by_subject,position) VALUES(${org},${proj.id},${title},${String(b.description||'').slice(0,2000)},${subject},(SELECT COALESCE(MAX(position),0)+1 FROM teamhub.tasks WHERE project_id=${proj.id})) RETURNING *`;
   await sql`INSERT INTO teamhub.activities(organization_id,actor_subject,action,project_id,task_id) VALUES(${org},${subject},'task.created',${proj.id},${rows[0].id})`;
   return reply(res,201,{task:rows[0]});
  }
 }
 const tm=/^\/api\/tasks\/([0-9a-f-]+)$/.exec(p);
 if(tm&&validId(tm[1])&&req.method==='PATCH'){
  requireEditor(role);const b=await json(req);
  const keys=Object.keys(b);if(!keys.length||keys.some(k=>!['status','priority','title'].includes(k)))bad('Campos não permitidos.');
  const existing=await sql`SELECT id,project_id,title,status,priority FROM teamhub.tasks WHERE id=${tm[1]} AND organization_id=${org}`;
  if(!existing.length)bad('Tarefa não encontrada.',404);
  const t=existing[0];const status=b.status===undefined?t.status:b.status,priority=b.priority===undefined?t.priority:b.priority,title=b.title===undefined?t.title:String(b.title).trim();
  if(!['todo','doing','done'].includes(status)||!['low','medium','high'].includes(priority)||title.length<2||title.length>240)bad('Valores inválidos.');
  const result=await sql`UPDATE teamhub.tasks SET status=${status},priority=${priority},title=${title},updated_at=now() WHERE id=${t.id} AND organization_id=${org} RETURNING id,title,status,priority`;
  await sql`INSERT INTO teamhub.activities(organization_id,actor_subject,action,project_id,task_id) VALUES(${org},${subject},'task.updated',${t.project_id},${t.id})`;
  return reply(res,200,{task:result[0]});
 }
 return reply(res,404,{error:'Rota não encontrada'});
};
http.createServer((req,res)=>Promise.resolve(route(req,res)).catch(e=>reply(res,e.status||500,{error:e.status?e.message:'Erro interno'}))).listen(port,'0.0.0.0',()=>console.log('AnnA Nexus na porta',port));
