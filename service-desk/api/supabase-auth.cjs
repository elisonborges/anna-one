'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function createSupabaseVerifier(config=process.env, request=globalThis.fetch) {
 return async function verifySupabase(header) {
   const base=config.SD_SUPABASE_URL;
   const key=config.SD_SUPABASE_PUBLISHABLE_KEY;
   if (!base || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(base) || !key ||
       typeof header!=='string' || header.length>4096 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(header)) return null;
   const token=header.slice(7);
   const controller=new AbortController();
   const timeout=setTimeout(()=>controller.abort(),4000);
   try {
     // Supabase Auth /user validates the actual access token server-side.
     // No service_role key or JWT secret is needed in this API.
     const response=await request(base.replace(/\/$/,'')+'/auth/v1/user',{
       method:'GET',headers:{apikey:key,authorization:'Bearer '+token,accept:'application/json'},
       signal:controller.signal,redirect:'error'
     });
     if(!response.ok) return null;
     const user=await response.json();
     return user && UUID.test(user.id||'') && user.aud==='authenticated' ? {id:user.id} : null;
   } catch (_) {return null;}
   finally {clearTimeout(timeout);}
 };
}
module.exports={createSupabaseVerifier};
