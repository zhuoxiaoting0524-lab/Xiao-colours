import { api, uploadBytes } from "./auth-client.js";

const $ = (selector, root = document) => root?.querySelector(selector);
const $$ = (selector, root = document) => [...(root?.querySelectorAll(selector) || [])];
const COUNTRY_NAMES = { JP:["日本","Japan"], CN:["中国","China"], FR:["法国","France"], IT:["意大利","Italy"], GB:["英国","United Kingdom"], US:["美国","United States"], ES:["西班牙","Spain"], DE:["德国","Germany"], KR:["韩国","South Korea"], TH:["泰国","Thailand"] };
const CATEGORY_LABELS = { food:"美食",cafe:"咖啡与饮品",sight:"景点",shopping:"购物",stay:"住宿",entertainment:"娱乐",other:"其他",transport:"交通",activity:"门票与活动" };

let authState;
let notify = () => {};
let countries = [];
let current = null;
let activeTab = "overview";
let mounted = false;
let routeMap = null;

function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char])); }
function namesFor(country) {
  const code = country.country_code || country.archive?.country_code;
  const defaults = COUNTRY_NAMES[code] || [code, code];
  return [country.archive?.name_zh || defaults[0], country.archive?.name_en || defaults[1]];
}
function amount(minor, currency) { return new Intl.NumberFormat("zh-CN", { style:"currency", currency, maximumFractionDigits:2 }).format(Number(minor || 0) / 100); }
function setMode(mode) {
  $$('[data-footprints-mode]').forEach((button) => button.classList.toggle("active", button.dataset.footprintsMode === mode));
  $$('[data-footprints-globe]').forEach((node) => { node.hidden = mode !== "globe"; });
  $("#country-archive-shell").hidden = mode !== "countries";
  if (mode === "countries") loadCountries();
}

function renderCountryList() {
  const box = $("#country-archive-countries");
  if (!countries.length) {
    box.innerHTML = '<div class="country-list-empty"><p>还没有可建立档案的国家。</p><button type="button" data-back-globe>去添加地点</button></div>';
    $("[data-back-globe]", box)?.addEventListener("click", () => setMode("globe"));
    return;
  }
  box.innerHTML = countries.map((country) => {
    const [zh,en] = namesFor(country); const code = country.country_code;
    return `<button type="button" class="country-list-card ${current?.archive?.country_code === code ? "active" : ""}" data-country="${code}"><span class="country-list-symbol">${escapeHtml(code)}</span><span><b>${escapeHtml(zh)} <em>${escapeHtml(en)}</em></b><small>${Number(country.visited_count||0)} 个去过地点 · ${Number(country.wish_count||0)} 个想去地点</small></span><i>›</i></button>`;
  }).join("");
  $$('[data-country]', box).forEach((button) => button.addEventListener("click", () => openCountry(button.dataset.country)));
}

async function loadCountries() {
  try {
    const data = await api("/api/me/country-archives"); countries = data.countries || []; renderCountryList();
    if (!current && countries[0]) await openCountry(countries[0].country_code);
  } catch (error) { notify(error.message, true); }
}

async function openCountry(code) {
  const country = countries.find((item) => item.country_code === code);
  const [nameZh,nameEn] = namesFor(country || { country_code:code });
  try {
    let data;
    try { data = await api(`/api/me/country-archives/${code}`); }
    catch (error) {
      if (error.status !== 404) throw error;
      data = await api(`/api/me/country-archives/${code}`, { method:"POST", csrfToken:authState.csrfToken, body:{ nameZh,nameEn } });
    }
    current = data; renderCountryList(); renderArchive();
  } catch (error) { notify(error.message, true); }
}

function archiveHeader() {
  const a=current.archive; const title=[a.name_zh||a.country_code,a.name_en].filter(Boolean).join(" · ");
  return `<header class="country-hero"><button type="button" class="country-mobile-back" aria-label="返回国家列表">‹</button><div><small>COUNTRY TRAVEL ARCHIVE</small><h3>${escapeHtml(title)}</h3><p>所有在 ${escapeHtml(a.name_zh||a.country_code)} 的地点、路线、体验与花销。</p></div><span>${escapeHtml(a.country_code)}</span></header>
    <nav class="country-tabs" role="tablist">${[["overview","总览"],["routes","路线"],["experiences","吃喝玩乐"],["expenses","花销"]].map(([id,label])=>`<button type="button" data-country-tab="${id}" class="${activeTab===id?"active":""}">${label}</button>`).join("")}</nav>`;
}

