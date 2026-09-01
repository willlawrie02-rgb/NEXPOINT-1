/* NexPoint Admin — shared hub-board module (Print / Mill / Opportunities).

   Page contract:
   window.HUB = {
     hub: 'print', title: 'Print Hub',
     left:  { side: 'offer_capacity',   title: 'Hosts — offering capacity',     approveLabel: 'Approve as host' },
     right: { side: 'request_capacity', title: 'Seekers — requesting capacity', approveLabel: 'Approve request' },
   }
   plus the board skeleton: #banner, #count, #filters, #leftTitle/#leftN/#leftCol,
   #rightTitle/#rightN/#rightCol, #introRows, #overlay/#modalBody.

   Every action inserts an engine_intents row; the UI marks the card
   "Queued for the engine" until the executed intent's result lands.
   The browser never changes an external system itself — and approving
   records a decision only: the introduction email is sent by Will or
   Chris from Outlook, then logged here. */

const SUPABASE_URL='https://synywukadvjpjjxjylwk.supabase.co';
const SUPABASE_KEY='sb_publishable_a2-WFA1i5tqkoHy52_aGzQ_6Yx3xtNo';
const ADMIN_EMAILS=['willlawrie@nexpoint.co.uk','chris@nexpoint.co.uk'];  // UI gate; real gate is database RLS
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const $=id=>document.getElementById(id);
const isAdmin=email=>ADMIN_EMAILS.includes((email||'').toLowerCase());
let me=null,requests=[],intros=[],pendingByReq={},pendingByIntro={},intentById={},filter='all';

const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function boot(){
  const {data}=await sb.auth.getSession();
  const s=data&&data.session;
  if(s&&isAdmin(s.user.email)) showAdmin(s.user); else showLogin(s);
}
function showLogin(session){
  $('login').style.display='block';$('admin').style.display='none';
  if(session&&!isAdmin(session.user.email))
    $('loginErr').textContent=`${session.user.email} is signed in but not an admin.`;
}
async function doLogin(){
  $('loginErr').textContent='';
  const email=$('email').value.trim(),password=$('pw').value;
  const {data,error}=await sb.auth.signInWithPassword({email,password});
  if(error){$('loginErr').textContent=error.message;return;}
  if(!isAdmin(data.user.email)){$('loginErr').textContent='This account is not on the admin allowlist.';await sb.auth.signOut();return;}
  showAdmin(data.user);
}
async function signOut(){await sb.auth.signOut();location.reload();}

function showAdmin(user){
  me=user;$('login').style.display='none';$('admin').style.display='block';
  $('who').textContent=user.email;
  load();
}

/* ── Board vocabulary ──────────────────────────────────────────────── */

const STAGES=['approved','introduced','in_discussion','deal_done','dead','invoiced','paid'];
const STAGE_LABEL={approved:'APPROVED',introduced:'INTRODUCED',in_discussion:'IN DISCUSSION',
  deal_done:'DEAL DONE',dead:'DEAD',invoiced:'INVOICED',paid:'PAID'};
const SIDE_PREFIX={offer_capacity:'H',request_capacity:'S',list_opportunity:'L',request_intro:'I'};
const reqRef=r=>`${HUB.hub[0].toUpperCase()}${SIDE_PREFIX[r.side]||'R'}-${String(r.id).padStart(4,'0')}`;
/* A column carries one side or several — the print/mill seeker column takes
   request_capacity AND request_intro (asking to meet a listed node IS seeking). */
const sidesOf=col=>Array.isArray(col.side)?col.side:[col.side];
const FILTERS=[
  {f:'all',label:'All'},{f:'new',label:'New'},{f:'reviewing',label:'Reviewing'},
  {f:'approved',label:'Approved'},{f:'declined',label:'Declined'},
];
const REQ_BADGE={new:'NEW',reviewing:'REVIEWING',approved:'APPROVED',declined:'DECLINED'};

/* ── Data ──────────────────────────────────────────────────────────── */

