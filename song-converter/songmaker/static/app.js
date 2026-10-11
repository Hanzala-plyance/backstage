const $ = (q) => document.querySelector(q);
const form = $('#song-form');
const levels = ['Easy','Medium','Hard','Expert'];
let sourceMode = 'file';
let lastReadyCount = -1, queueRefreshing = false;
let activeJob, currentResult, outputRoot = '', animation, toastTimer;
let instrument = 'Guitar', difficulty = 'Expert', originalNotes = [], dirty = false;

async function api(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    let error = body.detail || `Request failed (${response.status}).`;
    if (Array.isArray(error)) error = error.map(x => x.msg).join(' ');
    throw new Error(error);
  }
  return response.json();
}
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, 5500); }
function error(message) {$('#form-error').textContent = message; $('#form-error').hidden = !message;}
let selectedFiles = [], queueItems = [], pendingUploads = new Map(), queueTimer, queueSignature = '';
function selectAudio() {
  selectedFiles = [...$('#audio-file').files];
  renderSelectedFiles();
}
function renderSelectedFiles() {
  $('#file-title').textContent = selectedFiles.length ? `${selectedFiles.length} song${selectedFiles.length===1?'':'s'} selected` : 'Start with your songs';
  $('#file-subtitle').textContent = selectedFiles.length ? 'Review your selection below. Choose again to replace it.' : 'Drop songs here, or choose several files.';
  $('#file-selection').replaceChildren();
  selectedFiles.forEach((file,index)=>{const row=document.createElement('div');const label=document.createElement('span');label.textContent=`${file.name} · ${(file.size/1024/1024).toFixed(1)} MB`;const button=document.createElement('button');button.type='button';button.textContent='×';button.setAttribute('aria-label',`Remove ${file.name}`);button.onclick=()=>{selectedFiles.splice(index,1);const transfer=new DataTransfer();selectedFiles.forEach(f=>transfer.items.add(f));$('#audio-file').files=transfer.files;renderSelectedFiles();};row.append(label,button);$('#file-selection').append(row);});
  error(selectedFiles.some(file=>file.size>250*1024*1024)?'Each audio file must be under 250 MB.':selectedFiles.length>20?'Choose up to 20 songs per batch.':'');
}
$('#audio-file').addEventListener('change', selectAudio);
for (const event of ['dragenter','dragover']) $('#dropzone').addEventListener(event, e => {e.preventDefault();$('#dropzone').classList.add('dragging');});
for (const event of ['dragleave','drop']) $('#dropzone').addEventListener(event, () => $('#dropzone').classList.remove('dragging'));
$('#dropzone').addEventListener('drop', e => {e.preventDefault();if(!e.dataTransfer.files.length)return;const data=new DataTransfer();[...e.dataTransfer.files].forEach(f=>data.items.add(f));$('#audio-file').files=data.files;selectAudio();});
$('#lyrics-toggle').addEventListener('change', () => $('#lyrics-options').hidden = !$('#lyrics-toggle').checked);
$('#art-toggle').addEventListener('change', () => $('#art-query-label').hidden = !$('#art-toggle').checked);
$('#cover-file').addEventListener('change', () => {const file=$('#cover-file').files[0];$('#cover-name').textContent=file?.name || 'PNG, JPG, WEBP';$('#clear-cover').hidden=!file;});
$('#clear-cover').addEventListener('click', () => {$('#cover-file').value='';$('#cover-file').dispatchEvent(new Event('change'));});
function updateVideoQuality() {
  const enabled = sourceMode === 'youtube' && $('#youtube-video').checked;
  $('#youtube-quality').disabled = !enabled;
  $('#youtube-quality-option').hidden = !enabled;
  $('#youtube-quality-help').hidden = !enabled;
}
$('#youtube-video').addEventListener('change', updateVideoQuality);
function setSource(mode) {
  if (mode === 'charts' && !$('#chart-search-query').value.trim()) $('#chart-search-query').value = $('#youtube-search').value;
  if (mode === 'youtube' && !$('#youtube-search').value.trim()) $('#youtube-search').value = $('#chart-search-query').value;
  sourceMode = mode;
  $('#chart-search-panel').hidden = mode !== 'charts';
  $('.song-card').classList.toggle('chart-search-mode', mode === 'charts');
  for (const selector of ['.song-details', '.band-card', '.finishing-card', '.build-footer']) $(selector).hidden = mode === 'charts';
  $('#file-selection').hidden = mode !== 'file';
  $('#dropzone').hidden = mode !== 'file'; $('#youtube-input').hidden = mode !== 'youtube';
  $('#audio-file').disabled = mode !== 'file'; $('#audio-file').required = mode === 'file';
  $('#youtube-video').disabled = mode !== 'youtube';
  updateVideoQuality();
  $('#cover-video-option').hidden = mode === 'youtube'; $('#cover-video').disabled = mode === 'youtube';
  $('#youtube-url').disabled = mode !== 'youtube'; $('#youtube-url').required = mode === 'youtube';
  for (const key of ['file', 'youtube', 'charts']) { const button=$('#source-'+key);button.classList.toggle('selected',key===mode);button.setAttribute('aria-selected',String(key===mode)); }
}
$('#source-file').addEventListener('click',()=>setSource('file'));
$('#source-youtube').addEventListener('click',()=>{setSource('youtube');$('#youtube-url').focus();});
$('#source-charts').addEventListener('click',()=>{setSource('charts');$('#chart-search-query').focus();});
function setNav(id){for(const key of ['new-song','queue-button','library-button'])$('#'+key).classList.toggle('active',key===id);}
function showQueue(){
  setNav('queue-button');
  $('#intro').hidden=true;$('#create-view').hidden=true;$('#result-panel').hidden=true;$('#progress-area').hidden=true;$('#queue-panel').hidden=false;
  $('#audio-player').pause();localStorage.setItem('autochart-view','queue');renderQueue();
}
function renderQueue(){
  const entries=[...queueItems,...pendingUploads.values()];
  const active=entries.filter(item=>!['complete','error'].includes(item.status)).length;
  $('#queue-count').textContent=active;
  $('#queue-summary').textContent=entries.length?`${active} in progress · ${entries.filter(i=>i.status==='complete').length} ready · ${entries.filter(i=>i.status==='error').length} need attention`:'Choose audio files or YouTube links to start your first batch.';
  const signature=JSON.stringify(entries);if(signature===queueSignature)return;queueSignature=signature;
  $('#queue-list').replaceChildren();
  for(const item of [...entries].reverse()){
    const row=document.createElement('article');row.className='queue-item card';row.dataset.job=item.id||'';
    const info=document.createElement('div');info.className='queue-info';const title=document.createElement('h3');title.textContent=item.title;
    const status=document.createElement('p');status.className='help';status.textContent=item.library?.message||item.message||item.status;
    const bar=document.createElement('progress');bar.max=100;bar.value=item.progress||0;bar.setAttribute('aria-label',`${item.title} progress`);
    info.append(title,status);if(!['complete','error'].includes(item.status))info.append(bar);
    const actions=document.createElement('div');actions.className='queue-actions';
    if(item.status==='complete'){
      const open=document.createElement('button');open.type='button';open.className='secondary-button';open.textContent='Open';open.onclick=async()=>{if(dirty&&!await saveTrack())return;try{await showResult(item.id);}catch(e){toast(e.message);}};
      const download=document.createElement('a');download.className='primary-button small';download.textContent='Download';download.href=`/api/jobs/${item.id}/download`;
      const install=document.createElement('button');install.type='button';install.className='secondary-button';install.textContent=item.library?.status==='installed'?'Installed in Backstage':'Install in Backstage';install.disabled=item.library?.status==='installed';install.onclick=async()=>{install.disabled=true;try{await api(`/api/jobs/${item.id}/install`,{method:'POST'});await refreshQueue();refreshSharedLibrary();toast('Installed. Use Scan Songs in Backstage.');}catch(e){install.disabled=false;toast(e.message);}};
      actions.append(open,install,download);
    }else{const badge=document.createElement('span');badge.className='queue-state '+item.status;badge.textContent=item.status==='error'?'Needs attention':`${item.status} · ${item.progress||0}%`;actions.append(badge);}
    row.append(info,actions);$('#queue-list').append(row);
  }
}
async function refreshQueue(){
  if(queueRefreshing)return;queueRefreshing=true;clearTimeout(queueTimer);
  try{
    queueItems=await api('/api/queue');renderQueue();const readyCount=queueItems.filter(item=>item.status==='complete').length;if(readyCount!==lastReadyCount){lastReadyCount=readyCount;refreshLibrary();refreshSharedLibrary();}

  }catch(e){if(!$('#queue-panel').hidden)$('#queue-summary').textContent='Reconnecting to Backstage… Keep the app running.';}
  queueRefreshing=false;queueTimer=setTimeout(refreshQueue,queueItems.some(i=>!['complete','error'].includes(i.status))?1600:5000);
}
function uploadJob(data, item){
  return new Promise((resolve,reject)=>{
    const request=new XMLHttpRequest();request.open('POST','/api/jobs');request.timeout=600000;
    request.upload.onprogress=e=>{if(e.lengthComputable){item.progress=Math.round(100*e.loaded/e.total);item.message=`Uploading · ${item.progress}%`;renderQueue();}};
    request.onload=()=>{let result;try{result=JSON.parse(request.responseText);}catch{reject(new Error('The server returned an unreadable response.'));return;}if(request.status>=200&&request.status<300)resolve(result);else reject(new Error(typeof result.detail==='string'?result.detail:'This song could not be added. Check the file and options.'));};
    request.onerror=()=>reject(new Error('Upload interrupted. Keep Backstage running and add this song again.'));
    request.ontimeout=()=>reject(new Error('Upload timed out. Add this song again.'));request.send(data);
  });
}
let uploadTasks=[], uploadsInFlight=0;
function scheduleUpload(data,item){
  return new Promise((resolve,reject)=>{uploadTasks.push({data,item,resolve,reject});pumpUploads();});
}
function pumpUploads(){
  while(uploadsInFlight<2&&uploadTasks.length){const task=uploadTasks.shift();uploadsInFlight++;
    uploadJob(task.data,task.item).then(task.resolve,task.reject).finally(()=>{uploadsInFlight--;pumpUploads();});}
}
form.addEventListener('submit', async e => {
  e.preventDefault();error('');
  if(sourceMode === 'charts'){searchCharts();return;}
  const sources=sourceMode==='youtube'?[...new Set($('#youtube-url').value.split(/\n/).map(v=>v.trim()).filter(Boolean))]:[...selectedFiles];
  if(!sources.length||sources.length>20){error('Choose 1–20 songs, or paste one YouTube video link per line.');return;}
  if(sourceMode==='file'&&sources.some(f=>f.size>250*1024*1024)){error('Each audio file must be under 250 MB.');return;}
  const mode=sourceMode, defaults=new FormData(form);defaults.delete('audio');defaults.delete('youtube_url');
  defaults.set('lyrics_mode',$('#lyrics-toggle').checked?'auto':'skip');defaults.set('art_mode',$('#art-toggle').checked?'google':'offline');
  if(!$('#cover-file').files.length)defaults.delete('cover');
  // Snapshot this batch and release the form immediately. New batches use their own options.
  if(mode==='file'){$('#audio-file').value='';selectedFiles=[];renderSelectedFiles();}else $('#youtube-url').value='';
  showQueue();
  const batch=sources.map(source=>{const key='pending-'+crypto.randomUUID();const item={id:key,title:mode==='file'?source.name:source,status:'uploading',progress:0,message:'Waiting to upload…'};pendingUploads.set(key,item);return {source,key,item};});renderQueue();
  let accepted=0;
  await Promise.all(batch.map(async({source,key,item})=>{
    const data=new FormData();for(const [k,v] of defaults)data.append(k,v);if(mode==='file')data.set('audio',source);else data.set('youtube_url',source);
    try{const job=await scheduleUpload(data,item);accepted++;pendingUploads.delete(key);queueItems.push({...item,id:job.id,status:'queued',progress:0,message:'Waiting for conversion…'});}
    catch(e){item.status='error';item.message=e.message;
      if(!$('#queue-panel').hidden&&batch.length===1)error(e.message);
      // Restore only failed items, preserving any new selection the user is working on.
      if(mode==='file'){if(!selectedFiles.some(f=>f.name===source.name&&f.size===source.size&&f.lastModified===source.lastModified))selectedFiles.push(source);const transfer=new DataTransfer();selectedFiles.forEach(f=>transfer.items.add(f));$('#audio-file').files=transfer.files;renderSelectedFiles();}
      else {const links=$('#youtube-url').value.split(/\n/).map(v=>v.trim()).filter(Boolean);if(!links.includes(source))links.push(source);$('#youtube-url').value=links.join('\n');}
    }renderQueue();
  }));
  toast(`${accepted} of ${batch.length} songs added to your queue`);await refreshQueue();
});
$('#queue-button').addEventListener('click',async()=>{if(dirty&&!await saveTrack())return;showQueue();refreshQueue();});
$('#queue-add-more').addEventListener('click',()=>$('#new-song').click());
async function searchYouTube(){
  const query=$('#youtube-search').value.trim();if(query.length<2){$('#search-status').textContent='Enter an artist or song title.';return;}
  const button=$('#youtube-search-button');button.disabled=true;$('#search-status').textContent='Searching YouTube…';$('#youtube-results').replaceChildren();
  try{const data=await api('/api/youtube/search?q='+encodeURIComponent(query));$('#search-status').textContent=data.results.length?'Choose Add to put a video in your batch.':'No matching videos under 20 minutes. Try another search.';
    for(const result of data.results){const row=document.createElement('div');row.className='search-result';const image=document.createElement('img');image.src=result.thumbnail;image.alt='';image.loading='lazy';
      const info=document.createElement('div');const title=document.createElement('a');title.textContent=result.title;title.href=result.url;title.target='_blank';title.rel='noreferrer';const detail=document.createElement('small');detail.textContent=result.artist+(result.duration?` · ${Math.floor(result.duration/60)}:${String(Math.floor(result.duration%60)).padStart(2,'0')}`:'');info.append(title,detail);
      const add=document.createElement('button');add.type='button';add.className='secondary-button';add.textContent='＋ Add';add.onclick=()=>{const links=$('#youtube-url').value.split(/\n/).map(s=>s.trim()).filter(Boolean);if(links.length>=20){toast('Add this batch first. You can queue up to 20 songs.');return;}if(!links.includes(result.url))links.push(result.url);$('#youtube-url').value=links.join('\n');add.textContent='Added ✓';add.disabled=true;};row.append(image,info,add);$('#youtube-results').append(row);}
  }catch(e){$('#search-status').textContent=e.message;}finally{button.disabled=false;}
}
$('#youtube-search-button').addEventListener('click',searchYouTube);
$('#youtube-search').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchYouTube();}});
function tracks(){return currentResult.analysis.instruments || {Guitar:currentResult.analysis.tracks};}
function notes(){return tracks()[instrument][difficulty];}
function refreshDownload(){const url=`/api/jobs/${activeJob}/download?v=${Date.now()}`;$('#download-button').href=url;$('#drums-download').href=url;}
async function showResult(id) {
  setNav('library-button');$('#queue-panel').hidden=true;localStorage.setItem('autochart-view','editor');
  currentResult=await api(`/api/jobs/${id}/result`);activeJob=id;dirty=false;
  $('#intro').hidden=true;$('#create-view').hidden=true;$('#progress-area').hidden=true;$('#result-panel').hidden=false;
  $('#result-title').textContent=currentResult.metadata.title;
  $('#result-subtitle').textContent=`${currentResult.metadata.artist} · ${currentResult.format_version===2?'Full band · All four difficulties':'Guitar export'}`;
  refreshDownload();
  $('#result-cover').src=`/api/jobs/${id}/files/album.png?v=${Date.now()}`;
  $('#result-cover').alt=`Cover for ${currentResult.metadata.title}`;
  const player=$('#audio-player');
  $('#preview-player-status').hidden=false;
  $('#preview-player-status').textContent='Preparing full-song preview…';
  player.src=`/api/jobs/${id}/files/preview.m4a`;
  $('#art-source').textContent=`Artwork: ${currentResult.artwork.source}`;
  if(/^https?:\/\//.test(currentResult.artwork.url||'')){const a=document.createElement('a');a.href=currentResult.artwork.url;a.textContent=' · Source ↗';a.target='_blank';a.rel='noreferrer';$('#art-source').append(a);}
  const duration=currentResult.analysis.duration;
  $('#volume-status').hidden = !currentResult.loudness?.enabled;
  $('#volume-status').textContent = currentResult.loudness?.enabled ? 'Volume matched across songs.' : '';
  $('#video-status').hidden = !currentResult.video?.included;
  $('#video-status').textContent = currentResult.video?.included ? `${currentResult.video.source} video${currentResult.video.width && currentResult.video.height ? ` · ${currentResult.video.width} × ${currentResult.video.height}` : ''} included. Enable song videos in Backstage to play it.` : '';
  $('#stats').textContent=`${Math.floor(duration/60)}:${String(Math.floor(duration%60)).padStart(2,'0')}  ·  ${currentResult.analysis.bpm} BPM`;
  $('#saved-path').textContent=`${outputRoot}/${id}/${currentResult.folder}`;
  $('#legacy-notice').hidden=!!currentResult.analysis.instruments;
  $('#validated-badge').hidden=currentResult.format_version!==2;
  $('#warnings').replaceChildren();
  for(const warning of currentResult.warnings){const p=document.createElement('p');p.textContent=warning;$('#warnings').append(p);}
  for(const [key,value] of Object.entries(currentResult.metadata)){const input=$('#details-form').elements[key];if(input)input.value=value;}
  $('#lyrics-status').textContent=currentResult.lyrics_status;
  $('#lyrics-editor').value=currentResult.lyrics;renderLyrics(currentResult.lyrics);
  $('#lyrics-save-message').textContent='Changes are included in your download after saving.';
  instrument='Guitar';difficulty='Expert';selectTrack(instrument,difficulty);setTab('notes');
  localStorage.setItem('autochart-job',id);window.scrollTo({top:0,behavior:'smooth'});
}
$('#audio-player').addEventListener('loadedmetadata',()=>{
  $('#preview-player-status').hidden=true;$('#preview-player-status').textContent='';
});
$('#audio-player').addEventListener('playing',()=>{
  $('#preview-player-status').hidden=true;$('#preview-player-status').textContent='';
});
$('#audio-player').addEventListener('error',()=>{
  $('#preview-player-status').hidden=false;
  $('#preview-player-status').textContent='The audio preview could not load. Reopen the song or try a recent version of Safari or Chrome.';
});
function matrix() {
  const root=$('#track-matrix');root.replaceChildren(document.createElement('span'));
  for(const level of levels){const heading=document.createElement('span');heading.className='matrix-heading';heading.textContent=level;root.append(heading);}
  for(const part of ['Guitar','Bass','Rhythm','Drums']){
    const label=document.createElement('span');label.className='matrix-label';label.textContent=part;root.append(label);
    for(const level of levels){
      const count=tracks()[part]?.[level]?.length;const button=document.createElement('button');button.className='track-cell';button.disabled=!count;
      button.dataset.instrument=part;button.dataset.difficulty=level;
      button.setAttribute('aria-label',`${part} ${level}, ${count||0} note groups`);
      button.classList.toggle('selected',instrument===part && difficulty===level);button.setAttribute('aria-pressed',String(instrument===part && difficulty===level));
      button.append(document.createTextNode(count ? count.toLocaleString() : '—'));const small=document.createElement('small');small.textContent=count?'notes':'not included';button.append(small);
      button.addEventListener('click',async()=>{if(dirty && !await saveTrack())return;selectTrack(part,level);});root.append(button);
    }
  }
}
function selectTrack(part,level){instrument=part;difficulty=level;originalNotes=structuredClone(notes());dirty=false;$('#edit-notes').checked=false;$('#track-edit-actions').hidden=true;$('#preview-title').textContent=`${part} · ${level}`;matrix();drawPreview();}
function setTab(name){for(const b of document.querySelectorAll('[data-tab]')){const selected=b.dataset.tab===name;b.classList.toggle('selected',selected);b.setAttribute('aria-selected',String(selected));}for(const tab of ['notes','lyrics','details'])$(`#tab-${tab}`).hidden=tab!==name;if(name==='notes')drawPreview();}
for(const button of document.querySelectorAll('[data-tab]'))button.addEventListener('click',()=>setTab(button.dataset.tab));
function drawPreview(){
  cancelAnimationFrame(animation);if(!currentResult || $('#result-panel').hidden)return;
  const canvas=$('#chart-preview'),ctx=canvas.getContext('2d'),width=canvas.width,height=canvas.height,now=$('#audio-player').currentTime||0;
  const colors=instrument==='Drums'?['#e89943','#e56a74','#d6b437','#6496e5','#5cba77']:['#5bbb76','#e56a74','#d6b437','#6496e5','#e89943'];
  const names=instrument==='Drums'?['Kick','Snare','Hi-hat','Tom','Crash']:['Green','Red','Yellow','Blue','Orange'];
  const maxLane=instrument==='Drums'||['Hard','Expert'].includes(difficulty)?4:difficulty==='Easy'?2:3;
  ctx.clearRect(0,0,width,height);ctx.fillStyle='#fafbfd';ctx.fillRect(0,0,width,height);
  const top=30,laneHeight=45,hitX=93,scale=(width-hitX-20)/5;
  for(let lane=0;lane<5;lane++){
    const y=top+laneHeight*lane+laneHeight/2;ctx.strokeStyle='#e5eaf1';ctx.beginPath();ctx.moveTo(hitX,y);ctx.lineTo(width-20,y);ctx.stroke();
    ctx.font='12px -apple-system, sans-serif';ctx.fillStyle=lane<=maxLane?'#8c949e':'#d3d7dd';ctx.fillText(names[lane],12,y+4);
    if(lane<=maxLane){ctx.fillStyle=colors[lane];ctx.globalAlpha=.18;ctx.beginPath();ctx.arc(hitX,y,11,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;}
  }
  ctx.strokeStyle='#b6c5d7';ctx.beginPath();ctx.moveTo(hitX,top);ctx.lineTo(hitX,top+laneHeight*5);ctx.stroke();
  for(const note of notes()){
    if(note.time+(note.duration||0)<now-.3||note.time>now+5)continue;
    const x=hitX+(note.time-now)*scale;
    for(const lane of note.lanes){const y=top+laneHeight*lane+laneHeight/2;ctx.fillStyle=colors[lane];
      if(note.duration){ctx.globalAlpha=.4;ctx.fillRect(Math.max(hitX,x),y-3,Math.max(0,x+note.duration*scale-Math.max(hitX,x)),6);ctx.globalAlpha=1;}
      if(x>hitX-12){ctx.beginPath();ctx.roundRect(x-9,y-9,18,18,6);ctx.fill();}
    }
  }
  ctx.fillStyle='#9fa7b2';ctx.font='11px -apple-system, sans-serif';for(let s=0;s<=4;s++)ctx.fillText(`${(now+s).toFixed(1)}s`,hitX+s*scale-10,height-13);
  if(!$('#audio-player').paused)animation=requestAnimationFrame(drawPreview);
}
for(const event of ['play','pause','seeked','loadedmetadata','timeupdate'])$('#audio-player').addEventListener(event,drawPreview);
$('#edit-notes').addEventListener('change',()=>{$('#track-edit-actions').hidden=!$('#edit-notes').checked;if($('#edit-notes').checked)$('#audio-player').pause();$('#chart-preview').style.cursor=$('#edit-notes').checked?'crosshair':'default';});
$('#chart-preview').addEventListener('click',e=>{
  if(!$('#edit-notes').checked)return;$('#audio-player').pause();
  const rect=e.currentTarget.getBoundingClientRect(),x=(e.clientX-rect.left)*900/rect.width,y=(e.clientY-rect.top)*300/rect.height;
  const lane=Math.floor((y-30)/45),max=instrument==='Drums'||['Hard','Expert'].includes(difficulty)?4:difficulty==='Easy'?2:3;
  if(lane<0||lane>max||x<93||x>880)return;
  const time=Math.round((($('#audio-player').currentTime||0)+(x-93)/((900-93-20)/5))*100)/100;
  if(time>=currentResult.analysis.duration)return;
  const items=notes(),near=items.find(n=>Math.abs(n.time-time)<.07);
  if(near){if(near.lanes.includes(lane)){if(near.lanes.length===1 && items.length===1){toast('Keep at least one note in each chart.');return;}near.lanes=near.lanes.filter(l=>l!==lane);if(!near.lanes.length)items.splice(items.indexOf(near),1);}else{if(instrument==='Drums'&&lane!==0&&near.lanes.filter(l=>l!==0).length>=2){toast('A drum hit can use two hands and a kick.');return;}near.lanes.push(lane);near.lanes.sort();}}
  else{items.push({time,duration:0,length:0,lanes:[lane]});items.sort((a,b)=>a.time-b.time);}
  dirty=true;$('#track-edit-status').textContent='Unsaved changes · Only this instrument and difficulty will change.';matrix();drawPreview();
});
async function saveTrack(){
  if(!dirty)return true;$('#save-track').disabled=true;
  try{const result=await api(`/api/jobs/${activeJob}/tracks/${instrument}/${difficulty}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({notes:notes().map(n=>({time:n.time,duration:n.duration||0,lanes:n.lanes}))})});tracks()[instrument][difficulty]=result.notes;originalNotes=structuredClone(result.notes);dirty=false;$('#track-edit-status').textContent='Saved. Your download includes these changes.';refreshDownload();matrix();drawPreview();toast(`${instrument} · ${difficulty} saved`);return true;}catch(e){toast(e.message);return false;}finally{$('#save-track').disabled=false;}
}
$('#save-track').addEventListener('click',saveTrack);
$('#reset-track').addEventListener('click',()=>{tracks()[instrument][difficulty]=structuredClone(originalNotes);dirty=false;$('#track-edit-status').textContent='Restored the last saved chart.';matrix();drawPreview();});
function lyricRow(stamp,text){
  const row=document.createElement('div');row.className='lyric-row';const time=document.createElement('input');time.value=stamp;time.placeholder='00:00.00';time.setAttribute('aria-label','Lyric timestamp');
  const words=document.createElement('input');words.value=text;words.placeholder='Your lyric';words.setAttribute('aria-label','Lyric text');
  const remove=document.createElement('button');remove.textContent='×';remove.setAttribute('aria-label','Remove lyric line');remove.addEventListener('click',()=>row.remove());row.append(time,words,remove);$('#lyric-rows').append(row);return row;
}
function renderLyrics(text){$('#lyric-rows').replaceChildren();for(const line of text.split('\n')){const match=line.match(/^\[([^\]]+)\](.*)$/);if(match)lyricRow(match[1],match[2]);}}
$('#add-lyric').addEventListener('click',()=>{const now=$('#audio-player').currentTime||0;const stamp=`${String(Math.floor(now/60)).padStart(2,'0')}:${(now%60).toFixed(2).padStart(5,'0')}`;const row=lyricRow(stamp,'');row.scrollIntoView({block:'nearest'});row.children[1].focus();});
$('#save-lyrics').addEventListener('click',async()=>{
  const text=[...document.querySelectorAll('.lyric-row')].map(row=>`[${row.children[0].value}]${row.children[1].value}`).join('\n');$('#save-lyrics').disabled=true;
  try{const result=await api(`/api/jobs/${activeJob}/lyrics`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});currentResult.lyrics=result.lyrics;$('#lyrics-editor').value=result.lyrics;renderLyrics(result.lyrics);$('#lyrics-status').textContent='Edited by you';$('#lyrics-save-message').textContent=result.message;refreshDownload();toast('Lyrics saved');}catch(e){$('#lyrics-save-message').textContent=e.message;toast(e.message);}finally{$('#save-lyrics').disabled=false;}
});
$('#details-form').addEventListener('submit',async e=>{
  e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;
  try{const metadata=await api(`/api/jobs/${activeJob}/metadata`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});currentResult.metadata=metadata;$('#result-title').textContent=metadata.title;$('#result-subtitle').textContent=`${metadata.artist} · ${currentResult.analysis.instruments?'Full band · All four difficulties':'Guitar export'}`;$('#details-message').textContent='Saved to your song folder and download.';refreshDownload();refreshLibrary();toast('Song details saved');}catch(e){$('#details-message').textContent=e.message;}finally{button.disabled=false;}
});
$('#replace-cover').addEventListener('change',async()=>{const input=$('#replace-cover'),file=input.files[0];if(!file)return;const data=new FormData();data.append('cover',file);input.disabled=true;
  try{await api(`/api/jobs/${activeJob}/cover`,{method:'POST',body:data});$('#result-cover').src=`/api/jobs/${activeJob}/files/album.png?v=${Date.now()}`;$('#art-source').textContent='Artwork: Uploaded cover';refreshDownload();toast('Cover updated');}catch(e){toast(e.message);}finally{input.disabled=false;input.value='';}
});
$('#upgrade-button').addEventListener('click',async()=>{const button=$('#upgrade-button');button.disabled=true;try{await api(`/api/jobs/${activeJob}/upgrade`,{method:'POST'});showQueue();refreshQueue();toast('Full-band upgrade added to your queue');}catch(e){error(e.message);}finally{button.disabled=false;}});

async function refreshLibrary(){
  try{const songs=await api('/api/jobs');$('#history-count').textContent=songs.length;$('#library-list').replaceChildren();
    if(!songs.length){const p=document.createElement('p');p.className='secondary';p.textContent='Your finished songs will be here. Create your first song to get started.';$('#library-list').append(p);}
    for(const song of songs){const button=document.createElement('button');button.className='library-entry';const img=document.createElement('img');img.src=`/api/jobs/${song.id}/files/album.png`;img.alt='';const info=document.createElement('span');info.className='library-info';info.textContent=song.title;const artist=document.createElement('small');artist.textContent=`${song.artist} · ${song.full_band?'Full band':'Guitar only'}`;info.append(artist);const arrow=document.createElement('span');arrow.className='library-arrow';arrow.textContent='↗';button.append(img,info,arrow);button.addEventListener('click',async()=>{if(dirty && !await saveTrack())return;$('#library-dialog').close();$('#audio-player').pause();error('');try{await showResult(song.id);}catch(e){error(e.message);}});$('#library-list').append(button);}
  }catch(e){toast(e.message);}
}
$('#drums-help-button').addEventListener('click',async()=>{
  $('#drums-dialog').showModal();$('#drums-check-status').classList.remove('verified');$('#drums-check-status').textContent='Checking the exported drum track…';$('#drums-download').hidden=true;
  try{const check=await api(`/api/jobs/${activeJob}/drums-check`);$('#drums-check-status').textContent=check.message+(check.ready?' '+levels.map(level=>`${level}: ${check.counts[level]} hits`).join(' · '):'');$('#drums-check-status').classList.toggle('verified',check.ready);$('#drums-download').hidden=!check.ready;}catch(e){$('#drums-check-status').textContent=e.message;}
});
$('#close-drums').addEventListener('click',()=>$('#drums-dialog').close());
$('#library-button').addEventListener('click',()=>{refreshLibrary();$('#library-dialog').showModal();});
$('#close-library').addEventListener('click',()=>$('#library-dialog').close());
$('#new-song').addEventListener('click',async()=>{if(dirty && !await saveTrack())return;setNav('new-song');$('#queue-panel').hidden=true;localStorage.setItem('autochart-view','create');$('#audio-player').pause();$('#result-panel').hidden=true;$('#intro').hidden=false;$('#create-view').hidden=false;error('');window.scrollTo({top:0,behavior:'smooth'});});
$('#download-button').addEventListener('click',async e=>{if(dirty){e.preventDefault();if(await saveTrack())window.location.href=$('#download-button').href;}});
window.addEventListener('beforeunload',e=>{if(dirty||uploadsInFlight||uploadTasks.length){e.preventDefault();e.returnValue='';}});
async function init(){
  try{const health=await api('/api/health');outputRoot=health.output;if(!health.ffmpeg)error('Install FFmpeg with “brew install ffmpeg”, then restart Backstage.');refreshLibrary();if(localStorage.getItem('autochart-view')==='queue')showQueue();refreshQueue();}
  catch{error('Start Backstage on your computer, then refresh this page.');}
}
init();

let chartSearchPage = 0, chartSearchKey = '', chartSearchRequest = 0;
async function searchCharts(more = false) {
  const query = $('#chart-search-query').value.trim();
  if (query.length < 2) {$('#chart-search-status').textContent = 'Enter an artist or song title.';return;}
  const instrument = $('#chart-search-instrument').value, difficulty = $('#chart-search-difficulty').value;
  const key = JSON.stringify([query, instrument, difficulty]);
  if (key !== chartSearchKey) more = false;
  const page = more ? chartSearchPage + 1 : 1, request = ++chartSearchRequest;
  $('#chart-search-status').textContent = 'Searching Chorus Encore…';
  $('#chart-search-button').disabled = true;$('#chart-search-more').disabled = true;
  if (!more) {$('#chart-search-results').replaceChildren();$('#chart-search-more').hidden = true;}
  try {
    const data = await api('/api/charts/search?' + new URLSearchParams({q:query, instrument, difficulty, page}));
    if (request !== chartSearchRequest) return;
    chartSearchPage = page;chartSearchKey = key;
    for (const result of data.results) {
      if ([...$('#chart-search-results').children].some(row => row.dataset.chart === result.id)) continue;
      const row = document.createElement('article');row.className = 'chart-search-result';row.dataset.chart = result.id;
      if (result.thumbnail) {const art = document.createElement('img');art.src = result.thumbnail;art.alt = '';art.loading = 'lazy';art.onerror = () => art.hidden = true;row.append(art);}
      const info = document.createElement('div');info.className = 'chart-info';
      const title = document.createElement('h3');title.textContent = result.title;
      const description = document.createElement('p');description.textContent = `${result.artist} · Chart by ${result.charter}`;
      const tracks = document.createElement('div');tracks.className = 'chart-tracks';
      for (const [part, levels] of Object.entries(result.tracks)) {const badge = document.createElement('span');badge.textContent = `${part[0].toUpperCase()+part.slice(1)} · ${levels.map(level => level[0].toUpperCase()+level.slice(1)).join(', ')}`;tracks.append(badge);}
      if (!tracks.children.length) {const unknown = document.createElement('p');unknown.textContent = 'Track details unavailable — check the chart page.';tracks.append(unknown);}
      info.append(title, description, tracks);row.append(info);
      const open = document.createElement('a');open.className = 'secondary-button';open.textContent = 'Get chart ↗';open.href = result.url;open.target = '_blank';open.rel = 'noopener noreferrer';open.setAttribute('aria-label', `Get ${result.title} chart by ${result.charter} on Chorus Encore`);row.append(open);
      $('#chart-search-results').append(row);
    }
    const count = $('#chart-search-results').children.length;
    $('#chart-search-status').textContent = count ? `${count} ${count === 1 ? 'chart' : 'charts'} shown · Choose a version, then download it on Chorus Encore.` : 'No matching charts. Try another difficulty, or use YouTube to generate one.';
    $('#chart-search-more').hidden = !data.has_more;
  } catch (e) {if (request === chartSearchRequest) $('#chart-search-status').textContent = e.message;}
  finally {if (request === chartSearchRequest) {$('#chart-search-button').disabled = false;$('#chart-search-more').disabled = false;}}
}
$('#chart-search-button').addEventListener('click', () => searchCharts());
$('#chart-search-more').addEventListener('click', () => searchCharts(true));
$('#chart-search-query').addEventListener('keydown', e => {if(e.key === 'Enter'){e.preventDefault();searchCharts();}});
for (const selector of ['#chart-search-instrument', '#chart-search-difficulty']) $(selector).addEventListener('change', () => {if ($('#chart-search-query').value.trim().length >= 2) searchCharts();});

async function refreshSharedLibrary(){
  const status=document.querySelector('#backstage-library-status');
  try{const library=await api('/api/library');status.textContent=`${library.songs.length} installed songs · ${library.path}`;}
  catch(e){status.textContent=e.message;}
}
refreshSharedLibrary();