function totalsHtml() {
  const rows=Object.entries(current.totals||{}); return rows.length ? rows.map(([currency,total])=>`<span><b>${amount(total,currency)}</b><small>${currency}</small></span>`).join("") : '<p class="archive-muted">尚未记录花销</p>';
}
function overviewHtml() {
  const recent=[...(current.experiences||[])].slice(0,4);
  return `<div class="country-stat-grid"><article><small>去过地点</small><b>${current.stats.visited}</b></article><article><small>旅行照片</small><b>${current.stats.photos}</b></article><article class="currency-stat"><small>花销（按币种）</small><div>${totalsHtml()}</div></article></div>
  <div class="country-overview-grid"><section class="archive-card"><header><h4>已保存地点</h4><span>${current.footprints.length}</span></header><div class="archive-place-list">${current.footprints.length?current.footprints.map(p=>`<div><i class="${p.status}">●</i><span><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.location_label||"")}</small></span><em>${p.status==="visited"?"去过":"想去"}</em></div>`).join(""):empty("还没有地点")}</div></section>
  <section class="archive-card"><header><h4>最近添加</h4></header><div class="archive-recent-list">${recent.length?recent.map(x=>`<button type="button" data-edit-experience="${x.id}"><span>${CATEGORY_LABELS[x.category]||"记录"}</span><b>${escapeHtml(x.name)}</b><small>${escapeHtml(x.city||x.experience_date||"")}</small></button>`).join(""):empty("还没有体验记录")}</div></section></div>`;
}
function empty(label) { return `<div class="archive-empty"><span>✦</span><p>${label}</p></div>`; }
function experiencesHtml() {
  return `<div class="archive-section-head"><div><h4>吃喝玩乐</h4><p>每个地点一张主要记录卡片，照片与消费直接归属于此记录。</p></div><button type="button" class="archive-primary" data-add-experience>＋ 添加记录</button></div>
  <div class="experience-grid">${current.experiences.length?current.experiences.map(x=>`<article class="experience-card">${x.photos?.[0]?`<img src="${x.photos[0].url}" alt="${escapeHtml(x.name)} 的照片" loading="lazy">`:`<div class="experience-placeholder">${CATEGORY_LABELS[x.category]||"旅行记录"}</div>`}<div><small>${CATEGORY_LABELS[x.category]||x.category}${x.city?` · ${escapeHtml(x.city)}`:""}</small><h4>${escapeHtml(x.name)}</h4><p>${escapeHtml(x.note||"暂无感受记录")}</p><footer><span>${x.rating?"★".repeat(x.rating):"未评分"}</span><span>${x.expense?amount(x.expense.amount_minor,x.expense.currency):""}</span><button type="button" data-edit-experience="${x.id}">编辑</button></footer></div></article>`).join(""):empty("还没有吃喝玩乐记录")}</div>`;
}
function expensesHtml() {
  const currencies=Object.keys(current.totals||{}); const chosen=currencies[0]; const cat=current.categories?.[chosen]||{}; const total=current.totals?.[chosen]||0;
  return `<div class="archive-section-head"><div><h4>多币种花销</h4><p>不同币种分别统计，不进行未经说明的换算。</p></div><button type="button" class="archive-primary" data-add-expense>＋ 添加花销</button></div><div class="currency-totals">${totalsHtml()}</div>
  ${chosen?`<section class="archive-card category-chart"><header><h4>${chosen} 分类</h4></header>${Object.entries(cat).map(([key,value])=>`<div><span>${CATEGORY_LABELS[key]||key}</span><i><b style="width:${total?Math.round(value/total*100):0}%"></b></i><strong>${amount(value,chosen)}</strong></div>`).join("")}</section>`:""}
  <div class="expense-list">${current.expenses.length?current.expenses.map(x=>`<article><span>${CATEGORY_LABELS[x.category]||x.category}</span><div><b>${escapeHtml(x.title)}</b><small>${escapeHtml(x.expense_date||"日期未填写")}${x.experience_id?" · 来自体验记录":""}</small></div><strong>${amount(x.amount_minor,x.currency)}</strong><button type="button" data-delete-expense="${x.id}" aria-label="删除费用">×</button></article>`).join(""):empty("还没有花销记录")}</div>`;
}
function routesHtml() {
  const planned=current.routes.filter(x=>x.route_type==="planned"), actual=current.routes.filter(x=>x.route_type==="actual");
  return `<div class="archive-section-head"><div><h4>计划路线与实际足迹</h4><p>路线仅按保存顺序连接坐标，不代表真实道路导航。</p></div><button type="button" class="archive-primary" data-add-route>＋ 添加 Day</button></div><div class="country-route-map" id="country-route-map"><span>正在加载路线地图…</span></div>
  <div class="route-columns"><section class="archive-card"><header><h4>计划路线</h4><span>${planned.length} 天</span></header>${routeDays(planned,"planned")}</section><section class="archive-card"><header><h4>实际足迹</h4><span>${actual.length} 天</span></header>${routeDays(actual,"actual")}</section></div>`;
}
function routeDays(days,type) { return days.length?days.map(d=>`<article class="route-day"><header><b>Day ${d.day_number}</b><small>${escapeHtml(d.route_date||"")}</small><button type="button" data-add-route-item="${d.id}" data-route-type="${type}">＋ 地点</button></header>${d.items.length?d.items.map((x,i)=>`<div><i>${i+1}</i><span><b>${escapeHtml(x.name)}</b><small>${escapeHtml(x.location_label||"")}</small></span><button data-move-route="${x.id}" data-order="${Math.max(0,i-1)}">↑</button><button data-delete-route="${x.id}">×</button></div>`).join(""):empty("这一天还没有地点")}</article>`).join(""):empty(type==="planned"?"还没有计划路线":"还没有实际足迹"); }