async function load(){
  $('banner').innerHTML='';
  const rq=await sb.from('web_requests').select('*').eq('hub',HUB.hub)
    .neq('status','archived').order('created_at',{ascending:false});
  if(rq.error){
    $('banner').innerHTML=`<div class="banner">Could not read requests: ${esc(rq.error.message)}.
      If this says the table does not exist or permission is denied, migration 0016 has not been run yet.</div>`;
    $('leftCol').innerHTML='';$('rightCol').innerHTML='';
    return;
  }
  requests=rq.data||[];
  const iq=await sb.from('introductions').select('*').eq('hub',HUB.hub)
    .order('updated_at',{ascending:false});
  if(iq.error){
    $('banner').innerHTML=`<div class="banner">Could not read introductions: ${esc(iq.error.message)}.</div>`;
  }
  intros=iq.data||[];
  // Which rows already have an intent waiting or failed? (leads.html pattern —
  // failed first, so a re-raised pending intent wins the display.)
  const {data:intents}=await sb.from('engine_intents')
    .select('id,type,payload_json,status,result_note')
    .in('status',['pending','claimed','failed'])
    .in('type',['review-web-request','create-introduction','update-introduction']);
  pendingByReq={};pendingByIntro={};intentById={};
  const byState=(intents||[]).slice().sort((a,b)=>
    (a.status==='failed'?0:1)-(b.status==='failed'?0:1)||a.id-b.id);
  byState.forEach(i=>{
    intentById[i.id]=i;
    const p=i.payload_json||{};
    if(p.request_id!=null)pendingByReq[p.request_id]=i;
    if(p.request_a!=null)pendingByReq[p.request_a]=i;
    if(p.introduction_id!=null)pendingByIntro[p.introduction_id]=i;
  });
  render();
}

/* ── Intents ───────────────────────────────────────────────────────── */

async function raise(type,payload,spotId,verb){
  const el=$(spotId);
  if(el)el.innerHTML='<span class="status">Sending…</span>';
  const {error}=await sb.from('engine_intents').insert({type,payload_json:payload,requested_by:me.email});
  if(error){if(el)el.innerHTML=`<span class="status fail">Could not queue it: ${esc(error.message)}</span>`;return;}
  if(el){
    el.innerHTML=`<span class="status done">${esc(verb)} — queued — the engine acts within a minute or two.</span>`;
    const rowEl=el.closest('.row');if(rowEl)rowEl.classList.add('settled');
  }
  setTimeout(load,1200);
}

const reviewReq=(id,status)=>raise('review-web-request',{request_id:id,status},'act-'+id,
  status==='approved'?'Approved':status==='reviewing'?'Marked reviewing':'Declined');
function declineReq(id){
  const reason=prompt('Why is this declined? (recorded on the request)');
  if(reason===null)return;
  raise('review-web-request',{request_id:id,status:'declined',reason},'act-'+id,'Declined');
}
function setStage(id,stage){raise('update-introduction',{introduction_id:id,stage},'iact-'+id,'Updated');}
function recordCommission(id){
  const current=(intros.find(x=>x.id===id)||{}).commission_amount||'';
  const amount=prompt('Commission amount (numbers only, GBP):',current);
  if(amount===null)return;
  raise('update-introduction',{introduction_id:id,commission_amount:Number(amount)||0},'iact-'+id,'Recorded');
}
function retry(intentId){
  const i=intentById[intentId];
  if(!i)return;
  const p=i.payload_json||{};
  const spot=p.introduction_id!=null?'iact-'+p.introduction_id:'act-'+(p.request_id!=null?p.request_id:p.request_a);
  raise(i.type,p,spot,'Sent again');
}

/* ── Rendering ─────────────────────────────────────────────────────── */

function setFilter(f){filter=f;render();}

function render(){
  const awaiting=requests.filter(r=>r.status==='new'||r.status==='reviewing').length;
  $('count').textContent=requests.length
    ?`${requests.length} request${requests.length===1?'':'s'}${awaiting?` · ${awaiting} awaiting review`:''}`
    :'';
  $('filters').innerHTML=FILTERS.map(x=>
    `<button class="fchip" aria-pressed="${filter===x.f}" onclick="setFilter('${x.f}')">${x.label}</button>`).join('');

  $('leftTitle').textContent=HUB.left.title;
  $('rightTitle').textContent=HUB.right.title;
  renderCol('left');
  renderCol('right');
  renderRegister();
}

function renderCol(which){
  const col=HUB[which];
  const all=requests.filter(r=>sidesOf(col).includes(r.side));
  const shown=all.filter(r=>filter==='all'||r.status===filter);
  $(which+'N').textContent=all.length;
  $(which+'Col').innerHTML=shown.length
    ?shown.map(r=>reqCard(r,col)).join('')
    :`<div class="empty">${all.length?'Nothing matches this filter.':'Nothing here yet — requests from the website land in this column.'}</div>`;
}

function payloadDetails(r){
  const p=r.payload||{};
  const lines=Object.entries(p)
    .filter(([k,v])=>v!=null&&String(v).trim()!=='')
    .map(([k,v])=>`<strong>${esc(k.replace(/_/g,' '))}:</strong> ${esc(Array.isArray(v)?v.join(', '):v)}`);
  if(!lines.length)return '';
  return `<details class="pl"><summary><span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>What they submitted</summary><p>${lines.join('<br>')}</p></details>`;
}

