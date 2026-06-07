let deferredPrompt=null,watchId=null,map=null,selectedMarker=null,selectedLL=null,lastImage=null,lastReport=null;
let hotspotLayer=null,pinLayer=null,refreshTimer=null;
const $=id=>document.getElementById(id), clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const W={region:{unknown:0,historic:22,lode:18,glacial:10,greenstone:20,mountain:17,volcanic:14,desert:12,low:-12},landform:{inside:16,bar:14,creek:18,riffle:17,bedrock:22,clay:18,terrace:10,wash:14,lake:-7,upland:-14},bottom:{unknown:0,sand:-8,gravel:8,clay:15,bedrock:22},energy:{high:12,mod:8,flash:10,low:-5,dry:2},depth:{surface:0,six:3,target:8,deep:4,false:15},access:{unknown:0,public:4,permission:4,restricted:-30},panBlack:[0,5,12,18,23],gold:[0,12,28,50,65]};
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>{document.querySelectorAll("nav button,.tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");$(b.dataset.tab).classList.add("active");if(b.dataset.tab==="map")setTimeout(()=>{initMap();map.invalidateSize()},100)});
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e;$("installBtn").hidden=false});$("installBtn").onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;$("installBtn").hidden=true}};
function initMap(){
  if(map)return;
  let lat=+$("lat").value||41.084,lon=+$("lon").value||-85.625;
  map=L.map("mapView").setView([lat,lon],17);

  // Label-friendly default: street/hybrid labels are easier for river/town names.
  // Satellite is still available from the layer picker.
  let street=L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
    maxZoom:19,
    attribution:"© OpenStreetMap contributors"
  }).addTo(map);

  let satellite=L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{
    maxZoom:19,
    attribution:"Tiles © Esri"
  });

  let topo=L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",{
    maxZoom:17,
    attribution:"© OpenTopoMap"
  });

  // Optional labels overlay over satellite. Works like a hybrid view when enabled.
  let labels=L.tileLayer("https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png",{
    maxZoom:20,
    attribution:"© CARTO © OpenStreetMap contributors",
    pane:"overlayPane"
  });

  L.control.layers(
    {"Street labels":street,"Satellite":satellite,"Topo":topo},
    {"Town/river labels overlay":labels},
    {collapsed:false}
  ).addTo(map);

  hotspotLayer=L.layerGroup().addTo(map);
  pinLayer=L.layerGroup().addTo(map);
  selectedLL=L.latLng(lat,lon);
  selectedMarker=L.marker(selectedLL,{draggable:true}).addTo(map).bindPopup("Selected analysis point");
  selectedMarker.on("dragend",()=>setSelected(selectedMarker.getLatLng(),false));
  map.on("click",e=>setSelected(e.latlng,true));
  map.on("moveend zoomend",()=>{if($("autoRefresh").value==="on")debouncedHotspots()});
  renderPins();
  generateViewportHotspots();
}

