/* NexPoint Admin — shared hub-board module (Print / Mill / Opportunities).

   Page contract:
   window.HUB = {
     hub: 'print', title: 'Print Hub',
     left:  { side: 'offer_capacity',   title: 'Hosts — offering capacity',     approveLabel: 'Approve as host' },
     right: { side: 'request_capacity', title: 'Seekers — requesting capacity', approveLabel: 'Approve request' },
   }
   plus the board skeleton: #banner, #count, #filters, #leftTitle/#leftN/#leftCol,
   #rightTitle/#rightN/#rightCol, #introRows, #overlay/#modalBody. Print/Mill
   additionally carry #hostAppRows (host applications, spec §4 — "only print
   and mill hosts pay"), #listingRows (the listing review queue) and
   #seekerCol (the seeker request queue that replaces the old right column,
   which stays on the page under a collapsed "Legacy requests" heading):
   Opportunities has none of those, so every code path below checks for the
   element before touching the DOM, and the fetches are gated on HUB.hub
   being 'print' or 'mill'.

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
let hostApps=[],orgById={},pendingByHostApp={};
/* Hub v2: the listing review queue and the seeker request queue. */
let listings=[],revById={},machinesByRev={},seekReqs=[];
let pendingByListing={},pendingBySeekReq={};
const HOSTS_HUB=()=>HUB.hub==='print'||HUB.hub==='mill';

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

/* STAGES is what the register's dropdown may SET. The lifecycle is wider:
   proposed / awaiting_acceptance / expired / declined belong to the
   acceptance flow, which the worker and the engine move, so those rows show
   a read-only badge instead of a dropdown that could yank them out of it. */
const STAGES=['approved','introduced','in_discussion','deal_done','dead','invoiced','paid'];
const STAGE_LABEL={proposed:'PROPOSED',awaiting_acceptance:'AWAITING ACCEPTANCE',
  approved:'APPROVED',introduced:'INTRODUCED',in_discussion:'IN DISCUSSION',
  deal_done:'DEAL DONE',dead:'DEAD',invoiced:'INVOICED',paid:'PAID',
  expired:'EXPIRED',declined:'DECLINED'};
/* A provider said no, or never answered: the desk may re-route round it. */
const SPENT_STAGES=['declined','expired'];
const LISTING_INTENTS=['approve-listing','decline-listing',
  'approve-listing-revision','decline-listing-revision'];
/* All three carry `request_id`, and it means a seeker_requests row — NOT the
   web_requests id review-web-request's own request_id means. */