function reqCard(r,col){
  const q=pendingByReq[r.id];
  const inIntros=intros.filter(i=>i.request_a===r.id||i.request_b===r.id);
  const meta=[
    r.contact_name?`<span>${esc(r.contact_name)}</span>`:'',
    r.email?`<span>${esc(r.email)}</span>`:'',
    r.phone?`<span>${esc(r.phone)}</span>`:'',
    r.location?`<span>${esc(r.location)}</span>`:'',
    r.brief_ref?`<span>brief ${esc(r.brief_ref)}</span>`:'',
    r.created_at?`<span>received ${esc(String(r.created_at).slice(0,10))}</span>`:'',
  ].filter(Boolean).join('');
  const declined=r.status==='declined'&&(r.review_note||r.reviewed_by)
    ?`<div class="why" style="margin-top:8px;color:var(--fg-2)">Declined${r.reviewed_by?' by '+esc(r.reviewed_by):''}${r.review_note?': '+esc(r.review_note):''}</div>`
    :'';
  const linked=inIntros.length
    ?`<div class="meta"><span class="status done"><span class="material-symbols-outlined" aria-hidden="true">handshake</span> In introduction ${inIntros.map(i=>esc(i.ref||('INTRO-'+String(i.id).padStart(4,'0')))).join(', ')}</span></div>`
    :'';

  let actions;
  if(q&&q.status==='failed'){
    actions=`<div class="actions"><span class="status fail">Engine could not action this: ${esc(q.result_note||'')}</span>
      <button class="btn btn-gh btn-sm" onclick="retry(${q.id})"><span class="material-symbols-outlined" aria-hidden="true">refresh</span>Try again</button></div>`;
  }else if(q){
    actions=`<div class="actions"><span class="status">Queued — the engine acts within a minute or two.</span></div>`;
  }else if(r.status==='new'){
    actions=`<div class="actions">
      <button class="btn btn-gh btn-sm" onclick="reviewReq(${r.id},'reviewing')">Mark reviewing</button>
      <button class="btn btn-grn btn-sm" onclick="reviewReq(${r.id},'approved')"><span class="material-symbols-outlined" aria-hidden="true">check</span>${esc(col.approveLabel)}</button>
      <button class="btn btn-danger btn-sm" onclick="declineReq(${r.id})"><span class="material-symbols-outlined" aria-hidden="true">close</span>Decline</button></div>`;
  }else if(r.status==='reviewing'){
    actions=`<div class="actions">
      <button class="btn btn-grn btn-sm" onclick="reviewReq(${r.id},'approved')"><span class="material-symbols-outlined" aria-hidden="true">check</span>${esc(col.approveLabel)}</button>
      <button class="btn btn-danger btn-sm" onclick="declineReq(${r.id})"><span class="material-symbols-outlined" aria-hidden="true">close</span>Decline</button></div>`;
  }else if(r.status==='approved'){
    actions=`<div class="actions">
      <button class="btn btn-pri btn-sm" onclick="openIntroModal(${r.id})"><span class="material-symbols-outlined" aria-hidden="true">handshake</span>Make introduction</button></div>`;
  }else{ // declined
    actions=`<div class="actions">
      <button class="btn btn-gh btn-sm" onclick="reviewReq(${r.id},'reviewing')">Reconsider</button></div>`;
  }

  return `<div class="row req s-${esc(r.status)}">
    <div class="row-top">
      <span class="ref">${esc(reqRef(r))}</span>
      <span class="company">${esc(r.company||'(no company given)')}</span>
      <span class="stg stg-${esc(r.status)}">${esc(REQ_BADGE[r.status]||r.status)}</span>
    </div>
    <div class="meta">${meta}</div>
    ${declined}
    ${linked}
    ${payloadDetails(r)}
    <div id="act-${r.id}">${actions}</div>
  </div>`;
}

const companyOf=id=>{
  const r=requests.find(x=>x.id===id);
  return r?`${r.company||'(no company given)'} · ${reqRef(r)}`:(id==null?'—':'request #'+id);
};

function fmtCommission(i){
  if(i.commission_amount!=null&&i.commission_amount!=='')
    return `${Number(i.commission_amount).toLocaleString('en-GB')} ${esc(i.commission_currency||'GBP')}`;
  return i.commission_basis?esc(i.commission_basis):'—';
}

