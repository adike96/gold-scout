let deferredPrompt=null,watchId=null,map=null,selectedMarker=null,selectedLL=null,lastImage=null,lastReport=null;
let heatLayer=null,pinLayer=null,waterLayer=null,refreshTimer=null,osmWaterways=[],lastBboxKey="";
const $=id=>document.getElementById(id), clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

const W={region:{unknown:0,historic:22,lode:18,glacial:10,greenstone:20,mountain:17,volcanic:14,desert:12,low:-12},landform:{inside:16,bar:14,creek:18,riffle:17,bedrock:22,clay:18,terrace:10,wash:14,lake:-7,upland:-14},bottom:{unknown:0,sand:-8,gravel:8,clay:15,bedrock:22},energy:{high:12,mod:8,flash:10,low:-5,dry:2},depth:{surface:0,six:3,target:8,deep:4,false:15},access:{unknown:0,public:4,permission:4,restricted:-30},panBlack:[0,5,12,18,23],gold:[0,12,28,50,65]};

document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>{document.querySelectorAll("nav button,.tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");$(b.dataset.tab).classList.add("active");if(b.dataset.tab==="map")setTimeout(()=>{initMap();map.invalidateSize()},100)});
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e;$("installBtn").hidden=false});
$("installBtn").onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;$("installBtn").hidden=true}};

function initMap(){
  if(map)return;
  let lat=+$("lat").value||41.084,lon=+$("lon").value||-85.625;
  map=L.map("mapView").setView([lat,lon],17);

  const street=L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(map);
  const satellite=L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{maxZoom:19,attribution:"Tiles © Esri"});
  const topo=L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",{maxZoom:17,attribution:"© OpenTopoMap"});
  const labels=L.tileLayer("https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png",{maxZoom:20,attribution:"© CARTO © OpenStreetMap"});
  L.control.layers({"Street labels":street,"Satellite":satellite,"Topo":topo},{"Town/river labels overlay":labels},{collapsed:false}).addTo(map);

  heatLayer=L.layerGroup().addTo(map);
  waterLayer=L.layerGroup().addTo(map);
  pinLayer=L.layerGroup().addTo(map);

  selectedLL=L.latLng(lat,lon);
  selectedMarker=L.marker(selectedLL,{draggable:true}).addTo(map).bindPopup("Selected analysis point");
  selectedMarker.on("dragend",()=>setSelected(selectedMarker.getLatLng(),false));
  map.on("click",e=>setSelected(e.latlng,true));

  // Throttled and stable refresh: not every tiny move, and output is a grid overlay.
  map.on("moveend zoomend",()=>{if(getVal("autoRefresh","on")==="on")debouncedHeatmap()});
  renderPins();
  generateHeatmap();
}

function getVal(id,def){let e=$(id);return e?e.value:def}
function setSelected(ll,pan){selectedLL=ll;selectedMarker.setLatLng(ll);$("lat").value=ll.lat.toFixed(6);$("lon").value=ll.lng.toFixed(6);if($("selectedCoords"))$("selectedCoords").textContent=`${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`;if(pan)selectedMarker.openPopup();}
function setGPS(p){let ll=L.latLng(p.coords.latitude,p.coords.longitude);if($("gpsAccuracy"))$("gpsAccuracy").textContent="±"+Math.round(p.coords.accuracy)+" m";if($("gpsAccuracy")){};if(map){setSelected(ll,false);map.setView(ll,18)}else{$("lat").value=ll.lat.toFixed(6);$("lon").value=ll.lng.toFixed(6)}}
$("gpsBtn").onclick=()=>{initMap();navigator.geolocation?navigator.geolocation.getCurrentPosition(setGPS,e=>alert(e.message),{enableHighAccuracy:true,timeout:16000,maximumAge:20000}):alert("GPS unavailable")};
if($("trackBtn"))$("trackBtn").onclick=()=>{initMap();if(!navigator.geolocation)return alert("GPS unavailable");watchId=navigator.geolocation.watchPosition(setGPS,e=>alert(e.message),{enableHighAccuracy:true,maximumAge:5000})};
if($("stopTrackBtn"))$("stopTrackBtn").onclick=()=>{if(watchId!==null){navigator.geolocation.clearWatch(watchId);watchId=null}};
if($("refreshHotspotsBtn"))$("refreshHotspotsBtn").onclick=()=>{initMap();generateHeatmap(true)};

