let deferredPrompt=null,lastImage=null,lastReport=null;
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const weights={
  landform:{active_bar:16,creek_mouth:18,riffle_tail:17,old_terrace:10,cut_bank:12,lake:2,upland:-10},
  energy:{fast_mixed:12,moderate:8,slow:-4,dry:2},
  depth:{unknown:0,top:3,target:8,deep:4,falsebottom:14},
  moisture:{wet:4,damp:2,dry:-2},
  blackSandPan:[0,5,11,17],
  goldSeen:[0,12,25,35]
};

window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e;$("installBtn").hidden=false});
$("installBtn").onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$("installBtn").hidden=true}};

$("gpsBtn").onclick=()=>{ if(!navigator.geolocation){$("geoStatus").textContent="GPS unavailable.";return}
  $("geoStatus").textContent="Getting high-accuracy GPS…";
  navigator.geolocation.getCurrentPosition(p=>{
    $("lat").value=p.coords.latitude.toFixed(6); $("lon").value=p.coords.longitude.toFixed(6);
    $("geoStatus").textContent=`GPS fix: ±${Math.round(p.coords.accuracy)} m`;
  },e=>$("geoStatus").textContent="GPS error: "+e.message,{enableHighAccuracy:true,timeout:16000,maximumAge:20000});
};
$("copyBtn").onclick=async()=>{const s=`${$("lat").value}, ${$("lon").value}`; await navigator.clipboard.writeText(s).catch(()=>{}); alert("Coordinates copied: "+s)};
$("mapBtn").onclick=()=>{const lat=parseFloat($("lat").value),lon=parseFloat($("lon").value); if(!isFinite(lat)||!isFinite(lon))return alert("Enter coordinates first."); window.open(`https://maps.apple.com/?ll=${lat},${lon}&q=Gold%20Scout%20Site`,"_blank")};

$("photo").onchange=e=>{const f=e.target.files[0];if(!f)return;const img=new Image();img.onload=()=>analyze(img);img.src=URL.createObjectURL(f)};

function analyze(img){
 const c=$("canvas"),ctx=c.getContext("2d",{willReadFrequently:true});
 const scale=Math.min(1100/img.width,1); c.width=Math.round(img.width*scale); c.height=Math.round(img.height*scale);
 ctx.drawImage(img,0,0,c.width,c.height);
 const d=ctx.getImageData(0,0,c.width,c.height).data;
 let dark=0,gray=0,tan=0,green=0,blue=0,yellow=0,edge=0,total=0,prev=0;
 for(let i=0;i<d.length;i+=4){
   const r=d[i],g=d[i+1],b=d[i+2],lum=.2126*r+.7152*g+.0722*b,max=Math.max(r,g,b),min=Math.min(r,g,b),sat=max?((max-min)/max):0;
   total++;
   if(lum<58&&sat<.50)dark++;
   if(sat<.20&&lum>60&&lum<200)gray++;
   if(r>85&&g>60&&b<95&&sat>.16)tan++;
   if(g>r*1.08&&g>b*1.08&&sat>.22)green++;
   if(b>r*1.08&&b>g*.9&&sat>.18)blue++;
   if(r>150&&g>112&&b<90&&sat>.33)yellow++;
   if(i>4&&Math.abs(lum-prev)>45)edge++;
   prev=lum;
 }
 const pct=x=>x/total;
 lastImage={
   dark:pct(dark),gray:pct(gray),tan:pct(tan),green:pct(green),blue:pct(blue),yellow:pct(yellow),edge:pct(edge),
   texture:clamp((pct(edge)-.075)/.20,0,1),
   darkMineral:clamp((pct(dark)-.045)/.22,0,1),
   gravel:clamp((pct(gray)+pct(tan)-.22)/.50,0,1),
   vegetationPenalty:clamp((pct(green)-.12)/.35,0,1),
   waterPenalty:clamp((pct(blue)-.10)/.30,0,1)
 };
 $("imageMetrics").innerHTML=[
   ["Texture/coarse-gravel proxy",lastImage.texture],
   ["Dark-mineral proxy",lastImage.darkMineral],
   ["Gravel/clay color proxy",lastImage.gravel],
   ["Vegetation interference",lastImage.vegetationPenalty],
   ["Water/shadow interference",lastImage.waterPenalty],
   ["Yellow pixel caution",lastImage.yellow]
 ].map(([k,v])=>`<div class="metric"><b>${k}</b><br>${(v*100).toFixed(0)}%</div>`).join("");
}

function regional(lat,lon){
 let s=0,lines=[];
 if(isFinite(lat)&&isFinite(lon)){
   if(lat>=40.25&&lat<=41.9&&lon>=-87.6&&lon<=-84.6){s+=12;lines.push("+12 glaciated northern/central Indiana belt")}
   if(lat>=40.8&&lat<=41.35&&lon>=-86.35&&lon<=-85.15){s+=10;lines.push("+10 Eel River / Wabash regional placer window")}
   if(lat>=41.02&&lat<=41.18&&lon>=-85.78&&lon<=-85.50){s+=7;lines.push("+7 South Whitley local scout window")}
   if(lat>=41.25&&lat<=41.45&&lon>=-85.55&&lon<=-85.25){s+=2;lines.push("+2 Chain O' Lakes glacial terrain, but lower river-sorting advantage")}
 } else lines.push("No GPS score");
 return {s,lines};
}
function checked(id,pts,text){return $(id).checked?{pts,line:`+${pts} ${text}`}:{pts:0,line:null}}