function setSelected(ll,pan){selectedLL=ll;selectedMarker.setLatLng(ll);$("lat").value=ll.lat.toFixed(6);$("lon").value=ll.lng.toFixed(6);$("selectedCoords").textContent=`${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`;if(pan)selectedMarker.openPopup();}
function setGPS(p){const ll=L.latLng(p.coords.latitude,p.coords.longitude);$("gpsAccuracy").textContent="±"+Math.round(p.coords.accuracy)+" m";if($("gpsAccuracy")){} $("lat").value=ll.lat.toFixed(6);$("lon").value=ll.lng.toFixed(6);$("gpsAccuracy").textContent="±"+Math.round(p.coords.accuracy)+" m"; if($("gpsAccuracy")){}; if($("gpsAccuracy")){}; if($("selectedCoords"))$("selectedCoords").textContent=`${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`; if(document.getElementById("gpsAccuracy")){}; if(map){setSelected(ll,false);map.setView(ll,18)}}
$("gpsBtn").onclick=()=>{initMap();navigator.geolocation?navigator.geolocation.getCurrentPosition(setGPS,e=>alert(e.message),{enableHighAccuracy:true,timeout:16000,maximumAge:20000}):alert("GPS unavailable")};
$("trackBtn").onclick=()=>{initMap();if(!navigator.geolocation)return alert("GPS unavailable");watchId=navigator.geolocation.watchPosition(setGPS,e=>alert(e.message),{enableHighAccuracy:true,maximumAge:5000})};
$("stopTrackBtn").onclick=()=>{if(watchId!==null){navigator.geolocation.clearWatch(watchId);watchId=null}};
$("refreshHotspotsBtn").onclick=()=>{initMap();generateViewportHotspots()};
function debouncedHotspots(){clearTimeout(refreshTimer);refreshTimer=setTimeout(generateViewportHotspots,450);}
function icon(cls,size=18){return L.divIcon({className:cls,iconSize:[size,size]})}
function metersPerPixel(){const c=map.getCenter(),z=map.getZoom();return 156543.03392*Math.cos(c.lat*Math.PI/180)/Math.pow(2,z)}

let osmWaterways = [];
let osmFetchTimer = null;
let lastOsmBboxKey = "";
const hotspotMemory = new Map();

function viewportCandidateCount(){
  const density=$("density").value;
  return density==="high"?60:density==="medium"?34:18;
}

function bboxKey(){
  const b=map.getBounds();
  return [b.getSouth().toFixed(3),b.getWest().toFixed(3),b.getNorth().toFixed(3),b.getEast().toFixed(3)].join(",");
}

async function fetchVisibleWaterways(){
  if(!map) return [];
  const key=bboxKey();
  if(key===lastOsmBboxKey && osmWaterways.length) return osmWaterways;
  lastOsmBboxKey=key;
  const b=map.getBounds();
  const query = `
    [out:json][timeout:12];
    (
      way["waterway"~"river|stream|creek|brook|canal|ditch"](${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()});
    );
    out geom;
  `;
  try{
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},
      body:"data="+encodeURIComponent(query)
    });
    const data = await res.json();
    osmWaterways = (data.elements||[])
      .filter(w=>w.geometry && w.geometry.length>1)
      .map(w=>({
        id:w.id,
        name:(w.tags&&w.tags.name)||"mapped waterway",
        type:(w.tags&&w.tags.waterway)||"stream",
        pts:w.geometry.map(g=>L.latLng(g.lat,g.lon))
      }));
    return osmWaterways;
  }catch(e){
    console.warn("OSM waterway fetch failed", e);
    return [];
  }
}

function debouncedHotspots(){
  clearTimeout(refreshTimer);
  refreshTimer=setTimeout(generateViewportHotspots,650);
}

async function generateViewportHotspots(){
  if(!map) return;
  hotspotLayer.clearLayers();
  $("candidateCount").textContent="loading…";
  $("hotspotPanel").textContent="Loading mapped river/stream lines in the visible map area…";

  const waterways = await fetchVisibleWaterways();
  let candidates = [];

  if(waterways.length){
    for(const way of waterways){
      candidates.push(...waterwayCandidates(way));
    }
    candidates = dedupeCandidates(candidates);
    candidates.sort((a,b)=>b.score-a.score);
    candidates = candidates.slice(0, +$("maxHotspots").value);
    $("hotspotPanel").innerHTML =
      `<b>River-locked mode:</b> hotspots are anchored to mapped waterways from OpenStreetMap, so they stay on/near rivers and streams.\n\n` +
      candidates.slice(0,10).map((h,i)=>`<b>${i+1}. ${h.name}</b> — ${h.score}/100\n${h.reason}\n`).join("\n");
  } else {
    candidates = fallbackCenterlineCandidates();
    $("hotspotPanel").innerHTML =
      `<b>No mapped waterway found in this view.</b>\nZoom closer to a river/creek or switch to the labeled street/topo layer so the stream is visible. I generated a small fallback scan near the selected point only.\n\n` +
      candidates.slice(0,8).map((h,i)=>`<b>${i+1}. ${h.name}</b> — ${h.score}/100\n${h.reason}\n`).join("\n");
  }

  candidates.forEach((h,i)=>drawHotspot(h,i));
  $("candidateCount").textContent=String(candidates.length);
  $("bestTarget").textContent=candidates.length?`${candidates[0].score}/100 ${candidates[0].name}`:"No river targets";
  if($("voiceHints").value==="on"&&candidates[0]?.score>=75)speak(`High potential river target visible. ${candidates[0].name}.`);
}

