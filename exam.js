// ---------- server bridge (google.script.run, or a local mock for testing) ----------
// call(fn,...args) 由頁面提供（index.html：雲端 API；review.html：審閱用）
const call=(fn,...a)=>window.BACKEND[fn](...a);
const TYPE={wrongno:"號碼錯",split:"一顆被切成兩塊",merged:"兩顆黏成一顆",notooth:"不是牙",outline:"輪廓不準"};
let ME=null, CASES=[], st={}, cur=0, cache={}, dirty=false, saving=false, menuEl=null;
const LK=()=>"ct-student-"+(ME?ME.sid:"");
function toast(t){const e=document.getElementById("toast");e.textContent=t;e.style.display="block";clearTimeout(e._t);e._t=setTimeout(()=>e.style.display="none",3200)}
const S=c=>st[c]=st[c]||{errors:{},missing:[],bone:null,canal:null,done:false,note:""};
const FDI=v=>/^[1-4][1-8]$/.test(v);
function local(){try{localStorage.setItem(LK(),JSON.stringify(st))}catch(e){}}
function markDirty(){dirty=true;local();clearTimeout(markDirty._t);markDirty._t=setTimeout(()=>flush(false),2500)}
let pend=false;
async function flush(final){if(!ME)return; if(saving&&!final){pend=true;return} saving=true;
  try{const r=await call("save",ME.sid,st,!!final);dirty=false;document.getElementById("saved").textContent="已存到雲端 "+new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});return r}
  catch(e){document.getElementById("saved").textContent="⚠ 雲端存檔失敗（已先存在這台電腦）";if(final)throw e}
  finally{saving=false;if(pend){pend=false;setTimeout(()=>flush(false),50)}}}
window.addEventListener("beforeunload",e=>{if(dirty){flush(false);e.preventDefault();e.returnValue=""}});
document.getElementById("go").onclick=async()=>{const v=i=>document.getElementById(i).value.trim();const info={sid:v("sid"),name:v("sname"),email:v("email"),grade:v("grade")};
  if(!info.sid||!info.email){toast("請填學號和學校 email");return} go.disabled=true;
  try{ME=await call("register",info);document.getElementById("toast").style.display="none";CASES=ME.cases;st=ME.saved||{};
    try{const l=JSON.parse(localStorage.getItem(LK())||"null");if(l&&!ME.saved)st=l}catch(e){}
    document.getElementById("login").classList.add("hide");["foot","tmp"].forEach(i=>document.getElementById(i).classList.remove("hide"));
    document.getElementById("who").textContent=ME.sid+"　"+(ME.name||"")+"　第 "+ME.set+" 組";
    cur=Math.max(0,CASES.findIndex(c=>!(st[c]||{}).done));if(cur<0)cur=0;if(ME.final){dirty=false;markDirty=()=>{};flush=async f=>f?call("save",ME.sid,st,true):null;document.getElementById("foot").classList.add("hide");document.getElementById("tmp").classList.add("hide");}await render();if(ME.final){document.getElementById("case").style.pointerEvents="none";toast("你已經交件，只能再下載 PDF；要修改請找老師")}}
  catch(e){toast(e.message||String(e))} finally{go.disabled=false}};
document.getElementById("tmp").onclick=async()=>{flushMissing();const r=await flush(false);if(r)toast("已暫存到雲端（"+r.done+" / "+r.total+" 例完成）")};
function dots(){const d=document.getElementById("dots");d.innerHTML="";CASES.forEach((c,i)=>{const b=document.createElement("button");b.className="dot"+(i===cur?" cur":"")+((st[c]||{}).done?" done":"");b.textContent=i+1;b.onclick=async()=>{if(!flushMissing())return;cur=i;await render();scrollTo(0,0)};d.appendChild(b)});
  const all=CASES.length&&CASES.every(c=>(st[c]||{}).done);document.getElementById("pdf").classList.toggle("hide",!all)}
