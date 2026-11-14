import http from 'node:http';
import { Pool } from 'pg';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const REQUIRED=['DATABASE_URL','NEON_AUTH_JWKS_URL','FRONTEND_ORIGIN'];
for(const name of REQUIRED)if(!process.env[name])throw new Error('Configuração ausente: '+name);
const allowedOrigins=new Set([new URL(process.env.FRONTEND_ORIGIN).origin,'https://anna-classroom.elisonborg.workers.dev']);
const port=Number(process.env.PORT||3000);
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:4,connectionTimeoutMillis:5000,ssl:{rejectUnauthorized:true}});
const jwksUrl=new URL(process.env.NEON_AUTH_JWKS_URL);
const jwks=createRemoteJWKSet(jwksUrl);
// Neon Managed Auth assina os JWTs com issuer igual à origem do endpoint.
// O audience não é garantido nesse fluxo; assinatura e issuer são obrigatórios.
const authIssuer=jwksUrl.origin;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
const validName=(x,max)=>typeof x==='string'&&x.trim().length>=1&&x.trim().length<=max;

// GameLab v0.3 -> Classroom: snapshot validado no servidor. As respostas
// corretas só ficam no banco, nunca são incluídas nas listagens públicas.
function normalizeEduPlayQuiz(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const title=typeof value.title==='string'?value.title.trim():'';
 const subject=typeof value.subject==='string'?value.subject.trim():'';
 if(!validName(title,100)||subject.length>80||!Array.isArray(value.questions)||value.questions.length<1||value.questions.length>20)return null;
 const questions=[];
 for(const question of value.questions){
  if(!question||typeof question!=='object'||Array.isArray(question))return null;
  const prompt=typeof question.prompt==='string'?question.prompt.trim():'';
  const type=question.type==='boolean'?'boolean':question.type==='multiple'?'multiple':null;
  const options=question.options;
  const n=type==='boolean'?2:4;
  if(!type||!validName(prompt,300)||!Array.isArray(options)||options.length!==n)return null;
  if(!options.every(option=>validName(option,180)))return null;
  if(!Number.isInteger(question.correct)||question.correct<0||question.correct>=n)return null;
  const difficulty=['easy','medium','hard'].includes(question.difficulty)?question.difficulty:'medium';
  questions.push({prompt,type,options:options.map(option=>option.trim()),correct:question.correct,difficulty});
 }
 return {format:'anna-eduplay-quiz-v1',title,subject,questions};
}

