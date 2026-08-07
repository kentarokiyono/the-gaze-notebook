const COMMANDS=[
  {id:'new-note',label:'新規ノート作成',icon:'plus',run:()=>createNote()},
  {id:'new-child',label:'サブページを追加',icon:'file-plus',run:()=>{if(state.currentNote)createChildNote(state.currentNote.id);}},
  {id:'view-library',label:'ライブラリを開く',icon:'book-open',run:()=>setView('library')},
  {id:'view-graph',label:'3Dグラフを開く',icon:'box',run:()=>setView('graph')},
  {id:'toggle-ai',label:'AIパネルを開く／閉じる',icon:'sparkles',run:()=>toggleAiDrawer()},
  {id:'toggle-preview',label:'プレビューを切り替え',icon:'eye',run:()=>setEditorMode(editorMode==='preview'?'edit':'preview')},
  {id:'move',label:'ノートを移動',icon:'arrow-right-left',run:()=>openMoveModal()},
  {id:'delete-note',label:'現在のノートを削除',icon:'trash-2',run:()=>{if(state.currentNote)deleteNote(state.currentNote.id);}},
  {id:'export',label:'現在のノートを書き出す',icon:'download',run:()=>exportCurrentNote()},
  {id:'notion-send',label:'Notionへ送信',icon:'arrow-up-from-line',run:()=>sendToNotion()},
  {id:'notion-import',label:'Notionからインポート',icon:'arrow-down-to-line',run:()=>openNotionImportModal()},
  {id:'suggest-links',label:'AIでつながりを提案',icon:'sparkles',run:()=>aiSuggestLinks()},
  {id:'evaluate',label:'AIで充実度を評価',icon:'sparkles',run:()=>evaluateRichnessWithAI()},
  {id:'settings',label:'設定を開く',icon:'settings',run:()=>openSettings()}
];
let paletteIndex=0,paletteItems=[];
function openPalette(){document.getElementById('palette-overlay').classList.remove('hidden');
  const inp=document.getElementById('palette-input');inp.value='';inp.focus();renderPalette('');}
function closePalette(){document.getElementById('palette-overlay').classList.add('hidden');}
async function renderPalette(q){q=q.toLowerCase();const items=[];
  COMMANDS.forEach(c=>{if(!q||c.label.toLowerCase().includes(q))items.push(Object.assign({type:'cmd'},c));});
  const notes=await TheGazeDB.getAllNotes();
  notes.forEach(n=>{const t=n.title||'Untitled';
    if(!q||t.toLowerCase().includes(q)||(n.content||'').toLowerCase().includes(q))items.push({type:'note',id:n.id,label:t,icon:'file-text'});});
  paletteItems=items.slice(0,30);paletteIndex=0;drawPalette();}
function drawPalette(){const el=document.getElementById('palette-list');
  if(paletteItems.length===0){el.innerHTML='<p class="text-xs text-slate-500 px-4 py-3">見つかりませんでした</p>';return;}
  el.innerHTML=paletteItems.map((it,i)=>'<div class="palette-item '+(i===paletteIndex?'selected':'')+'" data-i="'+i+'">'
    +'<i data-lucide="'+(it.icon||'file-text')+'" class="w-4 h-4 text-slate-500"></i>'
    +'<span class="truncate">'+escapeHtml(it.label)+'</span>'
    +'<span class="ml-auto text-[10px] text-slate-600">'+(it.type==='cmd'?'コマンド':'ノート')+'</span></div>').join('');
  lucide.createIcons();
  el.querySelectorAll('.palette-item').forEach(d=>{
    d.addEventListener('click',()=>{paletteIndex=parseInt(d.dataset.i);executePalette();});
    d.addEventListener('mousemove',()=>{const i=parseInt(d.dataset.i);if(paletteIndex!==i){paletteIndex=i;updatePaletteSel();}});});}
function updatePaletteSel(){document.querySelectorAll('.palette-item').forEach((d,i)=>d.classList.toggle('selected',i===paletteIndex));}
function executePalette(){const it=paletteItems[paletteIndex];if(!it)return;closePalette();
  if(it.type==='cmd')it.run();else openNoteById(it.id);}
const DEFAULT_TEMPLATES=[
  {id:'tpl_seed_1',name:'次のアクション分解',prompt:'このノートの内容に基づき、私が次に取るべき「具体的なアクション」を小さなステップに分解して列挙してください。'},
  {id:'tpl_seed_2',name:'SWOT分析',prompt:'このノートに書かれているアイデア・テーマについて、SWOT分析（強み・弱み・機会・脅威）を行ってください。'},
  {id:'tpl_seed_3',name:'構造化レビュー',prompt:'このノートの論理構成をレビューし、矛盾点・根拠の弱い箇所・抜け落ちている視点を指摘してください。'},
  {id:'tpl_seed_4',name:'ファインマン理解',prompt:'このノートの内容を、初心者が理解できるように平易な言葉と具体例で説明し直し、私の理解が曖昧な部分を指摘してください。'},
  {id:'tpl_seed_5',name:'反証の提示',prompt:'このノートの主張に対して、反対の立場から最も強力な反論・反例を3つ挙げてください。'}];
let editingTemplateId=null;
function getTemplates(){try{return JSON.parse(localStorage.getItem('gaze_prompt_templates')||'[]');}catch(e){return[];}}
function saveTemplates(arr){localStorage.setItem('gaze_prompt_templates',JSON.stringify(arr));}
function seedTemplates(){if(localStorage.getItem('gaze_prompt_templates')===null)saveTemplates(DEFAULT_TEMPLATES.slice());}
function renderTemplateList(){const listEl=document.getElementById('template-list');const tpls=getTemplates();
  if(tpls.length===0){listEl.innerHTML='<p class="text-[11px] text-slate-600">カスタムプロンプトがありません。+ から作成。</p>';return;}
  listEl.innerHTML=tpls.map(t=>'<div class="tpl-chip" data-id="'+t.id+'"><span class="flex items-center gap-1.5"><i data-lucide="play" class="w-3 h-3 text-blue-400"></i>'+escapeHtml(t.name)+'</span>'
    +'<button class="tpl-edit" data-id="'+t.id+'" title="編集"><i data-lucide="pencil" class="w-3 h-3"></i></button></div>').join('');
  lucide.createIcons();
  listEl.querySelectorAll('.tpl-chip').forEach(chip=>{chip.addEventListener('click',(e)=>{if(e.target.closest('.tpl-edit'))return;
    const tpl=getTemplates().find(x=>x.id===chip.dataset.id);if(tpl)runTemplate(tpl);});});
  listEl.querySelectorAll('.tpl-edit').forEach(b=>b.addEventListener('click',(e)=>{e.stopPropagation();
    const tpl=getTemplates().find(x=>x.id===b.dataset.id);if(tpl)openTemplateModal(tpl);}));}