function waterwayCandidates(way){
  const out=[];
  const pts=way.pts;
  if(pts.length<2) return out;

  const stepEvery = $("density").value==="high"?2:$("density").value==="medium"?3:5;

  for(let i=1;i<pts.length-1;i+=stepEvery){
    const prev=pts[i-1], p=pts[i], next=pts[i+1];
    if(!map.getBounds().pad(0.06).contains(p)) continue;

    const angle = turnAngle(prev,p,next);
    const curveBonus = clamp(Math.abs(angle)/85*18,0,18);
    const confluenceBonus = nearbyJunctionBonus(p, way.id);
    const saved = nearSavedBonus(p);
    const mode = $("mapMode").value;
    let modeBonus = mode==="glacial"?3:mode==="river"||mode==="auto"?6:mode==="terrace"?1:mode==="desert"?0:0;
    const cal = localCalibrationBonus();
    const stableNoise = deterministicNoise(p.lat,p.lng)*8 - 4;

    const score = clamp(Math.round(45 + curveBonus + confluenceBonus + modeBonus + saved.bonus + cal + stableNoise), 8, 96);
    const bendName = angle>8 ? "inside-bend / point-bar edge" : angle<-8 ? "opposite bend heavy line" : "straight-run low gravel test";
    const reason =
      `${way.name} (${way.type}). Anchored to mapped stream geometry.\n` +
      (Math.abs(angle)>12 ? `Curve detected: bends can form low-energy pay streaks.` : `Straight/low curve section: test only if gravel, black sand, or clay contact is present.`) +
      (confluenceBonus?`\nNearby mapped junction/confluence adds potential.`:"") +
      (saved.text?`\n${saved.text}`:"");

    out.push({
      lat:p.lat,lng:p.lng,score,
      name:bendName,
      reason,
      action:"Pan the lowest coarse gravel closest to the black-sand/heavy-mineral line.",
      waterwayId:way.id
    });

    // Offset target beside bend: real pay streak is often on bar margin, not exactly the centerline.
    if(Math.abs(angle)>10){
      const bearing = bearingDeg(prev,next);
      const side = angle>0 ? -90 : 90;
      const off = destination(p.lat,p.lng,bearing+side,18);
      out.push({
        lat:off.lat,lng:off.lng,score:clamp(score+5,0,98),
        name:"bend-margin pay streak",
        reason:`Offset 18 ft from ${way.name}. Targets likely gravel-bar/heavy-mineral margin instead of the channel center.`,
        action:"Look for black sand, coarse lag gravel, and clay/hardpan contact.",
        waterwayId:way.id
      });
    }
  }
  return out;
}

function fallbackCenterlineCandidates(){
  const center=currentLL();
  const bearings=[0,45,90,135,180,225,270,315];
  return bearings.map((br,i)=>{
    const p=destination(center.lat,center.lng,br,35+i*8);
    return {
      lat:p.lat,lng:p.lng,
      score:clamp(42-i*2+localCalibrationBonus(),5,70),
      name:"fallback selected-point target",
      reason:"No OpenStreetMap river/stream line was found in this visible map area. This is not river-locked. Zoom closer to the river or use the labeled map layer.",
      action:"Use only as a temporary target; prefer mapped river hotspots.",
      waterwayId:null
    };
  });
}

