// One UI and protocol for WKWebView (macOS) and WebView2 (Windows).
// A media bridge being available does not itself mean music is playing.
export function connectMusic(scene) {
 const transport=window.webkit?.messageHandlers?.seasonsMusic || (window.chrome?.webview ? {
  postMessage:message=>window.chrome.webview.postMessage({channel:'seasonsMusic',...message})
 } : null);
 if(!transport)return;
 const root=document.documentElement;
 const panel=document.createElement('section');
 panel.className='music-controls';panel.hidden=true;panel.setAttribute('aria-label','音乐播放控制');
 panel.innerHTML=`<div class="music-title"></div><div class="music-artist"></div><div class="music-buttons"><button disabled data-command="previous" aria-label="上一首">⏮</button><button disabled data-command="toggle" class="music-toggle" aria-label="播放或暂停">▶</button><button disabled data-command="next" aria-label="下一首">⏭</button></div><div class="music-timeline"><span class="music-elapsed">—</span><input disabled type="range" min="0" max="1" value="0" step="0.1" aria-label="音乐播放进度"><span class="music-duration">—</span></div><div class="music-message" role="status"></div>`;
 document.querySelector('main').appendChild(panel);
 const title=panel.querySelector('.music-title'),artist=panel.querySelector('.music-artist'),toggle=panel.querySelector('.music-toggle'),range=panel.querySelector('input'),message=panel.querySelector('.music-message');
 let state={},seeking=false,visible=false,artwork=null,source='',lastTrack='',lastLayout='';
 const send=(action,value)=>transport.postMessage({action,value});
 function notifyLayout(){
  const height=visible ? Math.max(0,parseFloat(getComputedStyle(root).getPropertyValue('--music-area-height'))||120) : 0;
  const key=`${visible}:${height}`;
  if(key===lastLayout)return;
  lastLayout=key;
  transport.postMessage({action:'layout',visible,height});
 }
 panel.querySelectorAll('[data-command]').forEach(b=>b.addEventListener('click',()=>{
  if(visible&&!b.disabled)send(b.dataset.command);
 }));
 range.addEventListener('pointerdown',()=>{seeking=!range.disabled;});
 range.addEventListener('change',()=>{seeking=false;if(visible&&!range.disabled)send('seek',Number(range.value));});
 range.addEventListener('pointercancel',()=>seeking=false);
 range.addEventListener('blur',()=>seeking=false);
 const time=v=>Number.isFinite(v)?`${Math.floor(Math.max(0,v)/60).toString().padStart(2,'0')}:${Math.floor(Math.max(0,v)%60).toString().padStart(2,'0')}`:'—';
 addEventListener('seasons-music-state',e=>{
  state=e.detail||{};window.musicState=state;
  const wasVisible=visible;
  const nextSource=typeof state.source==='string'?state.source.trim():'';
  const track=typeof state.title==='string'?state.title.trim():'';
  const trackChanged=track!==lastTrack;
  if(trackChanged){artwork=null;seeking=false;lastTrack=track;}
  if(source!==nextSource){artwork=null;seeking=false;source=nextSource;}
  if(Object.hasOwn(state,'artwork'))artwork=state.artwork||null;
  visible=state.connected===true&&!!source&&!!track;
  window.musicUIVisible=visible;
  panel.hidden=!visible;
  root.classList.toggle('music-enabled',visible);
  if(!visible){artwork=null;seeking=false;title.textContent='';artist.textContent='';message.textContent='';}
  else {
   title.textContent=track;artist.textContent=state.artist||'';
   message.textContent=state.commandError||'';
  }
  toggle.textContent=state.playing?'Ⅱ':'▶';toggle.setAttribute('aria-label',state.playing?'暂停音乐':'播放音乐');
  panel.querySelectorAll('[data-command]').forEach(b=>b.disabled=!visible||state.capabilities?.[b.dataset.command]===false);
  range.disabled=!visible||state.capabilities?.seek===false||!Number.isFinite(state.duration)||state.duration<=0||!Number.isFinite(state.position);
  range.max=String(Math.max(1,state.duration||1));if(!seeking)range.value=String(state.position||0);
  panel.querySelector('.music-elapsed').textContent=time(state.position);panel.querySelector('.music-duration').textContent=time(state.duration);
  scene.setMusicArtwork(visible?artwork:null);
  notifyLayout();
  if(visible&&(!wasVisible||trackChanged)&&!Object.hasOwn(state,'artwork'))send('refresh');
 });
 addEventListener('resize',notifyLayout);
 window.musicUIVisible=false;
 notifyLayout();
 send('refresh');
}
