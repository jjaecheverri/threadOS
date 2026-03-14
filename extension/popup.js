async function load(){
  const r=await chrome.runtime.sendMessage({type:'GET_THREADS',payload:{}});
  const ts=r?.threads||[];
  const totalS=ts.reduce((n,t)=>n+(t.sessions?.length||0),0);
  const totalD=ts.reduce((n,t)=>n+(t.driftFlags?.length||0),0);
  document.getElementById('stats').innerHTML=`
    <div class="stat"><div class="stat-v">${ts.length}</div><div class="stat-l">Threads</div></div>
    <div class="stat"><div class="stat-v">${totalS}</div><div class="stat-l">Sessions</div></div>
    <div class="stat"><div class="stat-v" style="color:${totalD>0?'var(--red)':'var(--green)'}">${totalD}</div><div class="stat-l">Drift</div></div>
  `;
  if(totalS>0){
    const scores=ts.flatMap(t=>t.sessions||[]).map(s=>s.drift?.score??100);
    const avg=Math.round(scores.reduce((a,b)=>a+b,0)/scores.length);
    const col=avg>=80?'var(--green)':avg>=60?'var(--yellow)':avg>=40?'var(--orange)':'var(--red)';
    document.getElementById('fid').style.display='block';
    const sc=document.getElementById('fid-score');
    sc.textContent=avg+'%';sc.style.color=col;
    const fi=document.getElementById('fid-fill');
    fi.style.width=avg+'%';fi.style.background=col;
  }
  const sec=document.getElementById('threads');
  if(!ts.length){
    sec.innerHTML='<div class="empty">No threads yet. Visit ChatGPT, Claude, Gemini, or Perplexity to start capturing.</div>';
  }else{
    sec.innerHTML='<div class="section-label">Active threads</div>'+ts.slice(0,5).map(t=>{
      const d=t.driftFlags?.length||0;
      return`<div class="thread-item"><div class="t-dot" style="background:${d>0?'var(--red)':'var(--green)'}"></div><div class="t-name">${t.title}</div><div class="t-meta">${t.sessions?.length||0}s · ${d}d</div></div>`;
    }).join('');
  }
  try{const b=await new Promise(r=>chrome.storage.local.getBytesInUse(null,r));document.getElementById('usage').textContent=(b/1024).toFixed(1)+' KB';}catch{}
}
document.getElementById('clear-btn').addEventListener('click',async()=>{
  if(!confirm('Delete all threads and sessions? This cannot be undone.'))return;
  await chrome.runtime.sendMessage({type:'CLEAR_ALL',payload:{}});
  load();
});
load();