function debouncedHeatmap(){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>generateHeatmap(false),1400)}
function bboxKey(){const b=map.getBounds();return [b.getSouth().toFixed(3),b.getWest().toFixed(3),b.getNorth().toFixed(3),b.getEast().toFixed(3),map.getZoom()].join(",")}
async function fetchVisibleWaterways(){
  const key=bboxKey();
  if(key===lastBboxKey&&osmWaterways.length)return osmWaterways;
  lastBboxKey=key;
  const b=map.getBounds().pad(.08);
  const query=`[out:json][timeout:12];(way["waterway"~"river|stream|creek|brook|canal|ditch"](${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}););out geom;`;
  try{
    const res=await fetch("https://overpass-api.de/api/interpreter",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},body:"data="+encodeURIComponent(query)});
    const data=await res.json();
    osmWaterways=(data.elements||[]).filter(w=>w.geometry&&w.geometry.length>1).map(w=>({id:w.id,name:(w.tags&&w.tags.name)||"mapped waterway",type:(w.tags&&w.tags.waterway)||"stream",pts:w.geometry.map(g=>L.latLng(g.lat,g.lon))}));
    return osmWaterways;
  }catch(e){
    console.warn(e);
    return [];
  }
}

async function generateHeatmap(force=false){
  if(!map)return;
  if($("candidateCount"))$("candidateCount").textContent="loading…";
  if($("hotspotPanel"))$("hotspotPanel").textContent="Building stable river-based potential overlay…";
  heatLayer.clearLayers(); waterLayer.clearLayers();

  const ways=await fetchVisibleWaterways();
  let cells=[];
  if(ways.length){
    drawWaterways(ways);
    cells=buildRiverCells(ways);
  }else{
    cells=buildFallbackCells();
  }

  cells.sort((a,b)=>b.score-a.score);
  drawHeatCells(cells);
  const best=cells[0];
  if($("candidateCount"))$("candidateCount").textContent=String(cells.length);
  if($("bestTarget"))$("bestTarget").textContent=best?`${best.score}/100 ${best.label}`:"No targets";
  if($("hotspotPanel")){
    $("hotspotPanel").innerHTML=(ways.length?
      "<b>Stable heat-map mode:</b> colors are anchored to mapped rivers/streams and smoothed, so they should not jump around when you refresh.\n\n":
      "<b>No mapped river found:</b> zoom closer to a creek/river or use the labeled street/topo layer.\n\n")+
      cells.slice(0,8).map((c,i)=>`${i+1}. ${c.label} — ${c.score}/100\n${c.reason}`).join("\n\n");
  }
}

function drawWaterways(ways){
  ways.forEach(w=>L.polyline(w.pts,{color:"#38bdf8",weight:3,opacity:.8}).addTo(waterLayer).bindTooltip(w.name));
}

function buildRiverCells(ways){
  const out=[], zoom=map.getZoom();
  const spacing=zoom>=18?45:zoom>=16?70:110; // feet between sampled cells
  ways.forEach(w=>{
    for(let i=1;i<w.pts.length-1;i++){
      const prev=w.pts[i-1],p=w.pts[i],next=w.pts[i+1];
      if(!map.getBounds().pad(.06).contains(p))continue;
      if(i%Math.max(1,Math.round(spacing/35))!==0)continue;

      const angle=turnAngle(prev,p,next);
      const curve=clamp(Math.abs(angle)/90*20,0,20);
      const junction=nearJunction(p,w.id);
      const saved=nearSavedBonus(p);
      const cal=localCalibrationBonus();
      const base=46+curve+junction+saved.bonus+cal;
      const score=clamp(Math.round(base+stableNoise(p.lat,p.lng)*5-2.5),5,98);
      const bearing=bearingDeg(prev,next);
      const offsets=[0];

      // Side cells create a green/yellow corridor, not pin scatter.
      if(Math.abs(angle)>8) offsets.push(angle>0?-22:22);
      offsets.push(12,-12);

      offsets.forEach((side,idx)=>{
        const ll=side===0?{lat:p.lat,lng:p.lng}:destination(p.lat,p.lng,bearing+(side>0?90:-90),Math.abs(side));
        const sidePenalty=side===0?0:(Math.abs(angle)>8?1:-6);
        out.push({
          lat:ll.lat,lng:ll.lng,
          score:clamp(score+sidePenalty,0,100),
          label:side===0?(Math.abs(angle)>12?"River bend target":"River gravel target"):"Bend-margin/payline edge",
          reason:`${w.name} (${w.type}). ${Math.abs(angle)>12?"Bend/curve detected; likely low-energy heavy-mineral streak.":"Mapped waterway target; verify gravel, black sand, and hard bottom."}${junction?" Confluence/junction nearby.":""}${saved.text?" "+saved.text:""}`,
          radius:map.getZoom()>=18?11:map.getZoom()>=16?16:22
        });
      });
    }
  });
  return dedupe(out);
}