function dedupeCandidates(list){
  const out=[];
  for(const h of list){
    const key=(Math.round(h.lat*100000)/100000)+","+(Math.round(h.lng*100000)/100000);
    if(hotspotMemory.has(key)){
      const prev=hotspotMemory.get(key);
      h.score=Math.round((h.score+prev.score)/2);
    }
    hotspotMemory.set(key,h);
    if(!out.some(x=>L.latLng(x.lat,x.lng).distanceTo(L.latLng(h.lat,h.lng))<18)) out.push(h);
  }
  return out;
}

function turnAngle(a,b,c){
  const br1=bearingDeg(a,b), br2=bearingDeg(b,c);
  return ((br2-br1+540)%360)-180;
}

function bearingDeg(a,b){
  const lat1=a.lat*Math.PI/180, lat2=b.lat*Math.PI/180, dLon=(b.lng-a.lng)*Math.PI/180;
  const y=Math.sin(dLon)*Math.cos(lat2);
  const x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);
  return (Math.atan2(y,x)*180/Math.PI+360)%360;
}

function destination(lat,lng,bearing,feet){
  const R=6378137, d=feet*0.3048, br=bearing*Math.PI/180, phi1=lat*Math.PI/180, lam1=lng*Math.PI/180;
  const phi2=Math.asin(Math.sin(phi1)*Math.cos(d/R)+Math.cos(phi1)*Math.sin(d/R)*Math.cos(br));
  const lam2=lam1+Math.atan2(Math.sin(br)*Math.sin(d/R)*Math.cos(phi1),Math.cos(d/R)-Math.sin(phi1)*Math.sin(phi2));
  return {lat:phi2*180/Math.PI,lng:lam2*180/Math.PI};
}

function nearbyJunctionBonus(p, ownId){
  let bonus=0;
  for(const way of osmWaterways){
    if(way.id===ownId) continue;
    for(const q of way.pts){
      const d=p.distanceTo(q);
      if(d<45) return 12;
      if(d<90) bonus=Math.max(bonus,6);
    }
  }
  return bonus;
}

function deterministicNoise(lat,lng){
  const s=Math.sin((lat*127.1+lng*311.7)*1000)*43758.5453123;
  return s-Math.floor(s);
}

function currentLL(){
  const lat=+$("lat").value, lon=+$("lon").value;
  if(isFinite(lat)&&isFinite(lon)) return L.latLng(lat,lon);
  return selectedLL || map.getCenter();
}

