import {Window} from 'happy-dom';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const jsPath=path.join(root,'seasons/music.js');
const cssPath=path.join(root,'seasons/style.css');
const source=fs.readFileSync(jsPath,'utf8'),css=fs.readFileSync(cssPath,'utf8');
const results=[];
function test(name,fn){try{fn();results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',error:e.message});}}
function environment(platform='mac',height=600){
 const window=new Window({url:'http://127.0.0.1:1234/index.html?mode=widget',width:700,height});
 window.document.documentElement.classList.add('widget');
 const style=window.document.createElement('style');style.textContent=css.replaceAll('@media(', '@media (');window.document.head.append(style);
 window.document.body.innerHTML='<main><div class="world"><canvas></canvas></div></main>';
 const messages=[],art=[];
 if(platform==='mac')window.webkit={messageHandlers:{seasonsMusic:{postMessage:m=>messages.push(m)}}};
 if(platform==='win')window.chrome={webview:{postMessage:m=>messages.push(m)}};
 window.__testScene={setMusicArtwork:uri=>art.push(uri)};
 // Strip only the ES module export keyword. Run the shipped function unmodified in a real DOM realm.
 window.eval(source.replace(/^export /m,'')+'\nconnectMusic(window.__testScene);');
 const panel=window.document.querySelector('.music-controls');
 return {window,panel,messages,art,
  emit(state){window.dispatchEvent(new window.CustomEvent('seasons-music-state',{detail:state}));},
  latestLayout(){return messages.filter(m=>m.action==='layout').at(-1);},
  button(name){return panel.querySelector(`[data-command="${name}"]`);},
  range(){return panel.querySelector('input');},
  worldHeight(){return window.getComputedStyle(window.document.querySelector('.world')).height;},
  dispose(){window.happyDOM.abort();}
 };
}
const artA='data:image/png;base64,aGVsbG8=';
const track={connected:true,source:'com.tencent.qqmusic',title:'Song A',artist:'Artist',playing:true,duration:240,position:25,artwork:artA};
for(const platform of ['mac','win']){
 const run=(name,fn)=>test(`${platform}: ${name}`,()=>{const e=environment(platform);try{fn(e);}finally{e.dispose();}});
 run('initial ornament has no placeholder, hidden controls and full scene height',e=>{
  assert.equal(e.panel.hidden,true);assert.equal(e.window.getComputedStyle(e.panel).display,'none');
  assert.equal(e.panel.textContent.includes('等待播放器'),false);assert.equal(e.panel.textContent.includes('QQ'),false);
  assert.equal(e.window.document.documentElement.classList.contains('music-enabled'),false);
  assert.equal(e.worldHeight(),'100%');assert.equal(e.latestLayout().height,0);assert.equal(e.latestLayout().visible,false);
  assert.equal(e.messages.at(-1).action,'refresh');
  if(platform==='win')assert(e.messages.every(m=>m.channel==='seasonsMusic'));
  else assert(e.messages.every(m=>!Object.hasOwn(m,'channel')));
 });
 run('valid music activates info, controls, artwork and scene reservation',e=>{
  e.emit(track);assert.equal(e.panel.hidden,false);assert.notEqual(e.window.getComputedStyle(e.panel).display,'none');
  assert.equal(e.panel.querySelector('.music-title').textContent,'Song A');assert.equal(e.panel.querySelector('.music-artist').textContent,'Artist');
  assert.equal(e.window.musicUIVisible,true);assert.equal(e.window.getComputedStyle(e.panel).opacity,'1');
  assert.equal(e.art.at(-1),artA);assert.equal(e.button('toggle').disabled,false);assert.equal(e.range().disabled,false);
  assert.equal(e.latestLayout().visible,true);assert.equal(e.latestLayout().height,120);
  assert.match(e.worldHeight(),/calc\(100% - 120px\)/);
 });
 run('paused song keeps media visible without a fresh artwork field',e=>{
  e.emit(track);const paused={...track,playing:false,position:25};delete paused.artwork;e.emit(paused);
  assert.equal(e.panel.hidden,false);assert.equal(e.button('toggle').getAttribute('aria-label'),'播放音乐');
  assert.equal(e.panel.querySelector('.music-elapsed').textContent,'00:25');assert.equal(e.art.at(-1),artA);
 });
 run('lost session returns pure ornament and reconnect restores media',e=>{
  e.emit(track);e.emit({connected:false,source:'',title:'',error:'No player'});
  assert.equal(e.panel.hidden,true);assert.equal(e.art.at(-1),null);assert.equal(e.worldHeight(),'100%');
  assert.equal(e.latestLayout().height,0);assert.equal(e.panel.querySelector('.music-message').textContent,'');
  e.emit({...track,title:'Song B',artwork:null});assert.equal(e.panel.hidden,false);assert.equal(e.art.at(-1),null);
 });
 run('new media source never displays the previous source cover',e=>{
  e.emit(track);const other={...track,source:'org.other.player',title:'Different Song'};delete other.artwork;e.emit(other);
  assert.equal(e.panel.hidden,false);assert.equal(e.art.at(-1),null);
 });
 run('same source changing tracks clears omitted artwork and requests a full refresh',e=>{
  e.emit(track);const next={...track,title:'Song B'};delete next.artwork;
  const before=e.messages.filter(m=>m.action==='refresh').length;e.emit(next);
  assert.equal(e.art.at(-1),null);assert.equal(e.messages.filter(m=>m.action==='refresh').length,before+1);
  e.emit({...next,artwork:artA});assert.equal(e.art.at(-1),artA);
 });
 run('unidentified track or missing source does not enable player UI',e=>{
  for(const state of [{...track,title:''},{...track,title:'  '},{...track,source:''},{...track,source:'  '},{...track,connected:false},{...track,connected:'true'}]){
   e.emit(state);assert.equal(e.panel.hidden,true);assert.equal(e.art.at(-1),null);assert.equal(e.latestLayout().height,0);
  }
 });
 run('unavailable-player errors remain invisible and do not reserve space',e=>{
  e.emit({connected:false,source:'',title:'',error:'Connection error',commandError:'Command failed'});
  assert.equal(e.panel.hidden,true);assert.equal(e.panel.querySelector('.music-message').textContent,'');assert.equal(e.worldHeight(),'100%');
 });
 run('capabilities disable only unavailable controls and suppress their commands',e=>{
  e.emit({...track,capabilities:{previous:false,next:false,toggle:false,seek:false}});
  const before=e.messages.length;for(const name of ['previous','next','toggle']){assert.equal(e.button(name).disabled,true);e.button(name).click();}
  assert.equal(e.range().disabled,true);e.range().dispatchEvent(new e.window.Event('change'));assert.equal(e.messages.length,before);
  e.emit({...track,capabilities:{previous:true,next:false,toggle:true,seek:true}});assert.equal(e.button('previous').disabled,false);assert.equal(e.button('next').disabled,true);
 });
 run('enabled buttons dispatch their requested transport commands',e=>{
  e.emit(track);for(const name of ['previous','toggle','next']){e.button(name).click();assert.equal(e.messages.at(-1).action,name);}
 });
 run('seek retains a drag position through a tick and submits once on change',e=>{
  e.emit(track);const range=e.range();range.dispatchEvent(new e.window.PointerEvent('pointerdown'));range.value='70';
  e.emit({...track,position:26});assert.equal(range.value,'70');
  range.dispatchEvent(new e.window.Event('change'));assert.equal(e.messages.at(-1).action,'seek');assert.equal(e.messages.at(-1).value,70);
  e.emit({...track,position:71});assert.equal(range.value,'71');
 });
 run('invalid/missing timeline data disables seek without hiding song',e=>{
  for(const state of [{...track,duration:0},{...track,duration:null},{...track,position:null}]){
   e.emit(state);assert.equal(e.panel.hidden,false);assert.equal(e.range().disabled,true);
  }
 });
 run('small-height media layout and native hit region agree after resize',e=>{
  e.emit(track);e.window.happyDOM.setWindowSize({width:700,height:300});e.window.document.documentElement.setAttribute('data-test-viewport','300');e.window.dispatchEvent(new e.window.Event('resize'));
  assert.equal(e.latestLayout().height,110);assert.match(e.worldHeight(),/calc\(100% - 110px\)/);
  e.emit({connected:false});assert.equal(e.latestLayout().height,0);assert.equal(e.window.document.documentElement.classList.contains('music-enabled'),false); // Happy DOM retains an obsolete computed descendant style after viewport changes; real-browser pixels are separately verified.
  e.window.happyDOM.setWindowSize({width:700,height:600});e.window.document.documentElement.setAttribute('data-test-viewport','600');e.emit(track);assert.equal(e.latestLayout().height,120);
 });
 run('no duplicate native layout notifications for ordinary playback ticks',e=>{
  e.emit(track);const before=e.messages.filter(m=>m.action==='layout').length;
  e.emit({...track,position:26});e.emit({...track,position:27});assert.equal(e.messages.filter(m=>m.action==='layout').length,before);
 });
 run('disconnect clears cached cover before same-source reconnect without artwork',e=>{
  e.emit(track);e.emit({...track,connected:false});
  const next={...track,title:'A new song'};delete next.artwork;e.emit(next);assert.equal(e.art.at(-1),null);
 });
}
test('browser preview without native bridge creates no music UI',()=>{
 const e=environment('browser');assert.equal(e.panel,null);assert.equal(e.window.document.documentElement.classList.contains('music-enabled'),false);e.dispose();
});
const report={limitations:['No browser pixel rendering, native window behavior or live music sessions are simulated.','Happy DOM CSS parser requires whitespace after @media; tests add equivalent whitespace only.','Happy DOM viewport changes do not automatically invalidate style cache; a neutral attribute mutation is used. Its obsolete descendant-style cache after a subsequent root class toggle is excluded from the small-height pixel claim; native layout message and class removal are asserted.'],at:new Date().toISOString(),engine:'happy-dom 21.0.4 (DOM and CSS cascade, not browser pixels/native rendering; equivalent whitespace added after @media and neutral DOM attribute mutation after viewport resize to work around engine parser/cache limitations)' ,sources:{[jsPath]:crypto.createHash('sha256').update(source).digest('hex'),[cssPath]:crypto.createHash('sha256').update(css).digest('hex')},counts:{passed:results.filter(x=>x.status==='PASS').length,failed:results.filter(x=>x.status==='FAIL').length},results};
fs.writeFileSync('results.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
process.exitCode=report.counts.failed?1:0;