function buildFallbackCells(){
  let c=currentLL(), out=[];
  for(let br=0;br<360;br+=45){
    for(let d=35;d<=120;d+=35){
      let p=destination(c.lat,c.lng,br,d);
      out.push({lat:p.lat,lng:p.lng,score:clamp(38+stableNoise(p.lat,p.lng)*12,0,60),label:"Fallback area",reason:"No mapped river/stream was found. This is only a rough fallback, not river-locked.",radius:18});
    }
  }
  return out;
}

function drawHeatCells(cells){
  cells.forEach(c=>{
    const color=c.score>=75?"#16a34a":c.score>=60?"#84cc16":c.score>=45?"#facc15":c.score>=30?"#fb923c":"#ef4444";
    L.circle([c.lat,c.lng],{radius:c.radius,color,fillColor:color,weight:1,opacity:.55,fillOpacity:.30}).addTo(heatLayer)
      .bindPopup(`<b>${c.label}</b><br>Potential: ${c.score}/100<br>${esc(c.reason)}<br><button onclick="selectHeat(${c.lat},${c.lng})">Analyze here</button>`);
  });
}

function dedupe(list){
  const out=[];
  for(const c of list){
    if(!out.some(x=>L.latLng(x.lat,x.lng).distanceTo(L.latLng(c.lat,c.lng))<12))out.push(c);
  }
  return out;
}

function turnAngle(a,b,c){let br1=bearingDeg(a,b),br2=bearingDeg(b,c);return((br2-br1+540)%360)-180}
function bearingDeg(a,b){const lat1=a.lat*Math.PI/180,lat2=b.lat*Math.PI/180,dLon=(b.lng-a.lng)*Math.PI/180;const y=Math.sin(dLon)*Math.cos(lat2);const x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);return(Math.atan2(y,x)*180/Math.PI+360)%360}
function destination(lat,lng,bearing,feet){const R=6378137,d=feet*.3048,br=bearing*Math.PI/180,phi1=lat*Math.PI/180,lam1=lng*Math.PI/180;const phi2=Math.asin(Math.sin(phi1)*Math.cos(d/R)+Math.cos(phi1)*Math.sin(d/R)*Math.cos(br));const lam2=lam1+Math.atan2(Math.sin(br)*Math.sin(d/R)*Math.cos(phi1),Math.cos(d/R)-Math.sin(phi1)*Math.sin(phi2));return{lat:phi2*180/Math.PI,lng:lam2*180/Math.PI}}
function nearJunction(p,own){let bonus=0;for(const w of osmWaterways){if(w.id===own)continue;for(const q of w.pts){const d=p.distanceTo(q);if(d<45)return 12;if(d<90)bonus=Math.max(bonus,6)}}return bonus}
function stableNoise(lat,lng){const s=Math.sin((lat*127.1+lng*311.7)*1000)*43758.5453123;return s-Math.floor(s)}
function currentLL(){const lat=+$("lat").value,lon=+$("lon").value;if(isFinite(lat)&&isFinite(lon))return L.latLng(lat,lon);return selectedLL||map.getCenter()}
window.selectHeat=(lat,lng)=>{const ll=L.latLng(lat,lng);setSelected(ll,false);document.querySelector('[data-tab="analyze"]').click()};

$("photo").onchange=e=>{const f=e.target.files[0];if(!f)return;const img=new Image();img.onload=()=>analyzePhoto(img);img.src=URL.createObjectURL(f)};
function analyzePhoto(img){const c=$("photoCanvas"),ctx=c.getContext("2d",{willReadFrequently:true});let scale=Math.min(1000/img.width,1);c.width=img.width*scale;c.height=img.height*scale;ctx.drawImage(img,0,0,c.width,c.height);let d=ctx.getImageData(0,0,c.width,c.height).data,dark=0,gray=0,tan=0,green=0,blue=0,edge=0,total=0,prev=0;for(let i=0;i<d.length;i+=4){let r=d[i],g=d[i+1],b=d[i+2],lum=.2126*r+.7152*g+.0722*b,max=Math.max(r,g,b),min=Math.min(r,g,b),sat=max?(max-min)/max:0;total++;if(lum<58&&sat<.5)dark++;if(sat<.2&&lum>60&&lum<205)gray++;if(r>85&&g>60&&b<100&&sat>.16)tan++;if(g>r*1.08&&g>b*1.08&&sat>.22)green++;if(b>r*1.08&&b>g*.9&&sat>.18)blue++;if(i>4&&Math.abs(lum-prev)>45)edge++;prev=lum}let pct=x=>x/total;lastImage={texture:clamp((pct(edge)-.075)/.2,0,1),dark:clamp((pct(dark)-.045)/.22,0,1),gravel:clamp((pct(gray)+pct(tan)-.22)/.5,0,1),noise:clamp((pct(green)+pct(blue)-.18)/.45,0,1)};$("photoMetrics").innerHTML=[["Coarse texture",lastImage.texture],["Dark mineral proxy",lastImage.dark],["Gravel/clay proxy",lastImage.gravel],["Vegetation/water interference",lastImage.noise]].map(x=>`<div class="metric"><b>${x[0]}</b><br>${Math.round(x[1]*100)}%</div>`).join("")}

