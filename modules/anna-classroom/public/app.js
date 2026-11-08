// AnnA Classroom: utiliza a identidade do portal, sem cadastro de senha local.
// O backend verifica novamente o JWT e as permissões para cada operação.
const sections={
 inicio:["Visão geral","Turmas","Aulas","Atividades","Correções"],
 turmas:["Turmas e alunos","Turmas","Matrículas","Alunos"],
 aulas:["Aulas","Planejamento","Materiais"],
 atividades:["Atividades","Criar atividade","Entregas"],
 correcoes:["Correções","Feedback","Avaliações"],
 configuracoes:["Configurações","Instituição","Perfil"]
};
const gate=document.querySelector("#auth-gate");
const message=document.querySelector("#auth-message");
const link=document.querySelector("#auth-portal-link");
const app=document.querySelector("#classroom-app");
const AUTH_BASE="https://ep-spring-snow-b6mci3yx.neonauth.c-2.sa-east-1.aws.neon.tech/neondb/auth";
function blocked(text){gate.hidden=false;app.hidden=true;message.textContent=text;link.hidden=false;}
function show(institution){document.querySelector(".top small").textContent="Instituição: "+institution.name;gate.hidden=true;app.hidden=false;display(location.hash.slice(1)||"inicio");}
function display(key){
 const d=sections[key]||sections.inicio;
 document.querySelector("#page-title").textContent=d[0];
 document.querySelector("#page-description").textContent="Ambiente de ensino da AnnA One";
 document.querySelector("#section-title").textContent="Áreas do módulo";
 const target=document.querySelector("#module-cards");target.replaceChildren();
 for(const name of d.slice(1)){
  const card=document.createElement("article");card.className="card";
  const heading=document.createElement("h2");heading.textContent=name;
  const note=document.createElement("p");note.textContent="Implantação pedagógica progressiva";
  card.append(heading,note);target.append(card);
 }
 document.querySelectorAll("[data-view]").forEach(button=>{
  if(button.dataset.view===key)button.setAttribute("aria-current","page");
  else button.removeAttribute("aria-current");
 });
}
document.querySelectorAll("[data-view]").forEach(button=>button.addEventListener("click",()=>{
 const key=button.dataset.view;history.replaceState(null,"","#"+key);display(key);
}));
async function authenticate(){
 try{
  const {createAuthClient}=await import("https://esm.sh/@neondatabase/auth@0.5.0-beta?bundle");
  const auth=createAuthClient(AUTH_BASE);
  const session=await auth.getSession();
  const user=session?.data?.user||session?.data?.session?.user;
  if(!user)return blocked("Entre primeiro pelo portal AnnA One.");
  let jwt=session?.data?.session?.access_token;
  if(!jwt){
   const response=await fetch(AUTH_BASE+"/token",{credentials:"include",cache:"no-store"});
   if(!response.ok)return blocked("Não foi possível confirmar sua sessão.");
   const payload=await response.json();
   jwt=typeof payload==="string"?payload:payload?.token||payload?.data?.token||payload?.access_token;
  }
  if(typeof jwt!=="string")return blocked("Sessão sem token verificável.");
  const response=await fetch("https://anna-one-auditoria.elisonborg.workers.dev/v1/institution/me",{headers:{Authorization:"Bearer "+jwt},cache:"no-store"});
  if(!response.ok)return blocked("Não foi possível confirmar o acesso institucional.");
  const result=await response.json();
  const institution=Array.isArray(result?.institutions)?result.institutions.find(item=>item?.id&&item?.name):null;
  if(result?.authorized!==true||!institution)return blocked("Sua conta não tem vínculo institucional autorizado.");
  show(institution);
 }catch{
  blocked("Acesso indisponível neste endereço. Entre pelo portal AnnA One.");
 }
}
blocked("Verificando acesso institucional...");
authenticate();