const SEEKER_INTENTS=['approve-intro-request','add-provider','decline-intro-request'];
const LISTING_BADGE={pending:'PENDING',live:'LIVE',declined:'DECLINED',hidden:'HIDDEN'};
const SREQ_BADGE={open:'OPEN',picked:'PICKED',desk:'DESK',declined:'DECLINED',closed:'CLOSED'};
const seekRef=r=>`REQ-${String(r.id).padStart(4,'0')}`;
const introRef=i=>i.ref||('INTRO-'+String(i.id).padStart(4,'0'));
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
    /* On print/mill the listings and seeker queues are the working board and
       the enquiry inbox is the legacy section, so a web_requests failure
       shows its banner and the rest of the page still loads. */
    if(!(HOSTS_HUB()&&$('listingRows')))return;
  }
  requests=rq.data||[];
  const iq=await sb.from('introductions').select('*').eq('hub',HUB.hub)
    .order('updated_at',{ascending:false});
  if(iq.error){
    $('banner').innerHTML=`<div class="banner">Could not read introductions: ${esc(iq.error.message)}.</div>`;
  }
  intros=iq.data||[];

  hostApps=[];orgById={};listings=[];revById={};machinesByRev={};seekReqs=[];
  if(HOSTS_HUB()){
    const haq=await sb.from('host_applications').select('*').eq('hub',HUB.hub)
      .order('submitted_at',{ascending:false});
    if(haq.error){
      $('banner').innerHTML+=`<div class="banner">Could not read host applications: ${esc(haq.error.message)}.
        If this says the table does not exist or permission is denied, migration 0024 (schema) and
        0025 (engine_worker grants) may not be applied yet.</div>`;
    }else{
      hostApps=haq.data||[];
    }
    await loadHubV2();
    /* One organisations lookup for every table that names one. */
    const orgIds=[...new Set([...hostApps.map(a=>a.org_id),...listings.map(l=>l.org_id),
      ...seekReqs.map(r=>r.org_id)].filter(Boolean))];
    if(orgIds.length){
      const oq=await sb.from('organisations').select('id,name,domain').in('id',orgIds);
      (oq.data||[]).forEach(o=>{orgById[o.id]=o;});
    }
  }

  // Which rows already have an intent waiting or failed? (leads.html pattern —
  // failed first, so a re-raised pending intent wins the display.)
  const {data:intents}=await sb.from('engine_intents')
    .select('id,type,payload_json,status,result_note')
    .in('status',['pending','claimed','failed'])
    .in('type',['review-web-request','create-introduction','update-introduction',
                'approve-host','decline-host',
                ...LISTING_INTENTS,...SEEKER_INTENTS,'reroute-introduction']);
  pendingByReq={};pendingByIntro={};pendingByHostApp={};intentById={};
  pendingByListing={};pendingBySeekReq={};
  const byState=(intents||[]).slice().sort((a,b)=>
    (a.status==='failed'?0:1)-(b.status==='failed'?0:1)||a.id-b.id);
  byState.forEach(i=>{
    intentById[i.id]=i;
    const p=i.payload_json||{};
    /* request_id means two different tables depending on the intent, so it
       is read by type and never by name alone. */
    if(p.request_id!=null){
      if(SEEKER_INTENTS.includes(i.type))pendingBySeekReq[p.request_id]=i;
      else pendingByReq[p.request_id]=i;
    }
    if(p.request_a!=null)pendingByReq[p.request_a]=i;
    if(p.introduction_id!=null)pendingByIntro[p.introduction_id]=i;
    if(p.application_id!=null)pendingByHostApp[p.application_id]=i;
    /* add-provider and reroute name a listing too — they are not a decision
       ON that listing, so they never grey out its review buttons. */
    if(p.listing_id!=null&&LISTING_INTENTS.includes(i.type))pendingByListing[p.listing_id]=i;
  });
  render();
}

/* Listings, their revisions and machines, and the seeker request queue.
   Every one is print/mill only; a missing table reads as "0029 not applied
   yet" rather than a blank board with no explanation. */
async function loadHubV2(){
  const lq=await sb.from('listings').select('*').eq('hub',HUB.hub)
    .order('created_at',{ascending:false});
  if(lq.error){
    $('banner').innerHTML+=`<div class="banner">Could not read listings: ${esc(lq.error.message)}.
      If this says the table does not exist or permission is denied, migration 0029
      (hub v2 schema) may not be applied yet.</div>`;
  }else{
    listings=lq.data||[];
    const revIds=[...new Set(listings
      .flatMap(l=>[l.live_revision_id,l.pending_revision_id]).filter(Boolean))];
    if(revIds.length){
      const rq=await sb.from('listing_revisions').select('*').in('id',revIds);
      (rq.data||[]).forEach(r=>{revById[r.id]=r;});
      const mq=await sb.from('listing_machines').select('*').in('revision_id',revIds)
        .order('position',{ascending:true});
      (mq.data||[]).forEach(m=>{(machinesByRev[m.revision_id]=machinesByRev[m.revision_id]||[]).push(m);});
    }
  }
  const sq=await sb.from('seeker_requests').select('*').eq('hub',HUB.hub)
    .order('created_at',{ascending:false});
  if(sq.error){
    $('banner').innerHTML+=`<div class="banner">Could not read seeker requests: ${esc(sq.error.message)}.</div>`;
  }else{
    seekReqs=sq.data||[];
  }
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
  const spot=LISTING_INTENTS.includes(i.type)?'lst-'+p.listing_id
    :SEEKER_INTENTS.includes(i.type)?'sreq-'+p.request_id
    :p.introduction_id!=null?'iact-'+p.introduction_id
    :p.application_id!=null?'happ-'+p.application_id
    :'act-'+(p.request_id!=null?p.request_id:p.request_a);
  raise(i.type,p,spot,'Sent again');
}

