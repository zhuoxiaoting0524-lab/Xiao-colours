const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
let notes=[
 {id:1,title:"本周想做的三件小事",body:"整理桌面。读完手边那本书。给自己留一个没有安排的下午。",color:"sage",date:"20 OCT"},
 {id:2,title:"A quiet reminder",body:"不用一次把所有事情都完成。先做好今天最重要的一件。",color:"ivory",date:"19 OCT"},
 {id:3,title:"下次采购",body:"燕麦、酸奶、咖啡豆、洗衣液、两支黑色签字笔。",color:"blue",date:"18 OCT"},
 {id:4,title:"最近喜欢",body:"清晨的风，洗干净的床单，傍晚六点的天空，还有不赶时间的散步。",color:"rose",date:"16 OCT"},
 {id:5,title:"灵感碎片",body:"页面不需要塞满。留白不是没有内容，而是让重要的东西被看见。",color:"ivory",date:"12 OCT"},
 {id:6,title:"周末",body:"去市场买花，然后试着做一道从来没有做过的菜。",color:"sage",date:"10 OCT"}
];
let noteId=null,noteColor="ivory",selectedDay=20,taskId=null,placeFilter="all",activePlace=null;
const days=[{w:"MON",d:19},{w:"TUE",d:20},{w:"WED",d:21},{w:"THU",d:22},{w:"FRI",d:23},{w:"SAT",d:24},{w:"SUN",d:25}];
let tasks=[{id:1,day:20,time:"09:30",title:"整理本周计划",tag:"Personal",done:true},{id:2,day:20,time:"13:00",title:"完成阅读笔记",tag:"Study",done:false},{id:3,day:20,time:"18:30",title:"散步四十分钟",tag:"Health",done:false},{id:4,day:22,time:"10:00",title:"准备项目材料",tag:"Study",done:false},{id:5,day:24,time:"15:30",title:"买花和咖啡豆",tag:"Home",done:false}];
const templates={
  Reykjavík:{country:"Iceland",coordinates:[-21.9426,64.1466]},
  Seoul:{country:"South Korea",coordinates:[126.978,37.5665]},
  Marrakech:{country:"Morocco",coordinates:[-7.9811,31.6295]}
};
let places=[
  {id:1,name:"Barcelona",country:"Spain",status:"visited",note:"熟悉的街道、海风和缓慢的傍晚。",coordinates:[2.1734,41.3851],date:"2026 · CURRENT"},
  {id:2,name:"Lisbon",country:"Portugal",status:"visited",note:"坡道、电车和阳光落在旧墙上的颜色。",coordinates:[-9.1393,38.7223],date:"2025 · SPRING"},
  {id:3,name:"Tokyo",country:"Japan",status:"wish",note:"想去认真走一次城市，也想看安静的近郊。",coordinates:[139.6917,35.6895],date:"SOMEDAY"},
  {id:4,name:"Iceland",country:"Iceland",status:"wish",note:"想看冬天的海岸、风和很远的光。",coordinates:[-19.0208,64.9631],date:"SOMEDAY"}
];
let mapInstance=null,mapModule=null,mapPromise=null;
let mapMarkers=[];

function route(name,push=true){name=$(`[data-screen="${name}"]`)?name:"home";$$('[data-screen]').forEach(x=>x.classList.toggle('active',x.dataset.screen===name));document.body.dataset.route=name;if(push)history.pushState(null,"",`#${name}`);window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});$('#app').focus({preventScroll:true});if(name==='footprints')requestAnimationFrame(()=>initFootprintsMap())}
function open(id){const d=$(`#${id}`);d.showModal?d.showModal():d.setAttribute('open','')}
function close(id){const d=$(`#${id}`);d.close?d.close():d.removeAttribute('open')}

function renderNotes(){const q=$('#note-search').value.trim().toLowerCase(),found=notes.filter(n=>`${n.title} ${n.body}`.toLowerCase().includes(q));$('#note-count').textContent=notes.length;$('#note-empty').hidden=!!found.length;$('#note-wall').replaceChildren(...found.map(n=>{const b=document.createElement('button');b.className='note';b.type='button';b.dataset.color=n.color;b.innerHTML='<time></time><h3></h3><p></p>';b.querySelector('time').textContent=n.date;b.querySelector('h3').textContent=n.title;b.querySelector('p').textContent=n.body;b.onclick=()=>editNote(n.id);return b}))}
function editNote(id=null){noteId=id;const n=notes.find(x=>x.id===id);noteColor=n?.color||'ivory';$('#note-dialog-title').textContent=n?'打开便签':'新的便签';$('#note-title').value=n?.title||'';$('#note-body').value=n?.body||'';$('#note-meta').textContent=n?`最后整理：${n.date}`:'仅为原型，不会写入正式数据';$('#delete-note').hidden=!n;$$('[data-color]').forEach(b=>b.classList.toggle('active',b.dataset.color===noteColor));open('note-dialog')}
function saveNote(e){e.preventDefault();const data={title:$('#note-title').value.trim()||'Untitled note',body:$('#note-body').value.trim(),color:noteColor,date:'JUST NOW'};if(noteId)notes=notes.map(n=>n.id===noteId?{...n,...data}:n);else notes.unshift({id:Date.now(),...data});renderNotes();close('note-dialog')}