function describe(f,e){if(e.type==="wrongno")return f+" → 應該是 "+e.correct+" 號";if(e.type==="split")return f+"：和 "+e.with+" 是同一顆"+(e.correct?"（＝"+e.correct+"）":"");if(e.type==="merged")return f+"：兩顆黏一起"+(e.correct?"（應為 "+e.correct+"）":"");return f+"："+TYPE[e.type]}
let lastRendered=null;
async function render(){const id=CASES[cur];const el=document.getElementById("case");dots();const _mi=document.getElementById("missno");const keepMiss=(_mi&&lastRendered===id)?_mi.value:"";lastRendered=id;
  if(!cache[id]){el.innerHTML='<div class="card">讀取中…</div>';try{cache[id]=await call("getCase",ME.sid,id)}catch(e){el.innerHTML='<div class="card">讀取失敗：'+(e.message||e)+'（請重新整理）</div>';return}}
  const c=cache[id],s=S(id);
  const chips=c.labels.map(l=>`<button class="chip${s.errors[l.fdi]?" err":""}" data-f="${l.fdi}" style="left:${l.x/c.size[0]*100}%;top:${l.y/c.size[1]*100}%" title="點這裡：${l.fdi} 號有錯">${s.errors[l.fdi]?'<span class="x">'+TYPE[s.errors[l.fdi].type]+'</span>':""}</button>`).join("");
  const items=Object.entries(s.errors).map(([f,e])=>`<span class="item">${describe(f,e)} <button data-del="${f}">✕</button></span>`).concat(s.missing.map((m,i)=>`<span class="item">AI 漏掉：${m} 號 <button data-delm="${i}">✕</button></span>`)).join("");
  el.innerHTML=`<div class="card"><b style="font-size:18px">第 ${cur+1} / ${CASES.length} 例　${c.code}</b>
  <div class="ai"><b>AI 對這份影像的說明：</b>${c.ai_note||""}</div>
  <div class="step"><span class="no">①</span><div><div class="tt">標錯：哪顆牙號錯，就點它的號碼框</div><div class="sub">畫面左＝病人右邊。號碼框是 AI 的牙號；橘／藍輪廓是 AI 切出的每顆牙；黃線＝骨頭外框；紅線＝下顎神經管。</div></div></div>
  <div class="panowrap" id="pw" style="max-width:calc(60vh * ${c.size[0]/c.size[1]})"><img src="data:image/png;base64,${c.pano}" draggable="false">${chips}</div>
  <div class="list">${items||'<span class="mu">還沒有標錯的牙（如果都對，直接按下方「全部正確，下一例」）</span>'}</div>
  <span style="display:inline-flex;gap:6px;align-items:center"><span class="mu">AI 漏掉的牙：</span><input id="missno" class="note" style="width:120px;margin:0" placeholder="牙號，例如 31"><button class="btn" id="addmiss">加入漏掉的牙</button></span>
  <div class="step"><span class="no">②</span><div><div class="tt">看線：黃線、紅線準不準</div></div></div>
  <div class="q"><div class="g"><span>黃線（骨頭外框）</span><button class="btn yes ${s.bone==="ok"?"on":""}" data-k="bone" data-v="ok">準</button><button class="btn no ${s.bone==="bad"?"on":""}" data-k="bone" data-v="bad">不準</button></div>
  <div class="g"><span>紅線（神經管）</span><button class="btn yes ${s.canal==="ok"?"on":""}" data-k="canal" data-v="ok">準</button><button class="btn no ${s.canal==="bad"?"on":""}" data-k="canal" data-v="bad">不準</button></div></div>
  <input class="note" id="note" placeholder="想補充的話寫這裡（可不填）">
  <div class="step"><span class="no">③</span><div><div class="tt">3D：可以轉、可以縮放，對照上面的牙號</div><div class="sub">預設只看上顎；「上下都看」會把上下顎分開。側面只畫靠近你那一側的牙。骨頭是半透明，可以關掉。</div></div></div>
  <div id="v3h">${c.mesh?"":`<div class="v3"><img src="data:image/png;base64,${c.views.right}"><img src="data:image/png;base64,${c.views.front}"><img src="data:image/png;base64,${c.views.left}"></div>`}</div></div>`;
  document.getElementById("note").value=s.note||"";document.getElementById("missno").value=keepMiss;
  el.querySelectorAll(".chip").forEach(b=>b.onclick=ev=>{ev.stopPropagation();openMenu(b,+b.dataset.f)});
  el.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{delete s.errors[b.dataset.del];markDirty();render()});
  el.querySelectorAll("[data-delm]").forEach(b=>b.onclick=()=>{s.missing.splice(+b.dataset.delm,1);markDirty();render()});
  el.querySelectorAll(".q button").forEach(b=>b.onclick=()=>{s[b.dataset.k]=b.dataset.v;markDirty();render()});
  document.getElementById("note").oninput=e=>{s.note=e.target.value;markDirty()};
  document.getElementById("addmiss").onclick=()=>{const v=missno.value.trim();if(FDI(v)){if(!s.missing.includes(+v))s.missing.push(+v);markDirty();render()}else toast("請先在左邊格子填 AI 漏掉的牙號（11–48，例如 31）")};
  document.getElementById("missno").onkeydown=e=>{if(e.key==="Enter")addmiss.click()};
  document.getElementById("prev").disabled=cur===0;
  if(c.mesh){try{if(!window.V3||!window.THREE)throw new Error("3D 元件沒有載入");V3.mount(document.getElementById("v3h"),id,c.mesh)}catch(e){console.error(e);document.getElementById("v3h").innerHTML='<div class="mu">3D 暫時打不開（'+(e.message||e)+'）。牙號請看上面的全景圖。</div>'}}}