/* ── Hub v2 actions ────────────────────────────────────────────────── */

function approveListing(id){raise('approve-listing',{listing_id:id},'lst-'+id,'Approved');}
function declineListing(id){
  const note=prompt('What needs changing before this listing can go live? (sent to the host)');
  if(note===null)return;
  raise('decline-listing',{listing_id:id,note},'lst-'+id,'Sent back');
}
function approveRevision(id){
  raise('approve-listing-revision',{listing_id:id},'lst-'+id,'Revision approved');
}
function declineRevision(id){
  const note=prompt('What needs changing? (sent to the host; the live listing stays as it is)');
  if(note===null)return;
  raise('decline-listing-revision',{listing_id:id,note},'lst-'+id,'Revision declined');
}

function approveRequest(id){
  /* Every pick is ticked by default; untick one and only the rest are sent,
     so the engine's own default (all of them) still covers a retry. */
  const boxes=[...document.querySelectorAll('.pick-'+id)];
  const chosen=boxes.filter(b=>b.checked).map(b=>b.value);
  if(boxes.length&&!chosen.length){alert('Tick at least one provider to approve.');return;}
  const payload={request_id:id};
  if(boxes.length&&chosen.length<boxes.length)payload.listing_ids=chosen;
  raise('approve-intro-request',payload,'sreq-'+id,'Approved');
}
function addProvider(id){
  const sel=$('addp-'+id);
  if(!sel||!sel.value){alert('Choose a provider to add first.');return;}
  raise('add-provider',{request_id:id,listing_id:sel.value},'sreq-'+id,'Provider added');
}
function declineRequest(id){
  const reason=prompt('Why can we not match this request? (kept on the record here — the seeker is told only that we could not match it)');
  if(reason===null)return;
  if(!reason.trim()){alert('The engine keeps a reason on every declined request.');return;}
  raise('decline-intro-request',{request_id:id,reason:reason.trim()},'sreq-'+id,'Declined');
}
function reroute(id){
  const sel=$('rr-'+id);
  if(!sel||!sel.value){alert('Choose a listing to re-route to.');return;}
  raise('reroute-introduction',{introduction_id:id,listing_id:sel.value},'iact-'+id,'Re-routed');
}

/* ── Host applications (spec §4 — gated onboarding, print/mill only) ──── */

function approveHostApp(id){
  const rateStr=prompt('Subscription rate in GBP (e.g. 500 for £500):');
  if(rateStr===null)return;
  const rate=Number(rateStr);
  if(!rate||rate<=0){alert('Enter a positive number for the rate.');return;}
  const period=(prompt("Billing period — type 'annual' or 'monthly':","annual")||'').trim().toLowerCase();
  if(period===''){return;}
  if(period!=='annual'&&period!=='monthly'){alert("Period must be 'annual' or 'monthly'.");return;}
  raise('approve-host',{application_id:id,rate,period},'happ-'+id,'Approved');
}
function declineHostApp(id){
  const note=prompt('Reason for declining (optional — shown to the applicant only if you give one):');
  if(note===null)return;
  raise('decline-host',{application_id:id,note},'happ-'+id,'Declined');
}

/* ── Rendering ─────────────────────────────────────────────────────── */

function setFilter(f){filter=f;render();}

