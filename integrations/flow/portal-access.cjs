'use strict';
// Integração preparada para inclusão no backend Flow mediante revisão coordenada.
// Não usar em navegador. Exige FLOW_PORTAL_AUTH_URL e FLOW_SERVICE_TOKEN privados.
const DEFAULT_TIMEOUT_MS=4000;
function makePortalAccessCheck({url=process.env.FLOW_PORTAL_AUTH_URL,token=process.env.FLOW_SERVICE_TOKEN,fetchImpl=globalThis.fetch,timeoutMs=DEFAULT_TIMEOUT_MS}={}){
  return async function checkPortalAccess(clientId){
    if(!Number.isSafeInteger(Number(clientId))||Number(clientId)<=0)return false;
    if(!url||!/^https:\/\//i.test(url)||!token||token.length<32)return false;
    try{
      const response=await fetchImpl(url,{method:'POST',headers:{'Content-Type':'application/json','X-Flow-Service-Token':token},body:JSON.stringify({flow_client_id:Number(clientId)}),signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
      if(!response.ok)return false;
      const data=await response.json();
      return data?.authorized===true&&typeof data.institution_id==='string'&&/^[a-f0-9-]{36}$/i.test(data.institution_id);
    }catch{return false;}
  };
}
module.exports={makePortalAccessCheck};