async function body(req){
 const chunks=[];let bytes=0;
 for await(const chunk of req){bytes+=chunk.length;if(bytes>32768)throw Object.assign(new Error('Corpo grande demais'),{status:413});chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Object.assign(new Error('JSON inválido'),{status:400})}
}
async function authenticate(req){
 const header=req.headers.authorization||'';
 const match=/^Bearer ([A-Za-z0-9._~-]+)$/.exec(header);
 if(!match)throw Object.assign(new Error('Token obrigatório'),{status:401});
 const {payload}=await jwtVerify(match[1],jwks,{issuer:authIssuer,algorithms:['EdDSA']});
 if(typeof payload.sub!=='string'||!UUID.test(payload.sub))throw Object.assign(new Error('Identidade inválida'),{status:401});
 return payload.sub;
}
async function permission(db,userId,institutionId,pathname,method){
 // Administrador mantém direitos completos. Professor só pode consultar
 // turmas/aulas/atividades e criar conteúdo; estudantes e matrículas são restritos.
 const teacherRoute=(pathname==='/v1/classes'&&method==='GET')||
 (pathname==='/v1/lessons'&&['GET','POST'].includes(method))||
 (pathname==='/v1/assignments'&&['GET','POST'].includes(method))||
 (pathname==='/v1/eduplay/share'&&method==='POST');
 const q=await db.query(
  'SELECT anna_classroom.can_manage_institution($1::uuid,$2::uuid) AS admin, anna_classroom.can_author_eduplay($1::uuid,$2::uuid) AS author',
  [userId,institutionId]
 );
 const access=q.rows[0];
 if(access?.admin!==true&&!(teacherRoute&&access?.author===true))
  throw Object.assign(new Error('Acesso institucional ou módulo não autorizado'),{status:403});
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
 if(!['/v1/classes','/v1/students','/v1/enrollments','/v1/lessons','/v1/assignments','/v1/submissions','/v1/overview','/v1/access','/v1/eduplay/share'].includes(pathname))return send(res,404,{error:'Rota inexistente'});
 try{
  let userId;
  try { userId=await authenticate(req); }
  catch { return send(res,401,{error:'Sessão inválida ou expirada'}); }
  if(pathname==='/v1/access'){
   if(req.method!=='GET')return send(res,405,{error:'Método não permitido'});
   const client=await pool.connect();
   try{
    const result=await client.query('SELECT id,name,anna_classroom.can_manage_institution($1::uuid,id) AS administrator FROM anna_classroom.authorized_institution($1::uuid)',[userId]);
    if(!result.rows.length)return send(res,403,{error:'Classroom não habilitado para esta conta ou instituição'});
    return send(res,200,{authorized:true,institutions:result.rows});
   }finally{client.release();}
  }
  const institutionId=req.headers['x-institution-id'];
  if(typeof institutionId!=='string'||!UUID.test(institutionId))return send(res,400,{error:'Instituição inválida'});
  const client=await pool.connect();
  try{
   await permission(client,userId,institutionId,pathname,req.method);
   if(req.method==='GET'&&pathname==='/v1/overview'){
    const stats=await client.query('SELECT (SELECT count(*) FROM anna_classroom.classes WHERE institution_id=$1) AS classes,(SELECT count(*) FROM anna_classroom.students WHERE institution_id=$1) AS students,(SELECT count(*) FROM anna_classroom.enrollments WHERE institution_id=$1) AS enrollments,(SELECT count(*) FROM anna_classroom.lessons WHERE institution_id=$1) AS lessons,(SELECT count(*) FROM anna_classroom.assignments WHERE institution_id=$1) AS assignments,(SELECT count(*) FROM anna_classroom.submissions WHERE institution_id=$1) AS submissions',[institutionId]);
    return send(res,200,{stats:stats.rows[0]});
   }
   if(pathname==='/v1/overview')return send(res,405,{error:'Método não permitido'});
   if(req.method==='GET'&&pathname==='/v1/classes'){
    const rows=await client.query('SELECT id,name,school_year,created_at FROM anna_classroom.classes WHERE institution_id=$1 ORDER BY created_at DESC LIMIT 100',[institutionId]);
    return send(res,200,{items:rows.rows});
   }
   if(req.method==='GET'&&pathname==='/v1/students'){
    const rows=await client.query('SELECT id,display_name,created_at FROM anna_classroom.students WHERE institution_id=$1 ORDER BY display_name LIMIT 100',[institutionId]);
    return send(res,200,{items:rows.rows});
   }
   if(req.method==='GET'&&pathname==='/v1/enrollments'){
    const rows=await client.query('SELECT e.id,e.class_id,e.student_id,e.enrolled_at,c.name AS class_name,c.school_year,s.display_name AS student_name FROM anna_classroom.enrollments e JOIN anna_classroom.classes c ON c.id=e.class_id AND c.institution_id=e.institution_id JOIN anna_classroom.students s ON s.id=e.student_id AND s.institution_id=e.institution_id WHERE e.institution_id=$1 ORDER BY c.name,s.display_name LIMIT 500',[institutionId]);
    return send(res,200,{items:rows.rows});
   }
   if(req.method==='GET'&&pathname==='/v1/lessons'){
    const rows=await client.query('SELECT l.id,l.class_id,l.title,l.description,l.created_at,c.name AS class_name FROM anna_classroom.lessons l JOIN anna_classroom.classes c ON c.id=l.class_id AND c.institution_id=l.institution_id WHERE l.institution_id=$1 ORDER BY l.created_at DESC LIMIT 100',[institutionId]);
    return send(res,200,{items:rows.rows});
   }
   if(req.method==='GET'&&pathname==='/v1/assignments'){
    const rows=await client.query('SELECT a.id,a.lesson_id,a.title,a.instructions,a.due_at,a.created_at,(a.eduplay_quiz IS NOT NULL) AS from_eduplay,l.title AS lesson_title FROM anna_classroom.assignments a JOIN anna_classroom.lessons l ON l.id=a.lesson_id AND l.institution_id=a.institution_id WHERE a.institution_id=$1 ORDER BY a.created_at DESC LIMIT 100',[institutionId]);
    return send(res,200,{items:rows.rows});
   }
   if(req.method==='GET'&&pathname==='/v1/submissions'){
    const rows=await client.query('SELECT s.id,s.student_id,s.assignment_id,s.submitted_at,s.grade,s.feedback,st.display_name AS student_name,a.title AS assignment_title FROM anna_classroom.submissions s JOIN anna_classroom.students st ON st.id=s.student_id AND st.institution_id=s.institution_id JOIN anna_classroom.assignments a ON a.id=s.assignment_id AND a.institution_id=s.institution_id WHERE s.institution_id=$1 ORDER BY s.submitted_at DESC LIMIT 100',[institutionId]);
    return send(res,200,{items:rows.rows});
   }
   if(pathname==='/v1/submissions')return send(res,405,{error:'Cadastro de entregas reservado ao fluxo de estudantes'});
   if(req.headers['content-type']?.split(';')[0]?.trim()!=='application/json')return send(res,415,{error:'Esperado application/json'});
   const data=await body(req);
   if(!data||typeof data!=='object'||Array.isArray(data))return send(res,400,{error:'Objeto JSON necessário'});
   if(pathname==='/v1/eduplay/share'){
    if(typeof data.lesson_id!=='string'||!UUID.test(data.lesson_id))return send(res,400,{error:'Selecione uma aula válida'});
    const quiz=normalizeEduPlayQuiz(data.quiz);
    if(!quiz)return send(res,400,{error:'Quiz inválido: título, alternativas ou respostas fora dos limites'});
    if(typeof(data.instructions??'')!=='string'||(data.instructions||'').length>3000)return send(res,400,{error:'Instruções inválidas'});
    const dueAt=data.due_at?new Date(data.due_at):null;
    if(dueAt&&(!Number.isFinite(dueAt.getTime())||typeof data.due_at!=='string'))return send(res,400,{error:'Prazo inválido'});
    const created=await client.query(
     'INSERT INTO anna_classroom.assignments (institution_id,lesson_id,title,instructions,due_at,created_by,eduplay_quiz) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING id,title,lesson_id,created_at',
     [institutionId,data.lesson_id,quiz.title,(data.instructions||'').trim(),dueAt?dueAt.toISOString():null,userId,JSON.stringify(quiz)]
    );
    return send(res,201,{item:created.rows[0],origin:'anna-eduplay'});
   }
   if(pathname==='/v1/enrollments'){
    if(typeof data.class_id!=='string'||!UUID.test(data.class_id)||typeof data.student_id!=='string'||!UUID.test(data.student_id))return send(res,400,{error:'Turma e aluno obrigatórios'});
    const created=await client.query('INSERT INTO anna_classroom.enrollments(institution_id,class_id,student_id) VALUES($1,$2,$3) RETURNING id,class_id,student_id,enrolled_at',[institutionId,data.class_id,data.student_id]);
    return send(res,201,{item:created.rows[0]});
   }
   if(pathname==='/v1/lessons'){
    if(typeof data.class_id!=='string'||!UUID.test(data.class_id)||!validName(data.title,150)||typeof(data.description??'')!=='string'||(data.description||'').length>3000)return send(res,400,{error:'Turma, título ou descrição inválidos'});
    const created=await client.query('INSERT INTO anna_classroom.lessons(institution_id,class_id,title,description,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,class_id,title,description,created_at',[institutionId,data.class_id,data.title.trim(),(data.description||'').trim(),userId]);
    return send(res,201,{item:created.rows[0]});
   }
   if(pathname==='/v1/assignments'){
    if(typeof data.lesson_id!=='string'||!UUID.test(data.lesson_id)||!validName(data.title,150)||typeof(data.instructions??'')!=='string'||(data.instructions||'').length>5000)return send(res,400,{error:'Aula, título ou instruções inválidos'});
    let dueAt=null;
    if(data.due_at!==null&&data.due_at!==undefined&&data.due_at!==''){
     if(typeof data.due_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(data.due_at)||!Number.isFinite(Date.parse(data.due_at)))return send(res,400,{error:'Prazo inválido'});
     dueAt=new Date(data.due_at).toISOString();
    }
    const created=await client.query('INSERT INTO anna_classroom.assignments(institution_id,lesson_id,title,instructions,due_at,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,lesson_id,title,instructions,due_at,created_at',[institutionId,data.lesson_id,data.title.trim(),(data.instructions||'').trim(),dueAt,userId]);
    return send(res,201,{item:created.rows[0]});
   }
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
  const status=e.status||(e.code==='23505'?409:(e.code==='23503'||e.code==='23514'||e.code==='23502')?400:500);
  // Não expor tokens, SQL, credenciais ou detalhes internos ao cliente.
  return send(res,status,{error:status===500?'Falha interna':status===409?'Registro já existente':status===400&&e.code==='23503'?'Referência não encontrada nesta instituição':status===400&&e.code==='23514'?'Dados fora dos limites aceitos':e.message});
 }
}
const server=http.createServer(handler);
server.requestTimeout=15000;
server.listen(port,'0.0.0.0',()=>console.log('AnnA Classroom API pronta na porta '+port));