function render(){
  const awaiting=requests.filter(r=>r.status==='new'||r.status==='reviewing').length;
  if(HOSTS_HUB()&&$('listingRows')){
    /* On print/mill the page is about listings and seeker requests now; the
       web_requests columns below are the legacy inbox and say so. */
    const toReview=listings.filter(l=>l.status==='pending'||l.pending_revision_id).length;
    const open=seekReqs.filter(r=>r.status==='open'||r.status==='picked').length;
    $('count').textContent=[
      toReview?`${toReview} listing${toReview===1?'':'s'} to review`:'',
      open?`${open} open seeker request${open===1?'':'s'}`:'',
      requests.length?`${requests.length} legacy request${requests.length===1?'':'s'}`:'',
    ].filter(Boolean).join(' · ');
  }else{
    $('count').textContent=requests.length
      ?`${requests.length} request${requests.length===1?'':'s'}${awaiting?` · ${awaiting} awaiting review`:''}`
      :'';
  }
  $('filters').innerHTML=FILTERS.map(x=>
    `<button class="fchip" aria-pressed="${filter===x.f}" onclick="setFilter('${x.f}')">${x.label}</button>`).join('');

  $('leftTitle').textContent=HUB.left.title;
  $('rightTitle').textContent=HUB.right.title;
  renderCol('left');
  renderCol('right');
  renderRegister();
  if(HOSTS_HUB()&&$('hostAppRows'))renderHostApps();
  if(HOSTS_HUB()&&$('listingRows'))renderListings();
  if(HOSTS_HUB()&&$('seekerCol'))renderSeekerQueue();
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
    }else if(STAGES.includes(i.stage)){
      manage=`<select aria-label="Set stage for ${esc(introRef(i))}" onchange="setStage(${i.id},this.value)">
          ${STAGES.map(s=>`<option value="${s}" ${s===i.stage?'selected':''}>${STAGE_LABEL[s]}</option>`).join('')}
        </select>
        <button class="btn btn-gh btn-sm" onclick="recordCommission(${i.id})">Record commission</button>`;
    }else{
      /* In the acceptance flow: the provider, the worker and the engine move
         these, not a dropdown. A spent one may be re-routed to another host. */
      manage=`<span style="color:var(--fg-2);font-size:12.5px">With the provider</span>`;
      if(SPENT_STAGES.includes(i.stage))manage=rerouteControl(i)
        ||`<span style="color:var(--fg-2);font-size:12.5px">No other listing to re-route to</span>`;
    }
    const when=i.stage==='declined'&&i.declined_at?String(i.declined_at).slice(0,10)
      :i.stage==='expired'&&i.acceptance_expires_at?String(i.acceptance_expires_at).slice(0,10):'';
    return `<tr>
      <td class="rref">${esc(introRef(i))}</td>
      <td>${esc(partyA(i))}</td>
      <td>${esc(partyB(i))}</td>
      <td><span class="stg stg-${esc(i.stage)}">${esc(STAGE_LABEL[i.stage]||i.stage)}</span>${
        when?`<br><span class="when">${esc(when)}</span>`:''}</td>
      <td class="money">${fmtCommission(i)}</td>
      <td><div id="iact-${i.id}" class="actions" style="margin-top:0">${manage}</div></td>
    </tr>`;
  }).join('');
}

/* Party names. A legacy introduction pairs two web_requests; a hub v2 one
   names a listing and a seeker request instead. Admins see both sides here
   — the identity rule is about what a MEMBER sees before acceptance. */
const listingById=id=>listings.find(l=>String(l.id)===String(id))||null;
const seekReqById=id=>seekReqs.find(r=>r.id===id)||null;
function listingOrgName(id){
  const l=listingById(id);
  if(!l)return '—';
  return (orgById[l.org_id]||{}).name||'(host)';
}
function seekerOrgName(id){
  const r=seekReqById(id);
  if(!r)return '—';
  return `${(orgById[r.org_id]||{}).name||'(seeker)'} · ${seekRef(r)}`;
}
const partyA=i=>i.request_a!=null?companyOf(i.request_a):listingOrgName(i.listing_id);
const partyB=i=>i.request_b!=null?companyOf(i.request_b):seekerOrgName(i.seeker_request_id);