function openTemplateModal(tpl){editingTemplateId=tpl?tpl.id:null;
  document.getElementById('template-modal-title').textContent=tpl?'プロンプトテンプレートを編集':'新しいプロンプトテンプレート';
  document.getElementById('template-name').value=tpl?tpl.name:'';
  document.getElementById('template-prompt').value=tpl?tpl.prompt:'';
  const del=document.getElementById('template-delete-btn');del.classList.toggle('hidden',!tpl);del.classList.toggle('flex',!!tpl);
  document.getElementById('template-overlay').classList.remove('hidden');document.getElementById('template-name').focus();}
function closeTemplateModal(){document.getElementById('template-overlay').classList.add('hidden');}
function saveTemplate(){const name=document.getElementById('template-name').value.trim(),prompt=document.getElementById('template-prompt').value.trim();
  if(!name){showToast('名前を入力してください','error');return;}
  if(!prompt){showToast('プロンプトを入力してください','error');return;}
  const tpls=getTemplates();
  if(editingTemplateId){const i=tpls.findIndex(t=>t.id===editingTemplateId);if(i>=0)tpls[i]=Object.assign({},tpls[i],{name,prompt});}
  else tpls.push({id:'tpl_'+Date.now()+'_'+Math.random().toString(36).substring(2,6),name,prompt});
  saveTemplates(tpls);closeTemplateModal();renderTemplateList();showToast('テンプレートを保存しました','success');}
function deleteTemplate(){if(!editingTemplateId)return;if(!confirm('このテンプレートを削除しますか？'))return;
  saveTemplates(getTemplates().filter(t=>t.id!==editingTemplateId));closeTemplateModal();renderTemplateList();showToast('テンプレートを削除しました','success');}
async function runTemplate(tpl){const provider=getSelectedProvider(),apiKey=getProviderApiKey(provider),settings=getSettings();
  if(provider!=='ollama'&&!apiKey){showToast(getProviderName(provider)+'のAPIキーが設定されていません','error');openSettings();return;}
  let prompt=tpl.prompt,context=state.currentNote?state.currentNote.content:'';
  if(prompt.indexOf('{{note}}')>=0){prompt=prompt.split('{{note}}').join(context||'');context='';}
  addChatMessage('user','['+tpl.name+']');const thinking=addChatMessage('assistant','',{isThinking:true,canAppend:false});
  try{const resp=await askLLM({provider,apiKey,endpoint:settings.ollamaEndpoint,prompt,context:(context||'').substring(0,15000)});
    thinking.remove();addChatMessage('assistant',resp);}
  catch(err){thinking.remove();addChatMessage('assistant','**エラーが発生しました**\n\n'+err.message);}}
const GROWTH={weights:{links:0.35,chars:0.35,richness:0.30},caps:{links:30,chars:30000},thresholds:[0,8,20,40,62,85],
  stageNames:{constellation:['闇夜の灯','一つ星','三つ星','星座の芽','星座','満天の星'],plant:['種','双葉','若葉','蕾','開花','満開'],campfire:['燻る薪','火種','小さな炎','炎','焚き火','篝火']},
  hints:{constellation:'リンクで星を結ぼう',plant:'書くほど育つ',campfire:'言葉で火を育てよう'},
  fillColors:{constellation:'linear-gradient(90deg,#3b82f6,#60a5fa)',plant:'linear-gradient(90deg,#22c55e,#4ade80)',campfire:'linear-gradient(90deg,#f97316,#fbbf24)'},
  chipColors:{constellation:'bg-blue-500/15 text-blue-300',plant:'bg-green-500/15 text-green-300',campfire:'bg-orange-500/15 text-orange-300'}};
let lastGrowthLevel=null;
function getGrowthTheme(){return localStorage.getItem('gaze_growth_theme')||'constellation';}
function setGrowthTheme(t){localStorage.setItem('gaze_growth_theme',t);}
async function computeGrowthMetrics(){let notes=[];try{notes=await TheGazeDB.getAllNotes();}catch(e){}
  let links=0,chars=0,richSum=0,richCount=0;
  for(const n of notes){const c=n.content||'';chars+=c.length;const m=c.match(/\[\[[^\]]+\]\]/g);if(m)links+=m.length;
    if(n.richness&&typeof n.richness.score==='number'){richSum+=n.richness.score;richCount++;}}
  const avgRichness=richCount>0?richSum/richCount:0;
  const score=GROWTH.weights.links*Math.min(links/GROWTH.caps.links,1)*100+GROWTH.weights.chars*Math.min(chars/GROWTH.caps.chars,1)*100+GROWTH.weights.richness*avgRichness;
  const TH=GROWTH.thresholds;let level=0;for(let i=1;i<TH.length;i++)if(score>=TH[i])level=i;
  let progress=level>=TH.length-1?1:(score-TH[level])/(TH[level+1]-TH[level]);
  return{links,chars,avgRichness,richCount,score,level,progress:Math.max(0,Math.min(1,progress))};}
function renderGrowth(m){const theme=getGrowthTheme(),visualEl=document.getElementById('growth-visual');if(!visualEl)return;
  visualEl.innerHTML=theme==='constellation'?renderConstellationSVG(m.level):theme==='plant'?renderPlantSVG(m.level):renderCampfireSVG(m.level);
  document.getElementById('growth-stage').textContent=GROWTH.stageNames[theme][m.level];
  const chip=document.getElementById('growth-level-chip');chip.textContent='Lv.'+m.level;chip.className='text-[10px] px-1.5 py-0.5 rounded-md font-semibold '+GROWTH.chipColors[theme];
  const fill=document.getElementById('growth-progress-fill');fill.style.width=(m.progress*100)+'%';fill.style.background=GROWTH.fillColors[theme];
  document.getElementById('metric-links').textContent='リンク '+m.links;
  document.getElementById('metric-chars').textContent=formatCharCount(m.chars)+'字';
  document.getElementById('metric-richness').textContent=m.richCount>0?'充実度 '+Math.round(m.avgRichness):'充実度 —';
  document.querySelectorAll('#theme-selector .theme-btn').forEach(b=>b.classList.toggle('active',b.dataset.theme===theme));
  const cEl=document.getElementById('growth-comment'),cn=state.currentNote;
  cEl.textContent=(cn&&cn.richness&&cn.richness.comment)?'「'+cn.richness.comment+'」':GROWTH.hints[theme];}
async function refreshGrowth(){const m=await computeGrowthMetrics();renderGrowth(m);
  if(lastGrowthLevel!==null&&m.level>lastGrowthLevel){showToast(GROWTH.stageNames[getGrowthTheme()][m.level]+' に成長しました','success');
    const w=document.getElementById('growth-widget');if(w){w.classList.remove('level-up-flash');void w.offsetWidth;w.classList.add('level-up-flash');}}
  lastGrowthLevel=m.level;}
