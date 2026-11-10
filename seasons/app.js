import { SeasonScene } from './renderer.js';
import { connectMusic } from './music.js';
const $=id=>document.getElementById(id);
const widget=document.documentElement.classList.contains('widget');
if(window.__SEASONS_WIDGET__)$('scene').setAttribute('aria-label','四季桌面摆件。直接拖动移动，拖动四角调整大小，按住 Shift 拖动指针切换四季，点击奶牛猫或蝴蝶互动。');
const titles=['春生','夏长','秋藏','冬眠'];
const descriptions=['草叶随风起伏，微光停在草尖。','风吹过草叶，日子慢慢变长。','一片金黄，收藏风的形状。','雪落下来，小世界安静了。'];
const weatherNames={auto:['微风 · 草尖微光','晴光 · 微风','秋风 · 飞絮','飘雪 · 覆霜'],rain:'细雨',snow:'飘雪',wind:'微风',clear:'晴朗'};
let scene;
function reflect(s){
 if(widget)return;
 $('season-title').textContent=titles[s.season];$('season-desc').textContent=descriptions[s.season];
 $('timeline').value=Math.round(((s.phase+.75)%1)*9999);
 $('play').textContent=s.playing?'Ⅱ':'▶';$('play').setAttribute('aria-label',s.playing?'暂停季节流转':'继续季节流转');
 $('weather-label').textContent=s.weather==='auto'?weatherNames.auto[s.season]:weatherNames[s.weather];
 document.querySelectorAll('[data-season]').forEach(b=>{b.classList.toggle('active',+b.dataset.season===s.season);b.setAttribute('aria-pressed',String(+b.dataset.season===s.season));});
}
try{
 scene=new SeasonScene($('scene'),{phase:.25,quality:'high',speed:Math.PI*8,background:'transparent',onChange:reflect});
 window.seasonScene=scene;window.scene=scene;window.appReady=true;$('loading').hidden=true;reflect(scene.state);
}catch(e){$('loading').hidden=true;$('failure').hidden=false;$('failure-message').textContent=e.message;throw e;}
connectMusic(scene);
$('play').onclick=()=>scene.setPlaying(!scene.playing);
$('timeline').oninput=e=>scene.setPhase((+e.target.value/10000+.25)%1);
document.querySelectorAll('[data-season]').forEach(b=>b.onclick=()=>scene.setPhase([.25,.5,.75,0][+b.dataset.season]));
$('speed').onchange=e=>scene.setSpeed(+e.target.value);
$('weather').onchange=e=>scene.setWeather(e.target.value);
$('quality').onchange=e=>scene.setQuality(e.target.value);
$('backdrop').onchange=e=>document.body.dataset.backdrop=e.target.value;
function focusMode(value){document.body.classList.toggle('focus',value);$('exit-focus').hidden=!value;}
$('focus').onclick=()=>focusMode(true);$('exit-focus').onclick=()=>focusMode(false);
addEventListener('keydown',e=>{
 if(e.key==='Escape')focusMode(false);
 if(e.target.matches('input,select,button'))return;
 if(e.code==='Space'){e.preventDefault();scene.setPlaying(!scene.playing);}
 if(e.key==='ArrowRight'){e.preventDefault();scene.setPhase(scene.phase+.01);}
 if(e.key==='ArrowLeft'){e.preventDefault();scene.setPhase(scene.phase-.01);}
});
$('capture').onclick=()=>{const a=document.createElement('a');a.download=`四季-${titles[scene.state.season]}.png`;a.href=$('scene').toDataURL('image/png');a.click();};
addEventListener('seasons-command',e=>{const {action,value}=e.detail||{};
 if(action==='togglePlay')scene.setPlaying(!scene.playing);
 if(action==='speed'){scene.setSpeed(Number(value));$('speed').value=String(value);}
 if(action==='quality'){scene.setQuality(value);$('quality').value=value;}
 if(action==='weather'){scene.setWeather(value);$('weather').value=value;}
 if(action==='phase')scene.setPhase(Number(value));
});
// The native desktop shell owns drag-to-move and corner resize. A short click
// reaches the same character hit test without seeking the season underneath it.
addEventListener('seasons-native-click',e=>{
 if(!widget)return;
 const {x,y}=e.detail||{};
 scene.interactAtClient(Number(x),Number(y));
});
// The simulation clamps long frame gaps, so coming back never jumps through a season.
addEventListener('pagehide',()=>scene.destroy(),{once:true});