$("photo").onchange=e=>{const f=e.target.files[0];if(!f)return;const img=new Image();img.onload=()=>analyzePhoto(img);img.src=URL.createObjectURL(f)};
function analyzePhoto(img){const c=$("photoCanvas"),ctx=c.getContext("2d",{willReadFrequently:true});let scale=Math.min(1000/img.width,1);c.width=img.width*scale;c.height=img.height*scale;ctx.drawImage(img,0,0,c.width,c.height);let d=ctx.getImageData(0,0,c.width,c.height).data,dark=0,gray=0,tan=0,green=0,blue=0,edge=0,total=0,prev=0;for(let i=0;i<d.length;i+=4){let r=d[i],g=d[i+1],b=d[i+2],lum=.2126*r+.7152*g+.0722*b,max=Math.max(r,g,b),min=Math.min(r,g,b),sat=max?(max-min)/max:0;total++;if(lum<58&&sat<.5)dark++;if(sat<.2&&lum>60&&lum<205)gray++;if(r>85&&g>60&&b<100&&sat>.16)tan++;if(g>r*1.08&&g>b*1.08&&sat>.22)green++;if(b>r*1.08&&b>g*.9&&sat>.18)blue++;if(i>4&&Math.abs(lum-prev)>45)edge++;prev=lum}let pct=x=>x/total;lastImage={texture:clamp((pct(edge)-.075)/.2,0,1),dark:clamp((pct(dark)-.045)/.22,0,1),gravel:clamp((pct(gray)+pct(tan)-.22)/.5,0,1),noise:clamp((pct(green)+pct(blue)-.18)/.45,0,1)};$("photoMetrics").innerHTML=[["Coarse texture",lastImage.texture],["Dark mineral proxy",lastImage.dark],["Gravel/clay proxy",lastImage.gravel],["Vegetation/water interference",lastImage.noise]].map(x=>`<div class="metric"><b>${x[0]}</b><br>${Math.round(x[1]*100)}%</div>`).join("")}
function calc(){let s=0,lines=[];["region","landform","bottom","energy","depth","access"].forEach(id=>{let val=$(id).value,w=W[id][val];s+=w;lines.push(`${w>=0?"+":""}${w} ${id}: ${val}`)});[["blackSand",16,"black sand visible"],["heavies",11,"dense heavies"],["coarse",10,"coarse lag gravel"],["obstruction",10,"obstruction trap"],["tributary",9,"tributary/confluence"],["legal",2,"legal access checked"]].forEach(a=>{if($(a[0]).checked){s+=a[1];lines.push(`+${a[1]} ${a[2]}`)}});let pb=+$("panBlack").value,g=+$("gold").value,pans=+$("pans").value||0;s+=W.panBlack[pb]+W.gold[g];lines.push(`+${W.panBlack[pb]} pan black sand`);lines.push(`+${W.gold[g]} gold result`);if(pans>=10){s+=7;lines.push("+7 strong sample count")}else if(pans>=5){s+=5;lines.push("+5 useful sample count")}else if(pans>0){s+=2;lines.push("+2 limited sample count")}if(lastImage){let ip=lastImage.texture*7+lastImage.dark*7+lastImage.gravel*5-lastImage.noise*4;s+=ip;lines.push(`${ip>=0?"+":""}${ip.toFixed(1)} photo signal`)}let cal=localCalibrationBonus();s+=cal;if(cal)lines.push(`${cal>=0?"+":""}${cal} local calibration`);s=Math.round(clamp(s,0,100));let conf=(pans>=5||g>=2)?"High":(lastImage||pans>0)?"Medium":"Low";let rating=s>=85?"Exceptional — grid pan now":s>=70?"High — systematic testing":s>=50?"Moderate — worth several pans":s>=30?"Low/moderate — quick scout":"Low — move unless evidence improves";$("score").textContent=s;$("rating").textContent=rating;$("barFill").style.width=s+"%";$("confidence").textContent="Confidence: "+conf;$("breakdown").textContent=lines.join("\n");$("recommend").textContent=recommend(s,pb,g);let ll=L.latLng(+$("lat").value,+$("lon").value);lastReport={id:String(Date.now()),type:"report",date:new Date().toISOString(),lat:ll.lat,lon:ll.lng,score:s,rating,confidence:conf,notes:$("notes").value,inputs:collect(),breakdown:lines,recommendation:$("recommend").textContent};return lastReport}
function recommend(s,pb,g){if(g>=2)return"Work this exact layer. Pan a grid every 10–15 ft to define the pay streak.";if(pb>=2)return"Follow the black sand line and sample the lowest gravel over clay/hardpan/bedrock.";if(s>=50)return"Take 5 pans: waterline, midbar, highbar, obstruction, and lowest gravel.";return"Use the live map to find a stronger nearby trap."}
function collect(){return[...document.querySelectorAll("input,select,textarea")].reduce((a,e)=>{if(e.type==="checkbox")a[e.id]=e.checked;else if(e.id)a[e.id]=e.value;return a},{})}
$("calcBtn").onclick=calc;$("saveReportBtn").onclick=()=>save(calc());$("saveCurrentBtn").onclick=()=>save(calc());$("navBtn").onclick=()=>{let lat=+$("lat").value,lon=+$("lon").value;if(isFinite(lat)&&isFinite(lon))window.open(`https://maps.apple.com/?ll=${lat},${lon}&q=Gold%20Scout%20Target`,"_blank")};
function save(r){let a=JSON.parse(localStorage.goldV6||"[]");a.unshift(r);localStorage.goldV6=JSON.stringify(a.slice(0,1000));renderJournal();renderPins();alert("Saved to journal and map.");}
function renderPins(){if(!pinLayer)return;pinLayer.clearLayers();let filter=$("journalFilter")?.value||"all";JSON.parse(localStorage.goldV6||"[]").filter(r=>isFinite(r.lat)&&isFinite(r.lon)).filter(r=>filter==="all"||(filter==="success"&&(+r.inputs?.gold||0)>=2)||(filter==="heavies"&&(+r.inputs?.panBlack||0)>=2)||(filter==="high"&&r.score>=70)||(filter==="low"&&r.score<45)).forEach(r=>{let cls=(+r.inputs?.gold||0)>=2||r.score>=70?"pinSuccess":r.score>=45?"pinMed":"pinLow";L.marker([r.lat,r.lon],{icon:icon(cls,17)}).addTo(pinLayer).bindPopup(`<b>${r.score}/100</b><br>${esc(r.rating)}<br>${esc(r.notes||"")}<br><button onclick="deleteReport('${r.id}')">Delete</button>`)});}
window.deleteReport=id=>{localStorage.goldV6=JSON.stringify(JSON.parse(localStorage.goldV6||"[]").filter(r=>r.id!==id));renderJournal();renderPins();}
function renderJournal(){let list=JSON.parse(localStorage.goldV6||"[]"),f=$("journalFilter")?.value||"all";list=list.filter(r=>f==="all"||(f==="success"&&(+r.inputs?.gold||0)>=2)||(f==="heavies"&&(+r.inputs?.panBlack||0)>=2)||(f==="high"&&r.score>=70)||(f==="low"&&r.score<45));$("journalList").innerHTML=list.length?list.map(r=>`<div class="journalItem"><b>${r.score}/100 — ${esc(r.rating)}</b><br><span>${new Date(r.date).toLocaleString()} • ${esc(r.confidence)}</span><br>${Number(r.lat).toFixed(6)}, ${Number(r.lon).toFixed(6)}<br>${esc(r.notes||"")}<details><summary>Details</summary><pre>${esc((r.breakdown||[]).join("\n"))}</pre></details></div>`).join(""):"<p>No saved reports yet.</p>"}
$("journalFilter").onchange=()=>{renderJournal();renderPins()};$("clearAllBtn").onclick=()=>{if(confirm("Clear all saved reports?")){localStorage.removeItem("goldV6");renderJournal();renderPins()}};
function download(name,data,type="application/json"){let blob=new Blob([data],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}
$("exportJsonBtn").onclick=()=>download("gold-scout-v6.json",JSON.stringify(JSON.parse(localStorage.goldV6||"[]"),null,2));
$("exportCsvBtn").onclick=()=>{let a=JSON.parse(localStorage.goldV6||"[]");download("gold-scout-v6.csv","date,lat,lon,score,rating,confidence,notes\n"+a.map(r=>[r.date,r.lat,r.lon,r.score,r.rating,r.confidence,r.notes].map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\n"),"text/csv")};
$("addCalBtn").onclick=()=>{let c=JSON.parse(localStorage.goldV6Cal||'{"pans":0,"specks":0}');c.pans+=+$("calPans").value||0;c.specks+=+$("calSpecks").value||0;localStorage.goldV6Cal=JSON.stringify(c);showCal();generateViewportHotspots();};
$("resetCalBtn").onclick=()=>{localStorage.removeItem("goldV6Cal");showCal();generateViewportHotspots();};
function showCal(){let c=JSON.parse(localStorage.goldV6Cal||'{"pans":0,"specks":0}');$("calStatus").textContent=`Calibration: ${c.specks} specks across ${c.pans} pans. Current bonus: ${localCalibrationBonus()}.`;}
function speak(t){try{speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(t))}catch(e){}}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]))}
function escAttr(s){return String(s).replace(/'/g,"\\'").replace(/"/g,'&quot;')}
if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});initMap();renderJournal();showCal();