function renderArchive() {
  const main=$("#country-archive-main"); if(!current) return;
  const content=activeTab==="experiences"?experiencesHtml():activeTab==="expenses"?expensesHtml():activeTab==="routes"?routesHtml():overviewHtml();
  main.innerHTML=archiveHeader()+`<section class="country-tab-panel">${content}</section>`;
  $$('[data-country-tab]',main).forEach(b=>b.addEventListener("click",()=>{activeTab=b.dataset.countryTab;renderArchive();}));
  $(".country-mobile-back",main)?.addEventListener("click",()=>$("#country-archive-shell").classList.remove("country-selected"));
  $$('[data-edit-experience]',main).forEach(b=>b.addEventListener("click",()=>openExperience(current.experiences.find(x=>x.id===b.dataset.editExperience))));
  $('[data-add-experience]',main)?.addEventListener("click",()=>openExperience());
  $('[data-add-expense]',main)?.addEventListener("click",()=>openExpense());
  $$('[data-delete-expense]',main).forEach(b=>b.addEventListener("click",()=>deleteExpense(b.dataset.deleteExpense)));
  $('[data-add-route]',main)?.addEventListener("click",openRouteDay);
  $$('[data-add-route-item]',main).forEach(b=>b.addEventListener("click",()=>openRouteItem(b.dataset.addRouteItem,b.dataset.routeType)));
  $$('[data-move-route]',main).forEach(b=>b.addEventListener("click",()=>moveRoute(b.dataset.moveRoute,b.dataset.order)));
  $$('[data-delete-route]',main).forEach(b=>b.addEventListener("click",()=>deleteRoute(b.dataset.deleteRoute)));
  if (activeTab === "routes") initRouteMap();
  $("#country-archive-shell").classList.add("country-selected");
}

async function initRouteMap() {
  const container = $("#country-route-map"); if (!container) return;
  routeMap?.remove?.(); routeMap = null;
  const items = current.routes.flatMap((day) => day.items.map((item) => ({ ...item, routeType: day.route_type, day: day.day_number })));
  if (!items.length) { container.innerHTML = "<span>添加路线地点后，会在这里显示真实坐标与顺序示意。</span>"; return; }
  try {
    const maplibregl = await import("https://unpkg.com/maplibre-gl@6.16.0/dist/maplibre-gl.mjs");
    routeMap = new maplibregl.Map({ container, style:"https://tiles.openfreemap.org/styles/positron", center:[items[0].longitude,items[0].latitude], zoom:5, attributionControl:true });
    routeMap.addControl(new maplibregl.NavigationControl({showCompass:false}),"top-right");
    routeMap.on("load",()=>{
      for (const type of ["planned","actual"]) {
        const coords=items.filter(x=>x.routeType===type).map(x=>[Number(x.longitude),Number(x.latitude)]);
        if(coords.length>1){routeMap.addSource(`route-${type}`,{type:"geojson",data:{type:"Feature",geometry:{type:"LineString",coordinates:coords}}});routeMap.addLayer({id:`route-${type}`,type:"line",source:`route-${type}`,paint:{"line-color":type==="actual"?"#738B7B":"#D9A58C","line-width":3,"line-dasharray":type==="planned"?[2,2]:[1,0]}});}
      }
      const bounds=new maplibregl.LngLatBounds();
      items.forEach((item,index)=>{bounds.extend([item.longitude,item.latitude]);const marker=document.createElement("button");marker.className=`country-route-marker ${item.routeType}`;marker.textContent=String(index+1);marker.title=`Day ${item.day} · ${item.name}`;new maplibregl.Marker({element:marker}).setLngLat([item.longitude,item.latitude]).setPopup(new maplibregl.Popup({offset:18}).setText(`Day ${item.day} · ${item.name}`)).addTo(routeMap);});
      if(items.length>1)routeMap.fitBounds(bounds,{padding:45,maxZoom:12,duration:matchMedia("(prefers-reduced-motion: reduce)").matches?0:600});
    });
  } catch { container.innerHTML="<span>路线地图暂时无法加载，已保存的路线列表仍可正常使用。</span>"; }
}

