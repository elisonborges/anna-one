import {createRemoteJWKSet,jwtVerify} from 'jose';
const AUTH_BASE='https://ep-spring-snow-b6mci3yx.neonauth.c-2.sa-east-1.aws.neon.tech/neondb/auth';
const jwks=createRemoteJWKSet(new URL(AUTH_BASE+'/jwks'));
export function mountSso(app,pool,sign,secret){
 app.post('/api/sso',async(req,res,next)=>{
  try{
   const token=typeof req.body?.token==='string'?req.body.token:'';
   if(token.length>8192||token.split('.').length!==3)return res.status(401).json({error:'Token inválido'});
   const {payload}=await jwtVerify(token,jwks,{issuer:AUTH_BASE,algorithms:['EdDSA','ES256','RS256']});
   const identity=String(payload.sub||payload.id||'');
   if(!identity||identity.length>160)return res.status(401).json({error:'Identidade inválida'});
   let user=(await pool.query('SELECT id,nome,perfil,ativo FROM reception.usuarios WHERE identidade_externa=$1',[identity])).rows[0];
   if(!user){
    // Somente o administrador Master confirmado pelo serviço de autorização do portal pode iniciar a administração.
    const response=await fetch('https://anna-one-auditoria.elisonborg.workers.dev/v1/admin/authorize',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(6000)});
    if(!response.ok||(await response.json()).admin_authorized!==true)return res.status(403).json({error:'Conta AnnA One válida, mas sem permissão no Reception'});
    const name=String(payload.name||payload.email||'Administrador AnnA One').slice(0,150);
    user=(await pool.query("INSERT INTO reception.usuarios(identidade_externa,nome,perfil) VALUES($1,$2,'admin') ON CONFLICT(identidade_externa) DO UPDATE SET identidade_externa=EXCLUDED.identidade_externa RETURNING id,nome,perfil,ativo",[identity,name])).rows[0];
   }
   if(!user.ativo)return res.status(403).json({error:'Acesso desativado'});
   const b=Buffer.from(JSON.stringify({id:user.id,exp:Date.now()+28800000})).toString('base64url');
   const csrf=(await import('node:crypto')).randomBytes(20).toString('hex');
   const flags='Path=/; Secure; SameSite=Strict; Max-Age=28800';
   res.set('Set-Cookie',[`reception_session=${b}.${sign(b)}; HttpOnly; ${flags}`,`reception_csrf=${csrf}; ${flags}`]);
   res.json({user:{nome:user.nome,perfil:user.perfil},csrf});
  }catch(e){if(['JWTExpired','JWSSignatureVerificationFailed','JWTClaimValidationFailed'].includes(e.name))return res.status(401).json({error:'Sessão AnnA One inválida'});next(e)}
 });
}