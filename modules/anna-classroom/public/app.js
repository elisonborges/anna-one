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

let renderVersion=0;
function element(tag,text,className){
 const node=document.createElement(tag);
 if(text!==undefined&&text!==null)node.textContent=String(text);
 if(className)node.className=className;
 return node;
}
function navigate(key){
 history.replaceState(null,"","#"+key);
 display(key);
}
function makeCard(title){
 const pane=element("article",null,"card classroom-panel");
 pane.append(element("h2",title));
 return pane;
}
function addStatus(pane,text){
 const node=element("p",text,"panel-feedback");
 node.setAttribute("role","status");
 pane.append(node);
 return node;
}
function makeField(label,name,type="text",maxLength=150){
 const field=element("label",null,"classroom-field");
 field.append(element("span",label));
 const control=document.createElement(type==="textarea"?"textarea":"input");
 control.name=name;
 if(type!=="textarea")control.type=type;
 if(type==="text"||type==="textarea")control.maxLength=maxLength;
 if(type!=="datetime-local")control.required=true;
 field.append(control);
 return field;
}
function makeSelect(label,name,items,placeholder){
 const field=element("label",null,"classroom-field");
 field.append(element("span",label));
 const select=document.createElement("select");
 select.name=name;select.required=true;
 const first=element("option",placeholder);
 first.value="";
 select.append(first);
 for(const item of items){
  const option=element("option",item.label);
  option.value=item.id;
  select.append(option);
 }
 field.append(select);
 return field;
}
function makeForm(pane,fields,buttonText,endpoint,toPayload,refreshView){
 const form=element("form",null,"classroom-data-form");
 for(const field of fields)form.append(field);
 const button=element("button",buttonText,"classroom-action");
 button.type="submit";form.append(button);
 const feedback=element("p","","panel-feedback");
 feedback.setAttribute("role","status");form.append(feedback);
 form.addEventListener("submit",async event=>{
  event.preventDefault();
  const data=Object.fromEntries(new FormData(form).entries());
  button.disabled=true;
  feedback.textContent="Salvando...";
  try{
   await apiRequest(endpoint,{method:"POST",body:JSON.stringify(toPayload(data))});
   form.reset();
   navigate(refreshView);
  }catch(error){
   feedback.textContent=error.message;
  }finally{button.disabled=false;}
 });
 pane.append(form);
}
async function apiRequest(path,init={}){
 if(!activeInstitution||!accessToken)throw Error("Sessão institucional não disponível.");
 let response;
 try{
  response=await fetch(API_BASE+path,{
   ...init,cache:"no-store",
   headers:{
    "Authorization":"Bearer "+accessToken,
    "X-Institution-Id":activeInstitution.id,
    ...(init.body?{"Content-Type":"application/json"}:{})
   }
  });
 }catch{throw Error("Não foi possível conectar à API do Classroom.");}
 if(!response.ok){
  if(response.status===401)throw Error("Sessão expirada. Entre novamente para continuar.");
  if(response.status===403)throw Error("Acesso não autorizado pelo Master.");
  const payload=await response.json().catch(()=>({}));
  throw Error(payload.error||"Operação não concluída (HTTP "+response.status+").");
 }
 return response.json();
}
function renderList(pane,items,formatter,emptyMessage){
 const count=element("p",items.length+" registro(s) carregado(s)","panel-count");
 pane.append(count);
 if(!items.length){pane.append(element("p",emptyMessage,"panel-feedback"));return;}
 const controls=element("div",null,"classroom-list-tools");
 const search=element("input");
 search.type="search";search.placeholder="Pesquisar nesta lista...";
 search.setAttribute("aria-label","Pesquisar "+pane.querySelector("h2").textContent.toLowerCase());
 controls.append(search);pane.append(controls);
 const list=element("ul",null,"classroom-record-list");
 pane.append(list);
 const normalized=text=>String(text??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR");
 const entries=items.map(item=>formatter(item));
 const update=()=>{
  const term=normalized(search.value.trim());
  const matches=entries.filter(entry=>normalized(entry.join(" ")).includes(term));
  list.replaceChildren();
  for(const entry of matches){
   const li=element("li");
   li.append(element("strong",entry[0]));
   if(entry[1])li.append(element("span",entry[1]));
   list.append(li);
  }
  count.textContent=matches.length+" de "+items.length+" registro(s) carregado(s)";
  if(!matches.length)list.append(element("li","Nenhum resultado para esta pesquisa.","panel-feedback"));
 };
 search.addEventListener("input",update);update();
}
function renderHome(target){
 const summary=makeCard("Resumo institucional");
 const feedback=addStatus(summary,"Consultando indicadores...");
 target.append(summary);
 const stamp=renderVersion;
 apiRequest("/v1/overview")
  .then(({stats})=>{
   if(stamp!==renderVersion)return;
   feedback.textContent="";
   const labels=[["classes","Turmas"],["students","Alunos"],["enrollments","Matrículas"],["lessons","Aulas"],["assignments","Atividades"]];
   const metrics=element("div",null,"classroom-stat-grid");
   for(const [id,label] of labels){
    const metric=element("div",null,"classroom-metric");
    metric.append(element("strong",stats?.[id]??"—"));
    metric.append(element("span",label));
    metrics.append(metric);
   }
   summary.append(metrics);
  }).catch(error=>{if(stamp===renderVersion)feedback.textContent=error.message;});
 for(const item of [
  ["Turmas e alunos","Cadastre turmas, alunos e vincule matrículas.","turmas"],
  ["Aulas","Planeje aulas vinculadas às turmas.","aulas"],
  ["Atividades","Crie atividades para suas aulas.","atividades"],
  ["Correções","Avaliações e devolutivas em implantação.","correcoes"]
 ]){
  const card=makeCard(item[0]);
  card.append(element("p",item[1]));
  const action=element("button","Abrir área","classroom-link-button");
  action.type="button";
  action.addEventListener("click",()=>navigate(item[2]));
  card.append(action);
  target.append(card);
 }
}
async function renderWorkspace(key,target,version){
 const status=makeCard("Dados da instituição");
 const message=addStatus(status,"Consultando registros autorizados...");
 target.append(status);
 try{
  const needs=key==="turmas"?["classes","students","enrollments"]:key==="aulas"?["classes","lessons"]:key==="atividades"?["lessons","assignments"]:["submissions"];
  const result=await Promise.all(needs.map(name=>apiRequest("/v1/"+name)));
  if(version!==renderVersion)return;
  status.remove();
  const byName=Object.fromEntries(needs.map((name,i)=>[name,Array.isArray(result[i].items)?result[i].items:[]]));
  if(key==="turmas")renderTurmas(target,byName);
  if(key==="aulas")renderAulas(target,byName);
  if(key==="atividades")renderAtividades(target,byName);
  if(key==="correcoes")renderCorrecoes(target,byName);
 }catch(error){
  if(version===renderVersion)message.textContent=error.message;
 }
}
function renderTurmas(target,{classes,students,enrollments}){
 const classForm=makeCard("Nova turma");
 makeForm(classForm,[makeField("Nome da turma","name","text",120),makeField("Ano letivo","school_year","number")],"Cadastrar turma","/v1/classes",data=>({name:data.name,school_year:Number(data.school_year)}),"turmas");
 const year=classForm.querySelector('[name="school_year"]');
 year.min="2020";year.max="2200";year.value=String(new Date().getFullYear());
 target.append(classForm);

 const studentForm=makeCard("Novo aluno");
 makeForm(studentForm,[makeField("Nome do aluno","display_name","text",150)],"Cadastrar aluno","/v1/students",data=>({display_name:data.display_name}),"turmas");
 target.append(studentForm);

 const enrollmentForm=makeCard("Nova matrícula");
 if(!classes.length||!students.length){
  addStatus(enrollmentForm,"Cadastre pelo menos uma turma e um aluno para realizar matrículas.");
 }else{
  makeForm(enrollmentForm,[
   makeSelect("Turma","class_id",classes.map(x=>({id:x.id,label:x.name+" · "+x.school_year})),"Selecione uma turma"),
   makeSelect("Aluno","student_id",students.map(x=>({id:x.id,label:x.display_name})),"Selecione um aluno")
  ],"Matricular aluno","/v1/enrollments",data=>data,"turmas");
 }
 target.append(enrollmentForm);

 const classList=makeCard("Turmas cadastradas");
 renderList(classList,classes,x=>[x.name,"Ano letivo: "+x.school_year],"Nenhuma turma cadastrada.");
 target.append(classList);

 const studentList=makeCard("Alunos cadastrados");
 renderList(studentList,students,x=>[x.display_name,"Cadastro institucional"],"Nenhum aluno cadastrado.");
 target.append(studentList);

 const enrollmentList=makeCard("Matrículas");
 renderList(enrollmentList,enrollments,x=>[x.student_name,x.class_name+" · "+x.school_year],"Nenhuma matrícula realizada.");
 target.append(enrollmentList);
}
function renderAulas(target,{classes,lessons}){
 const form=makeCard("Planejar aula");
 if(!classes.length){
  addStatus(form,"Cadastre uma turma antes de planejar aulas.");
  const action=element("button","Ir para Turmas","classroom-link-button");
  action.addEventListener("click",()=>navigate("turmas"));
  form.append(action);
 }else{
  makeForm(form,[
   makeSelect("Turma","class_id",classes.map(x=>({id:x.id,label:x.name+" · "+x.school_year})),"Selecione uma turma"),
   makeField("Título da aula","title","text",150),
   makeField("Descrição (opcional)","description","textarea",3000)
  ],"Salvar aula","/v1/lessons",data=>data,"aulas");
  form.querySelector('[name="description"]').required=false;
 }
 target.append(form);
 const list=makeCard("Aulas planejadas");
 renderList(list,lessons,x=>[x.title,x.class_name+" · "+(x.description||"Sem descrição")],"Nenhuma aula planejada.");
 target.append(list);
}
function renderAtividades(target,{lessons,assignments}){
 const form=makeCard("Criar atividade");
 if(!lessons.length){
  addStatus(form,"Planeje uma aula antes de criar atividades.");
  const action=element("button","Ir para Aulas","classroom-link-button");
  action.addEventListener("click",()=>navigate("aulas"));
  form.append(action);
 }else{
  makeForm(form,[
   makeSelect("Aula","lesson_id",lessons.map(x=>({id:x.id,label:x.title+" · "+x.class_name})),"Selecione uma aula"),
   makeField("Título","title","text",150),
   makeField("Instruções (opcional)","instructions","textarea",5000),
   makeField("Prazo (opcional)","due_at","datetime-local")
  ],"Salvar atividade","/v1/assignments",data=>({
   lesson_id:data.lesson_id,title:data.title,instructions:data.instructions,
   due_at:data.due_at?new Date(data.due_at).toISOString():null
  }),"atividades");
  form.querySelector('[name="instructions"]').required=false;
 }
 target.append(form);
 const list=makeCard("Atividades cadastradas");
 renderList(list,assignments,x=>[x.title,x.lesson_title+(x.due_at?" · Prazo: "+new Date(x.due_at).toLocaleDateString("pt-BR"):"")],"Nenhuma atividade cadastrada.");
 target.append(list);
}
function renderCorrecoes(target,{submissions}){
 const notice=makeCard("Entregas e avaliações");
 addStatus(notice,"Consulta de entregas por instituição. O registro de respostas pelos estudantes e a edição de notas serão implantados com os respectivos perfis e permissões.");
 target.append(notice);
 const pane=makeCard("Entregas recebidas");
 renderList(pane,submissions,x=>[
  x.student_name+" · "+x.assignment_title,
  (x.grade===null||x.grade===undefined?"Aguardando avaliação":"Nota: "+x.grade)+(x.feedback?" · Devolutiva: "+x.feedback:"")
 ],"Nenhuma entrega registrada.");
 target.append(pane);
}
function display(key){
 const view=sections[key]?key:"inicio";
 const d=sections[view];
 const version=++renderVersion;
 document.querySelector("#page-title").textContent=d[0];
 document.querySelector("#page-description").textContent="Ambiente de ensino da AnnA One";
 document.querySelector("#section-title").textContent=view==="inicio"?"Áreas do módulo":view==="turmas"?"Gestão de turmas, alunos e matrículas":view==="aulas"?"Planejamento de aulas":view==="atividades"?"Atividades pedagógicas":"Áreas do módulo";
 const target=document.querySelector("#module-cards");target.replaceChildren();
 if(view==="inicio")renderHome(target);
 else if(["turmas","aulas","atividades","correcoes"].includes(view))renderWorkspace(view,target,version);
 else{
  const pane=makeCard("Instituição e perfil");
  addStatus(pane,"Instituição: "+(activeInstitution?.name||"não identificada")+". Acesso controlado pelo Master AnnA One.");
  target.append(pane);
 }
 document.querySelectorAll("[data-view]").forEach(button=>{
  if(button.dataset.view===view)button.setAttribute("aria-current","page");
  else button.removeAttribute("aria-current");
 });
}
document.querySelectorAll("[data-view]").forEach(button=>button.addEventListener("click",()=>navigate(button.dataset.view)));
window.addEventListener("hashchange",()=>{if(!app.hidden)display(location.hash.slice(1)||"inicio");});

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
 let response;
 try{
  response=await fetch(API_BASE+"/v1/access",{headers:{Authorization:"Bearer "+jwt},cache:"no-store"});
 }catch{
  throw Error("Sem comunicação com a API do Classroom. Verifique a conexão e tente novamente.");
 }
 if(response.status===401)throw Error("Sessão não validada pela API do Classroom.");
 if(response.status===403)throw Error("O Master ainda não liberou o Classroom para esta conta.");
 if(!response.ok)throw Error("Não foi possível confirmar a autorização (HTTP "+response.status+").");
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
 let phase="login";
 try{
  const result=await authClient.signIn.email({email:emailInput.value.trim(),password:passwordInput.value});
  if(result?.error){
   if(/fetch|network|cors/i.test(String(result.error.message||"")))throw Error("Falha de comunicação com Neon Auth durante o login.");
   throw Error("E-mail ou senha inválidos.");
  }
  phase="sessão";
  const session=await authClient.getSession();
  if(!session?.data?.user&&!session?.data?.session?.user)throw Error("A sessão não foi confirmada.");
  phase="permissão";
  await verifyInstitution(await obtainAccessToken(session));
 }catch(error){
  const raw=String(error?.message||"");
  const networkError=/failed to fetch|networkerror|load failed|fetch failed/i.test(raw)||error instanceof TypeError;
  showLogin(networkError?("Falha de rede na etapa "+phase+". Não foi possível comunicar com "+(phase==="permissão"?"a API do Classroom.":"o Neon Auth.")+" Verifique se o navegador bloqueou a conexão."):(raw||"Não foi possível entrar."));
 }finally{submitLogin.disabled=false;}
});
const signoutButton=document.querySelector("#classroom-signout");
signoutButton?.addEventListener("click",async()=>{
 if(!authClient||signoutButton.disabled)return;
 signoutButton.disabled=true;
 try{
  const result=await authClient.signOut();
  if(result?.error)throw Error("Erro ao sair");
  accessToken=null;
  activeInstitution=null;
  ++renderVersion;
  document.querySelector("#module-cards").replaceChildren();
  blocked("Sessão encerrada. Entre novamente quando desejar.");
  loginForm.hidden=false;
  passwordInput.value="";
  signoutButton.disabled=false;
 }catch{
  signoutButton.disabled=false;
  window.alert("Não foi possível encerrar a sessão. Tente novamente.");
 }
});
blocked("Verificando acesso institucional...");
authenticate();
