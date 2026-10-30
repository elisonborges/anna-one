'use strict';
const crypto=require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PARAMETERS={N:16384,r:8,p:1,maxmem:32*1024*1024};
function hashPassword(password) {
 if(typeof password!=='string'||password.length<12||Buffer.byteLength(password)>1024) throw Error('invalid password');
 const salt=crypto.randomBytes(16);
 const digest=crypto.scryptSync(password,salt,64,PARAMETERS);
 return 'scrypt$16384$8$1$'+salt.toString('base64url')+'$'+digest.toString('base64url');
}
function verifyPassword(password,encoded) {
 if(typeof password!=='string'||Buffer.byteLength(password)>1024||typeof encoded!=='string') return false;
 const parts=encoded.split('$');
 if(parts.length!==6||parts[0]!=='scrypt'||parts[1]!=='16384'||parts[2]!=='8'||parts[3]!=='1') return false;
 try {
  const salt=Buffer.from(parts[4],'base64url'),expected=Buffer.from(parts[5],'base64url');
  if(salt.length!==16||expected.length!==64) return false;
  const actual=crypto.scryptSync(password,salt,64,PARAMETERS);
  return crypto.timingSafeEqual(actual,expected);
 }catch(_){return false;}
}
function issueToken(userId,config=process.env) {
 if(!UUID.test(userId||'')||!config.SD_JWT_SECRET||Buffer.byteLength(config.SD_JWT_SECRET)<32||!config.SD_JWT_ISSUER||!config.SD_JWT_AUDIENCE) throw Error('token issuer not configured');
 const now=Math.floor(Date.now()/1000);
 const encode=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url');
 const body=encode({sub:userId,iss:config.SD_JWT_ISSUER,aud:config.SD_JWT_AUDIENCE,iat:now,exp:now+900});
 const unsigned=encode({alg:'HS256',typ:'JWT'})+'.'+body;
 return unsigned+'.'+crypto.createHmac('sha256',config.SD_JWT_SECRET).update(unsigned).digest('base64url');
}
module.exports={hashPassword,verifyPassword,issueToken};
