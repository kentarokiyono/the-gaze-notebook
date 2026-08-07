const DB_NAME='TheGazeDB',DB_VERSION=1,NOTES_STORE='notes';
const LS_KEY='gaze_notes_ls';
let __backend=null;
function idbOpen(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);
  r.onerror=()=>rej(r.error||new Error('idb error'));
  r.onsuccess=()=>res(r.result);
  r.onupgradeneeded=(e)=>{const db=e.target.result;if(!db.objectStoreNames.contains(NOTES_STORE)){const s=db.createObjectStore(NOTES_STORE,{keyPath:'id'});s.createIndex('updatedAt','updatedAt',{unique:false});}};});}
async function detectBackend(){if(__backend)return __backend;
  try{
    if(typeof indexedDB==='undefined')throw new Error('no indexedDB');
    const db=await idbOpen();db.close();__backend='idb';
  }catch(e){__backend='ls';}
  return __backend;}
function lsReadAll(){try{const o=JSON.parse(localStorage.getItem(LS_KEY)||'{}');return(o&&typeof o==='object')?o:{};}catch(e){return{};}}
function lsWriteAll(o){try{localStorage.setItem(LS_KEY,JSON.stringify(o));}catch(e){}}
function idbPut(note){return new Promise((res,rej)=>{idbOpen().then(db=>{const tx=db.transaction(NOTES_STORE,'readwrite');const r=tx.objectStore(NOTES_STORE).put(note);
  r.onsuccess=()=>{db.close();res(note);};r.onerror=()=>{db.close();rej(r.error);};}).catch(rej);});}
function idbDelete(id){return new Promise((res,rej)=>{idbOpen().then(db=>{const tx=db.transaction(NOTES_STORE,'readwrite');const r=tx.objectStore(NOTES_STORE).delete(id);
  r.onsuccess=()=>{db.close();res();};r.onerror=()=>{db.close();rej(r.error);};}).catch(rej);});}
function idbGetAll(){return new Promise((res,rej)=>{idbOpen().then(db=>{const r=db.transaction(NOTES_STORE,'readonly').objectStore(NOTES_STORE).getAll();
  r.onsuccess=()=>{db.close();const n=r.result||[];n.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));res(n);};r.onerror=()=>{db.close();rej(r.error);};}).catch(rej);});}
function idbGet(id){return new Promise((res,rej)=>{idbOpen().then(db=>{const r=db.transaction(NOTES_STORE,'readonly').objectStore(NOTES_STORE).get(id);
  r.onsuccess=()=>{db.close();res(r.result);};r.onerror=()=>{db.close();rej(r.error);};}).catch(rej);});}