function dialog(title, fields) {
  let node=$("#country-editor-dialog"); if(!node){node=document.createElement("dialog");node.id="country-editor-dialog";node.className="dialog country-editor-dialog";document.body.append(node);} node.innerHTML=`<form method="dialog"><header><span><small>COUNTRY ARCHIVE</small><h3>${title}</h3></span><button value="cancel" aria-label="关闭">×</button></header><div class="country-form-fields">${fields}</div><footer><button value="cancel">取消</button><button class="primary" value="save">保存</button></footer></form>`;node.showModal();return node;
}
async function refresh(data) { current=data; renderArchive(); await loadCountries(); }
function openExperience(item=null){const node=dialog(item?"编辑体验记录":"添加体验记录",`<label>名称<input name="name" required maxlength="140" value="${escapeHtml(item?.name||"")}"></label><div class="field-grid"><label>分类<select name="category">${["food","cafe","sight","shopping","stay","entertainment","other"].map(x=>`<option value="${x}" ${item?.category===x?"selected":""}>${CATEGORY_LABELS[x]}</option>`).join("")}</select></label><label>城市<input name="city" maxlength="140" value="${escapeHtml(item?.city||"")}"></label></div><div class="field-grid"><label>日期<input type="date" name="date" value="${item?.experience_date||""}"></label><label>评分（1-5）<input type="number" name="rating" min="1" max="5" value="${item?.rating||""}"></label></div><label>个人感受<textarea name="note" rows="4">${escapeHtml(item?.note||"")}</textarea></label><div class="field-grid"><label>消费金额<input name="amount" inputmode="decimal" value="${item?.expense?Number(item.expense.amount_minor)/100:""}"></label><label>币种<input name="currency" maxlength="3" value="${item?.expense?.currency||"JPY"}"></label></div><label>添加照片<input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple></label>${item?.photos?.length?`<div class="existing-photos">${item.photos.map(p=>`<span><img src="${p.url}" alt=""><button type="button" data-remove-photo="${p.id}">×</button></span>`).join("")}</div>`:""}`);
  $$('[data-remove-photo]',node).forEach(b=>b.addEventListener("click",async()=>{if(!confirm("删除这张照片？"))return;await api(`/api/me/country-archives/${current.archive.country_code}/experiences/${item.id}/photos/${b.dataset.removePhoto}`,{method:"DELETE",csrfToken:authState.csrfToken,body:{}});await openCountry(current.archive.country_code);}));
  node.addEventListener("close",async()=>{if(node.returnValue!=="save")return;const form=new FormData($("form",node));try{const body=Object.fromEntries([...form.entries()].filter(([key])=>key!=="photos"));const data=await api(`/api/me/country-archives/${current.archive.country_code}/experiences${item?`/${item.id}`:""}`,{method:item?"PATCH":"POST",csrfToken:authState.csrfToken,body});const saved=item?data.experiences.find(x=>x.id===item.id):data.experiences[0];for(const file of form.getAll("photos").filter(x=>x?.size)){const compressed=await compressImage(file);await uploadBytes(`/api/me/country-archives/${current.archive.country_code}/experiences/${saved.id}/photos`,{bytes:compressed.bytes,contentType:compressed.type,csrfToken:authState.csrfToken});}await openCountry(current.archive.country_code);notify("旅行记录已保存");}catch(error){notify(error.message,true);}}, {once:true});}
