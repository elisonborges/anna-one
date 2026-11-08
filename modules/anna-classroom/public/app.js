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
const API_BASE="https://anna-classroom-api.onrender.com";
let activeInstitution=null;
let accessToken=null;
function blocked(text){gate.hidden=false;app.hidden=true;message.textContent=text;link.hidden=false;}
function show(institution){activeInstitution=institution;document.querySelector(".top small").textContent="Instituição: "+institution.name;gate.hidden=true;app.hidden=false;display(location.hash.slice(1)||"inicio");}
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
 if(key==="turmas"){loadAuthorizedList(target,"/v1/classes","Turmas cadastradas",item=>String(item.name||"Turma")+" · "+String(item.school_year||""));loadAuthorizedList(target,"/v1/students","Alunos cadastrados",item=>String(item.display_name||"Aluno"));}
 document.querySelectorAll("[data-view]").forEach(button=>{
  if(button.dataset.view===key)button.setAttribute("aria-current","page");
  else button.removeAttribute("aria-current");
 });
}
document.querySelectorAll("[data-view]").forEach(button=>button.addEventListener("click",()=>{
 const key=button.dataset.view;history.replaceState(null,"","#"+key);display(key);
}));
async function loadAuthorizedList(target,endpoint,title,formatItem){
 if(!activeInstitution||!accessToken)return;
 const pane=document.createElement("article");pane.className="card";pane.style.gridColumn="1/-1";
 const heading=document.createElement("h2");heading.textContent=title;
 const status=document.createElement("p");status.textContent="Consultando dados autorizados...";
 pane.append(heading,status);target.append(pane);
 try{
  const response=await fetch(API_BASE+endpoint,{headers:{"Authorization":"Bearer "+accessToken,"X-Institution-Id":activeInstitution.id},cache:"no-store"});
  if(!pane.isConnected)return;
  if(!response.ok){
   const messages={401:"Sessão não validada pela API; token JWT precisa de validação.",403:"Acesso restrito: módulo ainda não habilitado para esta instituição."};
   status.textContent=messages[response.status]||"Não foi possível consultar os dados (HTTP "+response.status+").";
   return;
  }
  const payload=await response.json();
  const items=Array.isArray(payload?.items)?payload.items:[];
  if(!items.length){status.textContent="Nenhum registro cadastrado nesta instituição.";return;}
  status.textContent=items.length+" registro(s) encontrado(s).";
  const list=document.createElement("ul");
  for(const item of items){
   const li=document.createElement("li");li.textContent=formatItem(item);list.append(li);
  }
  pane.append(list);
 }catch{
  if(pane.isConnected)status.textContent="Falha de conexão com a API. Verifique a disponibilidade do serviço.";
 }
}
const auditEndpoint="https://anna-one-auditoria.elisonborg.workers.dev/v1/institution/me";
const loginForm=document.querySelector("#classroom-login-form");
const emailInput=document.querySelector("#classroom-email");
const passwordInput=document.querySelector("#classroom-password");
const submitLogin=document.querySelector("#classroom-login-submit");
let authClient=null;
function showLogin(text){
 blocked(text);
 loginForm.hidden=false;
 link.textContent="Voltar ao portal AnnA One ↗";
 link.href="https://annaone.com.br/app/";
 link.hidden=false;
}
async function verifyInstitution(jwt){
 if(typeof jwt!=="string"||jwt.split(".").length!==3)throw Error("Sessão sem token de acesso válido.");
 const response=await fetch(auditEndpoint,{headers:{Authorization:"Bearer "+jwt},cache:"no-store"});
 if(!response.ok)throw Error("Não foi possível verificar o vínculo institucional.");
 const result=await response.json();
 const institution=Array.isArray(result?.institutions)?result.institutions.find(item=>item?.id&&item?.name):null;
 if(result?.authorized!==true||!institution)throw Error("Esta conta não tem vínculo institucional ativo. Solicite autorização ao Master.");
 // O vínculo institucional isolado não libera o módulo: a API confirma
 // a identidade e a atribuição do Classroom pelo Master antes de exibir sua interface.
 let permissionResponse;
 try{
  permissionResponse=await fetch(API_BASE+"/v1/classes",{
   headers:{"Authorization":"Bearer "+jwt,"X-Institution-Id":institution.id},
   cache:"no-store"
  });
 }catch{
  throw Error("A API do Classroom está indisponível. Tente novamente mais tarde.");
 }
 if(permissionResponse.status===401)throw Error("Sua sessão foi aceita no portal, mas a API do Classroom não validou o token.");
 if(permissionResponse.status===403)throw Error("O Classroom não está liberado para esta conta ou instituição. Consulte o Master.");
 if(!permissionResponse.ok)throw Error("Não foi possível confirmar o acesso ao Classroom (HTTP "+permissionResponse.status+").");
 accessToken=jwt;
 loginForm.hidden=true;
 passwordInput.value="";
 show(institution);
}
async function obtainAccessToken(session){
 let jwt=session?.data?.session?.access_token;
 if(typeof jwt!=="string"||jwt.split(".").length!==3){
  const response=await fetch(AUTH_BASE+"/token",{credentials:"include",cache:"no-store"});
  if(response.ok){
   const data=await response.json();
   jwt=typeof data==="string"?data:data?.token||data?.data?.token||data?.access_token;
  }
 }
 return jwt;
}
async function authenticate(){
 try{
  const {createAuthClient}=await import("https://esm.sh/@neondatabase/auth@0.5.0-beta?bundle");
  authClient=createAuthClient(AUTH_BASE);
  const session=await authClient.getSession();
  if(!session?.data?.user&&!session?.data?.session?.user)throw Error("Entre com sua conta AnnA One.");
  await verifyInstitution(await obtainAccessToken(session));
 }catch(error){
  showLogin(error?.message==="Entre com sua conta AnnA One."?error.message:"Entre com sua conta AnnA One para acessar o módulo.");
 }
}
loginForm.addEventListener("submit",async event=>{
 event.preventDefault();
 if(!authClient){showLogin("Autenticação indisponível. Atualize a página e tente novamente.");return;}
 submitLogin.disabled=true;
 message.textContent="Autenticando sua conta...";
 try{
  const result=await authClient.signIn.email({email:emailInput.value.trim(),password:passwordInput.value});
  if(result?.error)throw Error("E-mail ou senha inválidos.");
  const session=await authClient.getSession();
  if(!session?.data?.user&&!session?.data?.session?.user)throw Error("A sessão não foi confirmada.");
  await verifyInstitution(await obtainAccessToken(session));
 }catch(error){
  showLogin(error?.message||"Não foi possível entrar.");
 }finally{submitLogin.disabled=false;}
});
blocked("Verificando acesso institucional...");
authenticate();