function rerouteControl(i){
  if(i.seeker_request_id==null)return '';
  const req=seekReqById(i.seeker_request_id);
  const taken=new Set(intros.filter(x=>x.seeker_request_id===i.seeker_request_id)
    .map(x=>String(x.listing_id)));
  const options=listings.filter(l=>l.status==='live'&&!taken.has(String(l.id))
    &&shipsTo(l,req&&req.region));
  if(!options.length)return '';
  return `<select id="rr-${i.id}" aria-label="Re-route ${esc(introRef(i))}">
      <option value="">Re-route to…</option>
      ${options.map(l=>`<option value="${esc(l.id)}">${esc(listingLabel(l))}</option>`).join('')}
    </select>
    <button class="btn btn-gh btn-sm" onclick="reroute(${i.id})">Re-route</button>`;
}

function hostAppProfile(a){
  const lines=Object.entries(a.profile||{})
    .filter(([k,v])=>v!=null&&String(v).trim()!=='')
    .map(([k,v])=>`<strong>${esc(k.replace(/_/g,' '))}:</strong> ${esc(Array.isArray(v)?v.join(', '):v)}`);
  if(!lines.length)return '<span style="color:var(--fg-2)">—</span>';
  return `<details class="pl"><summary><span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>Profile</summary><p>${lines.join('<br>')}</p></details>`;
}

function renderHostApps(){
  if(!hostApps.length){
    $('hostAppRows').innerHTML=`<tr><td colspan="5" style="color:var(--fg-2)">No ${esc(HUB.hub)} hub applications yet.</td></tr>`;
    return;
  }
  $('hostAppRows').innerHTML=hostApps.map(a=>{
    const org=orgById[a.org_id]||{};
    const q=pendingByHostApp[a.id];
    let manage;
    if(a.status!=='pending'){
      manage=`<span class="stg stg-${a.status==='approved'?'approved':'declined'}">${esc(a.status.toUpperCase())}</span>`
        +(a.decided_by?` <span style="color:var(--fg-2);font-size:12px">by ${esc(a.decided_by)}</span>`:'');
    }else if(q&&q.status==='failed'){
      manage=`<span class="status fail">Failed: ${esc(q.result_note||'')}</span>
        <button class="btn btn-gh btn-sm" onclick="retry(${q.id})">Try again</button>`;
    }else if(q){
      manage=`<span class="status">Queued — the engine acts within a minute or two.</span>`;
    }else{
      manage=`<button class="btn btn-grn btn-sm" onclick="approveHostApp(${a.id})">
          <span class="material-symbols-outlined" aria-hidden="true">check</span>Approve</button>
        <button class="btn btn-danger btn-sm" onclick="declineHostApp(${a.id})">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>Decline</button>`;
    }
    return `<tr>
      <td><strong>${esc(org.name||a.org_id||'(unknown)')}</strong>${org.domain?`<br><span style="color:var(--fg-2);font-size:12px">${esc(org.domain)}</span>`:''}</td>
      <td>${a.submitted_at?esc(String(a.submitted_at).slice(0,10)):'—'}</td>
      <td><span class="stg stg-${a.status==='pending'?'new':a.status==='approved'?'approved':'declined'}">${esc((a.status||'').toUpperCase())}</span></td>
      <td>${hostAppProfile(a)}</td>
      <td><div id="happ-${a.id}" class="actions" style="margin-top:0">${manage}</div></td>
    </tr>`;
  }).join('');
}

/* ── Listings (hub v2) ─────────────────────────────────────────────── */

const REV_FIELDS=[['address_line','Address'],['town','Town'],['postcode','Postcode'],
  ['country','Country'],['ships_to','Ships to'],['services','Services'],
  ['quality_notes','Quality notes'],['monthly_capacity','Monthly capacity'],
  ['attributes','Attributes']];

const fmtVal=v=>{
  if(v==null||v==='')return '—';
  if(Array.isArray(v))return v.length?v.join(', '):'—';
  if(typeof v==='object')return Object.entries(v).map(([k,x])=>`${k}: ${x}`).join(', ')||'—';
  return String(v);
};
/* Arrays compare as sets: a host reordering "ships to" is not a change. */
const sameSet=(a,b)=>JSON.stringify((a||[]).map(String).sort())===JSON.stringify((b||[]).map(String).sort());
const sameVal=(a,b)=>Array.isArray(a)||Array.isArray(b)?sameSet(a,b)
  :JSON.stringify(a==null?null:a)===JSON.stringify(b==null?null:b);