async function compressImage(file){const bitmap=await createImageBitmap(file);const scale=Math.min(1,1400/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement("canvas");canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();let quality=.84,blob;do{blob=await new Promise(r=>canvas.toBlob(r,"image/jpeg",quality));quality-=.08;}while(blob?.size>700*1024&&quality>.35);if(!blob||blob.size>700*1024)throw new Error("照片压缩后仍超过 700KB");return{bytes:await blob.arrayBuffer(),type:"image/jpeg"};}
function openExpense(){const node=dialog("添加花销",`<label>名称<input name="title" required maxlength="140"></label><div class="field-grid"><label>分类<select name="category">${["food","stay","transport","activity","shopping","other"].map(x=>`<option value="${x}">${CATEGORY_LABELS[x]}</option>`).join("")}</select></label><label>日期<input type="date" name="date"></label></div><div class="field-grid"><label>金额<input name="amount" required inputmode="decimal"></label><label>币种<input name="currency" value="JPY" maxlength="3" required></label></div><label>备注<textarea name="note" rows="3"></textarea></label>`);node.addEventListener("close",async()=>{if(node.returnValue!=="save")return;try{const body=Object.fromEntries(new FormData($("form",node)));await refresh(await api(`/api/me/country-archives/${current.archive.country_code}/expenses`,{method:"POST",csrfToken:authState.csrfToken,body}));notify("花销已保存");}catch(e){notify(e.message,true);}},{once:true});}
async function deleteExpense(id){if(!confirm("删除这笔花销？"))return;await refresh(await api(`/api/me/country-archives/${current.archive.country_code}/expenses/${id}`,{method:"DELETE",csrfToken:authState.csrfToken,body:{}}));}
function openRouteDay(){const node=dialog("添加路线日期",`<div class="field-grid"><label>类型<select name="routeType"><option value="planned">计划路线</option><option value="actual">实际足迹</option></select></label><label>Day<input name="dayNumber" type="number" min="1" value="1"></label></div><label>日期<input name="date" type="date"></label><label>标题<input name="title" maxlength="140"></label>`);node.addEventListener("close",async()=>{if(node.returnValue!=="save")return;try{await refresh(await api(`/api/me/country-archives/${current.archive.country_code}/routes`,{method:"POST",csrfToken:authState.csrfToken,body:Object.fromEntries(new FormData($("form",node)))}));}catch(e){notify(e.message,true);}},{once:true});}
function openRouteItem(dayId,type){const available=current.footprints.filter(p=>type!=="actual"||p.status==="visited");const node=dialog("添加路线地点",`<label>选择已有地点<select name="footprintId" required><option value="">请选择</option>${available.map(p=>`<option value="${p.id}">${escapeHtml(p.name)} · ${p.status==="visited"?"去过":"想去"}</option>`).join("")}</select></label><label>路线备注<textarea name="note" rows="3"></textarea></label><p class="form-note">${type==="actual"?"实际足迹仅允许选择已明确标记为去过的地点。":"添加计划不会改变地点的去过状态。"}</p>`);node.addEventListener("close",async()=>{if(node.returnValue!=="save")return;try{await refresh(await api(`/api/me/country-archives/${current.archive.country_code}/routes/${dayId}/items`,{method:"POST",csrfToken:authState.csrfToken,body:Object.fromEntries(new FormData($("form",node)))}));}catch(e){notify(e.message,true);}},{once:true});}
async function moveRoute(id,sortOrder){await refresh(await api(`/api/me/country-archives/${current.archive.country_code}/route-items/${id}`,{method:"PATCH",csrfToken:authState.csrfToken,body:{sortOrder:Number(sortOrder)}}));}
async function deleteRoute(id){if(!confirm("从路线中移除此地点？"))return;await refresh(await api(`/api/me/country-archives/${current.archive.country_code}/route-items/${id}`,{method:"DELETE",csrfToken:authState.csrfToken,body:{}}));}

export async function mountCountryArchives(nextAuth, options={}) {
  authState=nextAuth;notify=options.notify||notify;
  if(!mounted){mounted=true;$$('[data-footprints-mode]').forEach(button=>button.addEventListener("click",()=>setMode(button.dataset.footprintsMode)));window.addEventListener("xc:open-country-archive",async event=>{setMode("countries");await loadCountries();if(event.detail?.countryCode)await openCountry(event.detail.countryCode);});}
}
