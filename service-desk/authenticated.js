'use strict';
// Only short-lived credentials in this browser tab; no secrets in URLs or persistent storage.
const SESSION_KEY='anna_sd_session';
const API='https://anna-one.onrender.com/api/v1/tickets';
function session(){
 try{
  const value=JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null');
  return value&&typeof value.token==='string'&&value.expiresAt>Date.now()?value:null;
 }catch(_){return null;}
}
function logout(){
 sessionStorage.removeItem(SESSION_KEY);
 window.location.replace('login.html');
}
const current=session();
if(!current){logout();}
else{
 const user=document.getElementById('session-user');
 if(user)user.textContent=current.email||'Conta autenticada';
 document.getElementById('session-logout')?.addEventListener('click',logout);
 const status=document.getElementById('real-tickets-status');
 const tbody=document.getElementById('real-tickets-body');
 let pending=false;
 async function loadTickets(){
  if(pending)return;
  const auth=session();
  if(!auth){logout();return;}
  pending=true;status.textContent='Consultando chamados autorizados...';
  tbody.replaceChildren();
  try{
   const response=await fetch(API,{headers:{Authorization:'Bearer '+auth.token},cache:'no-store',mode:'cors'});
   if(response.status===401){logout();return;}
   if(!response.ok){status.textContent='Não foi possível consultar os chamados (HTTP '+response.status+').';return;}
   const data=await response.json();
   if(!Array.isArray(data.tickets))throw Error('invalid response');
   status.textContent=data.tickets.length?data.tickets.length+' chamado(s) autorizado(s).':'Nenhum chamado real disponível para esta conta.';
   for(const ticket of data.tickets){
    const tr=document.createElement('tr');
    const date=ticket.created_at?new Date(ticket.created_at):null;
    for(const value of [ticket.public_protocol||ticket.id||'',ticket.title||'',ticket.status||'',ticket.priority||'',date&&!Number.isNaN(date.valueOf())?date.toLocaleString('pt-BR'):'']){
     const td=document.createElement('td');td.textContent=String(value);tr.append(td);
    }
    tbody.append(tr);
   }
  }catch(_){status.textContent='Falha ao consultar a API. Tente novamente.';}
  finally{pending=false;}
 }
 document.getElementById('reload-real-tickets')?.addEventListener('click',loadTickets);
 document.querySelector('[data-view="reais"]')?.addEventListener('click',loadTickets);
 // Never fetch private records while showing the public demonstration.
}