class TheGazeDB{
  static async addNote(note){const b=await detectBackend();
    if(b==='idb')return idbPut(note);
    const all=lsReadAll();all[note.id]=note;lsWriteAll(all);return note;}
  static async deleteNote(id){const b=await detectBackend();
    if(b==='idb')return idbDelete(id);
    const all=lsReadAll();delete all[id];lsWriteAll(all);}
  static async getAllNotes(){const b=await detectBackend();
    if(b==='idb')return idbGetAll();
    const arr=Object.values(lsReadAll());arr.sort((a,c)=>(c.updatedAt||0)-(a.updatedAt||0));return arr;}
  static async getNote(id){const b=await detectBackend();
    if(b==='idb')return idbGet(id);
    return lsReadAll()[id]||null;}
}
const state={currentNote:null,saveTimeout:null,isSaving:false,wikilinkActive:false,searchQuery:'',activeTag:null,previewTimeout:null,backlinksOpen:true,aiSuggestions:[]};
let editorMode='edit',currentView='library';
const expandedIds=new Set(JSON.parse(localStorage.getItem('gaze_expanded')||'[]'));
function saveExpanded(){localStorage.setItem('gaze_expanded',JSON.stringify([...expandedIds]));}
function escapeHtml(t){if(!t)return'';const d=document.createElement('div');d.textContent=t;return d.innerHTML;}
function escapeAttr(s){return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function escapeRegExp(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function newId(){return'note_'+Date.now()+'_'+Math.random().toString(36).substring(2,7);}
function formatCharCount(n){if(n>=10000)return(n/10000).toFixed(1)+'万';if(n>=1000)return(n/1000).toFixed(1)+'k';return String(n);}
function formatDate(ts){if(!ts)return'';const diff=Date.now()-new Date(ts);
  if(diff<60000)return'たった今';if(diff<3600000)return Math.floor(diff/60000)+'分前';
  if(diff<86400000)return Math.floor(diff/3600000)+'時間前';if(diff<604800000)return Math.floor(diff/86400000)+'日前';
  return new Date(ts).toLocaleDateString('ja-JP',{month:'short',day:'numeric'});}
function truncateText(t,m=60){if(!t)return'';const c=t.replace(/\n+/g,' ').trim();return c.length>m?c.substring(0,m)+'...':c;}
function setSaveStatus(s){const el=document.getElementById('save-status');if(el)el.textContent=s;}
function showToast(message,type='success'){document.querySelectorAll('.gaze-toast').forEach(t=>t.remove());
  const toast=document.createElement('div');
  toast.className='gaze-toast fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-2xl z-[70] fade-in transition-all duration-300 border-l-4 '+(type==='error'?'bg-red-600/95 border border-red-500 border-l-red-200':'bg-slate-800/95 border border-slate-700 border-l-blue-400');
  toast.innerHTML='<span class="text-sm font-medium text-white">'+escapeHtml(message)+'</span>';
  document.body.appendChild(toast);setTimeout(()=>{toast.style.opacity='0';toast.style.transform='translateY(10px)';setTimeout(()=>toast.remove(),300);},3000);}
function extractTags(text){const tags=new Set();if(!text)return[];const re=/(?:^|\s)#([^\s#]+)/g;let m;
  while((m=re.exec(text))!==null){let tag=m[1].replace(/[.,!?;:、。()（）\[\]{}]+$/,'');if(tag.length>0&&!/^\d+$/.test(tag))tags.add(tag);}return[...tags];}
function setView(name){
  currentView=name;
  document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden'));
  const v=document.getElementById('view-'+name);if(v)v.classList.remove('hidden');
  document.querySelectorAll('.activity-btn[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  if(name==='graph')requestAnimationFrame(()=>initGraph());
  if(name==='library'){renderTree();renderDashboard();}
  if(name==='editor'){renderBreadcrumb();renderSubpages();}
}
function treeNodeHTML(n,depth,byParent){
  const kids=byParent[n.id]||[],hasKids=kids.length>0,expanded=expandedIds.has(n.id);
  const active=state.currentNote&&state.currentNote.id===n.id?'active':'';
  let html='<div class="tree-node '+active+'" data-id="'+n.id+'" style="padding-left:'+(8+depth*14)+'px">'
    +'<button class="tree-caret" data-caret="'+n.id+'" '+(hasKids?'':'style="visibility:hidden"')+'><i data-lucide="'+(expanded?'chevron-down':'chevron-right')+'" class="w-3 h-3"></i></button>'
    +'<i data-lucide="'+(n.pinned?'pin':'file-text')+'" class="w-3.5 h-3.5 tree-icon"></i>'
    +'<span class="tree-title truncate">'+escapeHtml(n.title||'Untitled')+'</span>'
    +'<button class="tree-add-child" data-addchild="'+n.id+'" title="サブページを追加"><i data-lucide="plus" class="w-3 h-3"></i></button></div>';
  if(hasKids&&expanded)for(const k of kids)html+=treeNodeHTML(k,depth+1,byParent);
  return html;
}
async function renderTree(){
  const all=await TheGazeDB.getAllNotes();
  const container=document.getElementById('page-tree');
  let list=all;
  if(state.activeTag)list=list.filter(n=>extractTags((n.title||'')+' '+(n.content||'')).includes(state.activeTag));
  const q=state.searchQuery.toLowerCase();
  if(q)list=list.filter(n=>(n.title||'').toLowerCase().includes(q)||(n.content||'').toLowerCase().includes(q));
  const filtering=q||state.activeTag;
  if(list.length===0){container.innerHTML='<p class="text-xs text-slate-600 text-center py-6">ページがありません</p>';return;}
  if(filtering){
    container.innerHTML=list.map(n=>'<div class="tree-node" data-id="'+n.id+'" style="padding-left:8px"><i data-lucide="file-text" class="w-3.5 h-3.5 tree-icon"></i><span class="tree-title truncate">'+escapeHtml(n.title||'Untitled')+'</span></div>').join('');
  }else{
    const byParent={},roots=[],ids=new Set(all.map(n=>n.id));
    const sortFn=(a,b)=>((b.pinned?1:0)-(a.pinned?1:0))||((b.updatedAt||0)-(a.updatedAt||0));
    for(const n of all){if(n.parentId&&ids.has(n.parentId))(byParent[n.parentId]||=[]).push(n);else roots.push(n);}
    roots.sort(sortFn);Object.values(byParent).forEach(a=>a.sort(sortFn));
    container.innerHTML=roots.map(n=>treeNodeHTML(n,0,byParent)).join('');
  }
  lucide.createIcons();
  container.querySelectorAll('.tree-node').forEach(nd=>{
    nd.addEventListener('click',(e)=>{if(e.target.closest('.tree-caret')||e.target.closest('.tree-add-child'))return;openNoteById(nd.dataset.id);});});
  container.querySelectorAll('.tree-caret').forEach(c=>c.addEventListener('click',(e)=>{
    e.stopPropagation();const id=c.dataset.caret;
    if(expandedIds.has(id))expandedIds.delete(id);else expandedIds.add(id);
    saveExpanded();renderTree();}));
  container.querySelectorAll('.tree-add-child').forEach(b=>b.addEventListener('click',(e)=>{
    e.stopPropagation();createChildNote(b.dataset.addchild);}));
}
async function renderDashboard(){
  const notes=await TheGazeDB.getAllNotes();
  let totalChars=0,totalLinks=0,richSum=0,richCount=0;
  notes.forEach(n=>{totalChars+=(n.content||'').length;const m=(n.content||'').match(/\[\[[^\]]+\]\]/g);if(m)totalLinks+=m.length;if(n.richness){richSum+=n.richness.score;richCount++;}});
  document.getElementById('stat-notes').textContent=notes.length;
  document.getElementById('stat-total-chars').textContent=formatCharCount(totalChars);
  document.getElementById('stat-total-links').textContent=totalLinks;
  document.getElementById('stat-avg-rich').textContent=richCount?Math.round(richSum/richCount):'—';
  const counts={};notes.forEach(n=>extractTags((n.title||'')+' '+(n.content||'')).forEach(t=>counts[t]=(counts[t]||0)+1));
  const tags=Object.keys(counts).sort((a,b)=>counts[b]-counts[a]).slice(0,20);
  const tagEl=document.getElementById('dash-tags');
  tagEl.innerHTML=tags.length?tags.map(t=>'<button class="tag-chip '+(state.activeTag===t?'active':'')+'" data-tag="'+escapeAttr(t)+'">#'+escapeHtml(t)+' <span class="opacity-50">'+counts[t]+'</span></button>').join(''):'<p class="text-xs text-slate-600">タグがありません</p>';
  tagEl.querySelectorAll('.tag-chip').forEach(c=>c.addEventListener('click',()=>{state.activeTag=state.activeTag===c.dataset.tag?null:c.dataset.tag;renderTree();renderDashboard();}));
  const recent=notes.slice().sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,8);
  const rel=document.getElementById('recent-list');
  rel.innerHTML=recent.length?recent.map(n=>'<button class="recent-item" data-id="'+n.id+'"><i data-lucide="file-text" class="w-3.5 h-3.5 text-slate-500 flex-shrink-0"></i><span class="truncate flex-1 text-left text-sm text-slate-300">'+escapeHtml(n.title||'Untitled')+'</span><span class="text-[10px] text-slate-600 flex-shrink-0">'+formatDate(n.updatedAt)+'</span></button>').join('')
    :'<p class="text-xs text-slate-600">まだノートがありません。</p>';
  lucide.createIcons();
  rel.querySelectorAll('.recent-item').forEach(b=>b.addEventListener('click',()=>openNoteById(b.dataset.id)));
  refreshGrowth();
}
async function renderNotesList(){await renderTree();await renderDashboard();}
async function openNoteById(id){await loadNote(id);setView('editor');}
async function createNote(){const note={id:newId(),title:'',content:'',parentId:null,createdAt:Date.now(),updatedAt:Date.now()};
  await TheGazeDB.addNote(note);await renderTree();openNoteById(note.id);showToast('新しいノートを作成しました','success');
  setTimeout(()=>document.getElementById('note-title').focus(),100);refreshGrowth();}
async function createChildNote(parentId){const note={id:newId(),title:'',content:'',parentId,createdAt:Date.now(),updatedAt:Date.now()};
  await TheGazeDB.addNote(note);expandedIds.add(parentId);saveExpanded();await renderTree();openNoteById(note.id);
  setTimeout(()=>document.getElementById('note-title').focus(),100);refreshGrowth();}
async function loadNote(id){try{const note=await TheGazeDB.getNote(id);
  if(!note){showToast('ノートが見つかりません','error');return;}
  state.currentNote=note;
  document.getElementById('note-title').value=note.title||'';
  document.getElementById('note-content').value=note.content||'';
  updateStats();updatePinButton();setSaveStatus('読み込み完了');
  state.aiSuggestions=[];renderAiSuggestions();
  await renderTree();renderBreadcrumb();renderSubpages();updateBacklinks();renderRelatedPanel();
  if(editorMode!=='edit')renderPreview();
}catch(e){showToast('ノートの読み込みに失敗しました','error');console.error(e);}}
async function saveNote(){if(!state.currentNote||state.isSaving)return;
  state.isSaving=true;setSaveStatus('保存中...');
  state.currentNote.title=document.getElementById('note-title').value;
  state.currentNote.content=document.getElementById('note-content').value;
  state.currentNote.updatedAt=Date.now();
  try{await TheGazeDB.addNote(state.currentNote);await renderTree();renderBreadcrumb();updateBacklinks();renderRelatedPanel();
    setSaveStatus('保存完了');setTimeout(()=>setSaveStatus('準備完了'),2000);refreshGrowth();}
  catch(e){showToast('保存に失敗しました','error');setSaveStatus('保存失敗');console.error(e);}
  finally{state.isSaving=false;}}
function scheduleSave(){setSaveStatus('編集中...');clearTimeout(state.saveTimeout);state.saveTimeout=setTimeout(()=>{saveNote();},800);}
async function deleteNote(id){const note=await TheGazeDB.getNote(id);if(!confirm('「'+(note?note.title:'Untitled')+'」を削除しますか？'))return;
  try{await TheGazeDB.deleteNote(id);
    if(state.currentNote&&state.currentNote.id===id){state.currentNote=null;setView('library');}
    await renderTree();renderDashboard();showToast('ノートを削除しました','success');refreshGrowth();
  }catch(e){showToast('削除に失敗しました','error');console.error(e);}}
async function togglePin(id){const note=await TheGazeDB.getNote(id);if(!note)return;
  note.pinned=!note.pinned;note.updatedAt=Date.now();await TheGazeDB.addNote(note);
  if(state.currentNote&&state.currentNote.id===id){state.currentNote=note;updatePinButton();}await renderTree();}
function updatePinButton(){const btn=document.getElementById('pin-current-btn');if(btn)btn.classList.toggle('active',!!(state.currentNote&&state.currentNote.pinned));}
function updateStats(){const content=document.getElementById('note-content').value;const chars=content.length;
  const words=content.trim()?content.trim().split(/\s+/).length:0;
  document.getElementById('stat-chars').textContent=chars.toLocaleString();
  document.getElementById('stat-words').textContent=words.toLocaleString();
  document.getElementById('stat-read').textContent=chars>0?Math.max(1,Math.ceil(chars/500))+'分':'—';
  document.getElementById('stat-links').textContent=(content.match(/\[\[[^\]]+\]\]/g)||[]).length;}