function renderConstellationSVG(level){const stars=[{x:22,y:50},{x:38,y:30},{x:52,y:46},{x:66,y:24},{x:82,y:40},{x:50,y:12}];
  const lines=[[0,1],[1,2],[2,3],[3,4],[2,5]];const nStars=Math.min(level+1,stars.length),nLines=Math.min(level,lines.length);
  let s='<svg width="110" height="72" viewBox="0 0 100 64" fill="none">';
  for(let i=0;i<nLines;i++){const a=stars[lines[i][0]],b=stars[lines[i][1]];s+='<line x1="'+a.x+'" y1="'+a.y+'" x2="'+b.x+'" y2="'+b.y+'" stroke="#60a5fa" stroke-width="0.6" opacity="0.35"/>';}
  for(let i=0;i<nStars;i++){const st=stars[i],r=i===0?1.8:1.4;s+='<circle cx="'+st.x+'" cy="'+st.y+'" r="'+(r+2)+'" fill="#60a5fa" opacity="0.12"/><circle class="twinkle" style="animation-delay:'+(i*0.4)+'s" cx="'+st.x+'" cy="'+st.y+'" r="'+r+'" fill="#e2e8f0"/>';}
  return s+'</svg>';}
function leaf(cx,cy,rot,color,rx){return'<ellipse cx="'+cx+'" cy="'+cy+'" rx="'+rx+'" ry="'+(rx*0.5)+'" fill="'+color+'" transform="rotate('+rot+' '+cx+' '+cy+')"/>';}
function flowerSVG(cx,cy,r,p,c){let f='';for(let i=0;i<6;i++){const a=i*60*Math.PI/180,px=cx+Math.cos(a)*r,py=cy+Math.sin(a)*r;f+='<ellipse cx="'+px+'" cy="'+py+'" rx="'+(r*0.7)+'" ry="'+(r*0.45)+'" fill="'+p+'" transform="rotate('+(i*60)+' '+px+' '+py+')" opacity="0.9"/>';}return f+'<circle cx="'+cx+'" cy="'+cy+'" r="'+(r*0.5)+'" fill="'+c+'"/>';}
function renderPlantSVG(level){let s='<svg width="80" height="80" viewBox="0 0 100 100" fill="none">';
  if(level>=1){s+='<g class="plant-sway">';const top=[0,64,52,42,40,34][level];
    s+='<path d="M50 74 Q49 '+((74+top)/2)+' 50 '+top+'" stroke="#4ade80" stroke-width="'+(1.5+level*0.3)+'" fill="none" stroke-linecap="round"/>';
    if(level>=1){s+=leaf(46,64,-30,'#4ade80',4);s+=leaf(54,64,30,'#4ade80',4);}
    if(level>=2){s+=leaf(44,58,-35,'#22c55e',5);s+=leaf(56,54,35,'#22c55e',5);}
    if(level>=3){s+=leaf(45,48,-30,'#16a34a',4.5);}if(level>=4){s+=leaf(55,46,30,'#16a34a',4.5);}if(level>=5){s+=leaf(44,42,-32,'#15803d',5);}
    if(level===3)s+='<circle cx="50" cy="40" r="3.2" fill="#a3e635"/>';
    if(level===4)s+=flowerSVG(50,38,6,'#f472b6','#fbbf24');
    if(level===5){s+=flowerSVG(50,32,7.5,'#f472b6','#fbbf24');s+=flowerSVG(39,44,4,'#a78bfa','#fbbf24');}
    s+='</g>';}else{s+='<circle cx="50" cy="72" r="2.2" fill="#a16207"/>';}
  s+='<ellipse cx="50" cy="74" rx="12" ry="2.5" fill="#5b4636"/><path d="M36 78 L64 78 L60 92 Q50 96 40 92 Z" fill="#3f3f46"/><rect x="33" y="73" width="34" height="6" rx="2" fill="#52525b"/></svg>';return s;}
function flamePath(cx,topY,baseY,w){const midY=topY+(baseY-topY)*0.45;return'M'+cx+' '+topY+' C '+(cx+w)+' '+midY+' '+(cx+w)+' '+(baseY-4)+' '+cx+' '+baseY+' C '+(cx-w)+' '+(baseY-4)+' '+(cx-w)+' '+midY+' '+cx+' '+topY+' Z';}
function renderCampfireSVG(level){let s='<svg width="80" height="80" viewBox="0 0 100 100" fill="none"><defs><radialGradient id="fg"><stop offset="0%" stop-color="#f97316" stop-opacity="0.35"/><stop offset="100%" stop-color="#f97316" stop-opacity="0"/></radialGradient></defs>';
  const glowR=[0,12,18,24,30,36][level];
  if(level>=1)s+='<circle class="fire-glow" cx="50" cy="58" r="'+glowR+'" fill="url(#fg)"/>';
  if(level>=1){const fh=[0,12,20,30,38,48][level],topY=72-fh,w=Math.max(fh*0.32,4);
    s+='<g class="flame-flicker">';s+='<path d="'+flamePath(50,topY,72,w)+'" fill="#f97316" opacity="0.92"/>';
    if(level>=2){const ih=fh*0.55;s+='<path d="'+flamePath(50,72-ih,71,Math.max(ih*0.3,3))+'" fill="#fbbf24"/>';}
    if(level>=4){const ch=fh*0.28;s+='<path d="'+flamePath(50,72-ch,70,Math.max(ch*0.3,2))+'" fill="#fde68a"/>';}s+='</g>';}
  else{s+='<circle class="fire-glow" cx="50" cy="70" r="3" fill="#f97316"/>';}
  if(level>=5){s+='<circle class="spark" cx="42" cy="52" r="1.2" fill="#fbbf24"/><circle class="spark" style="animation-delay:0.7s" cx="58" cy="48" r="1" fill="#f97316"/>';}
  s+='<rect x="30" y="72" width="40" height="7" rx="3.5" fill="#7c5c3e" transform="rotate(8 50 76)"/><rect x="30" y="72" width="40" height="7" rx="3.5" fill="#6b4f35" transform="rotate(-8 50 76)"/></svg>';return s;}