function calc(){
 let score=0,lines=[];
 const lat=parseFloat($("lat").value),lon=parseFloat($("lon").value),reg=regional(lat,lon);score+=reg.s;lines.push(...reg.lines);
 const lf=$("landform").value,en=$("energy").value,dep=$("depth").value,mo=$("moisture").value;
 score+=weights.landform[lf];lines.push(`${weights.landform[lf]>=0?"+":""}${weights.landform[lf]} landform: ${lf.replaceAll("_"," ")}`);
 score+=weights.energy[en];lines.push(`${weights.energy[en]>=0?"+":""}${weights.energy[en]} water energy: ${en.replaceAll("_"," ")}`);
 score+=weights.depth[dep];lines.push(`+${weights.depth[dep]} sample depth/false-bottom quality`);
 score+=weights.moisture[mo];lines.push(`${weights.moisture[mo]>=0?"+":""}${weights.moisture[mo]} moisture/active-material factor`);
 [
  checked("insideBend",12,"inside-bend sorting"),
  checked("naturalTrap",11,"natural obstruction trap"),
  checked("coarseLag",10,"coarse lag gravel"),
  checked("clay",14,"clay/hardpan/bedrock trap"),
  checked("bankLayers",7,"rounded gravel layers in bank"),
  checked("blackSand",16,"black sand observed"),
  checked("garnets",10,"dense heavies observed"),
  checked("legal",2,"legal access confirmed")
 ].forEach(x=>{score+=x.pts;if(x.line)lines.push(x.line)});
 const panBS=parseInt($("panBlackSand").value),gold=parseInt($("goldSeen").value),pans=parseInt($("pans").value)||0;
 score+=weights.blackSandPan[panBS];lines.push(`+${weights.blackSandPan[panBS]} pan black-sand result`);
 score+=weights.goldSeen[gold];lines.push(`+${weights.goldSeen[gold]} visible-gold confidence`);
 if(pans>=5){score+=5;lines.push("+5 multiple test pans improve confidence")} else if(pans>0){score+=2;lines.push("+2 limited test panning")}
 if(lastImage){
   let imgPts=lastImage.texture*7+lastImage.darkMineral*6+lastImage.gravel*5-lastImage.vegetationPenalty*4-lastImage.waterPenalty*3;
   score+=imgPts; lines.push(`${imgPts>=0?"+":""}${imgPts.toFixed(1)} photo-derived terrain/material signal`);
   if(lastImage.yellow>.018)lines.push("Photo caution: yellow pixels are not gold confirmation.");
 } else lines.push("No photo analysis included.");
 score=Math.round(clamp(score,0,100));
 let rating=score>=78?"Very high priority test spot":score>=62?"High — pan systematically":score>=42?"Moderate — worth several test pans":score>=25?"Low/moderate — quick scout only":"Low — move unless evidence improves";
 $("score").textContent=score;$("rating").textContent=rating;$("barFill").style.width=score+"%";$("breakdown").textContent=lines.join("\n");
 const next=nextStep(score,panBS,gold);
 $("nextStep").textContent=next;
 lastReport={date:new Date().toISOString(),lat,lon,score,rating,breakdown:lines,next};
}
function nextStep(score,bs,gold){
 if(gold>=2)return "Mark this exact layer and elevation. Take 5 more pans along a line across the bar to define the pay streak width.";
 if(bs>=2&&score>=50)return "Follow the black sand. Take pans 10–15 feet apart from waterline toward shore, then dig only the best line down to clay/hardpan.";
 if(score>=50)return "Take 5–10 test pans before digging deep. Target the lowest coarse gravel directly above clay or compact till.";
 if(score>=25)return "Do two quick pans. Move unless you see black sand, garnets, lead shot, or a hard bottom under gravel.";
 return "Do not spend much time here. Look for inside bends, creek mouths, riffle tail-outs, or gravel on clay.";
}
$("calcBtn").onclick=calc;
$("saveBtn").onclick=()=>{if(!lastReport)calc();const a=JSON.parse(localStorage.goldReportsV2||"[]");a.unshift(lastReport);localStorage.goldReportsV2=JSON.stringify(a.slice(0,100));render()};
$("exportBtn").onclick=()=>{if(!lastReport)calc();const blob=new Blob([JSON.stringify(lastReport,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="gold-scout-report.json";a.click();URL.revokeObjectURL(url)};
$("clearBtn").onclick=()=>{if(confirm("Clear saved reports?")){localStorage.removeItem("goldReportsV2");render()}};
function render(){const a=JSON.parse(localStorage.goldReportsV2||"[]");$("reports").innerHTML=a.length?a.map(r=>`<div class="report"><b>${r.score}/100 — ${r.rating}</b><br><span class="muted">${new Date(r.date).toLocaleString()}</span><br>${isFinite(r.lat)?`GPS: ${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}<br>`:""}<details><summary>Details</summary><pre>${esc(r.breakdown.join("\n")+"\n\nNext: "+r.next)}</pre></details></div>`).join(""):"<p class='muted'>No saved reports.</p>"}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]))}
if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
render();