function localCalibrationBonus(){const c=JSON.parse(localStorage.goldV6Cal||'{"pans":0,"specks":0}');if(c.pans<5)return 0;return clamp(Math.round(((c.specks/c.pans)-.02)*80),-8,14)}
function nearSavedBonus(ll){let saved=JSON.parse(localStorage.goldV6||"[]").filter(r=>isFinite(r.lat)&&isFinite(r.lon));let bonus=0,text="";saved.forEach(r=>{let d=ll.distanceTo(L.latLng(r.lat,r.lon));if(d<120&&r.score>=70){bonus=Math.max(bonus,8);text="Near previous high-score/success point."}if(d<80&&(+r.inputs?.gold||0)>=2){bonus=Math.max(bonus,12);text="Near confirmed saved gold."}if(d<60&&r.score<35){bonus=Math.min(bonus,-5);text="Near previous low/no-gold result."}});return{bonus,text}}

function calc(){let s=0,lines=[];["region","landform","bottom","energy","depth","access"].forEach(id=>{let e=$(id);if(!e)return;let val=e.value,w=W[id][val];s+=w;lines.push(`${w>=0?"+":""}${w} ${id}: ${val}`)});[["blackSand",16,"black sand visible"],["heavies",11,"dense heavies"],["coarse",10,"coarse lag gravel"],["obstruction",10,"obstruction trap"],["tributary",9,"tributary/confluence"],["legal",2,"legal access checked"]].forEach(a=>{if($(a[0])&&$(a[0]).checked){s+=a[1];lines.push(`+${a[1]} ${a[2]}`)}});let pb=+$("panBlack").value,g=+$("gold").value,pans=+$("pans").value||0;s+=W.panBlack[pb]+W.gold[g];lines.push(`+${W.panBlack[pb]} pan black sand`);lines.push(`+${W.gold[g]} gold result`);if(pans>=10){s+=7;lines.push("+7 strong sample count")}else if(pans>=5){s+=5;lines.push("+5 useful sample count")}else if(pans>0){s+=2;lines.push("+2 limited sample count")}if(lastImage){let ip=lastImage.texture*7+lastImage.dark*7+lastImage.gravel*5-lastImage.noise*4;s+=ip;lines.push(`${ip>=0?"+":""}${ip.toFixed(1)} photo signal`)}let cal=localCalibrationBonus();s+=cal;if(cal)lines.push(`${cal>=0?"+":""}${cal} local calibration`);s=Math.round(clamp(s,0,100));let conf=(pans>=5||g>=2)?"High":(lastImage||pans>0)?"Medium":"Low";let rating=s>=85?"Exceptional — grid pan now":s>=70?"High — systematic testing":s>=50?"Moderate — worth several pans":s>=30?"Low/moderate — quick scout":"Low — move unless evidence improves";$("score").textContent=s;$("rating").textContent=rating;$("barFill").style.width=s+"%";$("confidence").textContent="Confidence: "+conf;$("breakdown").textContent=lines.join("\n");$("recommend").textContent=recommend(s,pb,g);let ll=currentLL();lastReport={id:String(Date.now()),type:"report",date:new Date().toISOString(),lat:ll.lat,lon:ll.lng,score:s,rating,confidence:conf,notes:$("notes").value,inputs:collect(),breakdown:lines,recommendation:$("recommend").textContent};return lastReport}
function recommend(s,pb,g){if(g>=2)return"Work this exact layer. Pan a grid every 10–15 ft to define the pay streak.";if(pb>=2)return"Follow the black sand line and sample the lowest gravel over clay/hardpan/bedrock.";if(s>=50)return"Take 5 pans: waterline, midbar, highbar, obstruction, and lowest gravel.";return"Use the live heat overlay to find a stronger nearby river trap."}
function collect(){return[...document.querySelectorAll("input,select,textarea")].reduce((a,e)=>{if(e.type==="checkbox")a[e.id]=e.checked;else if(e.id)a[e.id]=e.value;return a},{})}
$("calcBtn").onclick=calc;$("saveReportBtn").onclick=()=>save(calc());$("saveCurrentBtn").onclick=()=>save(calc());$("navBtn").onclick=()=>{let ll=currentLL();window.open(`https://maps.apple.com/?ll=${ll.lat},${ll.lng}&q=Gold%20Scout%20Target`,"_blank")};

