const $=s=>document.querySelector(s);
const CAT={anime:'Anime',movie:'Anime Movie',video:'Video',music:'Music'};
let curFolder=null,files=[],cat='all',used=0,limit=20*1024**3,cur=null,subTracks=[],extActive=false;
const fmt=b=>b>=1e9?(b/1e9).toFixed(2)+' GB':b>=1e6?(b/1e6).toFixed(1)+' MB':Math.round(b/1e3)+' KB';
const esc=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock=t=>{t=Math.max(0,t|0);const h=t/3600|0,m=(t%3600)/60|0,s=t%60;return(h?h+':'+String(m).padStart(2,'0'):m)+':'+String(s).padStart(2,'0')};
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),2800)}
const key=()=>localStorage.getItem('vaultKey')||'';
let mode='server';
/* ---- local mode: files saved in this browser (IndexedDB) ---- */
const idb=new Promise((ok,no)=>{const r=indexedDB.open('solovault',1);r.onupgradeneeded=()=>{r.result.createObjectStore('meta',{keyPath:'id'});r.result.createObjectStore('blobs')};r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});
const tx=async(st,m,fn)=>{const d=await idb;return new Promise((ok,no)=>{const t=d.transaction(st,m);const out=fn(t);t.oncomplete=()=>ok(out&&out.result);t.onerror=()=>no(t.error);t.onabort=()=>no(t.error||new Error('Storage full'))})};
const idbPutMeta=rec=>tx('meta','readwrite',t=>t.objectStore('meta').put(rec));
const idbAll=()=>tx('meta','readonly',t=>t.objectStore('meta').getAll());
const idbBlob=id=>tx('blobs','readonly',t=>t.objectStore('blobs').get(id));
const idbPut=(rec,file)=>tx(['meta','blobs'],'readwrite',t=>{t.objectStore('meta').put(rec);t.objectStore('blobs').put(file,rec.id)});
const idbDel=ids=>tx(['meta','blobs'],'readwrite',t=>ids.forEach(i=>{t.objectStore('meta').delete(i);t.objectStore('blobs').delete(i)}));
const urlCache={};
async function fileURL(f){
  if(mode==='server')return '/files/'+f.id;
  if(!urlCache[f.id])urlCache[f.id]=URL.createObjectURL(await idbBlob(f.id));
  return urlCache[f.id];
}
async function fileText(f){return mode==='server'?await (await fetch('/files/'+f.id)).text():await (await idbBlob(f.id)).text()}
async function download(f){
  const a=document.createElement('a');a.download=f.name;
  a.href=mode==='server'?'/files/'+f.id+'?dl=1':await fileURL(f);
  document.body.appendChild(a);a.click();a.remove();
}
const uid=()=>crypto.randomUUID?crypto.randomUUID():String(Date.now()+Math.random());
function descendants(id){const out=[];const walk=i=>files.filter(x=>x.folder===i&&x.cat!=='sub').forEach(x=>{out.push(x.id);walk(x.id)});walk(id);return out}
function pathOf(id){const p=[];while(id){const f=files.find(x=>x.id===id);if(!f)break;p.unshift(f);id=f.folder}return p}
async function newFolder(){
  const name=(prompt('Folder name')||'').trim();if(!name)return;
  if(mode==='local')await idbPutMeta({id:uid(),name,cat:'folder',size:0,folder:curFolder,parent:null,added:Date.now()});
  else{const r=await call('/api/folder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,folder:curFolder})});if(!r.ok){toast('Could not create folder');return}}
  toast('Folder created');load();
}
let moving=null;
function openMove(f){
  moving=f;const sel=$('#moveSel');sel.innerHTML='';sel.add(new Option('Vault (top level)',''));
  const bad=new Set([f.id,...descendants(f.id)]);
  files.filter(x=>x.cat==='folder'&&!bad.has(x.id)).forEach(x=>sel.add(new Option(pathOf(x.id).map(p=>p.name).join(' / '),x.id)));
  sel.value=f.folder||'';$('#moveDlg').showModal();
}
$('#moveOk').onclick=async()=>{
  const to=$('#moveSel').value||null;$('#moveDlg').close();
  if(mode==='local'){const rec=files.find(x=>x.id===moving.id);rec.folder=to;await idbPutMeta(rec)}
  else{const r=await call('/api/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:moving.id,folder:to})});if(!r.ok){toast('Move failed');return}}
  toast('Moved');load();
};
$('#moveNo').onclick=()=>$('#moveDlg').close();
function renderCrumbs(flat){
  const c=$('#crumbs');c.innerHTML='';
  if(flat)c.innerHTML='<span class="muted">Results from all folders</span>';
  else{
    const h=document.createElement('button');h.textContent='Vault';h.onclick=()=>{curFolder=null;render()};c.appendChild(h);
    pathOf(curFolder).forEach(f=>{c.append(' / ');const b=document.createElement('button');b.textContent=f.name;b.onclick=()=>{curFolder=f.id;render()};c.appendChild(b)});
  }
  const n=document.createElement('button');n.className='btn sm';n.textContent='+ New folder';n.style.marginLeft='auto';n.onclick=newFolder;c.appendChild(n);
}
async function removeFile(f){
  if(mode==='local'){const set=new Set([f.id,...descendants(f.id)]);await idbDel(files.filter(x=>set.has(x.id)||set.has(x.parent)).map(x=>x.id));return true}
  return (await call('/api/files/'+f.id,{method:'DELETE'})).ok;
}

async function load(){
  try{
    const d=await (await fetch('/api/files')).json();
    mode='server';files=d.files;used=d.used;limit=d.limit;$('#modeNote').hidden=true;
  }catch{
    try{mode='local';files=await idbAll();used=files.reduce((s,f)=>s+f.size,0);limit=20*1024**3;$('#modeNote').hidden=false}
    catch{$('#grid').innerHTML='<p class="empty">[SYSTEM] This browser blocks local storage (private window?). Use a normal window, or run node server.js.</p>';return}
  }
  if(curFolder&&!files.find(x=>x.id===curFolder))curFolder=null;
  render();
}
function render(){
  $('#used').textContent=`${fmt(used)} / ${fmt(limit)}`;
  $('#bar').style.width=Math.min(100,used/limit*100)+'%';
  const q=$('#q').value.trim().toLowerCase();
  const flat=!!q||cat!=='all';
  const rows=files.filter(f=>f.cat!=='sub'&&(flat?(f.cat!=='folder'&&(cat==='all'||f.cat===cat)&&f.name.toLowerCase().includes(q)):(f.folder||null)===curFolder))
    .sort((a,b)=>(b.cat==='folder')-(a.cat==='folder')||b.added-a.added);
  renderCrumbs(flat);
  const g=$('#grid');g.innerHTML='';
  if(!rows.length){g.innerHTML='<p class="empty">[SYSTEM] No files here yet. Add some above.</p>';return}
  rows.forEach(f=>{
    const c=document.createElement('div');c.className='card';
    if(f.cat==='folder'){
      const n=files.filter(x=>x.folder===f.id&&x.cat!=='sub').length;
      c.innerHTML=`<div class="th"><span class="note">📁</span><span class="tag">Folder</span></div><div class="cb"><b title="${esc(f.name)}">${esc(f.name)}</b><span class="muted">${n} item${n===1?'':'s'}</span>
      <div class="acts"><button data-a="open">Open</button><button data-a="mv">Move</button><button data-a="del">Delete</button></div></div>`;
      const open=()=>{curFolder=f.id;render()};
      c.querySelector('.th').onclick=open;c.querySelector('[data-a=open]').onclick=open;
      c.querySelector('[data-a=mv]').onclick=()=>openMove(f);
      c.querySelector('[data-a=del]').onclick=async()=>{if(!confirm('Delete folder "'+f.name+'" and everything inside it?'))return;if(await removeFile(f)){toast('Deleted');load()}else toast('Delete failed')};
      g.appendChild(c);return;
    }
    const thumb=f.cat==='music'?'<span class="note">♪</span>':'<video preload="metadata" muted></video>';
    c.innerHTML=`<div class="th">${thumb}<span class="tag">${CAT[f.cat]}</span></div><div class="cb"><b title="${esc(f.name)}">${esc(f.name)}</b><span class="muted">${fmt(f.size)}</span>
    <div class="acts"><button data-a="play">Play</button><button data-a="dl">Download</button><button data-a="link">Share</button><button data-a="mv">Move</button><button data-a="del">Delete</button></div></div>`;
    c.querySelector('.th').onclick=()=>play(f);
    c.querySelector('[data-a=dl]').onclick=()=>download(f);
    c.querySelector('[data-a=mv]').onclick=()=>openMove(f);
    const tv=c.querySelector('video');if(tv)fileURL(f).then(u=>tv.src=u+'#t=3').catch(()=>{});
    c.querySelector('[data-a=play]').onclick=()=>play(f);
    c.querySelector('[data-a=link]').onclick=async()=>{if(mode==='local'){toast('Share links need the server (run node server.js)');return}const u=location.origin+'/files/'+f.id+'?dl=1';try{await navigator.clipboard.writeText(u);toast('Download link copied')}catch{prompt('Copy link',u)}};
    c.querySelector('[data-a=del]').onclick=async()=>{if(!confirm('Delete '+f.name+'?'))return;if(await removeFile(f)){toast('Deleted');load()}else toast('Delete failed')};
    g.appendChild(c);
  });
}
async function call(url,opt={}){
  opt.headers={...(opt.headers||{}),'x-key':key()};
  const r=await fetch(url,opt);
  if(r.status===401){const k=prompt('Admin key required');if(k!==null){localStorage.setItem('vaultKey',k);return call(url,opt)}}
  return r;
}
$('#tabs').onclick=e=>{const b=e.target.closest('button');if(!b)return;cat=b.dataset.c;document.querySelectorAll('#tabs button').forEach(x=>x.classList.toggle('on',x===b));render()};
$('#q').oninput=render;

/* upload */
async function upload(file,category,parent){
  if(mode!=='local')return uploadServer(file,category,parent);
  if(used+file.size>limit){toast('Storage full: 20 GB limit reached');return null}
  try{
    navigator.storage&&navigator.storage.persist&&navigator.storage.persist();
    const est=navigator.storage&&navigator.storage.estimate?await navigator.storage.estimate():null;
    if(est&&est.quota&&est.quota-est.usage<file.size){toast('This browser has no room left for that file');return null}
    const rec={id:crypto.randomUUID?crypto.randomUUID():String(Date.now()+Math.random()),name:file.name,cat:category,size:file.size,parent:parent||null,folder:parent?null:curFolder,added:Date.now()};
    await idbPut(rec,file);return rec;
  }catch(e){toast('Could not save file: '+(e&&e.message||'storage error'));return null}
}
function uploadServer(file,category,parent){
  return new Promise(res=>{
    if(used+file.size>limit){toast('Storage full: 20 GB limit reached');return res(null)}
    const row=document.createElement('div');row.className='q';row.innerHTML=`${esc(file.name)} <i></i>`;$('#queue').appendChild(row);
    const go=()=>{
      const x=new XMLHttpRequest();x.open('POST','/api/upload');
      x.setRequestHeader('x-name',encodeURIComponent(file.name));x.setRequestHeader('x-cat',category);x.setRequestHeader('x-key',key());
      if(parent)x.setRequestHeader('x-parent',parent);else if(curFolder)x.setRequestHeader('x-folder',curFolder);
      x.upload.onprogress=e=>row.querySelector('i').style.width=(e.loaded/e.total*100)+'%';
      x.onload=()=>{
        if(x.status===401){const k=prompt('Admin key required');if(k!==null){localStorage.setItem('vaultKey',k);return go()}}
        row.remove();
        if(x.status===200){res(JSON.parse(x.responseText))}else{let m='Upload failed';try{m=JSON.parse(x.responseText).error}catch{}toast(m);res(null)}
      };
      x.onerror=()=>{row.remove();toast('Upload failed: server stopped, unreachable, or storage is full');res(null)};
      x.send(file);
    };go();
  });
}
async function handleFiles(list){
  for(const f of list){
    const c=f.type.startsWith('audio/')?'music':$('#upcat').value;
    const r=await upload(f,c);if(r){toast('Added '+f.name);await load()}
  }
}
$('#pick').onclick=()=>$('#fileIn').click();
$('#fileIn').onchange=e=>{handleFiles([...e.target.files]);e.target.value=''};
const drop=$('#drop');
['dragover','dragenter'].forEach(n=>drop.addEventListener(n,e=>{e.preventDefault();drop.classList.add('over')}));
['dragleave','drop'].forEach(n=>drop.addEventListener(n,e=>{e.preventDefault();drop.classList.remove('over')}));
drop.addEventListener('drop',e=>handleFiles([...e.dataTransfer.files]));

/* player */
const v=$('#v'),ext=$('#ext'),stage=$('#stage');
let idleT;
function wake(){stage.classList.remove('idle');clearTimeout(idleT);if(!v.paused&&$('#menu').hidden)idleT=setTimeout(()=>stage.classList.add('idle'),3000)}
['mousemove','touchstart','keydown'].forEach(n=>stage.addEventListener(n,wake,{passive:true}));
function srt2vtt(t){return 'WEBVTT\n\n'+t.replace(/\r/g,'').replace(/^\uFEFF/,'').replace(/(\d+):(\d+):(\d+),(\d+)/g,'$1:$2:$3.$4')}
async function addSubText(name,text){
  const vtt=/^\s*WEBVTT/.test(text)?text:srt2vtt(text);
  const tr=document.createElement('track');tr.kind='subtitles';tr.label=name.replace(/\.\w+$/,'');
  tr.src=URL.createObjectURL(new Blob([vtt],{type:'text/vtt'}));v.appendChild(tr);
  tr.track.mode='disabled';subTracks.push(tr);
  const o=new Option(tr.label,subTracks.length-1);$('#subSel').add(o);
  $('#subSel').value=subTracks.length-1;setSub();
}
function setSub(){const i=+$('#subSel').value;subTracks.forEach((t,k)=>t.track.mode=k===i?'showing':'disabled')}
$('#subSel').onchange=setSub;
$('#addSub').onclick=()=>$('#subIn').click();
$('#subIn').onchange=async e=>{
  const f=e.target.files[0];e.target.value='';if(!f)return;
  await addSubText(f.name,await f.text());toast('Subtitle added');
  const r=await upload(f,'sub',cur.id);if(r)load();
};
function resetAudio(){ext.pause();ext.removeAttribute('src');extActive=false;v.muted=$('#mute').dataset.m==='1';ext.muted=false;$('#audSel').value='orig'}
$('#addAud').onclick=()=>$('#audIn').click();
$('#audIn').onchange=e=>{
  const f=e.target.files[0];e.target.value='';if(!f)return;
  ext.src=URL.createObjectURL(f);extActive=true;v.muted=true;
  const o=new Option('File: '+f.name,'ext');$('#audSel').add(o);$('#audSel').value='ext';
  ext.volume=v.volume;ext.currentTime=v.currentTime;ext.playbackRate=v.playbackRate;if(!v.paused)ext.play();toast('Audio track loaded');
};
$('#audSel').onchange=()=>{
  const val=$('#audSel').value;
  if(val==='orig'){extActive=false;ext.pause();v.muted=$('#mute').dataset.m==='1'}
  else if(val==='ext'){extActive=true;v.muted=true;ext.currentTime=v.currentTime;if(!v.paused)ext.play()}
  else if(v.audioTracks){extActive=false;ext.pause();v.muted=false;for(let i=0;i<v.audioTracks.length;i++)v.audioTracks[i].enabled=(i==val)}
};
function loadNativeAudio(){
  if(v.audioTracks&&v.audioTracks.length>1)for(let i=0;i<v.audioTracks.length;i++){const t=v.audioTracks[i];$('#audSel').add(new Option(t.label||t.language||('Track '+(i+1)),i))}
}
v.addEventListener('loadedmetadata',loadNativeAudio);

async function play(f){
  cur=f;$('#player').hidden=false;document.body.style.overflow='hidden';
  $('#ptitle').textContent=f.name;stage.classList.toggle('audio',f.cat==='music');
  [...v.querySelectorAll('track')].forEach(t=>t.remove());subTracks=[];$('#subSel').innerHTML='<option value="-1">Off</option>';
  $('#audSel').innerHTML='<option value="orig">Original</option>';resetAudio();
  v.style.filter='';$('#bri').value=1;v.src=await fileURL(f);
  v.play().catch(()=>{});wake();
  for(const s of files.filter(x=>x.cat==='sub'&&x.parent===f.id)){
    try{await addSubText(s.name,await fileText(s))}catch{}
  }
  if(subTracks.length){$('#subSel').value=-1;setSub()}
}
function closePlayer(){v.pause();ext.pause();v.removeAttribute('src');v.load();if(document.fullscreenElement)document.exitFullscreen();$('#player').hidden=true;document.body.style.overflow='';$('#menu').hidden=true}
$('#close').onclick=closePlayer;
$('#dl').onclick=e=>{e.preventDefault();if(cur)download(cur)};
function toggle(){v.paused?v.play():v.pause()}
function seekBy(d){v.currentTime=Math.min(v.duration||1e9,Math.max(0,v.currentTime+d));if(extActive)ext.currentTime=v.currentTime;flash(d>0?'+10s':'-10s',d>0)}
function flash(t,right){const f=$('#flash');f.textContent=t;f.style.left=right?'auto':'14%';f.style.right=right?'14%':'auto';f.classList.add('on');clearTimeout(flash.t);flash.t=setTimeout(()=>f.classList.remove('on'),500)}
$('#pp').onclick=toggle;$('#back').onclick=()=>seekBy(-10);$('#fwd').onclick=()=>seekBy(10);
v.onplay=()=>{$('#pp').textContent='⏸';if(extActive){ext.currentTime=v.currentTime;ext.play()}wake()};
v.onpause=()=>{$('#pp').textContent='▶';ext.pause();wake()};
v.onwaiting=()=>ext.pause();v.onplaying=()=>{if(extActive)ext.play()};
v.onratechange=()=>ext.playbackRate=v.playbackRate;
v.ontimeupdate=()=>{
  $('#seek').value=v.duration?v.currentTime/v.duration*1000:0;
  $('#time').textContent=clock(v.currentTime)+' / '+clock(v.duration||0);
  if(extActive&&Math.abs(ext.currentTime-v.currentTime)>0.3)ext.currentTime=v.currentTime;
};
$('#seek').oninput=e=>{v.currentTime=e.target.value/1000*(v.duration||0);if(extActive)ext.currentTime=v.currentTime};
function setVol(x){x=Math.min(1,Math.max(0,x));v.volume=ext.volume=x;$('#vol').value=x;$('#mute').textContent=x===0?'🔇':'🔊'}
$('#vol').oninput=e=>setVol(+e.target.value);
$('#mute').onclick=()=>{const m=$('#mute').dataset.m==='1'?'0':'1';$('#mute').dataset.m=m;if(extActive)ext.muted=m==='1';else v.muted=m==='1';$('#mute').textContent=m==='1'?'🔇':'🔊'};
$('#bri').oninput=e=>v.style.filter=`brightness(${e.target.value})`;
$('#spd').onchange=e=>v.playbackRate=+e.target.value;
$('#gear').onclick=()=>{$('#menu').hidden=!$('#menu').hidden;wake()};
function fullscreen(){
  if(document.fullscreenElement)return document.exitFullscreen();
  if(stage.requestFullscreen)stage.requestFullscreen();
  else if(stage.webkitRequestFullscreen)stage.webkitRequestFullscreen();
  else if(v.webkitEnterFullscreen)v.webkitEnterFullscreen();
}
$('#fs').onclick=fullscreen;

/* double-tap zones: left = -10s, right = +10s, single tap = show/hide controls, center = play/pause */
let last={t:0,z:''},single;
function tap(z){
  const now=Date.now();
  if(now-last.t<300&&last.z===z&&z!=='c'){clearTimeout(single);seekBy(z==='r'?10:-10);last={t:0,z:''};return}
  last={t:now,z};clearTimeout(single);
  single=setTimeout(()=>{
    if(!$('#menu').hidden){$('#menu').hidden=true;return}
    if(z==='c')toggle();else stage.classList.toggle('idle')
  },300);
}
$('#zl').onclick=()=>tap('l');$('#zc').onclick=()=>tap('c');$('#zr').onclick=()=>tap('r');
$('#zc').ondblclick=fullscreen;

document.addEventListener('keydown',e=>{
  if($('#player').hidden||['INPUT','SELECT'].includes(e.target.tagName)&&e.target.type!=='range')return;
  const k=e.key;
  if(k==='ArrowRight'){e.preventDefault();seekBy(10)}
  else if(k==='ArrowLeft'){e.preventDefault();seekBy(-10)}
  else if(k==='ArrowUp'){e.preventDefault();setVol(v.volume+0.05)}
  else if(k==='ArrowDown'){e.preventDefault();setVol(v.volume-0.05)}
  else if(k===' '||k==='k'){e.preventDefault();toggle()}
  else if(k==='f')fullscreen();
  else if(k==='m')$('#mute').click();
  else if(k==='Escape'&&!document.fullscreenElement)closePlayer();
  wake();
});
load();