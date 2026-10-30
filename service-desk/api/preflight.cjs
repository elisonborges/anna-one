'use strict';
const {URL}=require('node:url');
function validate(config=process.env) {
 const problems=[];
 if(!config.DATABASE_URL) problems.push('DATABASE_URL missing');
 else {
  try {
   const url=new URL(config.DATABASE_URL);
   if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||!url.username||!url.password) problems.push('DATABASE_URL invalid');
   if(url.searchParams.get('sslmode')!=='require' && url.searchParams.get('sslmode')!=='verify-full') problems.push('DATABASE_URL must require TLS');
   if(['neondb_owner','postgres','anna_sd_api_runtime','anna_sd_identity_runtime'].includes(decodeURIComponent(url.username))) problems.push('DATABASE_URL uses forbidden database role');
  }catch(_){problems.push('DATABASE_URL invalid');}
 }
 if(!config.SD_JWT_SECRET||Buffer.byteLength(config.SD_JWT_SECRET)<32) problems.push('SD_JWT_SECRET missing or too short');
 if(!config.SD_JWT_ISSUER) problems.push('SD_JWT_ISSUER missing');
 if(!config.SD_JWT_AUDIENCE) problems.push('SD_JWT_AUDIENCE missing');
 return problems;
}
if(require.main===module) {
 const problems=validate();
 if(problems.length){for(const problem of problems)console.error('Configuration: '+problem);process.exitCode=1;}
 else console.log('Configuration format OK; database permissions and connectivity NOT verified');
}
module.exports={validate};
