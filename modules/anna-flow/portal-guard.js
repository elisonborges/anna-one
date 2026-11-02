'use strict';
const check=async(clientId)=>{
 const url=process.env.FLOW_PORTAL_AUTH_URL,token=process.env.FLOW_SERVICE_TOKEN;
 if(!url||!/^https:\/\//.test(url)||!token||token.length<32||!Number.isSafeInteger(Number(clientId))||Number(clientId)<1)return false;
 try{
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Flow-Service-Token':token},body:JSON.stringify({flow_client_id:Number(clientId)}),signal:AbortSignal.timeout(4000),redirect:'error'});
  if(!r.ok)return false;const x=await r.json();
  return x.authorized===true&&typeof x.institution_id==='string'&&/^[a-f0-9-]{36}$/i.test(x.institution_id);
 }catch{return false;}
};
module.exports={check};