function closeMenu(){if(menuEl){menuEl.remove();menuEl=null}}
document.addEventListener("click",e=>{if(menuEl&&!menuEl.contains(e.target))closeMenu()});document.addEventListener("keydown",e=>{if(e.key==="Escape")closeMenu()});
function openMenu(btn,f){closeMenu();const id=CASES[cur],c=cache[id],s=S(id);const me=c.labels.find(l=>l.fdi===f);
  const nb=c.labels.filter(l=>l.fdi!==f&&((l.fdi<30)===(f<30))).sort((a,b)=>Math.abs(a.x-me.x)-Math.abs(b.x-me.x)).slice(0,4).map(l=>l.fdi);
  const m=document.createElement("div");m.className="menu";
  m.innerHTML=`<h4><span>${f} 號錯在哪？（選一個）</span><button id="mx">✕</button></h4>
  <button class="o" data-t="wrongno">A. 號碼錯（這顆其實是別的號碼）</button><div class="sub2" data-for="wrongno">正確牙號：<input id="m_wn" maxlength="2" placeholder="12"> <button class="btn pri" data-ok="wrongno">確定</button></div>
  <button class="o" data-t="split">B. 一顆被切成兩塊（和旁邊另一塊是同一顆牙）</button><div class="sub2" data-for="split">另一塊是：<select id="m_with"><option value="">請選</option>${nb.map(x=>`<option>${x}</option>`).join("")}</select> 正確牙號（知道才填）：<input id="m_sp" maxlength="2"> <button class="btn pri" data-ok="split">確定</button></div>
  <button class="o" data-t="merged">C. 兩顆黏成一顆（這個號碼框裡其實有兩顆牙）</button><div class="sub2" data-for="merged">正確牙號（知道才填）：<input id="m_m1" maxlength="2" placeholder="41"> 和 <input id="m_m2" maxlength="2" placeholder="31"> <button class="btn pri" data-ok="merged">確定</button></div>
  <button class="o" data-t="notooth">D. 不是牙（碎塊、殘根、假牙橋體…）</button><button class="o" data-t="outline">E. 號碼對，但輪廓畫得不準</button><button class="o" data-t="cancel" style="color:#8b949e">這顆沒錯／取消標記</button>`;
  document.body.appendChild(m);const place=()=>{const r=btn.getBoundingClientRect(),h=m.offsetHeight,w=m.offsetWidth;let l=r.left,t=r.bottom+6;if(l+w>innerWidth-8)l=innerWidth-w-8;if(t+h>innerHeight-90)t=Math.max(60,r.top-h-6);m.style.left=Math.max(8,l)+"px";m.style.top=t+"px"};place();
  const commit=e=>{s.errors[f]=e;markDirty();closeMenu();render()};m.querySelector("#mx").onclick=ev=>{ev.stopPropagation();closeMenu()};
  m.querySelectorAll("button.o").forEach(b=>b.onclick=ev=>{ev.stopPropagation();const t=b.dataset.t;if(t==="cancel"){delete s.errors[f];markDirty();closeMenu();render();return}
    if(t==="notooth"||t==="outline"){commit({type:t,correct:null,with:null});return}m.querySelectorAll(".sub2").forEach(x=>x.classList.toggle("show",x.dataset.for===t));place()});
  m.querySelectorAll("[data-ok]").forEach(b=>b.onclick=ev=>{ev.stopPropagation();const t=b.dataset.ok;
    if(t==="wrongno"){const v=m_wn.value.trim();if(!FDI(v)){toast("請填正確牙號（11–48）");return}if(+v===f){toast("和原本號碼一樣");return}commit({type:t,correct:v,with:null})}
    if(t==="split"){const w=m_with.value,v=m_sp.value.trim();if(!w){toast("請選「另一塊是」哪個號碼");return}if(v&&!FDI(v)){toast("牙號格式不對");return}commit({type:t,correct:v||null,with:+w})}
    if(t==="merged"){const x=m_m1.value.trim(),y=m_m2.value.trim();if((x&&!FDI(x))||(y&&!FDI(y))){toast("牙號格式不對");return}commit({type:t,correct:(x||y)?[x,y].filter(Boolean).join(","):null,with:null})}});
  m.addEventListener("click",ev=>ev.stopPropagation());menuEl=m}
