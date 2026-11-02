import {mountSso} from './sso.js';
import express from 'express';
import pg from 'pg';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import {timingSafeEqual, createHmac} from 'node:crypto';
const app=express(); const secret=process.env.SESSION_SECRET||'';
if(!process.env.DATABASE_URL||secret.length<48)throw Error('Missing secure database and session configuration');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:true},max:5});
app.disable('x-powered-by');app.set('trust proxy',1);app.use(helmet());app.use(express.json({limit:'16kb'}));
app.use('/api',rateLimit({windowMs:60000,limit:90,standardHeaders:'draft-8',legacyHeaders:false}));
const sign=v=>createHmac('sha256',secret).update(v).digest('hex');
const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=')));
const fail=(res,code,message)=>res.status(code).json({error:message});
const route=f=>(req,res,next)=>Promise.resolve(f(req,res)).catch(next);
function session(req){try{const [b,s]=String(cookies(req).reception_session||'').split('.');if(!b||!s||!timingSafeEqual(Buffer.from(sign(b),'hex'),Buffer.from(s,'hex')))return null;const x=JSON.parse(Buffer.from(b,'base64url'));return x.exp>Date.now()?x:null}catch{return null}}
async function auth(req,res,next){const s=session(req);if(!s)return fail(res,401,'Faça login');const x=await pool.query('SELECT id,nome,perfil FROM reception.usuarios WHERE id=$1 AND ativo=true',[s.id]);if(!x.rows[0])return fail(res,401,'Acesso não autorizado');req.user=x.rows[0];next()}
function role(...roles){return(req,res,next)=>roles.includes(req.user.perfil)?next():fail(res,403,'Perfil não autorizado')}
app.use('/api',(req,res,next)=>{if(['GET','HEAD'].includes(req.method))return next();const origin=req.get('origin');if(origin&&origin!==req.protocol+'://'+req.get('host'))return fail(res,403,'Origem inválida');if(req.path==='/sso')return next();if(!cookies(req).reception_csrf || !req.get('x-csrf-token') || req.get('x-csrf-token')!==cookies(req).reception_csrf)return fail(res,403,'Sessão inválida');next()});
// Proxy restrito ao Neon Auth central: mantém a autenticação no mesmo domínio do navegador.
const CENTRAL_AUTH='https://ep-spring-snow-b6mci3yx.neonauth.c-2.sa-east-1.aws.neon.tech/neondb/auth';
app.all('/central-auth/{*path}',rateLimit({windowMs:60000,limit:30}),route(async(req,res)=>{
 const sub=Array.isArray(req.params.path)?req.params.path.join('/'):String(req.params.path||'');
 const allowed=/^(get-session|sign-in\/email|sign-out|token|refresh-token|\.well-known\/jwks\.json)$/;
 if(!allowed.test(sub)||!['GET','POST'].includes(req.method))return fail(res,404,'Rota não disponível');
 const target=CENTRAL_AUTH+'/'+sub+(req.url.includes('?')?'?'+req.url.split('?').slice(1).join('?'):'');
 const headers={'accept':'application/json','origin':'https://annaone.com.br'};
 if(req.method==='POST')headers['content-type']='application/json';
 if(req.headers.cookie)headers.cookie=req.headers.cookie;
 let remote;
 try{remote=await fetch(target,{method:req.method,headers,body:req.method==='POST'?JSON.stringify(req.body||{}):undefined,redirect:'manual',signal:AbortSignal.timeout(12000)})}
 catch{return fail(res,502,'Neon Auth indisponível para o servidor')}
 for(const raw of remote.headers.getSetCookie?.()||[]){res.append('Set-Cookie',raw.replace(/;\s*Domain=[^;]*/ig,''))}
 res.status(remote.status);
 const ct=remote.headers.get('content-type');if(ct)res.set('Content-Type',ct);
 res.send(Buffer.from(await remote.arrayBuffer()));
}));
mountSso(app,pool,sign,secret);
app.get('/api/health',(_req,res)=>res.json({status:'online'}));
app.get('/api/me',auth,(req,res)=>res.json({user:req.user}));
app.get('/api/usuarios',auth,role('admin'),route(async(req,res)=>{const x=await pool.query('SELECT id,nome,perfil,ativo,criado_em FROM reception.usuarios ORDER BY nome LIMIT 250');res.json(x.rows)}));
app.post('/api/logout',auth,(req,res)=>{res.set('Set-Cookie',['reception_session=; Path=/; Secure; HttpOnly; Max-Age=0','reception_csrf=; Path=/; Secure; Max-Age=0']);res.json({ok:true})});
app.get('/api/alunos',auth,role('apoio','admin','recepcao'),route(async(req,res)=>{const q=String(req.query.q||'').trim();if(q.length<2)return res.json([]);const x=await pool.query('SELECT a.id,a.nome,t.identificacao turma FROM reception.alunos a LEFT JOIN reception.turmas t ON t.id=a.turma_id WHERE a.ativo=true AND a.nome ILIKE $1 ORDER BY a.nome LIMIT 20',['%'+q+'%']);res.json(x.rows)}));
app.get('/api/responsaveis/:id',auth,role('apoio','admin','recepcao'),route(async(req,res)=>{const x=await pool.query("SELECT r.id,r.nome,ar.exige_conferencia FROM reception.autorizacoes_retirada ar JOIN reception.responsaveis r ON r.id=ar.responsavel_id WHERE ar.aluno_id=$1 AND ar.autorizada AND (ar.valida_de IS NULL OR ar.valida_de<=CURRENT_DATE) AND (ar.valida_ate IS NULL OR ar.valida_ate>=CURRENT_DATE) ORDER BY r.nome",[req.params.id]);res.json(x.rows)}));
app.post('/api/liberacoes',auth,role('apoio','admin'),route(async(req,res)=>{const {aluno_id,responsavel_id,motivo,presencial}=req.body||{};if(!presencial||!String(motivo||'').trim()||String(motivo).length>500)return fail(res,400,'Conferência presencial e motivo obrigatórios');const c=await pool.connect(),code=randomBytes(9).toString('base64url').toUpperCase();try{await c.query('BEGIN');const ar=await c.query("SELECT ar.id FROM reception.autorizacoes_retirada ar JOIN reception.alunos a ON a.id=ar.aluno_id WHERE a.ativo AND ar.aluno_id=$1 AND ar.responsavel_id=$2 AND ar.autorizada AND NOT ar.exige_conferencia AND (ar.valida_de IS NULL OR ar.valida_de<=CURRENT_DATE) AND (ar.valida_ate IS NULL OR ar.valida_ate>=CURRENT_DATE) FOR UPDATE OF ar",[aluno_id,responsavel_id]);if(!ar.rows[0]){await c.query('ROLLBACK');return fail(res,409,'Responsável sem autorização válida')}const x=await c.query("INSERT INTO reception.liberacoes(aluno_id,responsavel_id,autorizacao_id,emitida_por,codigo_hash,motivo,expira_em) VALUES($1,$2,$3,$4,$5,$6,now()+interval '2 hours') RETURNING id,expira_em",[aluno_id,responsavel_id,ar.rows[0].id,req.user.id,sign(code),String(motivo).trim()]);await c.query("INSERT INTO reception.historico_operacoes(liberacao_id,usuario_id,acao) VALUES($1,$2,'emissao')",[x.rows[0].id,req.user.id]);await c.query('COMMIT');res.json({...x.rows[0],code})}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}));
app.post('/api/validar',auth,role('portaria','admin'),route(async(req,res)=>{const code=String(req.body?.code||'').trim().toUpperCase();if(!/^[A-Z0-9_-]{12}$/.test(code))return fail(res,400,'Código inválido');const x=await pool.query('SELECT l.status,l.expira_em,l.motivo,a.nome aluno,r.nome responsavel,t.identificacao turma FROM reception.liberacoes l JOIN reception.alunos a ON a.id=l.aluno_id JOIN reception.responsaveis r ON r.id=l.responsavel_id LEFT JOIN reception.turmas t ON t.id=a.turma_id WHERE l.codigo_hash=$1',[sign(code)]);if(!x.rows[0])return fail(res,404,'Código não encontrado');res.json({...x.rows[0],validavel:x.rows[0].status==='pendente'&&new Date(x.rows[0].expira_em)>new Date()})}));
app.post('/api/confirmar',auth,role('portaria','admin'),route(async(req,res)=>{const code=String(req.body?.code||'').trim().toUpperCase();if(!/^[A-Z0-9_-]{12}$/.test(code)||req.body?.conferido!==true)return fail(res,400,'Conferência presencial obrigatória');const c=await pool.connect();try{await c.query('BEGIN');const x=await c.query("UPDATE reception.liberacoes l SET status='confirmada',confirmada_em=now(),confirmada_por=$2 WHERE codigo_hash=$1 AND status='pendente' AND expira_em>now() AND EXISTS(SELECT 1 FROM reception.autorizacoes_retirada ar WHERE ar.id=l.autorizacao_id AND ar.autorizada AND NOT ar.exige_conferencia AND (ar.valida_de IS NULL OR ar.valida_de<=CURRENT_DATE) AND (ar.valida_ate IS NULL OR ar.valida_ate>=CURRENT_DATE)) RETURNING id,confirmada_em",[sign(code),req.user.id]);if(!x.rows[0]){await c.query('ROLLBACK');return fail(res,409,'Liberação inválida, expirada ou já utilizada')}await c.query("INSERT INTO reception.historico_operacoes(liberacao_id,usuario_id,acao) VALUES($1,$2,'saida_confirmada')",[x.rows[0].id,req.user.id]);await c.query('COMMIT');res.json(x.rows[0])}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}));
app.get('/api/historico',auth,role('apoio','recepcao','admin'),route(async(req,res)=>{const x=await pool.query('SELECT l.status,l.criada_em,l.confirmada_em,a.nome aluno,r.nome responsavel FROM reception.liberacoes l JOIN reception.alunos a ON a.id=l.aluno_id JOIN reception.responsaveis r ON r.id=l.responsavel_id WHERE $1::boolean OR l.emitida_por=$2 ORDER BY l.criada_em DESC LIMIT 100',[req.user.perfil!=='apoio',req.user.id]);res.json(x.rows)}));
app.use(express.static('public',{maxAge:0}));
app.get('/{*path}',(_req,res)=>res.sendFile(process.cwd()+'/public/index.html'));
app.use((err,req,res,next)=>{console.error(err);fail(res,500,'Erro interno')});
app.listen(Number(process.env.PORT||3000),'0.0.0.0');