function renderWeek(){$('#week').replaceChildren(...days.map(x=>{const b=document.createElement('button');b.className=`day${x.d===selectedDay?' active':''}${tasks.some(t=>t.day===x.d)?' has':''}`;b.innerHTML=`<span>${x.w}</span><b>${x.d}</b><i></i>`;b.onclick=()=>{selectedDay=x.d;renderWeek();renderMonth();renderTasks()};return b}))}
function renderMonth(){$('#month').replaceChildren(...Array.from({length:31},(_,i)=>{const b=document.createElement('button');b.textContent=i+1;b.classList.toggle('active',i+1===selectedDay);b.onclick=()=>{selectedDay=i+1;renderMonth();renderWeek();renderTasks()};return b}))}
function renderTasks(){const list=tasks.filter(t=>t.day===selectedDay),info=days.find(x=>x.d===selectedDay);$('#day-label').textContent=selectedDay===20?`TODAY · ${info?.w||'DAY'}`:info?.w||'OCTOBER';$('#day-title').textContent=`October ${selectedDay}`;if(!list.length){$('#tasks').innerHTML='<p class="empty">这一天还没有任务。点击 Add task 创建一个。</p>';return}$('#tasks').replaceChildren(...list.map(t=>{const row=document.createElement('article');row.className=`task${t.done?' done':''}`;row.innerHTML='<button class="check"></button><time></time><h4></h4><span><i class="tag"></i><button class="edit">···</button></span>';row.querySelector('time').textContent=t.time||'ALL DAY';row.querySelector('h4').textContent=t.title;row.querySelector('.tag').textContent=t.tag;row.querySelector('.check').onclick=()=>{t.done=!t.done;renderTasks()};row.querySelector('.edit').onclick=()=>editTask(t.id);return row}))}
function editTask(id=null){taskId=id;const t=tasks.find(x=>x.id===id);$('#task-dialog-title').textContent=t?'编辑任务':'新的任务';$('#task-title').value=t?.title||'';$('#task-time').value=t?.time||'09:00';$('#task-tag').value=t?.tag||'Personal';$('#delete-task').hidden=!t;open('task-dialog')}
function saveTask(e){e.preventDefault();const data={title:$('#task-title').value.trim(),time:$('#task-time').value,tag:$('#task-tag').value};if(taskId)tasks=tasks.map(t=>t.id===taskId?{...t,...data}:t);else tasks.push({id:Date.now(),day:selectedDay,done:false,...data});renderWeek();renderTasks();close('task-dialog')}

function filteredPlaces(){const q=$('#place-search').value.trim().toLowerCase();return places.filter(p=>(placeFilter==='all'||p.status===placeFilter)&&`${p.name} ${p.country}`.toLowerCase().includes(q))}
function renderPlaces(){const list=filteredPlaces();$('#place-list').replaceChildren(...list.map(p=>{const b=document.createElement('button');b.className='place';b.dataset.status=p.status;b.innerHTML='<span><b></b><small></small></span><i></i>';b.querySelector('b').textContent=p.name;b.querySelector('small').textContent=p.country;b.onclick=()=>showPlace(p.id);return b}));syncMapMarkers()}

function syncMapMarkers(){
  mapMarkers.forEach(marker=>marker.remove());
  mapMarkers=[];
  if(!mapInstance||!mapModule)return;
  filteredPlaces().forEach(place=>{
    const pin=document.createElement('button');
    pin.type='button';
    pin.className=`map-pin${activePlace===place.id?' active':''}`;
    pin.dataset.status=place.status;
    pin.setAttribute('aria-label',`${place.name}，${place.status==='visited'?'去过':'想去'}`);
    pin.addEventListener('pointerdown',event=>event.stopPropagation());
    pin.onclick=event=>{event.preventDefault();event.stopPropagation();showPlace(place.id)};
    const marker=new mapModule.Marker({element:pin,anchor:'center'}).setLngLat(place.coordinates).addTo(mapInstance);
    mapMarkers.push(marker);
  });
}

function showPlace(id){
  activePlace=id;
  const p=places.find(x=>x.id===id),box=$('#place-detail');
  if(!p)return;
  box.innerHTML='<header><span><p class="overline"></p><h3></h3></span><button>×</button></header><span></span><p></p><footer></footer>';
  box.querySelector('.overline').textContent=p.country.toUpperCase();
  box.querySelector('h3').textContent=p.name;
  box.querySelector(':scope>span').textContent=p.status==='visited'?'去过 · VISITED':'想去 · WISH LIST';
  box.querySelector(':scope>p').textContent=p.note;
  box.querySelector('footer').textContent=p.date;
  box.querySelector('header button').onclick=()=>{box.hidden=true;activePlace=null;syncMapMarkers()};
  box.hidden=false;
  syncMapMarkers();
  if(mapInstance)mapInstance.flyTo({center:p.coordinates,zoom:p.name==='Iceland'?6.4:11.5,bearing:0,pitch:0,duration:matchMedia('(prefers-reduced-motion:reduce)').matches?0:1500});
}