function save(r){let a=JSON.parse(localStorage.goldV6||"[]");a.unshift(r);localStorage.goldV6=JSON.stringify(a.slice(0,1000));renderJournal();renderPins();alert("Saved to journal and map.")}
function renderPins(){if(!pinLayer)return;pinLayer.clearLayers();let filter=$("journalFilter")?.value||"all";JSON.parse(localStorage.goldV6||"[]").filter(r=>isFinite(r.lat)&&isFinite(r.lon)).filter(r=>filter==="all"||(filter==="success"&&(+r.inputs?.gold||0)>=2)||(filter==="heavies"&&(+r.inputs?.panBlack||0)>=2)||(filter==="high"&&r.score>=70)||(filter==="low"&&r.score<45)).forEach(r=>{let cls=(+r.inputs?.gold||0)>=2||r.score>=70?"pinSuccess":r.score>=45?"pinMed":"pinLow";L.marker([r.lat,r.lon],{icon:L.divIcon({className:cls,iconSize:[17,17]})}).addTo(pinLayer).bindPopup(`<b>${r.score}/100</b><br>${esc(r.rating)}<br>${esc(r.notes||"")}<br><button onclick="deleteReport('${r.id}')">Delete</button>`)});}
window.deleteReport=id=>{localStorage.goldV6=JSON.stringify(JSON.parse(localStorage.goldV6||"[]").filter(r=>r.id!==id));renderJournal();renderPins();}
function renderJournal(){let list=JSON.parse(localStorage.goldV6||"[]"),f=$("journalFilter")?.value||"all";list=list.filter(r=>f==="all"||(f==="success"&&(+r.inputs?.gold||0)>=2)||(f==="heavies"&&(+r.inputs?.panBlack||0)>=2)||(f==="high"&&r.score>=70)||(f==="low"&&r.score<45));$("journalList").innerHTML=list.length?list.map(r=>`<div class="journalItem"><b>${r.score}/100 — ${esc(r.rating)}</b><br><span>${new Date(r.date).toLocaleString()} • ${esc(r.confidence)}</span><br>${Number(r.lat).toFixed(6)}, ${Number(r.lon).toFixed(6)}<br>${esc(r.notes||"")}<details><summary>Details</summary><pre>${esc((r.breakdown||[]).join("\n"))}</pre></details></div>`).join(""):"<p>No saved reports yet.</p>"}
$("journalFilter").onchange=()=>{renderJournal();renderPins()};$("clearAllBtn").onclick=()=>{if(confirm("Clear all saved reports?")){localStorage.removeItem("goldV6");renderJournal();renderPins()}};
function download(name,data,type="application/json"){let blob=new Blob([data],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}
$("exportJsonBtn").onclick=()=>download("gold-scout-v6-2.json",JSON.stringify(JSON.parse(localStorage.goldV6||"[]"),null,2));
$("exportCsvBtn").onclick=()=>{let a=JSON.parse(localStorage.goldV6||"[]");download("gold-scout-v6-2.csv","date,lat,lon,score,rating,confidence,notes\n"+a.map(r=>[r.date,r.lat,r.lon,r.score,r.rating,r.confidence,r.notes].map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\n"),"text/csv")};
$("addCalBtn").onclick=()=>{let c=JSON.parse(localStorage.goldV6Cal||'{"pans":0,"specks":0}');c.pans+=+$("calPans").value||0;c.specks+=+$("calSpecks").value||0;localStorage.goldV6Cal=JSON.stringify(c);showCal();generateHeatmap(true)};
$("resetCalBtn").onclick=()=>{localStorage.removeItem("goldV6Cal");showCal();generateHeatmap(true)};
function showCal(){let c=JSON.parse(localStorage.goldV6Cal||'{"pans":0,"specks":0}');$("calStatus").textContent=`Calibration: ${c.specks} specks across ${c.pans} pans. Current bonus: ${localCalibrationBonus()}.`}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]))}
if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});initMap();renderJournal();showCal();
