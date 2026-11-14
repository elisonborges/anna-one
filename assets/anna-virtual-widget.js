/* AnnA Virtual — componente compartilhado para páginas AnnA One/LabPC/EduPlay v1.0 */
(()=>{'use strict';
if(window.__annaVirtualWidgetMounted||document.getElementById('anna-assistant-launch'))return;
window.__annaVirtualWidgetMounted=true;
const URL='https://anna-virtual-teste.elisonborg.workers.dev/';
const css=`
#anna-virtual-floating{position:fixed;z-index:2147483000;right:18px;bottom:18px;font-family:Inter,"Segoe UI",Arial,sans-serif;font-size:14px;line-height:1.5;box-sizing:border-box}
#anna-virtual-floating *{box-sizing:border-box}
#anna-virtual-floating .av-launch{display:flex;align-items:center;gap:9px;border:1px solid #ab84ee;border-radius:999px;background:linear-gradient(120deg,#3d197d,#7436cb);padding:11px 16px;color:#fff;box-shadow:0 9px 27px #17083a55;font:800 13px Inter,"Segoe UI",Arial,sans-serif;cursor:pointer}
#anna-virtual-floating .av-launch:hover{filter:brightness(1.09)}
#anna-virtual-floating .av-launch:focus-visible,#anna-virtual-floating .av-close:focus-visible,#anna-virtual-floating .av-open:focus-visible{outline:3px solid #fbbf24;outline-offset:3px}
#anna-virtual-floating .av-icon{display:grid;place-items:center;width:27px;height:27px;border-radius:50%;background:#ffffff2d;font-size:18px}
#anna-virtual-floating .av-panel{position:absolute;right:0;bottom:65px;width:min(355px,calc(100vw - 28px));max-height:calc(100dvh - 100px);border-radius:18px;background:#fff;box-shadow:0 16px 42px #091c4a6b;border:1px solid #ddd6fa;overflow:hidden;color:#182e55}
#anna-virtual-floating .av-panel[hidden]{display:none!important}
#anna-virtual-floating .av-head{background:linear-gradient(105deg,#3b1679,#6131a8);padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:9px;color:#fff}
#anna-virtual-floating .av-head strong{font-size:14px}
#anna-virtual-floating .av-close{cursor:pointer;background:#ffffff30;border:0;color:#fff;border-radius:8px;padding:3px 10px;font-size:22px;line-height:1.2}
#anna-virtual-floating .av-content{padding:23px 22px 21px;text-align:center}
#anna-virtual-floating .av-symbol{display:grid;place-items:center;width:58px;height:58px;margin:0 auto 11px;border-radius:50%;background:linear-gradient(130deg,#1169e9,#733bd1);color:white;font-size:29px}
#anna-virtual-floating h2{font:800 21px Inter,"Segoe UI",Arial,sans-serif;margin:0 0 9px;color:#20365b}
#anna-virtual-floating p{font:14px/1.5 Inter,"Segoe UI",Arial,sans-serif;margin:0 0 17px;color:#53647a}
#anna-virtual-floating .av-open{display:block;text-decoration:none;background:linear-gradient(115deg,#7130d6,#3d70da);border-radius:11px;color:#fff;padding:12px 15px;font-size:13px;font-weight:850}
#anna-virtual-floating small{display:block;margin-top:11px;color:#66758a;font-size:11px}
@media(max-width:540px){#anna-virtual-floating{right:11px;bottom:11px}#anna-virtual-floating .av-launch{padding:10px 12px;font-size:12px}#anna-virtual-floating .av-panel{bottom:59px}}
@media(max-width:360px){#anna-virtual-floating .av-launch .av-label{display:none}}
@media(prefers-reduced-motion:reduce){#anna-virtual-floating *{transition:none!important}}
`;
const style=document.createElement('style');style.id='anna-virtual-floating-style';style.textContent=css;document.head.append(style);
const root=document.createElement('aside');root.id='anna-virtual-floating';root.setAttribute('aria-label','Acesso à assistente virtual AnnA');
root.innerHTML='<button type="button" class="av-launch" aria-controls="anna-virtual-floating-panel" aria-expanded="false"><span class="av-icon" aria-hidden="true">✦</span><span class="av-label">Converse com a AnnA</span></button><div id="anna-virtual-floating-panel" class="av-panel" role="dialog" aria-label="Assistente virtual AnnA" aria-modal="false" hidden><div class="av-head"><strong>✦ AnnA · Assistente Virtual</strong><button type="button" class="av-close" aria-label="Fechar assistente">×</button></div><div class="av-content"><div class="av-symbol" aria-hidden="true">✦</div><h2>Olá! Sou a AnnA.</h2><p>Sua assistente virtual está pronta para conversar com você.</p><a class="av-open" target="_blank" rel="noopener noreferrer" href="'+URL+'">Iniciar conversa ↗</a><small>A conversa será aberta em uma nova aba.</small></div></div>';
document.body.append(root);
const launch=root.querySelector('.av-launch'),panel=root.querySelector('.av-panel'),close=root.querySelector('.av-close');
function setOpen(open){panel.hidden=!open;launch.setAttribute('aria-expanded',String(open));if(open)close.focus();else launch.focus()}
launch.addEventListener('click',()=>setOpen(panel.hidden));close.addEventListener('click',()=>setOpen(false));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden)setOpen(false)});
document.addEventListener('pointerdown',e=>{if(!panel.hidden&&!root.contains(e.target))setOpen(false)});
})();