function machineList(rev){
  return ((rev&&machinesByRev[rev.id])||[]).map(m=>[
    m.name,m.count>1?`x${m.count}`:'',
    (m.materials||[]).length?`(${m.materials.join(', ')})`:'',
    m.lead_time_days!=null?`${m.lead_time_days}d`:'',
  ].filter(Boolean).join(' '));
}

function revisionDiff(oldRev,newRev){
  const rows=[];
  REV_FIELDS.forEach(([f,label])=>{
    if(!sameVal((oldRev||{})[f],(newRev||{})[f]))
      rows.push([label,fmtVal((oldRev||{})[f]),fmtVal((newRev||{})[f])]);
  });
  const om=machineList(oldRev),nm=machineList(newRev);
  if(om.join(' | ')!==nm.join(' | '))
    rows.push(['Machines',om.length?om.join('; '):'—',nm.length?nm.join('; '):'—']);
  return rows;
}

function diffTable(rows){
  return `<table class="diff"><thead><tr><th>Field</th><th>Now</th><th>Requested</th></tr></thead>
    <tbody>${rows.map(([f,a,b])=>`<tr><td>${esc(f)}</td><td class="was">${esc(a)}</td>
      <td class="now">${esc(b)}</td></tr>`).join('')}</tbody></table>`;
}

function submittedTable(rev){
  const rows=REV_FIELDS.map(([f,label])=>[label,fmtVal((rev||{})[f])]);
  const machines=machineList(rev);
  rows.push(['Machines',machines.length?machines.join('; '):'—']);
  return `<table class="diff"><tbody>${rows.map(([f,v])=>
    `<tr><td>${esc(f)}</td><td class="now" colspan="2">${esc(v)}</td></tr>`).join('')}</tbody></table>`;
}

const listingLabel=l=>{
  const rev=revById[l.live_revision_id]||{};
  const where=[rev.town,rev.country].filter(Boolean).join(', ');
  return `${(orgById[l.org_id]||{}).name||'(host)'}${where?' · '+where:''}`;
};

function renderListings(){
  if(!listings.length){
    $('listingRows').innerHTML=`<tr><td colspan="7" style="color:var(--fg-2)">No ${esc(HUB.hub)}
      listings yet — a host's site appears here the moment they submit one.</td></tr>`;
    return;
  }
  $('listingRows').innerHTML=listings.map(listingRow).join('');
}

function listingRow(l){
  const live=revById[l.live_revision_id],pending=revById[l.pending_revision_id];
  const shown=pending||live||{};
  const q=pendingByListing[l.id];
  let manage;
  if(q&&q.status==='failed'){
    manage=`<span class="status fail">Failed: ${esc(q.result_note||'')}</span>
      <button class="btn btn-gh btn-sm" onclick="retry(${q.id})">Try again</button>`;
  }else if(q){
    manage=`<span class="status">Queued — the engine acts within a minute or two.</span>`;
  }else if(l.status!=='live'&&pending){
    /* Covers a first listing (pending) AND a resubmission after
       decline-listing (status stays declined; the new pending_revision_id
       is the only sign there is something to review again) — without this
       a declined listing's resubmission is unreviewable forever. */
    manage=`<button class="btn btn-grn btn-sm" onclick="approveListing('${esc(l.id)}')">
        <span class="material-symbols-outlined" aria-hidden="true">check</span>Approve</button>
      <button class="btn btn-danger btn-sm" onclick="declineListing('${esc(l.id)}')">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>Decline</button>`;
  }else if(l.status==='live'&&pending){
    manage=`<button class="btn btn-grn btn-sm" onclick="approveRevision('${esc(l.id)}')">
        <span class="material-symbols-outlined" aria-hidden="true">check</span>Approve revision</button>
      <button class="btn btn-danger btn-sm" onclick="declineRevision('${esc(l.id)}')">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>Decline revision</button>`;
  }else{
    manage=`<span style="color:var(--fg-2);font-size:12.5px">Nothing to review</span>`;
  }

  /* A first listing has nothing to diff against, so the reviewer gets what
     the host actually submitted; an edit to a live one gets old -> new. */
  const changes=pending&&live?revisionDiff(live,pending):[];
  const detail=pending?`<tr class="detail"><td colspan="7">
      <details ${l.status==='live'?'open':''}>
        <summary><span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>${
          live?'Requested changes':'Submitted details'}</summary>
        ${live?(changes.length?diffTable(changes)
          :'<p class="empty">This revision changes nothing on the live listing.</p>')
          :submittedTable(pending)}
      </details></td></tr>`:'';

  return `<tr>
    <td><strong>${esc((orgById[l.org_id]||{}).name||l.org_id||'(unknown)')}</strong></td>
    <td>${esc(l.hub)}</td>
    <td><span class="stg stg-${esc(l.status)}">${esc(LISTING_BADGE[l.status]||l.status)}</span>${
      pending&&l.status==='live'?'<br><span class="when">revision pending</span>':''}</td>
    <td>${esc([shown.town,shown.country].filter(Boolean).join(', ')||'—')}</td>
    <td>${esc(fmtVal(shown.ships_to))}</td>
    <td>${esc(shown.submitted_at?String(shown.submitted_at).slice(0,10):'—')}</td>
    <td><div id="lst-${esc(l.id)}" class="actions" style="margin-top:0">${manage}</div></td>
  </tr>${detail}`;
}