function flushMissing(){const el=document.getElementById("missno");if(!el||!ME)return true;const v=el.value.trim();if(!v)return true;if(FDI(v)){const s=S(CASES[cur]);if(!s.missing.includes(+v))s.missing.push(+v);el.value="";markDirty();return true}toast("漏掉的牙號格式不對（例如 31）");return false}
async function finish(all){if(!flushMissing())return;const s=S(CASES[cur]);
  if(all){const n=Object.keys(s.errors).length+s.missing.length;if(n){toast("這例已標了 "+n+" 項錯，不能按「全部正確」；請按藍色「這例填好了」");return}s.bone="ok";s.canal="ok"}
  else if(!s.bone||!s.canal){toast("還差 ② 看線：黃線、紅線各按「準」或「不準」");return}
  s.done=true;s.t=new Date().toISOString();markDirty();flush(false);
  if(cur<CASES.length-1){cur++;await render();scrollTo(0,0)}else{await render();toast("全部填完了！請按右上「下載結果 PDF」")}}
document.getElementById("next").onclick=()=>finish(false);document.getElementById("allok").onclick=()=>finish(true);
document.getElementById("prev").onclick=async()=>{if(!flushMissing())return;if(cur>0){cur--;await render();scrollTo(0,0)}};
// ---------- PDF: every page is a picture (no editable text) ----------
document.getElementById("pdf").onclick=async()=>{const b=document.getElementById("pdf");b.disabled=true;
  try{const r=await flush(true);const {jsPDF}=window.jspdf;const doc=new jsPDF({unit:"pt",format:"a4"});const W=595,H=842;
    for(let i=0;i<CASES.length;i++){const id=CASES[i];if(!cache[id])cache[id]=await call("getCase",ME.sid,id);const c=cache[id],s=S(id);
      const cv=document.createElement("canvas");cv.width=1240;cv.height=1754;const g=cv.getContext("2d");g.fillStyle="#fff";g.fillRect(0,0,cv.width,cv.height);g.fillStyle="#111";
      g.font="bold 34px 'Microsoft JhengHei','Noto Sans TC',sans-serif";g.fillText("CT 牙齒判讀練習　結果",60,80);
      g.font="26px 'Microsoft JhengHei','Noto Sans TC',sans-serif";g.fillText(`學號 ${ME.sid}　姓名 ${ME.name}　年級 ${ME.grade}`,60,130);g.fillText(`email ${ME.email}　第 ${ME.set} 組　第 ${i+1}/${CASES.length} 例　${c.code}`,60,170);
      g.fillText(`驗證碼 ${r.verify}　完成時間 ${new Date(r.at).toLocaleString()}`,60,210);
      const img=await new Promise(ok=>{const im=new Image();im.onload=()=>ok(im);im.src="data:image/png;base64,"+c.pano});const iw=1120,ih=iw*img.height/img.width;g.drawImage(img,60,240,iw,ih);
      let y=260+ih+40;g.font="bold 28px 'Microsoft JhengHei','Noto Sans TC',sans-serif";g.fillText("我標的錯誤",60,y);y+=44;g.font="26px 'Microsoft JhengHei','Noto Sans TC',sans-serif";
      const lines=Object.entries(s.errors).map(([f,e])=>describe(f,e)).concat(s.missing.map(m=>"AI 漏掉："+m+" 號"));if(!lines.length)lines.push("（全部正確）");
      lines.push("黃線（骨頭外框）："+(s.bone==="ok"?"準":"不準")+"　紅線（神經管）："+(s.canal==="ok"?"準":"不準"));if(s.note)lines.push("補充："+s.note);
      lines.forEach(t=>{for(let k=0;k<t.length;k+=40){g.fillText(t.slice(k,k+40),70,y);y+=38}});
      g.fillStyle="#888";g.font="20px sans-serif";g.fillText("研究用／教學用｜本頁為圖片，成績以老師雲端紀錄與驗證碼為準",60,1720);
      if(i)doc.addPage();doc.addImage(cv.toDataURL("image/jpeg",0.85),"JPEG",0,0,W,H)}
    doc.save(`CT判讀練習-${ME.sid}-${r.verify}.pdf`);toast("已下載 PDF，請交給老師")}
  catch(e){toast(e.message||String(e))} finally{b.disabled=false}};

document.addEventListener('click',e=>{const t=e.target;if(t.matches&&t.matches('.v3 img')){const z=document.createElement('div');z.className='zoom';z.innerHTML='<img src="'+t.src+'">';z.onclick=()=>z.remove();document.body.appendChild(z)}});