function showWorld(animated=true){
  if(!mapInstance)return;
  activePlace=null;
  $('#place-detail').hidden=true;
  syncMapMarkers();
  mapInstance.fitBounds([[-170,-55],[170,76]],{padding:18,bearing:0,pitch:0,duration:!animated||matchMedia('(prefers-reduced-motion:reduce)').matches?0:1200});
}

async function initFootprintsMap(force=false){
  if(mapInstance&&!force){mapInstance.resize();return mapInstance}
  if(mapPromise&&!force)return mapPromise;
  if(force&&mapInstance){mapMarkers.forEach(marker=>marker.remove());mapMarkers=[];mapInstance.remove();mapInstance=null}
  const loading=$('#map-loading'),errorBox=$('#map-error');
  loading.hidden=false;errorBox.hidden=true;$('#footprints-map').classList.remove('ready');
  mapPromise=(async()=>{
    try{
      mapModule=await import('https://unpkg.com/maplibre-gl@6.15.0/dist/maplibre-gl.mjs');
      mapInstance=new mapModule.Map({container:'footprints-map',style:'https://tiles.openfreemap.org/styles/liberty',center:[8,22],zoom:1,minZoom:0,maxZoom:17,renderWorldCopies:false,attributionControl:true});
      mapInstance.addControl(new mapModule.NavigationControl({showCompass:true,showZoom:true}),'top-right');
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('地图服务响应超时')),15000);
        mapInstance.once('load',()=>{clearTimeout(timer);resolve()});
        mapInstance.once('error',event=>{if(!mapInstance.loaded()){clearTimeout(timer);reject(event.error||new Error('地图资源加载失败'))}});
      });
      loading.hidden=true;$('#footprints-map').classList.add('ready');mapInstance.resize();showWorld(false);syncMapMarkers();
      return mapInstance;
    }catch(error){
      console.error('Footprints map failed:',error);
      loading.hidden=true;errorBox.hidden=false;$('#map-error-message').textContent=`${error?.message||'地图资源加载失败'}。请检查网络连接后重试。`;
      if(mapInstance){mapInstance.remove();mapInstance=null}
      return null;
    }finally{mapPromise=null}
  })();
  return mapPromise;
}

$$('[data-route]').forEach(b=>b.onclick=()=>route(b.dataset.route));window.onpopstate=()=>route(location.hash.slice(1)||'home',false);
$('#account').onclick=()=>{const p=$('#account-pop');p.hidden=!p.hidden;$('#account').setAttribute('aria-expanded',String(!p.hidden))};document.addEventListener('click',e=>{if(!e.target.closest('#account,#account-pop')){$('#account-pop').hidden=true;$('#account').setAttribute('aria-expanded','false')}});
$('#note-search').oninput=renderNotes;$('#add-note').onclick=()=>editNote();$('#note-form').onsubmit=saveNote;$('#delete-note').onclick=()=>{if(noteId)notes=notes.filter(n=>n.id!==noteId);renderNotes();close('note-dialog')};$$('[data-color]').forEach(b=>b.onclick=()=>{noteColor=b.dataset.color;$$('[data-color]').forEach(x=>x.classList.toggle('active',x===b))});
$$('[data-view]').forEach(b=>b.onclick=()=>{const month=b.dataset.view==='month';$('#week').hidden=month;$('#month').hidden=!month;$$('[data-view]').forEach(x=>x.classList.toggle('active',x===b))});$('#add-task').onclick=()=>editTask();$('#task-form').onsubmit=saveTask;$('#delete-task').onclick=()=>{if(taskId)tasks=tasks.filter(t=>t.id!==taskId);renderWeek();renderTasks();close('task-dialog')};
$('#place-search').oninput=renderPlaces;$$('[data-filter]').forEach(b=>b.onclick=()=>{placeFilter=b.dataset.filter;$$('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));renderPlaces()});$('#add-place').onclick=()=>open('place-dialog');$('#place-form').onsubmit=e=>{e.preventDefault();const name=$('#place-name').value,t=templates[name];places.push({id:Date.now(),name,country:t.country,status:$('#place-status').value,note:$('#place-note').value.trim()||'一段等待被写下的地点记忆。',coordinates:t.coordinates,date:'NEW PLACE'});renderPlaces();close('place-dialog');showPlace(places.at(-1).id)};$('#world-view').onclick=showWorld;$('#retry-map').onclick=()=>initFootprintsMap(true);
$$('[data-close]').forEach(b=>b.onclick=()=>close(b.dataset.close));$$('dialog').forEach(d=>d.onclick=e=>{if(e.target===d)close(d.id)});
renderNotes();renderWeek();renderMonth();renderTasks();renderPlaces();route(location.hash.slice(1)||'home',false);