/* ── Seeker request queue (hub v2) ─────────────────────────────────── */

const NEED_FIELDS=[['material','Material'],['process','Process'],['quantity','Quantity'],
  ['cadence','Cadence'],['max_lead_time_days','Max lead time (days)'],
  ['needed_by','Needed by'],['services','Services'],['notes','Notes']];

/* Can this listing serve that request's region? `ships_to` holds REGION
   terms (vocab_terms kind='region': uk, ireland, europe, … worldwide) and
   seeker_requests.region is drawn from the same vocabulary, so the two
   compare directly — the request's COUNTRY never could. `worldwide`
   serves every region; an empty ships_to serves none (a host who named no
   region has not offered one); and a request with no region at all shows
   every live listing, for the desk to judge. */
function shipsTo(l,region){
  if(!region)return true;
  const to=(revById[l.live_revision_id]||{}).ships_to||[];
  const want=String(region).toLowerCase();
  return to.map(x=>String(x).toLowerCase()).some(r=>r==='worldwide'||r===want);
}

/* A host that named no region at all has not refused one: `ships_to`
   empty is a gap in the listing, not a "serves nowhere". The engine
   agrees — add-provider's _live_listing reports ships_to_unset and
   never filters on it — so the picker offers these listings with the
   gap named beside them and lets the desk judge. shipsTo() above is
   deliberately untouched: for a listing that DID name regions, an
   unlisted one is still not served. */
function shipsToUnset(l){
  const to=(revById[l.live_revision_id]||{}).ships_to;
  return !to||!to.length;
}

function cardSummary(intro){
  const l=listingById(intro.listing_id);
  const rev=revById[intro.listing_revision_id]||(l?revById[l.live_revision_id]:null)||{};
  return [
    l?((orgById[l.org_id]||{}).name||'(host)'):'(listing withdrawn)',
    [rev.town,rev.country].filter(Boolean).join(', '),
    (rev.services||[]).join(', '),
    rev.monthly_capacity!=null?`${rev.monthly_capacity} a month`:'',
  ].filter(Boolean).join(' · ');
}

function renderSeekerQueue(){
  const open=seekReqs.filter(r=>r.status!=='closed');
  $('seekerN').textContent=seekReqs.length;
  $('seekerCol').innerHTML=open.length
    ?open.map(seekerCard).join('')
    :`<div class="empty">${seekReqs.length?'Every seeker request here is closed.'
      :'Nothing here yet — a seeker who searches and picks providers lands in this queue.'}</div>`;
}