function renderRegister(){
  /* Dead introductions leave the working board; the rows stay in the
     database and the nightly archive. */
  const live=intros.filter(i=>i.stage!=='dead');
  if(!live.length){
    $('introRows').innerHTML=`<tr><td colspan="6" style="color:var(--fg-2)">${intros.length
      ?'No live introductions — dead ones are kept in the database and the archive, off the board.'
      :'No introductions yet. Approve a request on each side, then make the introduction from either card.'}</td></tr>`;
    return;
  }
  $('introRows').innerHTML=live.map(i=>{
    const q=pendingByIntro[i.id];
    let manage;
    if(q&&q.status==='failed'){
      manage=`<span class="status fail">Failed: ${esc(q.result_note||'')}</span>
        <button class="btn btn-gh btn-sm" onclick="retry(${q.id})">Try again</button>`;
    }else if(q){
      manage=`<span class="status">Queued for the engine — moments away.</span>`;
    }else{
      manage=`<select aria-label="Set stage for ${esc(i.ref||i.id)}" onchange="setStage(${i.id},this.value)">
          ${STAGES.map(s=>`<option value="${s}" ${s===i.stage?'selected':''}>${STAGE_LABEL[s]}</option>`).join('')}
        </select>
        <button class="btn btn-gh btn-sm" onclick="recordCommission(${i.id})">Record commission</button>`;
    }
    return `<tr>
      <td class="rref">${esc(i.ref||('INTRO-'+String(i.id).padStart(4,'0')))}</td>
      <td>${esc(companyOf(i.request_a))}</td>
      <td>${esc(companyOf(i.request_b))}</td>
      <td><span class="stg stg-${esc(i.stage)}">${esc(STAGE_LABEL[i.stage]||i.stage)}</span></td>
      <td class="money">${fmtCommission(i)}</td>
      <td><div id="iact-${i.id}" class="actions" style="margin-top:0">${manage}</div></td>
    </tr>`;
  }).join('');
}

/* ── Make-introduction modal ───────────────────────────────────────── */

let modalFor=null;

function openIntroModal(reqId){
  const r=requests.find(x=>x.id===reqId);
  if(!r)return;
  modalFor=reqId;
  const otherCol=sidesOf(HUB.left).includes(r.side)?HUB.right:HUB.left;
  const partners=requests.filter(x=>sidesOf(otherCol).includes(x.side)&&x.status==='approved');
  const list=partners.length
    ?partners.map((p,ix)=>`<label style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border-faint);cursor:pointer">
        <input type="radio" name="partner" value="${p.id}" ${ix===0?'checked':''}>
        <span class="ref">${esc(reqRef(p))}</span>
        <span style="font-weight:600;color:var(--fg)">${esc(p.company||'(no company given)')}</span>
        <span style="color:var(--fg-2);font-size:12.5px">${esc(p.location||'')}</span>
      </label>`).join('')
    :`<div class="empty">No approved requests to pair with yet under “${esc(otherCol.title)}”.</div>`;
  $('modalBody').innerHTML=`
    <p style="font-size:14px;color:var(--fg-1);margin-bottom:16px">
      Introducing <strong>${esc(r.company||reqRef(r))}</strong> (${esc(reqRef(r))}) to:</p>
    <div style="margin-bottom:18px">${list}</div>
    <div class="field" style="margin-bottom:14px"><label>Commission basis <span class="opt">(how NexPoint is paid on this pairing)</span></label>
      <input id="m_basis" placeholder="e.g. 5% per order, introduction fee"></div>
    <div class="field" style="margin-bottom:18px"><label>Notes <span class="opt">(optional)</span></label>
      <textarea id="m_notes"></textarea></div>
    <div class="note-box">This records the introduction — you send the email yourselves from Outlook,
      then mark it introduced here.</div>
    <div style="display:flex;justify-content:flex-end;gap:10px">
      <button class="btn btn-gh" onclick="closeIntroModal()">Cancel</button>
      <button class="btn btn-pri" onclick="createIntro(${r.id})" ${partners.length?'':'disabled'}>Record introduction</button>
    </div>`;
  $('overlay').classList.add('open');
}
function closeIntroModal(){$('overlay').classList.remove('open');modalFor=null;}
function createIntro(aId){
  const chosen=document.querySelector('input[name="partner"]:checked');
  if(!chosen)return;
  const payload={hub:HUB.hub,request_a:aId,request_b:Number(chosen.value),brief_id:null,
    commission_basis:$('m_basis').value.trim(),notes:$('m_notes').value.trim()};
  closeIntroModal();
  raise('create-introduction',payload,'act-'+aId,'Introduction recorded');
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeIntroModal();});
document.addEventListener('click',e=>{if(e.target===$('overlay'))closeIntroModal();});

boot();