async function renderBreadcrumb(){const bc=document.getElementById('breadcrumb');if(!state.currentNote){bc.innerHTML='';return;}
  const notes=await TheGazeDB.getAllNotes();const map={};notes.forEach(n=>map[n.id]=n);
  const chain=[];let cur=state.currentNote,guard=0;
  while(cur&&guard<20){chain.unshift(cur);cur=cur.parentId?map[cur.parentId]:null;guard++;}
  bc.innerHTML=chain.map((n,i)=>'<span class="flex items-center gap-1 min-w-0">'+(i>0?'<i data-lucide="chevron-right" class="w-3 h-3 text-slate-600 flex-shrink-0"></i>':'')
    +'<button class="crumb truncate '+(n.id===state.currentNote.id?'text-slate-200':'text-slate-500 hover:text-slate-300')+'" data-id="'+n.id+'">'+escapeHtml(n.title||'Untitled')+'</button></span>').join('');
  lucide.createIcons();
  bc.querySelectorAll('.crumb').forEach(b=>b.addEventListener('click',()=>openNoteById(b.dataset.id)));}
async function renderSubpages(){
  const editEl=document.getElementById('inline-subpages');
  const prevEl=document.getElementById('inline-subpages-preview');
  if(!state.currentNote){if(editEl)editEl.innerHTML='';if(prevEl)prevEl.innerHTML='';return;}
  const notes=await TheGazeDB.getAllNotes();
  const kids=notes.filter(n=>n.parentId===state.currentNote.id).sort((a,b)=>(a.title||'').localeCompare(b.title||'','ja'));
  let html='<div class="pt-5 mt-2 border-t border-gaze-border/60">';
  if(kids.length)html+='<p class="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2" style="letter-spacing:.06em;">Subpages</p>';
  html+=kids.map(k=>'<button class="subpage-row" data-id="'+k.id+'"><i data-lucide="file-text" class="w-4 h-4 text-slate-500 flex-shrink-0"></i><span class="subpage-title">'+escapeHtml(k.title||'Untitled')+'</span><i data-lucide="chevron-right" class="w-3.5 h-3.5 text-slate-600 ml-auto flex-shrink-0"></i></button>').join('');
  html+='<button class="subpage-row subpage-add"><i data-lucide="plus" class="w-4 h-4 text-slate-500 flex-shrink-0"></i><span class="text-sm text-slate-500">新規ページ</span></button>';
  html+='</div>';
  [editEl,prevEl].forEach(el=>{if(!el)return;el.innerHTML=html;lucide.createIcons();
    el.querySelectorAll('.subpage-row[data-id]').forEach(b=>b.addEventListener('click',()=>openNoteById(b.dataset.id)));
    el.querySelectorAll('.subpage-add').forEach(b=>b.addEventListener('click',()=>createChildNote(state.currentNote.id)));});
}
function openMoveModal(){if(!state.currentNote){showToast('ノートを開いてください','error');return;}buildMoveList();document.getElementById('move-overlay').classList.remove('hidden');}
async function buildMoveList(){const notes=await TheGazeDB.getAllNotes();const cur=state.currentNote;
  const exclude=new Set([cur.id]);let changed=true;
  while(changed){changed=false;for(const n of notes){if(n.parentId&&exclude.has(n.parentId)&&!exclude.has(n.id)){exclude.add(n.id);changed=true;}}}
  const candidates=notes.filter(n=>!exclude.has(n.id)).sort((a,b)=>(a.title||'').localeCompare(b.title||'','ja'));
  const el=document.getElementById('move-list');
  el.innerHTML='<button class="move-item" data-parent=""><i data-lucide="home" class="w-3.5 h-3.5 text-slate-500"></i>ルート（最上位）</button>'+
    candidates.map(n=>'<button class="move-item" data-parent="'+n.id+'"><i data-lucide="file-text" class="w-3.5 h-3.5 text-slate-500"></i><span class="truncate">'+escapeHtml(n.title||'Untitled')+'</span></button>').join('');
  lucide.createIcons();
  el.querySelectorAll('.move-item').forEach(b=>b.addEventListener('click',async()=>{
    cur.parentId=b.dataset.parent||null;cur.updatedAt=Date.now();await TheGazeDB.addNote(cur);
    document.getElementById('move-overlay').classList.add('hidden');
    await renderTree();renderBreadcrumb();showToast('ノートを移動しました','success');}));}