function seekerCard(r){
  const q=pendingBySeekReq[r.id];
  const mine=intros.filter(i=>i.seeker_request_id===r.id);
  const picks=mine.filter(i=>i.stage==='proposed');
  const running=mine.filter(i=>i.stage!=='proposed');
  const need=NEED_FIELDS
    .filter(([f])=>r[f]!=null&&String(r[f]).trim()!==''&&!(Array.isArray(r[f])&&!r[f].length))
    .map(([f,label])=>`<strong>${esc(label)}:</strong> ${esc(fmtVal(r[f]))}`).join('<br>');
  const where=[r.town,r.country].filter(Boolean).join(', ');

  const pickList=picks.length
    ?`<div class="picks">${picks.map(i=>`<label>
        <input type="checkbox" class="pick-${r.id}" value="${esc(i.listing_id)}" checked>
        <span>${esc(cardSummary(i))}</span></label>`).join('')}</div>`
    :'';
  const runningList=running.length
    ?`<div class="meta">${running.map(i=>`<span><span class="stg stg-${esc(i.stage)}">${
        esc(STAGE_LABEL[i.stage]||i.stage)}</span> ${esc(introRef(i))} · ${esc(cardSummary(i))}</span>`).join('')}</div>`
    :'';

  const taken=new Set(mine.map(i=>String(i.listing_id)));
  const spare=listings.filter(l=>l.status==='live'&&!taken.has(String(l.id))
    &&(shipsTo(l,r.region)||shipsToUnset(l)));
  const adder=spare.length
    ?`<select id="addp-${r.id}" aria-label="Add a provider to ${esc(seekRef(r))}">
        <option value="">Add a provider…</option>
        ${spare.map(l=>`<option value="${esc(l.id)}">${esc(listingLabel(l))}${
          shipsToUnset(l)?' · ships-to unset':''}</option>`).join('')}
      </select>
      <button class="btn btn-gh btn-sm" onclick="addProvider(${r.id})">Add</button>`
    :'';

  let actions;
  if(q&&q.status==='failed'){
    actions=`<div class="actions"><span class="status fail">Engine could not action this: ${esc(q.result_note||'')}</span>
      <button class="btn btn-gh btn-sm" onclick="retry(${q.id})">
        <span class="material-symbols-outlined" aria-hidden="true">refresh</span>Try again</button></div>`;
  }else if(q){
    actions=`<div class="actions"><span class="status">Queued — the engine acts within a minute or two.</span></div>`;
  }else if(r.status==='open'||r.status==='picked'||r.status==='desk'){
    /* add-provider needs a picked request server-side — showing it on an
       open one would offer a control that always fails. */
    actions=`<div class="actions">
      ${picks.length?`<button class="btn btn-grn btn-sm" onclick="approveRequest(${r.id})">
        <span class="material-symbols-outlined" aria-hidden="true">check</span>Approve picks</button>`:''}
      ${['picked','desk'].includes(r.status)?adder:''}
      <button class="btn btn-danger btn-sm" onclick="declineRequest(${r.id})">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>Decline</button></div>`;
  }else{
    actions=`<div class="actions"><span style="color:var(--fg-2);font-size:12.5px">
      ${esc(r.decision_note?'Declined: '+r.decision_note:'Closed')}</span></div>`;
  }

  return `<div class="row req s-${esc(r.status==='open'?'new':r.status)}">
    <div class="row-top">
      <span class="ref">${esc(seekRef(r))}</span>
      <span class="company">${esc((orgById[r.org_id]||{}).name||'(no organisation)')}</span>
      <span class="stg stg-${esc(r.status)}">${esc(SREQ_BADGE[r.status]||r.status)}</span>
    </div>
    <div class="meta">${[where?`<span>${esc(where)}</span>`:'',
      r.created_at?`<span>received ${esc(String(r.created_at).slice(0,10))}</span>`:'',
      r.no_match?'<span>no automatic match</span>':''].filter(Boolean).join('')}</div>
    ${need?`<div class="why" style="margin-top:8px">${need}</div>`:''}
    ${pickList}
    ${runningList}
    <div id="sreq-${r.id}">${actions}</div>
  </div>`;
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
