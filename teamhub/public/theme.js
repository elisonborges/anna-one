// AnnA Nexus — tema independente da inicialização e da autenticação.
(() => {
  const key='anna-teamhub-theme';
  const root=document.documentElement;
  const meta=document.querySelector('meta[name="theme-color"]');
  const system=window.matchMedia?.('(prefers-color-scheme: dark)');
  let button=null;
  const stored=()=>{
    try{
      const value=localStorage.getItem(key);
      return value==='light'||value==='dark'?value:null;
    }catch{return null;}
  };
  function apply(theme,persist=false){
    const value=theme==='dark'?'dark':'light';
    root.dataset.theme=value;
    root.style.colorScheme=value;
    meta?.setAttribute('content',value==='dark'?'#09172b':'#0c2646');
    if(button){
      button.textContent=value==='dark'?'☀':'◐';
      button.setAttribute('aria-label',value==='dark'?'Ativar tema claro':'Ativar tema escuro');
      button.setAttribute('aria-pressed',String(value==='dark'));
      button.title=value==='dark'?'Ativar tema claro':'Ativar tema escuro';
    }
    if(persist){try{localStorage.setItem(key,value);}catch{}}
  }
  // Executado no <head>, antes do CSS, para evitar o piscar de tema.
  apply(stored()||(system?.matches?'dark':'light'));
  function bind(){
    button=document.getElementById('theme');
    if(!button)return;
    apply(root.dataset.theme);
    button.addEventListener('click',()=>apply(root.dataset.theme==='dark'?'light':'dark',true));
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',bind,{once:true});
  }else bind();
  system?.addEventListener?.('change',e=>{if(!stored())apply(e.matches?'dark':'light');});
})();