function handleEditorInput(e){const ta=e.target,value=ta.value,pos=ta.selectionStart;
  const before=value.substring(0,pos);const match=before.match(/\[\[([^\[\]\n]*)$/);
  if(match){state.wikilinkActive=true;showWikilinkSuggestions(match[1],ta);}else hideWikilinkModal();
  updateStats();schedulePreview();}
async function showWikilinkSuggestions(query,ta){const modal=document.getElementById('wikilink-modal'),container=document.getElementById('wikilink-suggestions');
  let notes=[];try{notes=await TheGazeDB.getAllNotes();}catch(e){return;}
  const filtered=notes.filter(n=>n.title&&n.title.toLowerCase().includes(query.toLowerCase())&&n.id!==state.currentNote.id).slice(0,8);
  if(filtered.length===0){hideWikilinkModal();return;}
  const rect=ta.getBoundingClientRect();const before=ta.value.substring(0,ta.selectionStart);const lines=before.split('\n');
  const top=rect.top+((lines.length-1)*24)-ta.scrollTop+30;const left=Math.min(rect.left+(lines[lines.length-1].length*9),rect.right-288);
  modal.style.left=Math.max(rect.left,left)+'px';modal.style.top=Math.min(top,window.innerHeight-300)+'px';modal.classList.remove('hidden');
  container.innerHTML=filtered.map(n=>'<div class="wikilink-suggestion" data-note-id="'+n.id+'"><div class="text-sm text-slate-200 truncate">'+escapeHtml(n.title)+'</div></div>').join('');
  container.querySelectorAll('.wikilink-suggestion').forEach(el=>el.addEventListener('click',async()=>{const s=await TheGazeDB.getNote(el.dataset.noteId);if(s&&s.title)insertWikilink(s.title,ta);}));}
function hideWikilinkModal(){state.wikilinkActive=false;document.getElementById('wikilink-modal').classList.add('hidden');}
function insertWikilink(title,ta){const pos=ta.selectionStart,value=ta.value,before=value.substring(0,pos);
  const match=before.match(/\[\[([^\[\]\n]*)$/);
  if(match){const start=pos-match[1].length-2;const ins='[['+title+']]';ta.value=value.substring(0,start)+ins+value.substring(pos);
    ta.selectionStart=ta.selectionEnd=start+ins.length;ta.focus();scheduleSave();}
  hideWikilinkModal();}
function applyMd(action){const ta=document.getElementById('note-content');const s=ta.selectionStart,e=ta.selectionEnd,sel=ta.value.substring(s,e);
  const wrapSel=(pre,suf)=>{ta.setRangeText(pre+sel+suf,s,e,'end');if(s===e){ta.selectionStart=ta.selectionEnd=s+pre.length;}else{ta.selectionStart=s+pre.length;ta.selectionEnd=s+pre.length+sel.length;}};
  const linePrefix=(prefix)=>{const val=ta.value;const ls=val.lastIndexOf('\n',s-1)+1;let le=val.indexOf('\n',e);if(le===-1)le=val.length;
    const lines=val.substring(ls,le).split('\n');const stripRe=/^(#{1,6}\s+|>\s+|- \[[ x]\]\s+|- |\d+\.\s+)/;
    const allHave=lines.every(l=>l.startsWith(prefix));
    ta.setRangeText(lines.map(l=>allHave?l.slice(prefix.length):prefix+l.replace(stripRe,'')).join('\n'),ls,le,'select');};
  const insertText=(text,offset)=>{ta.setRangeText(text,s,e,'end');ta.selectionStart=ta.selectionEnd=s+text.length+(offset||0);};
  if(action==='bold')wrapSel('**','**');else if(action==='italic')wrapSel('*','*');else if(action==='strike')wrapSel('~~','~~');
  else if(action==='code')wrapSel('\u0060','\u0060');else if(action==='h1')linePrefix('# ');else if(action==='h2')linePrefix('## ');
  else if(action==='ul')linePrefix('- ');else if(action==='ol')linePrefix('1. ');else if(action==='task')linePrefix('- [ ] ');else if(action==='quote')linePrefix('> ');
  else if(action==='link'){if(sel){ta.setRangeText('['+sel+'](url)',s,e,'end');ta.selectionStart=s+sel.length+3;ta.selectionEnd=s+sel.length+6;}
    else{ta.setRangeText('[テキスト](url)',s,e,'end');ta.selectionStart=s+1;ta.selectionEnd=s+5;}}
  else if(action==='wikilink')insertText('[[',0);else if(action==='hr')insertText('\n---\n',0);
  ta.focus();scheduleSave();handleEditorInput({target:ta});}
function buildOutline(){const val=document.getElementById('note-content').value;const items=[];let pos=0;
  for(const line of val.split('\n')){const m=line.match(/^(#{1,3})\s+(.+)/);if(m)items.push({level:m[1].length,text:m[2].trim(),pos});pos+=line.length+1;}return items;}
function jumpToPos(pos){const ta=document.getElementById('note-content');ta.focus();ta.selectionStart=ta.selectionEnd=pos;
  const lineIdx=ta.value.substring(0,pos).split('\n').length-1;const lh=parseFloat(getComputedStyle(ta).lineHeight)||24;
  ta.scrollTop=Math.max(0,lineIdx*lh-ta.clientHeight/3);}
function toggleOutlineMenu(){const menu=document.getElementById('outline-menu');
  if(!menu.classList.contains('hidden')){menu.classList.add('hidden');return;}
  const items=buildOutline();
  menu.innerHTML=items.length===0?'<p class="text-xs text-slate-500 px-3 py-2">見出しがありません</p>':items.map(it=>'<button class="outline-item" data-pos="'+it.pos+'"><span style="opacity:'+(1-(it.level-1)*0.25)+'">'+escapeHtml(it.text)+'</span></button>').join('');
  menu.classList.remove('hidden');
  menu.querySelectorAll('.outline-item').forEach(b=>b.addEventListener('click',()=>{jumpToPos(parseInt(b.dataset.pos));menu.classList.add('hidden');}));}
function wikilinkify(text){return text.replace(/\[\[([^\[\]]+)\]\]/g,(m,name)=>'<a href="#" class="wikilink" data-wikilink="'+escapeAttr(name)+'">'+escapeHtml(name)+'</a>');}
function renderPreview(){const title=document.getElementById('note-title').value,content=document.getElementById('note-content').value;
  const full=(title?'# '+title+'\n\n':'')+content;const el=document.getElementById('preview-content');
  try{el.innerHTML=marked.parse(wikilinkify(full));}catch(e){el.textContent=full;}
  el.querySelectorAll('a.wikilink').forEach(a=>a.addEventListener('click',(e)=>{e.preventDefault();openNoteByTitle(a.dataset.wikilink);}));}
function schedulePreview(){if(editorMode==='edit')return;clearTimeout(state.previewTimeout);state.previewTimeout=setTimeout(renderPreview,250);}
function setEditorMode(mode){editorMode=mode;const edit=document.getElementById('edit-pane'),prev=document.getElementById('preview-pane');
  if(mode==='edit'){edit.classList.remove('hidden');prev.classList.add('hidden');}
  else if(mode==='preview'){edit.classList.add('hidden');prev.classList.remove('hidden');renderPreview();}
  else{edit.classList.remove('hidden');prev.classList.remove('hidden');renderPreview();}
  prev.classList.toggle('border-l',mode==='split');
  document.querySelectorAll('.mode-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));}
async function openNoteByTitle(title){const notes=await TheGazeDB.getAllNotes();
  const found=notes.find(n=>(n.title||'').toLowerCase()===title.toLowerCase());
  if(found){openNoteById(found.id);return;}
  if(confirm('「'+title+'」はまだ存在しません。作成しますか？')){const note={id:newId(),title,content:'',parentId:null,createdAt:Date.now(),updatedAt:Date.now()};
    await TheGazeDB.addNote(note);await renderTree();openNoteById(note.id);refreshGrowth();}}
async function updateBacklinks(){const panel=document.getElementById('backlinks-panel'),listEl=document.getElementById('backlinks-list');
  if(!state.currentNote||!state.currentNote.title){panel.classList.add('hidden');return;}
  const title=state.currentNote.title;const notes=await TheGazeDB.getAllNotes();
  const re=new RegExp('\\[\\['+escapeRegExp(title)+'\\]\\]','i');
  const backs=notes.filter(n=>n.id!==state.currentNote.id&&n.content&&re.test(n.content));
  if(backs.length===0){panel.classList.add('hidden');return;}
  panel.classList.remove('hidden');document.getElementById('backlinks-count').textContent=backs.length;
  listEl.innerHTML=backs.map(b=>'<button class="backlink-item" data-id="'+b.id+'"><i data-lucide="corner-up-left" class="w-3 h-3 flex-shrink-0"></i><span class="truncate">'+escapeHtml(b.title||'Untitled')+'</span></button>').join('');
  lucide.createIcons();
  listEl.querySelectorAll('.backlink-item').forEach(el=>el.addEventListener('click',()=>openNoteById(el.dataset.id)));
  listEl.classList.toggle('hidden',!state.backlinksOpen);
  document.getElementById('backlinks-chevron').style.transform=state.backlinksOpen?'rotate(180deg)':'rotate(0deg)';}
const JP_STOP=new Set(['する','した','して','ある','ない','いる','なる','こと','もの','ため','これ','それ','あれ','この','その','どこ','から','まで','より','ます','です','のが','として','について','において','または','および','そして','しかし','だから','つまり','例えば']);
const tokenCache=new Map();
function tokenizeNote(note){const text=(note.title||'')+'\n'+(note.content||'');
  const cleaned=text.replace(new RegExp('\u0060\u0060\u0060[\\s\\S]*?\u0060\u0060\u0060','g'),' ').replace(new RegExp('\u0060[^\u0060]*\u0060','g'),' ');
  const tokens=new Set();
  for(const t of extractTags(cleaned))tokens.add('tag:'+t.toLowerCase());
  const links=cleaned.match(/\[\[([^\]]+)\]\]/g);if(links)for(const l of links)tokens.add('link:'+l.slice(2,-2).trim().toLowerCase());
  const words=cleaned.match(/[A-Za-z0-9_]{3,}/g);if(words)for(const w of words)tokens.add('w:'+w.toLowerCase());
  const cjk=cleaned.match(/[\u3040-\u30ff\u4e00-\u9fff]{2,}/g);
  if(cjk)for(const run of cjk)for(let i=0;i<run.length-1;i++){const bg=run.substr(i,2);if(!JP_STOP.has(bg))tokens.add('g:'+bg);}
  return tokens;}
function getTokenSet(note){const key=note.id+':'+(note.updatedAt||0);if(tokenCache.has(key))return tokenCache.get(key);
  if(tokenCache.size>200)tokenCache.clear();const t=tokenizeNote(note);tokenCache.set(key,t);return t;}
function computeRelated(current,notes){const cur=getTokenSet(current);if(cur.size<3)return[];const out=[];
  for(const n of notes){if(n.id===current.id)continue;if(!(n.title||'').trim()&&!(n.content||'').trim())continue;
    const toks=getTokenSet(n);if(toks.size===0)continue;let shared=0,weight=0;
    const small=cur.size<=toks.size?cur:toks,big=cur.size<=toks.size?toks:cur;
    for(const t of small)if(big.has(t)){shared++;weight+=t.startsWith('tag:')?3:t.startsWith('link:')?4:1;}
    if(shared===0)continue;out.push({note:n,shared,weight,overlap:shared/small.size});}
  out.sort((a,b)=>(b.weight+b.overlap*10)-(a.weight+a.overlap*10));return out.slice(0,6);}
async function renderRelatedPanel(){const panel=document.getElementById('related-panel'),localEl=document.getElementById('related-local');
  if(!state.currentNote||!((state.currentNote.content||'').trim()||(state.currentNote.title||'').trim())){panel.classList.add('hidden');return;}
  const notes=await TheGazeDB.getAllNotes();const related=computeRelated(state.currentNote,notes);
  if(related.length===0)localEl.innerHTML='<span class="text-[11px] text-slate-600">ローカルの類似はまだありません。</span>';
  else{localEl.innerHTML=related.map(r=>'<button class="related-chip" data-id="'+r.note.id+'"><span class="truncate max-w-[150px]">'+escapeHtml(r.note.title||'Untitled')+'</span><span class="related-score">'+Math.min(100,Math.round(r.overlap*100))+'%</span></button>').join('');
    localEl.querySelectorAll('.related-chip').forEach(c=>c.addEventListener('click',()=>openNoteById(c.dataset.id)));}
  renderAiSuggestions();panel.classList.remove('hidden');}
function renderAiSuggestions(){const aiEl=document.getElementById('related-ai');
  if(state.aiSuggestions.length===0){aiEl.innerHTML='';return;}
  aiEl.innerHTML='<p class="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mt-1">AI 仮リンク</p>'+state.aiSuggestions.map((s,i)=>
    '<div class="ai-link-item"><div class="flex-1 min-w-0"><span class="ai-link-title font-medium">'+escapeHtml(s.title)+'</span>'
    +(s.reason?'<p class="text-[11px] text-slate-500 mt-0.5">'+escapeHtml(s.reason)+'</p>':'')+'</div>'
    +'<button class="insert-link-btn text-btn flex-shrink-0" data-i="'+i+'"><i data-lucide="link" class="w-3 h-3"></i>挿入</button>'
    +(s.noteId?'<button class="open-link-btn icon-btn flex-shrink-0" data-i="'+i+'"><i data-lucide="arrow-up-right" class="w-3.5 h-3.5"></i></button>':'')+'</div>').join('');
  lucide.createIcons();
  aiEl.querySelectorAll('.insert-link-btn').forEach(b=>b.addEventListener('click',()=>insertSuggestionLink(state.aiSuggestions[parseInt(b.dataset.i)].title)));
  aiEl.querySelectorAll('.open-link-btn').forEach(b=>b.addEventListener('click',()=>{const s=state.aiSuggestions[parseInt(b.dataset.i)];if(s.noteId)openNoteById(s.noteId);}));}
function insertSuggestionLink(title){const ta=document.getElementById('note-content');const pos=ta.selectionStart||ta.value.length;
  const before=ta.value.substring(0,pos),after=ta.value.substring(pos);
  const pre=(before&&!/\s$/.test(before))?' ':'';const post=(after&&!/^\s/.test(after))?' ':'';
  ta.setRangeText(pre+'[['+title+']]'+post,pos,pos,'end');ta.focus();scheduleSave();showToast('[['+title+']] を挿入しました','success');}
function parseSuggestionResponse(text){if(!text)return null;const m=text.match(/\{[\s\S]*\}/);
  if(m){try{const o=JSON.parse(m[0]);if(Array.isArray(o.links))return o.links.filter(l=>l&&typeof l.index==='number').map(l=>({index:l.index,title:l.title||'',reason:l.reason||''}));}catch(e){}}
  const am=text.match(/\[[\s\S]*\]/);if(am){try{const arr=JSON.parse(am[0]);if(Array.isArray(arr))return arr.filter(l=>l&&typeof l.index==='number').map(l=>({index:l.index,title:l.title||'',reason:l.reason||''}));}catch(e){}}
  return null;}
async function aiSuggestLinks(){if(!state.currentNote){showToast('ノートを開いてください','error');return;}
  const provider=getSelectedProvider(),apiKey=getProviderApiKey(provider),settings=getSettings();
  if(provider!=='ollama'&&!apiKey){showToast(getProviderName(provider)+'のAPIキーが設定されていません','error');openSettings();return;}
  const notes=await TheGazeDB.getAllNotes();
  const candidates=notes.filter(n=>n.id!==state.currentNote.id&&((n.title||'').trim()||(n.content||'').trim()));
  if(candidates.length===0){showToast('比較できる他のノートがありません','error');return;}
  const localIds=new Set(computeRelated(state.currentNote,notes).map(r=>r.note.id));
  const ordered=candidates.slice().sort((a,b)=>{const am=localIds.has(a.id)?0:1,bm=localIds.has(b.id)?0:1;if(am!==bm)return am-bm;return(b.updatedAt||0)-(a.updatedAt||0);}).slice(0,30);
  const listText=ordered.map((n,i)=>(i+1)+'. タイトル: '+(n.title||'(無題)')+'\n   抜粋: '+truncateText((n.content||'').replace(/\n+/g,' '),80)).join('\n');
  const btn=document.getElementById('ai-suggest-links-btn');const orig=btn.innerHTML;
  btn.disabled=true;btn.innerHTML='<span class="thinking-dots"><span></span><span></span><span></span></span>';
  const prompt='あなたは知識ベースの潜在的なつながりを見つけるアシスタントです。現在のノートと概念的に深くつながっているノートを候補から最大3つ選び、理由を添えてください。なければ空配列を返してください。\n必ずJSON形式のみで答えてください:\n{"links":[{"index":候補番号(整数),"title":"ノートのタイトル","reason":"理由(25字以内)"}]}\n\n現在のノート\nタイトル: '+(state.currentNote.title||'(無題)')+'\n本文:\n'+(state.currentNote.content||'').substring(0,4000)+'\n\n候補ノートリスト:\n'+listText;
  try{const resp=await askLLM({provider,apiKey,endpoint:settings.ollamaEndpoint,prompt,context:''});
    const parsed=parseSuggestionResponse(resp);if(!parsed)throw new Error('AIの応答を解析できませんでした');
    state.aiSuggestions=parsed.map(p=>{const n=ordered[p.index-1];return{title:n?n.title:p.title,noteId:n?n.id:null,reason:p.reason||''};}).filter(s=>s.title);
    renderAiSuggestions();if(state.aiSuggestions.length===0)showToast('AIは意味のあるつながりを見つけられませんでした','success');
  }catch(err){showToast('AI提案に失敗: '+err.message,'error');console.error(err);}
  finally{btn.disabled=false;btn.innerHTML=orig;lucide.createIcons();}}
let graphInstance=null;
let showRelated=false;
function hashHue(s){let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;return Math.abs(h)%360;}
function nodeColor(n){if(n.pinned)return'#60a5fa';const tags=extractTags((n.title||'')+' '+(n.content||''));
  if(tags.length)return'hsl('+hashHue(tags[0].toLowerCase())+',60%,60%)';return'#64748b';}
function textSprite(main,sub){if(typeof THREE==='undefined')return null;
  const canvas=document.createElement('canvas');let ctx=canvas.getContext('2d');
  const fontMain='600 28px -apple-system, "Helvetica Neue", Arial, sans-serif';
  const fontSub='400 20px -apple-system, "Helvetica Neue", Arial, sans-serif';
  let m=main||'';if(m.length>16)m=m.substring(0,15)+'…';
  let s=sub||'';if(s.length>16)s=s.substring(0,15)+'…';
  ctx.font=fontMain;const wMain=ctx.measureText(m).width;
  ctx.font=fontSub;const wSub=s?ctx.measureText(s).width:0;
  const w=Math.ceil(Math.max(wMain,wSub))+20;const h=s?70:44;
  canvas.width=w;canvas.height=h;
  ctx=canvas.getContext('2d');ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.shadowColor='rgba(0,0,0,0.85)';ctx.shadowBlur=6;
  if(s){ctx.font=fontSub;ctx.fillStyle='rgba(148,163,184,0.9)';ctx.fillText(s,w/2,18);}
  ctx.font=fontMain;ctx.fillStyle='rgba(235,240,250,0.95)';ctx.fillText(m,w/2,s?48:22);
  const tex=new THREE.CanvasTexture(canvas);tex.minFilter=THREE.LinearFilter;
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false}));
  sp.scale.set(w/16,h/16,1);return sp;}
function makeNodeObject(node){const group=new THREE.Group();
  const r=2+Math.cbrt(node.val)*1.6;
  group.add(new THREE.Mesh(new THREE.SphereGeometry(r,20,20),new THREE.MeshBasicMaterial({color:node.color,transparent:true,opacity:0.92})));
  const label=textSprite(node.title,node.parentName);if(label){label.position.set(0,-(r+6),0);group.add(label);}
  return group;}
async function buildGraphData(includeRelated){const notes=await TheGazeDB.getAllNotes();
  const titleMap={},byId={};notes.forEach(n=>{byId[n.id]=n;if(n.title)titleMap[n.title.toLowerCase()]=n.id;});
  const nodes=notes.map(n=>{const title=n.title||'Untitled';
    const parentName=(n.parentId&&byId[n.parentId])?(byId[n.parentId].title||'Untitled'):null;
    return{id:n.id,title:title,parentName:parentName,name:parentName?parentName+' / '+title:title,val:Math.min(18,2+((n.content||'').length/300)),color:nodeColor(n)};});
  const links=[],seen=new Set();
  notes.forEach(n=>{const matches=(n.content||'').match(/\[\[([^\]]+)\]\]/g)||[];
    matches.forEach(m=>{const t=m.slice(2,-2).trim().toLowerCase();const target=titleMap[t];
      if(target&&target!==n.id){const key=[n.id,target].sort().join('|');if(!seen.has(key)){seen.add(key);links.push({source:n.id,target:target,type:'link',color:'rgba(148,163,184,0.5)'});}}});});
  if(includeRelated){for(const n of notes){
    const rel=computeRelated(n,notes).filter(r=>r.weight>=5&&r.overlap>=0.12).slice(0,3);
    for(const r of rel){const key=[n.id,r.note.id].sort().join('|');
      if(!seen.has(key)){seen.add(key);links.push({source:n.id,target:r.note.id,type:'related',color:'rgba(167,139,250,0.5)'});}}}}
  return{nodes,links};}
function initGraph(){const container=document.getElementById('graph-3d');if(!container)return;
  if(typeof ForceGraph3D==='undefined'){container.innerHTML='<div class="p-8 text-center text-slate-500">3Dグラフライブラリの読み込みに失敗しました。</div>';return;}
  if(!graphInstance){
    graphInstance=ForceGraph3D()(container)
      .backgroundColor('#0a0a0b')
      .nodeLabel(n=>'<div style="background:#141416;border:1px solid #2a2a2e;padding:4px 8px;border-radius:6px;font-size:12px;color:#e2e8f0">'+escapeHtml(n.name)+'</div>')
      .linkColor(l=>l.color||'rgba(148,163,184,0.4)')
      .linkWidth(l=>l.type==='related'?0.6:1.4)
      .linkDirectionalParticles(2).linkDirectionalParticleWidth(1.5)
      .onNodeClick(n=>openNoteById(n.id));
    if(typeof THREE!=='undefined')graphInstance.nodeThreeObject(n=>makeNodeObject(n));
    graphInstance.controls().autoRotate=false;
  }
  graphInstance.width(container.clientWidth).height(container.clientHeight);
  buildGraphData(showRelated).then(data=>graphInstance.graphData(data));}
(function(){const b=document.getElementById('graph-related');if(b)b.addEventListener('click',function(){
  showRelated=!showRelated;b.classList.toggle('active',showRelated);
  if(graphInstance)buildGraphData(showRelated).then(d=>graphInstance.graphData(d));});})();
