import fs from "node:fs";
const PORT=9394;
const j=async(p,o)=>{for(let i=0;i<20;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}${p}`,o);if(r.ok)return r.json()}catch{}await new Promise(r=>setTimeout(r,300))}throw new Error("no cdp")};
async function conn(u){const ws=new WebSocket(u);await new Promise((r,e)=>{ws.onopen=r;ws.onerror=e});let s=0;const p=new Map();const errs=[];ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==="Runtime.exceptionThrown")errs.push(m.params.exceptionDetails.exception?.description?.slice(0,150));if(m.id&&p.has(m.id)){p.get(m.id)(m.result??m.error);p.delete(m.id)}};const c={errs,cmd:(me,pa={})=>new Promise(r=>{const id=++s;p.set(id,r);ws.send(JSON.stringify({id,method:me,params:pa}))})};c.ev=async e=>{const r=await c.cmd("Runtime.evaluate",{expression:e,awaitPromise:true,returnByValue:true});return r.exceptionDetails?"EXC "+r.exceptionDetails.exception.description.slice(0,120):r.result.value};return c}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const sw=(await j("/json/list")).find(t=>t.type==="service_worker"); const id=new URL(sw.url).host;
const img=g=>`https://forest-ops-assets.seekrtech.com/library/trees/tree_type_${g}.png`;
const trees=[[45,"Cat-tail Willow"],[39,"Ghost Mushroom"],[38,"Rainbow Flower"],[124,"Bellflower"]].map(([g,t])=>({gid:g,title:t,image:img(g)}));
const plants=[];for(let i=0;i<6;i++){const s=new Date();s.setHours(6+i*2,0,0,0);plants.push({startTime:s.toISOString(),endTime:new Date(s.getTime()+30*60000).toISOString(),tag:1,note:"",treeTypeGid:trees[i%4].gid,isSuccess:i!==3,trees:[]})}
const base={version:3,region:"global",user:{id:12345678,name:"demo",email:"demo@example.com",coin:561,healthTreeCount:1182,deadTreeCount:10,totalMinutes:35562,gem:120,boost:{}},auth:{},treeTypes:trees,tags:[{tagId:1,title:"Work"}],selectedTreeGid:39,planting:null,pendingPlants:[],serverPlants:plants,blockEnabled:true,blocklist:[],allowlist:[],telegram:{enabled:false},lastSyncedAt:new Date().toISOString()};
const t=await j(`/json/new?${encodeURIComponent(`chrome-extension://${id}/options.html`)}`,{method:"PUT"});
const c=await conn(t.webSocketDebuggerUrl); await c.cmd("Runtime.enable");
await c.cmd("Emulation.setDeviceMetricsOverride",{width:900,height:1400,deviceScaleFactor:1,mobile:false});
await c.cmd("Emulation.setEmulatedMedia",{features:[{name:"prefers-color-scheme",value:"dark"}]});
await c.ev(`chrome.storage.local.set({fpState:${JSON.stringify(base)}})`); await c.ev("location.reload()"); await wait(4000);
console.log("frame:", await c.ev(`(()=>{const f=document.querySelector('#gardenFrame');const d=f.contentDocument;return JSON.stringify({h:f.style.height, embed:d.body.classList.contains('embed'), alive:d.querySelector('#cnt-alive')?.textContent, dead:d.querySelector('#cnt-dead')?.textContent, imgs:d.querySelectorAll('#plot image').length, innerScroll:d.documentElement.scrollHeight>d.documentElement.clientHeight})})()`));
console.log("history gone:", await c.ev(`!document.querySelector('.hist')`));
console.log("frame tab switch:", await c.ev(`(()=>{const d=document.querySelector('#gardenFrame').contentDocument;d.querySelector('[data-mode="week"]').click();return d.querySelector('#label').textContent})()`));
const r=await c.cmd("Page.captureScreenshot",{format:"png",captureBeyondViewport:true}); fs.writeFileSync("C:/Users/ADMIN/Desktop/temp 03/_og.png",Buffer.from(r.data,"base64"));
console.log("errors:", JSON.stringify(c.errs));
process.exit(0);