function parseRichnessResponse(text){if(!text)return null;const m=text.match(/\{[\s\S]*?\}/);
  if(m){try{const o=JSON.parse(m[0]);const sc=parseInt(o.score);if(!isNaN(sc))return{score:sc,comment:o.comment||''};}catch(e){}}
  const sm=text.match(/"score"\s*:\s*"?(\d{1,3})/i)||text.match(/(\d{1,3})\s*点/);
  if(sm){const cm=text.match(/"comment"\s*:\s*"([^"]*)"/i);return{score:parseInt(sm[1]),comment:cm?cm[1]:''};}return null;}
async function evaluateRichnessWithAI(){if(!state.currentNote){showToast('評価するノートを開いてください','error');return;}
  const content=state.currentNote.content||'';
  if(content.trim().length<20){showToast('まだ内容が短いようです','error');return;}
  const provider=getSelectedProvider(),apiKey=getProviderApiKey(provider),settings=getSettings();
  if(provider!=='ollama'&&!apiKey){showToast('AI評価にはAPIキーが必要です','error');openSettings();return;}
  const prompt='あなたは思考ノートの「内容充実度」を静かに見守る鑑定士です。各25点・計100点（具体性・構造・発展性・問い）で評価してください。必ずJSON形式のみで: {"score": 0-100の整数, "comment": "20字以内の一言"}\n\nノート本文:\n'+content.substring(0,6000);
  try{const resp=await askLLM({provider,apiKey,endpoint:settings.ollamaEndpoint,prompt,context:''});
    const parsed=parseRichnessResponse(resp);if(!parsed)throw new Error('AIの応答を解析できませんでした');
    const score=Math.max(0,Math.min(100,Math.round(parsed.score)));
    state.currentNote.richness={score,comment:parsed.comment||'',at:Date.now()};
    await TheGazeDB.addNote(state.currentNote);
    showToast('充実度 '+score+'点 — '+(parsed.comment||'評価しました'),'success');
    await renderTree();refreshGrowth();
  }catch(err){showToast('AI評価に失敗: '+err.message,'error');console.error(err);}}
function richTextToMarkdown(rt){if(!rt||!Array.isArray(rt))return'';return rt.map(x=>{let t=x.plain_text||'';const a=x.annotations||{};
  if(a.code)t='\u0060'+t+'\u0060';if(a.bold)t='**'+t+'**';if(a.italic)t='*'+t+'*';if(a.strikethrough)t='~~'+t+'~~';if(x.href)t='['+t+']('+x.href+')';return t;}).join('');}
async function notionBlocksToMarkdown(blocks,depth){depth=depth||0;if(!blocks||!Array.isArray(blocks))return'';let md='';const ind='  '.repeat(depth);
  for(const b of blocks){const t=b.type,d=b[t];
    if(t==='paragraph')md+=ind+richTextToMarkdown(d.rich_text)+'\n\n';
    else if(t==='heading_1')md+=ind+'# '+richTextToMarkdown(d.rich_text)+'\n\n';
    else if(t==='heading_2')md+=ind+'## '+richTextToMarkdown(d.rich_text)+'\n\n';
    else if(t==='heading_3')md+=ind+'### '+richTextToMarkdown(d.rich_text)+'\n\n';
    else if(t==='bulleted_list_item')md+=ind+'- '+richTextToMarkdown(d.rich_text)+'\n';
    else if(t==='numbered_list_item')md+=ind+'1. '+richTextToMarkdown(d.rich_text)+'\n';
    else if(t==='to_do')md+=ind+'- '+(d.checked?'[x] ':'[ ] ')+richTextToMarkdown(d.rich_text)+'\n';
    else if(t==='quote')md+=ind+richTextToMarkdown(d.rich_text).split('\n').map(l=>'> '+l).join('\n')+'\n\n';
    else if(t==='code')md+=ind+'\u0060\u0060\u0060'+(d.language||'')+'\n'+richTextToMarkdown(d.rich_text)+'\n'+ind+'\u0060\u0060\u0060\n\n';
    else if(t==='divider')md+=ind+'---\n\n';
    else if(d&&d.rich_text)md+=ind+richTextToMarkdown(d.rich_text)+'\n\n';
    if(b.has_children&&b.children)md+=await notionBlocksToMarkdown(b.children,depth+1);}
  return md;}
function markdownToNotionBlocks(md){if(!md||!md.trim())return[];const blocks=[],lines=md.split('\n');let i=0;
  const F3='\u0060\u0060\u0060';
  const pi=(text)=>{const rt=[],re=new RegExp('(\\*\\*(.+?)\\*\\*|\\*(.+?)\\*|\u0060(.+?)\u0060|([^*\u0060]+))','g');let m;
    while((m=re.exec(text))!==null){if(m[2])rt.push({type:'text',text:{content:m[2]},annotations:{bold:true}});
      else if(m[3])rt.push({type:'text',text:{content:m[3]},annotations:{italic:true}});
      else if(m[4])rt.push({type:'text',text:{content:m[4]},annotations:{code:true}});
      else if(m[5])rt.push({type:'text',text:{content:m[5]}});}
    return rt.length?rt:[{type:'text',text:{content:text}}];};
  while(i<lines.length){const l=lines[i];let m;
    if((m=l.match(/^# (.+)$/))){blocks.push({object:'block',type:'heading_1',heading_1:{rich_text:pi(m[1])}});i++;continue;}
    if((m=l.match(/^## (.+)$/))){blocks.push({object:'block',type:'heading_2',heading_2:{rich_text:pi(m[1])}});i++;continue;}
    if((m=l.match(/^### (.+)$/))){blocks.push({object:'block',type:'heading_3',heading_3:{rich_text:pi(m[1])}});i++;continue;}
    if((m=l.match(/^[-*] \[(x| )\] (.+)$/i))){blocks.push({object:'block',type:'to_do',to_do:{rich_text:pi(m[2]),checked:m[1].toLowerCase()==='x'}});i++;continue;}
    if((m=l.match(/^[-*] (.+)$/))){blocks.push({object:'block',type:'bulleted_list_item',bulleted_list_item:{rich_text:pi(m[1])}});i++;continue;}
    if((m=l.match(/^\d+\. (.+)$/))){blocks.push({object:'block',type:'numbered_list_item',numbered_list_item:{rich_text:pi(m[1])}});i++;continue;}
    if((m=l.match(/^> (.+)$/))){blocks.push({object:'block',type:'quote',quote:{rich_text:pi(m[1])}});i++;continue;}
    if(l.trim().indexOf(F3)===0){let code='';const lm=l.trim().match(new RegExp('^'+F3+'(\\w+)?'));const lang=(lm&&lm[1])||'plain text';i++;
      while(i<lines.length&&lines[i].trim().indexOf(F3)!==0){code+=(code?'\n':'')+lines[i];i++;}i++;
      blocks.push({object:'block',type:'code',code:{rich_text:[{type:'text',text:{content:code}}],language:lang}});continue;}
    if(l.trim()==='---'){blocks.push({object:'block',type:'divider',divider:{}});i++;continue;}
    if(l.trim()===''){i++;continue;}
    blocks.push({object:'block',type:'paragraph',paragraph:{rich_text:pi(l)}});i++;}
  return blocks;}
async function callNotionAPI(endpoint,options){options=options||{};const settings=getSettings();
  if(!settings.notionToken)throw new Error('Notion Tokenが設定されていません');
  const res=await fetch('https://api.notion.com'+endpoint,{method:options.method,headers:Object.assign({'Authorization':'Bearer '+settings.notionToken,'Notion-Version':'2022-06-28','Content-Type':'application/json'},options.headers),body:options.body});
  if(!res.ok){const et=await res.text();let em='Notion API Error';try{em=JSON.parse(et).message||em;}catch(e){}throw new Error(res.status+': '+em);}
  return res.json();}
async function fetchNotionPagesList(query){const body={filter:{or:[{property:'object',value:'page'},{property:'object',value:'database'}]},sort:{direction:'descending',timestamp:'last_edited_time'},page_size:100};if(query)body.query=query;
  const r=await callNotionAPI('/v1/search',{method:'POST',body:JSON.stringify(body)});return r.results||[];}
async function fetchNotionPageBlocks(pageId){const all=[];async function fb(id){const r=await callNotionAPI('/v1/blocks/'+id+'/children?page_size=100');
  for(const b of r.results){if(b.has_children){const cr=await callNotionAPI('/v1/blocks/'+b.id+'/children?page_size=100');b.children=cr.results||[];}all.push(b);}}
  await fb(pageId);return all;}
function getPageTitle(p){if(!p)return'Untitled';const pr=p.properties||{};for(const k in pr){const x=pr[k];if(x.type==='title'&&x.title)return x.title.map(t=>t.plain_text).join('')||'Untitled';}return p.title||'Untitled';}
function getPageLastEdited(p){if(!p.last_edited_time)return'';return new Date(p.last_edited_time).toLocaleDateString('ja-JP',{month:'short',day:'numeric'});}
async function openNotionImportModal(q){const settings=getSettings();
  if(!settings.notionToken){showToast('Notion設定でTokenを入力してください','error');openSettings();return;}
  document.getElementById('notion-overlay').classList.remove('hidden');document.getElementById('notion-search-input').value=q||'';await loadNotionPages(q||'');}
function closeNotionModal(){document.getElementById('notion-overlay').classList.add('hidden');}
async function loadNotionPages(query){const c=document.getElementById('notion-pages-container');
  c.innerHTML='<div class="text-center py-12 text-slate-500"><div class="thinking-dots inline-flex mb-3"><span></span><span></span><span></span></div><p class="text-sm">検索中...</p></div>';
  try{const pages=await fetchNotionPagesList(query);
    if(pages.length===0){c.innerHTML='<p class="text-center py-12 text-slate-500 text-sm">ページが見つかりませんでした</p>';return;}
    c.innerHTML=pages.map(p=>'<div class="notion-page-item flex items-start gap-3" data-page-id="'+p.id+'"><div class="flex-1 min-w-0"><h3 class="font-semibold text-white text-sm truncate">'+escapeHtml(getPageTitle(p))+'</h3><p class="text-xs text-slate-500 mt-1">'+getPageLastEdited(p)+'</p></div><button class="import-notion-page-btn px-3 py-1.5 rounded-md text-xs btn-primary text-white flex-shrink-0">インポート</button></div>').join('');
    c.querySelectorAll('.notion-page-item').forEach(item=>{item.querySelector('.import-notion-page-btn').addEventListener('click',async(e)=>{e.stopPropagation();await importNotionPage(item.dataset.pageId);});});
  }catch(err){c.innerHTML='<p class="text-center py-12 text-red-400 text-sm">エラー: '+escapeHtml(err.message)+'</p>';}}
async function importNotionPage(pageId){const settings=getSettings();if(!settings.notionToken){showToast('Notion設定が完了していません','error');return;}
  showToast('Notionから読み込み中...','success');
  try{const page=await callNotionAPI('/v1/pages/'+pageId);const title=getPageTitle(page);
    const blocks=await fetchNotionPageBlocks(pageId);const md=await notionBlocksToMarkdown(blocks);
    const note={id:newId(),title:title||'Imported from Notion',content:md.trim(),parentId:null,createdAt:Date.now(),updatedAt:Date.now(),notionPageId:pageId};
    await TheGazeDB.addNote(note);await renderTree();closeNotionModal();openNoteById(note.id);
    showToast('「'+title+'」をインポートしました','success');refreshGrowth();
  }catch(err){showToast('インポート失敗: '+err.message,'error');console.error(err);}}
async function sendToNotion(){if(!state.currentNote){showToast('ノートを開いてください','error');return;}
  const settings=getSettings();if(!settings.notionToken||!settings.notionPageId){showToast('Notion設定が完了していません','error');openSettings();return;}
  const title=state.currentNote.title||'Untitled';const blocks=markdownToNotionBlocks(state.currentNote.content||'');
  showToast('Notionに送信中...','success');
  try{const res=await fetch('https://api.notion.com/v1/pages',{method:'POST',
    headers:{'Authorization':'Bearer '+settings.notionToken,'Notion-Version':'2022-06-28','Content-Type':'application/json'},
    body:JSON.stringify({parent:{page_id:settings.notionPageId},properties:{title:[{text:{content:title}}]},children:blocks.length?blocks:[{object:'block',type:'paragraph',paragraph:{rich_text:[{type:'text',text:{content:'(空)'}}]}}]})});
    if(!res.ok){const ed=await res.json().catch(()=>({}));throw new Error(ed.message||res.statusText);}
    const result=await res.json();state.currentNote.notionPageId=result.id;await TheGazeDB.addNote(state.currentNote);await renderTree();
    showToast('Notionに送信しました','success');if(result.url&&confirm('Notionで開きますか？'))window.open(result.url,'_blank');
  }catch(err){showToast('Notion送信に失敗: '+err.message,'error');console.error(err);}}
function exportCurrentNote(){if(!state.currentNote){showToast('ノートを開いてください','error');return;}
  const title=state.currentNote.title||'untitled';const md='# '+(state.currentNote.title||'Untitled')+'\n\n'+(state.currentNote.content||'');
  const blob=new Blob([md],{type:'text/markdown'});const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=title.replace(/[^a-zA-Z0-9\u3000-\u9FFF]/g,'_')+'.md';
  document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);showToast('Markdownを書き出しました','success');}
async function exportAllNotes(){try{const notes=await TheGazeDB.getAllNotes();if(notes.length===0){showToast('書き出すノートがありません','error');return;}
  const blob=new Blob([JSON.stringify({version:2,exportedAt:Date.now(),notes},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='the-gaze-backup-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);showToast(notes.length+'件書き出しました','success');
}catch(e){showToast('書き出しに失敗しました','error');}}
async function importNotes(file){try{const text=await file.text();
  if(file.name.endsWith('.json')){const data=JSON.parse(text);if(!data.notes||!Array.isArray(data.notes))throw new Error('無効なJSON');
    let count=0;for(const n of data.notes){if(n.id&&(n.title||n.content)){await TheGazeDB.addNote(n);count++;}}
    await renderNotesList();showToast(count+'件読み込みました','success');refreshGrowth();
  }else if(file.name.endsWith('.md')){const content=text.replace(/^# .*\n\n?/,'');const tm=text.match(/^# (.*)$/m);
    const note={id:newId(),title:tm?tm[1].trim():file.name.replace('.md',''),content,parentId:null,createdAt:Date.now(),updatedAt:Date.now()};
    await TheGazeDB.addNote(note);await renderNotesList();openNoteById(note.id);showToast('Markdownを読み込みました','success');refreshGrowth();
  }else throw new Error('対応していない形式です');
}catch(e){showToast('読み込み失敗: '+e.message,'error');}}
async function resetAllData(){if(!confirm('本当にすべてのデータを削除しますか？'))return;
  if(!confirm('最終確認: 取り消せません。よろしいですか？'))return;
  try{
    const b=await detectBackend();
    if(b==='idb'){const db=await TheGazeDB.open();db.transaction(NOTES_STORE,'readwrite').objectStore(NOTES_STORE).clear();}
    else{localStorage.removeItem(LS_KEY);}
    localStorage.clear();state.currentNote=null;await renderNotesList();setView('library');
    showToast('すべてのデータを削除しました','success');closeSettings();refreshGrowth();
  }catch(e){showToast('削除に失敗しました','error');}}
async function askLLM(o){let full=o.prompt;
  if(o.context&&o.context.trim())full='You are an AI assistant helping with note analysis.\n\n---\nNOTE CONTENT:\n'+o.context+'\n---\n\nUSER REQUEST:\n'+o.prompt+'\n\nRespond in Japanese.';
  else full='You are a helpful AI assistant. Respond in Japanese.\n\nUSER REQUEST:\n'+o.prompt;
  if(o.provider==='gemini')return callGemini(o.apiKey,full);
  if(o.provider==='claude')return callClaude(o.apiKey,full);
  if(o.provider==='openai')return callOpenAI(o.apiKey,full);
  if(o.provider==='ollama')return callOllama(o.endpoint,full,o.model);
  throw new Error('不明なプロバイダー');}
async function callGemini(apiKey,prompt){if(!apiKey)throw new Error('Gemini APIキー未設定');
  const models=['gemini-3.6-flash','gemini-3.5-flash-lite','gemini-3.1-pro','gemini-2.5-flash','gemini-2.0-flash','gemini-flash-latest'];
  let lastErr=null;
  for(let i=0;i<models.length;i++){
    const model=models[i];
    const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent?key='+apiKey,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.7,maxOutputTokens:4096}})});
    if(r.ok){
      const d=await r.json();
      const t=d.candidates&&d.candidates[0]&&d.candidates[0].content&&d.candidates[0].content.parts&&d.candidates[0].content.parts[0]&&d.candidates[0].content.parts[0].text;
      if(!t)throw new Error('Geminiから応答なし');
      return t;
    }
    const et=await r.text();let em='Gemini API Error';
    try{const j=JSON.parse(et);em=(j.error&&j.error.message)||em;}catch(e){}
    const modelIssue=(r.status===404)||/not found|not supported/i.test(em);
    if(!modelIssue)throw new Error(em);
    lastErr=new Error(em);
  }
  throw lastErr||new Error('利用可能なGeminiモデルがありません');}
async function callClaude(apiKey,prompt){if(!apiKey)throw new Error('Claude APIキー未設定');
  const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-3-5-sonnet-20241022',max_tokens:4096,messages:[{role:'user',content:prompt}]})});
  if(!r.ok){const et=await r.text();let em='Claude API Error';try{em=JSON.parse(et).error&&JSON.parse(et).error.message||em;}catch(e){}throw new Error(em);}
  const d=await r.json();const t=d.content&&d.content[0]&&d.content[0].text;if(!t)throw new Error('応答なし');return t;}
async function callOpenAI(apiKey,prompt){if(!apiKey)throw new Error('OpenAI APIキー未設定');
  const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},body:JSON.stringify({model:'gpt-4o',messages:[{role:'user',content:prompt}],max_tokens:4096,temperature:0.7})});
  if(!r.ok){const et=await r.text();let em='OpenAI API Error';try{em=JSON.parse(et).error&&JSON.parse(et).error.message||em;}catch(e){}throw new Error(em);}
  const d=await r.json();const t=d.choices&&d.choices[0]&&d.choices[0].message&&d.choices[0].message.content;if(!t)throw new Error('応答なし');return t;}
async function callOllama(endpoint,prompt,model){const ep=(endpoint||'http://localhost:11434').replace(/\/+$/,'');
  const r=await fetch(ep+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:model||'llama3',prompt,stream:false,options:{temperature:0.7,num_predict:4096}})});
  if(!r.ok)throw new Error('Ollama Error');const d=await r.json();if(!d.response)throw new Error('応答なし');return d.response;}
function addChatMessage(role,content,options){options=options||{};const c=document.getElementById('chat-container');
  const div=document.createElement('div');div.className='chat-message rounded-xl p-4 '+(role==='user'?'bg-white/5 border border-gaze-border ml-4':'bg-gradient-to-br from-blue-900/20 to-indigo-900/10 border border-blue-700/30 mr-4');
  const h=document.createElement('div');h.className='flex items-center gap-2 mb-2';
  h.innerHTML=role==='user'?'<span class="text-xs font-semibold text-slate-300">You</span>':'<span class="text-xs font-semibold text-blue-300">AI Assistant</span>';
  const body=document.createElement('div');
  if(options.isThinking)body.innerHTML='<div class="flex items-center gap-3 text-slate-400"><div class="thinking-dots"><span></span><span></span><span></span></div><span class="text-sm">思考中...</span></div>';
  else if(role==='assistant'){body.className='prose prose-sm prose-invert max-w-none text-slate-200';try{body.innerHTML=marked.parse(content||'');}catch(e){body.textContent=content||'';}}
  else{body.className='text-sm text-slate-200 whitespace-pre-wrap';body.textContent=content||'';}
  div.appendChild(h);div.appendChild(body);
  if(role==='assistant'&&!options.isThinking&&options.canAppend!==false){
    const act=document.createElement('div');act.className='mt-3 pt-3 border-t border-blue-700/20 flex gap-2';
    act.innerHTML='<button class="append-to-note-btn flex items-center gap-1.5 text-xs bg-white/5 hover:bg-white/10 border border-gaze-border px-3 py-1.5 rounded-md transition-all"><i data-lucide="file-plus" class="w-3 h-3"></i>追記</button><button class="copy-btn flex items-center gap-1.5 text-xs bg-white/5 hover:bg-white/10 border border-gaze-border px-3 py-1.5 rounded-md transition-all"><i data-lucide="copy" class="w-3 h-3"></i>コピー</button>';
    div.appendChild(act);
    act.querySelector('.append-to-note-btn').addEventListener('click',()=>{const ta=document.getElementById('note-content');const sep=ta.value.trim()?'\n\n---\n\n':'';ta.value=ta.value+sep+content;ta.dispatchEvent(new Event('input'));scheduleSave();showToast('ノートに追記しました','success');});
    act.querySelector('.copy-btn').addEventListener('click',()=>navigator.clipboard.writeText(content).then(()=>showToast('コピーしました','success')));}
  c.appendChild(div);c.scrollTop=c.scrollHeight;lucide.createIcons();return div;}
function getSelectedProvider(){return document.getElementById('model-select').value;}
function getProviderApiKey(p){const s=getSettings();if(p==='gemini')return s.geminiKey;if(p==='claude')return s.claudeKey;if(p==='openai')return s.openaiKey;return null;}
function getProviderName(p){return{gemini:'Google Gemini',claude:'Anthropic Claude',openai:'OpenAI',ollama:'Ollama'}[p]||p;}
function toggleAiDrawer(){const d=document.getElementById('ai-drawer');const willShow=d.classList.contains('hidden');
  d.classList.toggle('hidden',!willShow);d.classList.toggle('flex',willShow);}
async function sendChatMessage(){const input=document.getElementById('chat-input');const msg=input.value.trim();if(!msg)return;
  const provider=getSelectedProvider(),apiKey=getProviderApiKey(provider),settings=getSettings();
  if(provider!=='ollama'&&!apiKey){showToast(getProviderName(provider)+'のAPIキーが設定されていません','error');openSettings();return;}
  addChatMessage('user',msg);input.value='';
  const context=state.currentNote?state.currentNote.content:'';const thinking=addChatMessage('assistant','',{isThinking:true,canAppend:false});
  try{const r=await askLLM({provider,apiKey,endpoint:settings.ollamaEndpoint,prompt:msg,context:(context||'').substring(0,15000)});thinking.remove();addChatMessage('assistant',r);}
  catch(err){thinking.remove();addChatMessage('assistant','**エラーが発生しました**\n\n'+err.message);}}
async function handleAIAction(action){const provider=getSelectedProvider(),apiKey=getProviderApiKey(provider),settings=getSettings();
  if(!state.currentNote||!(state.currentNote.content||'').trim()){showToast('ノートに内容がありません','error');return;}
  if(provider!=='ollama'&&!apiKey){showToast(getProviderName(provider)+'のAPIキーが設定されていません','error');openSettings();return;}
  const prompts={summarize:'このノートを簡潔に要約し、主要ポイントを箇条書きで抽出してください。',
    ideas:'このノートに基づき、関連する新しいアイデア・拡張可能性・別の視点を5つ提案してください。',
    questions:'このノートについて、深掘りすべき疑問点・検討すべき課題を5つ抽出してください。'};
  const names={summarize:'ノートの要約',ideas:'関連アイデアの提案',questions:'疑問点の抽出'};
  addChatMessage('user','['+names[action]+']');const thinking=addChatMessage('assistant','',{isThinking:true,canAppend:false});
  try{const r=await askLLM({provider,apiKey,endpoint:settings.ollamaEndpoint,prompt:prompts[action],context:state.currentNote.content.substring(0,15000)});thinking.remove();addChatMessage('assistant',r);}
  catch(err){thinking.remove();addChatMessage('assistant','**エラーが発生しました**\n\n'+err.message);}}
function getSettings(){return{geminiKey:localStorage.getItem('gaze_gemini_key')||'',claudeKey:localStorage.getItem('gaze_claude_key')||'',
  openaiKey:localStorage.getItem('gaze_openai_key')||'',ollamaEndpoint:localStorage.getItem('gaze_ollama_endpoint')||'http://localhost:11434',
  notionToken:localStorage.getItem('gaze_notion_token')||'',notionPageId:localStorage.getItem('gaze_notion_page_id')||''};}
function saveSettingsToStorage(){const set=(k,v)=>{v=v.trim();if(v)localStorage.setItem(k,v);else localStorage.removeItem(k);};
  set('gaze_gemini_key',document.getElementById('gemini-key').value);set('gaze_claude_key',document.getElementById('claude-key').value);
  set('gaze_openai_key',document.getElementById('openai-key').value);
  localStorage.setItem('gaze_ollama_endpoint',document.getElementById('ollama-endpoint').value.trim()||'http://localhost:11434');
  set('gaze_notion_token',document.getElementById('notion-token').value);set('gaze_notion_page_id',document.getElementById('notion-page-id').value);
  showToast('設定を保存しました','success');}
function loadSettingsToForm(){const s=getSettings();document.getElementById('gemini-key').value=s.geminiKey;document.getElementById('claude-key').value=s.claudeKey;
  document.getElementById('openai-key').value=s.openaiKey;document.getElementById('ollama-endpoint').value=s.ollamaEndpoint;
  document.getElementById('notion-token').value=s.notionToken;document.getElementById('notion-page-id').value=s.notionPageId;}
function openSettings(){document.getElementById('settings-overlay').classList.remove('hidden');loadSettingsToForm();}
function closeSettings(){document.getElementById('settings-overlay').classList.add('hidden');}
function setupTabs(){document.querySelectorAll('.tab-button').forEach(btn=>btn.addEventListener('click',()=>{const t=btn.dataset.tab;
  document.querySelectorAll('.tab-button').forEach(b=>{b.classList.remove('active');b.classList.add('text-slate-500');b.classList.remove('text-slate-300');});
  btn.classList.add('active');btn.classList.remove('text-slate-500');btn.classList.add('text-slate-300');
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.add('hidden'));const el=document.getElementById('tab-'+t);if(el)el.classList.remove('hidden');}));}
function setupEventListeners(){
  document.querySelectorAll('.activity-btn[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  document.getElementById('open-command-btn').addEventListener('click',openPalette);
  document.getElementById('open-settings-btn').addEventListener('click',openSettings);
  document.getElementById('lib-new-note').addEventListener('click',createNote);
  document.getElementById('dash-new-note').addEventListener('click',createNote);
  document.getElementById('dash-open-graph').addEventListener('click',()=>setView('graph'));
  document.getElementById('lib-search').addEventListener('input',e=>{state.searchQuery=e.target.value;renderTree();});
  document.getElementById('back-to-library').addEventListener('click',()=>setView('library'));
  document.getElementById('move-note-btn').addEventListener('click',openMoveModal);
  document.getElementById('move-cancel').addEventListener('click',()=>document.getElementById('move-overlay').classList.add('hidden'));
  document.getElementById('toggle-ai-btn').addEventListener('click',toggleAiDrawer);
  document.getElementById('close-ai-btn').addEventListener('click',toggleAiDrawer);
  document.getElementById('add-child-btn').addEventListener('click',()=>{if(state.currentNote)createChildNote(state.currentNote.id);});
  document.getElementById('pin-current-btn').addEventListener('click',()=>{if(state.currentNote)togglePin(state.currentNote.id);});
  document.getElementById('graph-reset').addEventListener('click',()=>{if(graphInstance)graphInstance.zoomToFit(400);});
  document.getElementById('graph-rotate').addEventListener('click',function(){if(!graphInstance)return;
    const c=graphInstance.controls();c.autoRotate=!c.autoRotate;this.classList.toggle('active',c.autoRotate);});
  const pInput=document.getElementById('palette-input');
  pInput.addEventListener('input',()=>renderPalette(pInput.value));
  pInput.addEventListener('keydown',e=>{
    if(e.key==='ArrowDown'){e.preventDefault();paletteIndex=Math.min(paletteIndex+1,paletteItems.length-1);updatePaletteSel();}
    else if(e.key==='ArrowUp'){e.preventDefault();paletteIndex=Math.max(paletteIndex-1,0);updatePaletteSel();}
    else if(e.key==='Enter'){e.preventDefault();executePalette();}
    else if(e.key==='Escape'){closePalette();}});
  document.getElementById('palette-overlay').addEventListener('click',e=>{if(e.target.id==='palette-overlay')closePalette();});
  document.getElementById('note-title').addEventListener('input',()=>{scheduleSave();updateStats();});
  const contentEl=document.getElementById('note-content');
  contentEl.addEventListener('input',e=>{scheduleSave();handleEditorInput(e);});
  contentEl.addEventListener('blur',()=>setTimeout(hideWikilinkModal,200));
  contentEl.addEventListener('keydown',e=>{
    if(e.key==='Escape')hideWikilinkModal();
    if(e.key==='Tab'){e.preventDefault();const s=contentEl.selectionStart,en=contentEl.selectionEnd;contentEl.setRangeText('  ',s,en,'end');contentEl.selectionStart=contentEl.selectionEnd=s+2;scheduleSave();return;}
    const mod=e.ctrlKey||e.metaKey;
    if(mod&&e.key==='b'){e.preventDefault();applyMd('bold');}
    if(mod&&e.key==='i'){e.preventDefault();applyMd('italic');}
    if(mod&&e.key==='k'){e.preventDefault();applyMd('link');}});
  contentEl.addEventListener('click',e=>{if(!(e.ctrlKey||e.metaKey))return;
    const pos=contentEl.selectionStart,val=contentEl.value;const before=val.lastIndexOf('[[',pos);if(before===-1)return;
    const close=val.indexOf(']]',before);if(close===-1||pos>close+2)return;
    const name=val.substring(before+2,close);if(name)openNoteByTitle(name);});
  document.querySelectorAll('[data-md]').forEach(b=>b.addEventListener('click',()=>applyMd(b.dataset.md)));
  document.querySelectorAll('.mode-btn').forEach(b=>b.addEventListener('click',()=>setEditorMode(b.dataset.mode)));
  document.getElementById('outline-btn').addEventListener('click',e=>{e.stopPropagation();toggleOutlineMenu();});
  document.addEventListener('click',e=>{const wrap=document.getElementById('outline-wrap');const menu=document.getElementById('outline-menu');
    if(wrap&&menu&&!wrap.contains(e.target))menu.classList.add('hidden');});
  document.getElementById('backlinks-toggle').addEventListener('click',()=>{state.backlinksOpen=!state.backlinksOpen;
    document.getElementById('backlinks-list').classList.toggle('hidden',!state.backlinksOpen);
    document.getElementById('backlinks-chevron').style.transform=state.backlinksOpen?'rotate(180deg)':'rotate(0deg)';});
  document.getElementById('ai-suggest-links-btn').addEventListener('click',aiSuggestLinks);
  document.querySelectorAll('#theme-selector .theme-btn').forEach(b=>b.addEventListener('click',()=>{setGrowthTheme(b.dataset.theme);refreshGrowth();}));
  document.getElementById('chat-send-btn').addEventListener('click',sendChatMessage);
  document.getElementById('chat-input').addEventListener('keypress',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChatMessage();}});
  document.querySelectorAll('.ai-action-btn').forEach(b=>b.addEventListener('click',()=>handleAIAction(b.dataset.action)));
  document.getElementById('add-template-btn').addEventListener('click',()=>openTemplateModal());
  document.getElementById('template-close-btn').addEventListener('click',closeTemplateModal);
  document.getElementById('template-cancel-btn').addEventListener('click',closeTemplateModal);
  document.getElementById('template-save-btn').addEventListener('click',saveTemplate);
  document.getElementById('template-delete-btn').addEventListener('click',deleteTemplate);
  document.getElementById('template-overlay').addEventListener('click',e=>{if(e.target.id==='template-overlay')closeTemplateModal();});
  document.getElementById('send-to-notion-btn').addEventListener('click',sendToNotion);
  document.getElementById('import-from-notion-btn').addEventListener('click',()=>openNotionImportModal());
  document.getElementById('notion-close-btn').addEventListener('click',closeNotionModal);
  document.getElementById('notion-overlay').addEventListener('click',e=>{if(e.target.id==='notion-overlay')closeNotionModal();});
  document.getElementById('notion-search-input').addEventListener('keypress',e=>{if(e.key==='Enter')loadNotionPages(e.target.value.trim());});
  document.getElementById('notion-refresh-btn').addEventListener('click',()=>loadNotionPages(document.getElementById('notion-search-input').value.trim()));
  document.getElementById('settings-close-btn').addEventListener('click',closeSettings);
  document.getElementById('settings-cancel-btn').addEventListener('click',closeSettings);
  document.getElementById('settings-save-btn').addEventListener('click',()=>{saveSettingsToStorage();closeSettings();});
  document.getElementById('settings-overlay').addEventListener('click',e=>{if(e.target.id==='settings-overlay')closeSettings();});
  setupTabs();
  document.getElementById('export-all-btn').addEventListener('click',exportAllNotes);
  document.getElementById('import-data-btn').addEventListener('click',()=>document.getElementById('import-file-input').click());
  document.getElementById('import-file-input').addEventListener('change',e=>{const f=e.target.files&&e.target.files[0];if(f){importNotes(f);e.target.value='';}});
  document.getElementById('reset-all-btn').addEventListener('click',resetAllData);
  document.addEventListener('keydown',e=>{
    const mod=e.ctrlKey||e.metaKey;
    if(mod&&e.key==='k'){e.preventDefault();openPalette();}
    if(mod&&e.key==='j'){e.preventDefault();if(currentView==='editor')toggleAiDrawer();}
    if(mod&&e.key==='n'){e.preventDefault();createNote();}
    if(mod&&e.key===','){e.preventDefault();openSettings();}});
}
function configureMarked(){if(typeof marked!=='undefined')marked.setOptions({breaks:true,gfm:true,headerIds:false,mangle:false});}
async function init(){
  configureMarked();setupEventListeners();lucide.createIcons();
  seedTemplates();renderTemplateList();
  setView('library');
  try{const notes=await TheGazeDB.getAllNotes();if(notes.length>0){await loadNote(notes[0].id);}}catch(e){console.error(e);}
  await renderNotesList();refreshGrowth();
  const s=getSettings();
  if(!s.geminiKey&&!s.claudeKey&&!s.openaiKey&&!s.notionToken)setTimeout(()=>showToast('設定からAPIキーを入力してください','success'),1500);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
