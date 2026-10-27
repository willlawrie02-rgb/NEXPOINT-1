/* NexPoint Admin — shared hub-board module (Print / Mill / Opportunities).

   Page contract:
   window.HUB = {
     hub: 'print', title: '3D Print Hub',
     left:  { side: 'offer_capacity',   title: 'Hosts — offering capacity',     approveLabel: 'Approve as host' },
     right: { side: 'request_capacity', title: 'Seekers — requesting capacity', approveLabel: 'Approve request' },
   }
   plus the board skeleton: #banner, #count, #filters, #leftTitle/#leftN/#leftCol,
   #rightTitle/#rightN/#rightCol, #overlay/#modalBody. Print/Mill are the
   two-column board (plan 044, Will's ruling of 6 Oct): #leftCol reviews
   listings as cards and #rightCol renders Find-capacity seeker requests
   beside the older enquiries. The Listings table, the Seeker requests
   section, the Host applications table and the Introductions register left
   the two pages; approve-listing makes the host and starts billing.
   Opportunities has #introRows and no listings, so every code path below
   checks for the element before touching the DOM, and the hub v2 fetches
   are gated on HUB.hub being 'print' or 'mill'. #legend is the badge key
   renderLegend fills where a page has one.

   Every action inserts an engine_intents row; the UI marks the card
   "Queued for the engine" until the executed intent's result lands.

   Plan 072 moved the queue half to the Inbox (app/jobs.js, decided in place
   there and on each company page): approving and declining listings and
   listing changes, the requests nobody matched or sent back to the desk,
   and a spent offer the inbox view lists (on a picked request, with
   nothing after it). Each left a one-line pointer here. What the view does
   not list keeps its control here: Resend on any other spent or awaiting
   offer, and Add a provider and Decline on a picked request. The live host
   cards, Offer to a seeker and the desk requests stay until their sections
   ship (075, 076). Plan 073 took the introductions' stage menu and Record
   commission off: an introduction moves on the Pipelines page's
   Introductions board, within its rules, and each one here shows where it
   stands there with a link to it.
   The browser never changes an external system itself. On Print and Mill
   a recorded introduction, a re-route and a resend each emails the site its offer
   through the engine (plan 067); only an Opportunities pairing is still
   emailed by Will or Chris by hand, then logged here. */

const SUPABASE_URL='https://synywukadvjpjjxjylwk.supabase.co';
const SUPABASE_KEY='sb_publishable_a2-WFA1i5tqkoHy52_aGzQ_6Yx3xtNo';
const ADMIN_EMAILS=['willlawrie@nexpoint.co.uk','chris@nexpoint.co.uk'];  // a hint for which screen to show; the database decides (is_brief_admin, a second factor since plan 035)
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const $=id=>document.getElementById(id);
const isAdmin=email=>ADMIN_EMAILS.includes((email||'').toLowerCase());
let me=null,requests=[],intros=[],pendingByReq={},pendingByIntro={},intentById={},filter='all';
let orgById={};
/* Plan 052, item 10: vocab_terms as {kind:{term:label}}, filled by load(). */
let vocabMap={};
/* Hub v2: the listing review queue and the seeker request queue. */
let listings=[],revById={},machinesByRev={},seekReqs=[];
let pendingBySeekReq={};
const HOSTS_HUB=()=>HUB.hub==='print'||HUB.hub==='mill';

/* The one rule every intent map uses: the NEWEST intent for a key decides
   what its row shows. Ascending id, last write wins; the read is
   newest-first and capped (load()), so the sort here restores the order
   the reduction needs. `done` rows are read too, so a success that
   followed a failure clears it, and a key whose newest intent is done is
   dropped: render code never sees a finished intent, and the row's own
   status decides its buttons. `keyOf(intent, payload)` returns a key, an
   array of keys, or null to skip. leads.html, organisations.html,
   orders.html, tasks.html and linkedin.html do not load this module and
   carry the same reduction inline. */
function newestIntent(intents,keyOf){
  const out={};
  (intents||[]).slice().sort((a,b)=>a.id-b.id).forEach(i=>{
    const keys=keyOf(i,i.payload_json||{});
    (Array.isArray(keys)?keys:[keys]).forEach(k=>{
      if(k==null)return;
      if(i.status==='done')delete out[k];else out[k]=i;
    });
  });
  return out;
}

const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* A failed intent is information, not a lock. It renders ABOVE the buttons
   the row's own status earns (a full-width line inside the .actions flex
   row), so a stale failure never hides Approve, Decline or Make
   introduction. `offerRetry` false withholds Try again where the row has
   settled since (a decided application, a closed seeker request, a
   listing with nothing pending): re-raising that payload could only fail
   again. A pending or claimed intent still replaces the buttons (QUEUED_LINE):
   the same decision twice would be two intents, and the engine would run
   both. */
function failedAbove(q,label,offerRetry=true){
  if(!q||q.status!=='failed')return '';
  return `<span class="fail-line" style="flex-basis:100%;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    <span class="status fail">${esc(label)}: ${esc(q.result_note||'')}</span>${offerRetry
      ?`<button class="btn btn-gh btn-sm" onclick="retry(${q.id})"><span class="material-symbols-outlined" aria-hidden="true">refresh</span>Try again</button>`
      :''}</span>`;
}
const QUEUED_LINE='<span class="status">Queued — the engine acts within a minute or two.</span>';

async function boot(){
  const {data}=await sb.auth.getSession();
  const s=data&&data.session;
  if(s&&isAdmin(s.user.email)){if(await NXAdminAuth.requireAal2(sb))showAdmin(s.user);else showLogin(s);}else showLogin(s);
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
  if(!(await NXAdminAuth.requireAal2(sb)))return;
  showAdmin(data.user);
}
async function signOut(){await sb.auth.signOut();location.reload();}

function showAdmin(user){
  me=user;$('login').style.display='none';$('admin').style.display='block';
  $('who').textContent=user.email;
  load();
}

/* ── Board vocabulary ──────────────────────────────────────────────── */

/* The stages the desk used to set from a dropdown here (plan 073 moved that to
   the Introductions board): such a row shows where it stands on the board and
   a link to it. proposed / awaiting_acceptance / expired / declined belong to
   the acceptance flow, which the worker and the engine move. */
const BOARD_STAGES=['approved','introduced','in_discussion','deal_done','dead','invoiced','paid'];
/* Where each of those sits on the Introductions board (the engine's
   pipelines.intro_board_stage; a declared order is read there, not here). */
const BOARD_STAGE_NAME={approved:'Offered',introduced:'Introduced',in_discussion:'Introduced',deal_done:'Trading',
  invoiced:'Trading',paid:'Trading',dead:'Closed'};
const STAGE_LABEL={proposed:'PROPOSED',awaiting_acceptance:'AWAITING ACCEPTANCE',
  approved:'APPROVED',introduced:'INTRODUCED',in_discussion:'IN DISCUSSION',
  deal_done:'DEAL DONE',dead:'DEAD',invoiced:'INVOICED',paid:'PAID',
  expired:'EXPIRED',declined:'DECLINED'};
/* A provider said no, or never answered: the desk may re-route round it. */
const SPENT_STAGES=['declined','expired'];
/* The ask is still open, lapsed unanswered, or declined: the same site may
   be asked again with a fresh window (plan 067; screen 2 of the acceptance
   says "we may offer it to you again"). */
const REISSUABLE_STAGES=['awaiting_acceptance','expired','declined'];
/* Both carry `request_id`, and it means a seeker_requests row, NOT the
   web_requests id review-web-request's own request_id means. Offer to a
   seeker raises add-provider from a live host card, and a picked request's
   card keeps Add a provider and Decline; an open or desk request is decided
   in the Inbox (plan 072). */
const SEEKER_INTENTS=['add-provider','decline-intro-request'];
const LISTING_BADGE={pending:'PENDING',live:'LIVE',declined:'DECLINED',hidden:'HIDDEN'};
const SREQ_BADGE={open:'OPEN',picked:'PICKED',desk:'DESK RE-ROUTE',declined:'DECLINED',closed:'CLOSED'};
/* A seeker request is known by its own PS-/MS- code (the hub's initial, S,
   its id padded to four) everywhere: the worker, the engine, the inbox view
   and this board (plan 067: the web_requests mirror is no longer filed).
   REQ- is retired (plan 052 item 4). */
function seekRef(r){
  return `${String(r.hub||HUB.hub)[0].toUpperCase()}S-${String(r.id).padStart(4,'0')}`;
}
const introRef=i=>i.ref||('INTRO-'+String(i.id).padStart(4,'0'));
const SIDE_PREFIX={offer_capacity:'H',request_capacity:'S',list_opportunity:'L',request_intro:'I'};
const reqRef=r=>`${HUB.hub[0].toUpperCase()}${SIDE_PREFIX[r.side]||'R'}-${String(r.id).padStart(4,'0')}`;
/* A column carries one side or several — the print/mill seeker column takes
   request_capacity AND request_intro (asking to meet a listed node IS seeking). */
const sidesOf=col=>Array.isArray(col.side)?col.side:[col.side];
/* Plan 076 (D1): a desk request is request_intro on print or mill (every
   Talk to the desk) or on opportunities with no reference (the homepage's
   intro call). It is a conversation on the Desk, answered there, so no
   column shows it and nothing here approves or declines it (D10). */
function isDeskRequest(r){
  if(!r||r.side!=='request_intro')return false;
  if(r.hub==='print'||r.hub==='mill')return true;
  return r.hub==='opportunities'&&!String(r.brief_ref||'').trim();
}
const FILTERS=[
  {f:'all',label:'All'},{f:'new',label:'New'},{f:'reviewing',label:'Reviewing'},
  {f:'approved',label:'Approved'},{f:'declined',label:'Declined'},
];
const REQ_BADGE={new:'NEW',reviewing:'REVIEWING',approved:'APPROVED',declined:'DECLINED'};

/* One plain-English line per badge value, keyed by vocabulary because the
   same word (declined, approved, pending) means something different on each
   queue. Every badge carries its line as a title, and renderLegend() prints
   the key for the queues a page has. */
const STATUS_HELP={
  stage:{
    proposed:'A pick made before plan 067; nothing new arrives here. Nobody was asked: add a provider to the request or decline it',
    awaiting_acceptance:'The provider has been asked and has not yet accepted or declined',
    approved:'Both sides approved; the introduction email has not gone yet',
    introduced:'The parties have been put together',
    in_discussion:'The parties are talking',
    deal_done:'Business agreed; commission to record',
    dead:'Went nowhere. Kept in the database and the archive, off the working board',
    invoiced:'Commission invoiced, payment outstanding',
    paid:'Commission paid; closed',
    expired:'The provider never answered in time. Resend it or re-route the seeker from the Inbox',
    declined:'The provider said no. Resend it (we may offer it to them again) or re-route the seeker from the Inbox',
  },
  listing:{
    pending:'A first submission waiting on your review',
    live:'Visible to seekers on the hub',
    declined:'Sent back with a reason; a resubmission shows up here as a pending revision',
    hidden:'Taken off the hub',
  },
  /* Plan 068: an edit to a live listing, and the period the host chose. */
  change:{
    change:'An edit to the live listing waiting on your review; the live listing stays as it is until you approve it',
    annual:'Chosen by the host on the listing form',
    monthly:'Chosen by the host on the listing form',
  },
  seeker:{
    open:'The seeker has searched but not yet picked; nothing for the desk yet',
    picked:'The seeker picked a site and the offer went to it. Nothing for the desk unless the site declines or the offer expires',
    desk:'The seeker told the desk the shortlist did not fit. It is decided in the Inbox',
    declined:'The desk declined the request and the seeker was told',
    closed:'Nothing left to do on this request',
  },
  request:{
    new:'Arrived from the website; nobody has looked yet',
    reviewing:'Marked as being looked at',
    approved:'Approved; pair it into an introduction from the card',
    declined:'Declined, with the reason on the card',
  },
};
/* A status badge: the vocabulary's label, its plain line as the title, and
   the .stg-* colour class (cls when a vocabulary borrows another's colours). */
function stg(kind,value,label,cls){
  const help=(STATUS_HELP[kind]||{})[value]||'';
  return `<span class="stg stg-${esc(cls||value)}"${help?` title="${esc(help)}"`:''}>${esc(label)}</span>`;
}

/* ── Data ──────────────────────────────────────────────────────────── */

async function load(){
  $('banner').innerHTML='';
  const rq=await sb.from('web_requests').select('*').eq('hub',HUB.hub)
    .neq('status','archived').order('created_at',{ascending:false});
  if(rq.error){
    $('banner').innerHTML=`<div class="banner">Could not read requests: ${esc(rq.error.message)}.
      If this says the table does not exist or permission is denied, migration 0016 has not been run yet.</div>`;
    $('leftCol').innerHTML='';$('rightCol').innerHTML='';
    /* On print/mill the host cards read through web_requests, but the seeker
       requests and the listings do not, so a web_requests failure shows its
       banner and the rest of the page still loads. */
    if(!HOSTS_HUB())return;
  }
  requests=rq.data||[];
  const iq=await sb.from('introductions').select('*').eq('hub',HUB.hub)
    .order('updated_at',{ascending:false});
  if(iq.error){
    $('banner').innerHTML=`<div class="banner">Could not read introductions: ${esc(iq.error.message)}.</div>`;
  }
  intros=iq.data||[];

  /* One read of the vocabulary so every card reads in words. A failed read
     leaves the map empty and lab() humanises the term instead. */
  vocabMap={};
  const vq=await sb.from('vocab_terms').select('kind,term,label');
  (vq.data||[]).forEach(v=>{(vocabMap[v.kind]=vocabMap[v.kind]||{})[v.term]=v.label;});

  orgById={};listings=[];revById={};machinesByRev={};seekReqs=[];
  if(HOSTS_HUB()){
    await loadHubV2();
    /* One organisations lookup for every table that names one. A web_requests
       row has no organisation column; a host card reads the organisation
       through its listing. */
    const orgIds=[...new Set([...listings.map(l=>l.org_id),
      ...seekReqs.map(r=>r.org_id)].filter(Boolean))];
    if(orgIds.length){
      const oq=await sb.from('organisations').select('id,name,domain,hidden_at,removed_at,paused_reason,removed_reason,sub_status,sub_period').in('id',orgIds);
      (oq.data||[]).forEach(o=>{orgById[o.id]=o;});
    }
  }

  // Which rows have an intent waiting, failed, or lately done? newestIntent()
  // decides which intent a row shows when it has more than one. Newest
  // first and capped: past PostgREST's default cap an unordered read drops
  // the NEWEST rows, which are the ones a board is about.
  const {data:intents}=await sb.from('engine_intents')
    .select('id,type,payload_json,status,result_note')
    .in('status',['pending','claimed','failed','done'])
    .in('type',['review-web-request','create-introduction','update-introduction',
                ...SEEKER_INTENTS,'reissue-acceptance'])
    .order('id',{ascending:false}).limit(1000);
  intentById={};(intents||[]).forEach(i=>{intentById[i.id]=i;});
  if((intents||[]).length===1000)
    $('banner').innerHTML+=`<div class="banner">Showing the newest 1,000 intent rows; older rows are not on this page.</div>`;
  /* request_id means two different tables depending on the intent, so it
     is read by type and never by name alone. create-introduction names
     both requests, so BOTH cards read queued or failed, and the partner
     card stops offering Make introduction while one is in flight. */
  pendingBySeekReq=newestIntent(intents,(i,p)=>
    SEEKER_INTENTS.includes(i.type)?p.request_id:null);
  pendingByReq=newestIntent(intents,(i,p)=>
    [SEEKER_INTENTS.includes(i.type)?null:p.request_id,p.request_a,p.request_b]);
  pendingByIntro=newestIntent(intents,(i,p)=>p.introduction_id);
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
function reissueAcceptance(id){
  /* reissue-acceptance (plan 067): stage back to awaiting_acceptance, the
     provider_notified_at stamp cleared and the offer emailed again with a
     fresh 14-day window; a declined row may be re-asked. Nothing else
     changes (handlers._reissue_acceptance). Plan 072: offered here only
     where the inbox view has no card for it. */
  const i=intros.find(x=>x.id===id)||{id};
  if(!confirm(`Send the offer for ${introRef(i)} to the same site again? It gets the email again and a fresh 14-day window; nothing else on the introduction changes.`))return;
  raise('reissue-acceptance',{introduction_id:id},'iact-'+id,'Offer sent again');
}
function retry(intentId){
  const i=intentById[intentId];
  if(!i)return;
  const p=i.payload_json||{};
  const spot=SEEKER_INTENTS.includes(i.type)?'sreq-'+p.request_id
    :p.introduction_id!=null?'iact-'+p.introduction_id
    :'act-'+(p.request_id!=null?p.request_id:p.request_a);
  raise(i.type,p,spot,'Sent again');
}

/* ── Hub v2 actions ────────────────────────────────────────────────── */

function addProvider(id){
  const sel=$('addp-'+id);
  if(!sel||!sel.value){alert('Choose a provider to add first.');return;}
  raise('add-provider',{request_id:id,listing_id:sel.value},'sreq-'+id,'Provider added');
}
function declineRequest(id){
  const reason=prompt('Why can we not match this request? (kept on the record here; the seeker is told only that we could not match it)');
  if(reason===null)return;
  if(!reason.trim()){alert('The engine keeps a reason on every declined request.');return;}
  raise('decline-intro-request',{request_id:id,reason:reason.trim()},'sreq-'+id,'Declined');
}
function offerToSeeker(listingId){
  /* "Offer to a seeker" on a live host card (Will, 6 Oct): the existing
     add-provider path, so the host is emailed the offer with its accept
     and decline links and contact details are released only on
     acceptance. Nothing is sent by hand. */
  const sel=$('offer-'+listingId);
  if(!sel||!sel.value){alert('Choose a seeker request to offer this host to.');return;}
  raise('add-provider',{request_id:Number(sel.value),listing_id:listingId},'lst-'+listingId,'Offered');
}
/* ── Rendering ─────────────────────────────────────────────────────── */

function setFilter(f){filter=f;render();}

function render(){
  const awaiting=requests.filter(r=>r.status==='new'||r.status==='reviewing').length;
  if(HOSTS_HUB()){
    /* On print/mill the count reads the two columns: listings to review on
       the left, open seeker requests and other enquiries on the right. */
    const toReview=listings.filter(l=>l.status==='pending'||l.pending_revision_id).length;
    const open=seekReqs.filter(r=>r.status==='open'||r.status==='picked'||r.status==='desk').length;
    const other=requests.filter(r=>sidesOf(HUB.right).includes(r.side)&&!isSeekerMirror(r)&&!isDeskRequest(r)&&(r.status==='new'||r.status==='reviewing')).length;
    $('count').textContent=[
      toReview?`${toReview} listing${toReview===1?'':'s'} to review`:'',
      open?`${open} open seeker request${open===1?'':'s'}`:'',
      other?`${other} other enquir${other===1?'y':'ies'}`:'',
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
  renderLegend();
  /* #listing-<id> (the desk notice's button, plan 047): open that card once. */
  if(!render.jumped&&/^#listing-/.test(location.hash)){
    const card=document.getElementById('lst-card-'+location.hash.slice(9));
    if(card){render.jumped=true;card.scrollIntoView({block:'start'});}
  }
}

/* The badge key under the page intro: one row per queue this page has,
   every badge carrying the same title it carries in the tables. */
function renderLegend(){
  const el=$('legend');if(!el)return;
  const row=(name,kind,labels,cls)=>`<div class="legend-row"><span class="legend-k">${esc(name)}</span>${
    Object.keys(labels).map(v=>`<span class="legend-i">${stg(kind,v,labels[v],cls?cls(v):undefined)} ${
      esc((STATUS_HELP[kind]||{})[v]||'')}</span>`).join('')}</div>`;
  const rows=[];
  if(HOSTS_HUB())rows.push(row('Listings','listing',LISTING_BADGE));
  if(HOSTS_HUB())rows.push(row('Seeker requests','seeker',SREQ_BADGE));
  rows.push(row('Introductions','stage',STAGE_LABEL));
  rows.push(row(HOSTS_HUB()?'Other enquiries':'Website enquiries','request',REQ_BADGE));
  el.innerHTML=`<details class="legend-box"><summary>What the badges mean</summary>${rows.join('')}</details>`;
}

/* The seeker-request vocabulary mapped onto the filter chips, so one row of
   chips filters both kinds of card in the right column. */
const SEEK_FILTER={new:['open','picked'],reviewing:['desk'],approved:['closed'],declined:['declined']};
/* Under All the closed requests stay off the board, as the queue this
   replaces kept them; the Approved chip is where they are listed. */
function seekMatches(r){return filter==='all'?r.status!=='closed':(SEEK_FILTER[filter]||[]).includes(r.status);}
/* A host card is judged by its LISTING, not by the enquiry row behind it:
   New is anything with a revision to review, Approved is live. */
function listingMatches(l){
  if(filter==='all')return true;
  if(filter==='new')return l.status==='pending'||!!l.pending_revision_id;
  if(filter==='approved')return l.status==='live';
  if(filter==='declined')return l.status==='declined';
  return false;
}

/* The worker mirrors every seeker request into web_requests (the engine's
   lead filing and 7-day sweep read that row), so a request on the board
   would show twice. The mirror stays in the table and leaves the board:
   a web_requests row is skipped when its seeker request is loaded, linked
   from either side. */
function isSeekerMirror(r){
  const sid=(r.payload||{}).seeker_request_id;
  return seekReqs.some(q=>(q.web_request_id!=null&&String(q.web_request_id)===String(r.id))
    ||(sid!=null&&String(q.id)===String(sid)));
}

function renderCol(which){
  const col=HUB[which];
  /* The worker files one web_requests row per SUBMISSION, so a resubmitted
     or edited listing has several rows behind it: the newest row (the read
     is created_at descending) stands for the listing and the rest are
     dropped, one card per listing. A row with no listing behind it is a
     legacy enquiry and keeps its own card. */
  const seen=new Set();
  /* A listing waiting for its first approval, and a request nobody matched
     or the seeker sent back to the desk, are decided in the Inbox (plan
     072): they leave the columns, and one line says how many and where. */
  const awaiting=l=>!!l&&!l.live_revision_id&&(l.status==='pending'||!!l.pending_revision_id);
  const inInbox=r=>r.status==='open'||r.status==='desk';
  const all=requests.filter(r=>sidesOf(col).includes(r.side)&&!isSeekerMirror(r)&&!isDeskRequest(r)).map(r=>{
    const l=HOSTS_HUB()&&r.side==='offer_capacity'?listingById((r.payload||{}).listing_id):null;
    return {r,l};
  }).filter(({l})=>{
    if(!l)return true;
    if(seen.has(String(l.id))||awaiting(l))return false;
    seen.add(String(l.id));return true;
  });
  const moved=!HOSTS_HUB()?0:which==='left'?listings.filter(awaiting).length:seekReqs.filter(inInbox).length;
  const pointer=!HOSTS_HUB()?'':`<p class="note" style="margin:0 0 10px">${which==='left'
    ?'Listings waiting for approval are in the Inbox'
    :'Requests nobody matched are in the Inbox'}${moved?` (${moved})`:''}. <a href="inbox.html">Open the Inbox</a></p>`
    +(which==='right'?'<p class="note" style="margin:0 0 10px">Questions sent to the desk are on the Desk. <a href="desk.html">Open the Desk</a></p>':'');
  const shown=all.filter(({r,l})=>l?listingMatches(l):(filter==='all'||r.status===filter));
  /* A Removed organisation (Will, 30 Sept 2026: off the hub, kept for the
     records, a human act on the Organisations board) is never mixed with
     the working list: its card goes under a Removed disclosure below the
     column, as the Organisations board's archive does. Paused stays in
     the list, marked. */
  const gone=o=>!!(o&&o.removed_at);
  let cards=shown.map(({r,l})=>({at:r.created_at||'',html:l?listingCard(r,l):reqCard(r,col),
    removed:!!l&&gone(orgById[l.org_id])}));
  let total=all.filter(({l})=>!(l&&gone(orgById[l.org_id]))).length;
  if(which==='right'&&HOSTS_HUB()){
    /* Find-capacity requests (hub v2) render beside the older enquiries
       (Will, 6 Oct): the right column is every seeker, whichever door
       they came through. */
    const board=seekReqs.filter(r=>!inInbox(r));
    total+=board.filter(r=>!gone(orgById[r.org_id])).length;
    cards=cards.concat(board.filter(seekMatches).map(r=>({at:r.created_at||'',html:seekerCard(r),
      removed:gone(orgById[r.org_id])})));
  }
  cards.sort((a,b)=>String(b.at).localeCompare(String(a.at)));
  const active=cards.filter(c=>!c.removed),removed=cards.filter(c=>c.removed);
  $(which+'N').textContent=total;
  const archive=removed.length
    ?`<details class="legacy"><summary>Removed <span class="count">\u00b7 ${removed.length} kept for the records</span></summary>${
      removed.map(c=>c.html).join('')}</details>`
    :'';
  $(which+'Col').innerHTML=pointer+(active.length
    ?active.map(c=>c.html).join('')
    :`<div class="empty">${total?'Nothing matches this filter.'
      :which==='left'?'No live host yet. A host\'s listing shows here once it is approved in the Inbox.'
      :'Nothing here yet. A seeker who picks a site lands here.'}</div>`)
    +archive;
}

const PAYLOAD_KIND={material:'material',process:'process',cadence:'cadence',services:'service'};
function payloadDetails(r){
  const p=r.payload||{};
  const lines=Object.entries(p)
    .filter(([k,v])=>v!=null&&String(v).trim()!=='')
    .map(([k,v])=>`<strong>${esc(humanise(k))}:</strong> ${esc(PAYLOAD_KIND[k]?fmtVal(v,PAYLOAD_KIND[k]):Array.isArray(v)?v.join(', '):v)}`);
  if(!lines.length)return '';
  return `<details class="pl"><summary><span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>What they submitted</summary><p>${lines.join('<br>')}</p></details>`;
}

/* A listing's card (plan 044): the worker files one web_requests row per
   submission with the listing and revision ids in its payload. The card
   shows the LISTING's status and the whole revision the host filled in, and
   its buttons raise the listing intents, so the row settles when the engine
   decides (handlers._settle_enquiry). A live host gets "Offer to a seeker".
   A legacy offer row with no listing behind it keeps the plain request card. */
function offerControl(l){
  /* A Paused or Removed host is not shown to seekers or the desk's pickers
     (Will's 2026-09-10 ruling), so it is not offered from its own card either. */
  if(!orgVisible(orgById[l.org_id]))return `<span style="color:var(--fg-2);font-size:12.5px">Paused or removed on the Accounts board: not offered to seekers</span>`;
  const taken=new Set(intros.filter(i=>String(i.listing_id)===String(l.id)).map(i=>i.seeker_request_id));
  const open=seekReqs.filter(r=>(r.status==='open'||r.status==='picked'||r.status==='desk')&&!taken.has(r.id));
  if(!open.length)return `<span style="color:var(--fg-2);font-size:12.5px">No open seeker request to offer this host to</span>`;
  return `<select id="offer-${esc(l.id)}" aria-label="Offer ${esc((orgById[l.org_id]||{}).name||'this host')} to a seeker">
      <option value="">Offer to a seeker…</option>
      ${open.map(r=>`<option value="${r.id}">${esc(seekRef(r))} · ${esc((orgById[r.org_id]||{}).name||'(seeker)')}${
        r.material?' · '+esc(lab('material',r.material)):''}</option>`).join('')}
    </select>
    <button class="btn btn-gh btn-sm" onclick="offerToSeeker('${esc(l.id)}')">Offer</button>`;
}

function listingCard(r,l){
  const pending=revById[l.pending_revision_id],live=revById[l.live_revision_id];
  const rev=live||revById[(r.payload||{}).revision_id]||pending||{};
  let actions;
  if(l.status==='live'&&pending){
    /* A change to a live listing is decided in the Inbox (plan 072). */
    actions=`<div class="actions"><span class="status" style="flex-basis:100%">A change to this listing is waiting in the Inbox. <a href="inbox.html">Open the Inbox</a></span>${offerControl(l)}</div>`;
  }else if(l.status==='live'){
    actions=`<div class="actions">${offerControl(l)}</div>`;
  }else{
    actions=`<div class="actions"><span style="color:var(--fg-2);font-size:12.5px">Nothing to review</span></div>`;
  }
  const meta=[
    r.contact_name?`<span>${esc(r.contact_name)}</span>`:'',
    r.email?`<span>${esc(r.email)}</span>`:'',
    r.location?`<span>${esc(r.location)}</span>`:'',
    rev.submitted_at?`<span>submitted ${esc(String(rev.submitted_at).slice(0,10))}</span>`:
      r.created_at?`<span>received ${esc(String(r.created_at).slice(0,10))}</span>`:'',
  ].filter(Boolean).join('');
  /* This host's introductions, each with its controls (introManage): the
     register left the page, and the Introductions page is read-only. */
  const mine=intros.filter(i=>String(i.listing_id)===String(l.id)&&i.stage!=='dead');
  const linked=mine.length
    ?mine.map(i=>`<div class="meta" style="align-items:center">
        <span>${stg('stage',i.stage,STAGE_LABEL[i.stage]||i.stage)} ${esc(introRef(i))} · ${esc(partyB(i))}</span>
        <div id="iact-${i.id}" class="actions" style="margin-top:0">${introManage(i)}</div></div>`).join('')
    :'';
  const wanted=location.hash==='#listing-'+l.id;
  return `<div class="row req s-${esc(l.status==='pending'?'new':l.status==='live'?'approved':l.status)}" id="lst-card-${esc(l.id)}">
    <div class="row-top">
      <span class="ref">${esc(reqRef(r))}</span>
      <span class="company">${esc((orgById[l.org_id]||{}).name||r.company||'(no company given)')}${
        rev.town?` <span style="color:var(--fg-2);font-weight:400">· ${esc(rev.town)}</span>`:''}</span>
      ${stg('listing',l.status,LISTING_BADGE[l.status]||l.status)}${orgStateMarker(orgById[l.org_id])}
    </div>
    <div class="meta">${meta}</div>
    ${linked}
    <details class="pl"${wanted?' open':''}><summary><span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>What they submitted</summary>${
      submittedTable(rev)}</details>
    <div id="lst-${esc(l.id)}">${actions}</div>
  </div>`;
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

  /* The request's own status decides the buttons; the intent decorates. */
  const failed=failedAbove(q,'Engine could not action this');
  let actions;
  if(q&&!failed){
    actions=`<div class="actions">${QUEUED_LINE}</div>`;
  }else if(r.status==='new'){
    actions=`<div class="actions">${failed}
      <button class="btn btn-gh btn-sm" onclick="reviewReq(${r.id},'reviewing')">Mark reviewing</button>
      <button class="btn btn-grn btn-sm" onclick="reviewReq(${r.id},'approved')"><span class="material-symbols-outlined" aria-hidden="true">check</span>${esc(col.approveLabel)}</button>
      <button class="btn btn-danger btn-sm" onclick="declineReq(${r.id})"><span class="material-symbols-outlined" aria-hidden="true">close</span>Decline</button></div>`;
  }else if(r.status==='reviewing'){
    actions=`<div class="actions">${failed}
      <button class="btn btn-grn btn-sm" onclick="reviewReq(${r.id},'approved')"><span class="material-symbols-outlined" aria-hidden="true">check</span>${esc(col.approveLabel)}</button>
      <button class="btn btn-danger btn-sm" onclick="declineReq(${r.id})"><span class="material-symbols-outlined" aria-hidden="true">close</span>Decline</button></div>`;
  }else if(r.status==='approved'){
    actions=`<div class="actions">${failed}
      <button class="btn btn-pri btn-sm" onclick="openIntroModal(${r.id})"><span class="material-symbols-outlined" aria-hidden="true">handshake</span>Make introduction</button></div>`;
  }else{ // declined
    actions=`<div class="actions">${failed}
      <button class="btn btn-gh btn-sm" onclick="reviewReq(${r.id},'reviewing')">Reconsider</button></div>`;
  }

  return `<div class="row req s-${esc(r.status)}">
    <div class="row-top">
      <span class="ref">${esc(reqRef(r))}</span>
      <span class="company">${esc(r.company||'(no company given)')}</span>
      ${stg('request',r.status,REQ_BADGE[r.status]||r.status)}
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

/* One introduction's controls: where it stands on the Introductions board,
   with a link to it, once the acceptance flow is done (plan 073); With the
   provider, Re-route and Reissue while the acceptance flow owns it; a failed
   intent above either.
   The register row (Opportunities) and the host card (Print and Mill, where
   the register left the page in plan 044) render the same thing, so no
   introduction is ever without its controls. */
function introManage(i){
  const q=pendingByIntro[i.id];
  const failed=failedAbove(q,'Failed');
  if(q&&!failed)return `<span class="status">Queued for the engine, moments away.</span>`;
  if(BOARD_STAGES.includes(i.stage)){
    if(i.stage==='approved')return failed+`<span style="color:var(--fg-2);font-size:12.5px">Recorded by hand: once the email has gone, move it to Introduced on the board.
      <a href="pipelines.html?tab=introductions">Open the Introductions board</a></span>`;
    const onBoard=i.first_order_at&&BOARD_STAGE_NAME[i.stage]==='Introduced'?'Trading':BOARD_STAGE_NAME[i.stage];
    return failed+`<span style="color:var(--fg-2);font-size:12.5px">${esc(onBoard)} on the Introductions board.
      <a href="pipelines.html?tab=introductions">Open the Introductions board</a></span>`;
  }
  /* In the acceptance flow: the provider, the worker and the engine move
     these, not a dropdown. Plan 067 (Q7, D9): a spent offer with a
     successor is history; the engine refuses a resend or a re-route of it. */
  const muted=t=>`<span style="color:var(--fg-2);font-size:12.5px">${t}</span>`;
  if(SPENT_STAGES.includes(i.stage)){
    const later=successorOf(i);
    if(later)return failed+muted(`Superseded by ${esc(introRef(later))} (${esc(STAGE_LABEL[later.stage]||later.stage)})`);
    /* Plan 072: the inbox view lists a spent offer on a picked request with
       nothing after it, and it is re-routed or resent there. */
    const req=seekReqById(i.seeker_request_id);
    if(req&&req.status==='picked')return failed+muted('Decide this spent offer in the Inbox. <a href="inbox.html">Open the Inbox</a>');
  }else if(i.stage==='awaiting_acceptance'&&!i.provider_notified_at){
    /* The offer email has not gone: the Inbox's card sends it now. */
    return failed+muted('The offer email has not gone: send it from the Inbox. <a href="inbox.html">Open the Inbox</a>');
  }
  let manage=muted('With the provider');
  if(REISSUABLE_STAGES.includes(i.stage))manage+=`
    <button class="btn btn-gh btn-sm" onclick="reissueAcceptance(${i.id})">Send the offer again</button>`;
  return failed+manage;
}

/* The row that supersedes a spent offer: one re-routed from it, or any
   offer on its request still live (not declined, expired or dead). */
function successorOf(i){
  if(i.seeker_request_id==null)return null;
  return intros.find(x=>x.id!==i.id&&x.seeker_request_id===i.seeker_request_id
    &&(x.rerouted_from===i.id||(!SPENT_STAGES.includes(x.stage)&&x.stage!=='dead')))||null;
}

function renderRegister(){
  if(!$('introRows'))return;
  /* Dead introductions leave the working board; the rows stay in the
     database and the nightly archive. Print and Mill have no register since
     plan 044 (the Introductions page has every hub's); Opportunities keeps it. */
  const live=intros.filter(i=>i.stage!=='dead');
  if(!live.length){
    $('introRows').innerHTML=`<tr><td colspan="6" style="color:var(--fg-2)">${intros.length
      ?'No live introductions — dead ones are kept in the database and the archive, off the board.'
      :'No introductions yet. Approve a request on each side, then make the introduction from either card.'}</td></tr>`;
    return;
  }
  $('introRows').innerHTML=live.map(i=>{
    const manage=introManage(i);
    const when=i.stage==='declined'&&i.declined_at?String(i.declined_at).slice(0,10)
      :i.stage==='expired'&&i.acceptance_expires_at?String(i.acceptance_expires_at).slice(0,10):'';
    return `<tr>
      <td class="rref">${esc(introRef(i))}</td>
      <td>${esc(partyA(i))}</td>
      <td>${esc(partyB(i))}</td>
      <td>${stg('stage',i.stage,STAGE_LABEL[i.stage]||i.stage)}${
        when?`<br><span class="when">${esc(when)}</span>`:''}</td>
      <td class="money">${fmtCommission(i)}</td>
      <td><div id="iact-${i.id}" class="actions" style="margin-top:0">${manage}</div></td>
    </tr>`;
  }).join('');
}

/* Party names. A legacy introduction pairs two web_requests; a hub v2 one
   names a listing and a seeker request instead. Admins see both sides here
   — the identity rule is about what a MEMBER sees before acceptance. */
/* Will's ruling (2026-09-10): a company is On, Paused or Removed, moved
   only by a person on the Organisations board. Paused keeps hidden_at as
   its since-stamp; the worker's public search reads the same two columns
   (_system/portal-worker/listings.js), so a LIVE listing whose host is
   paused or removed says so here and never reaches the desk's pickers,
   rendered by the state marker below (admin.css). */
const orgVisible=o=>!!o&&!o.hidden_at&&!o.removed_at;
function orgStateMarker(o){
  if(!o||orgVisible(o))return '';
  const state=o.removed_at?'removed':'paused';
  const why=state==='removed'?o.removed_reason:o.paused_reason;
  const help=`${state==='removed'?'Removed from the hub':'Paused'} by a person on the Accounts board${why?': '+why:''}. Not shown to seekers.`;
  return ` <span class="stg stg-${esc(state)}" title="${esc(help)}">${state.toUpperCase()}</span>`;
}
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

/* ── Listings (hub v2) ─────────────────────────────────────────────── */

/* No monthly capacity here since plan 055: it is a machine attribute, read
   by machineLines() and summed by capacityOf(). */
const REV_FIELDS=[['address_line','Address'],['town','Town'],['postcode','Postcode'],
  ['country','Country'],['ships_to','Ships to'],['services','Services'],
  ['quality_notes','Quality notes'],['attributes','Attributes']];

/* A stored term (pa12_nylon12, one_off) read as words: the vocabulary's label,
   or, for a term it lacks, the term with underscores as spaces and a capital. */
function humanise(t){
  const s=String(t).replace(/_/g,' ');
  return s.charAt(0).toUpperCase()+s.slice(1);
}
const CADENCE_LABEL={one_off:'One off',recurring:'Recurring'};
function lab(kind,term){
  if(term==null||term==='')return '';
  if(kind==='cadence'&&CADENCE_LABEL[term])return CADENCE_LABEL[term];
  return ((vocabMap[kind]||{})[term])||humanise(term);
}
/* Which vocabulary kind a field's terms belong to. */
const KIND_OF={material:'material',process:'process',cadence:'cadence',services:'service',ships_to:'region'};
function fmtVal(v,kind){
  if(v==null||v==='')return '—';
  if(Array.isArray(v))return v.length?v.map(x=>kind?lab(kind,x):x).join(', '):'—';
  if(typeof v==='object')return Object.entries(v).map(([k,x])=>`${humanise(k)}: ${x}`).join(', ')||'—';
  return kind?lab(kind,v):String(v);
}
/* One line per machine, everything the host said about it (plan 055):
   name, how many, materials, process, lead time, the monthly capacity and
   minimum order it carries as attributes (left out when absent), notes. */
function machineLines(rev){
  return ((rev&&machinesByRev[rev.id])||[]).map(m=>{
    const a=m.attributes||{};
    return [
      m.name||'(unnamed machine)',
      m.count>1?`\u00d7${m.count}`:'',
      (m.materials||[]).length?m.materials.map(t=>lab('material',t)).join(', '):'',
      a.process!=null&&a.process!==''?`process ${fmtVal(a.process,'process')}`:'',
      m.lead_time_days!=null?`${m.lead_time_days} day lead`:'',
      a.monthly_capacity!=null&&a.monthly_capacity!==''?`${a.monthly_capacity} a month`:'',
      a.min_order!=null&&a.min_order!==''?`min order ${a.min_order}`:'',
      m.notes?`notes: ${m.notes}`:'',
    ].filter(Boolean).join(' · ');
  });
}

/* What the host submitted, in the seeker card's format (needLines): one
   "Label: value" line per filled field, then one Machines line per machine.
   Fields the host left empty are left out, as the seeker card leaves out
   an empty need. */
function submittedTable(rev){
  const r=rev||{};
  const lines=REV_FIELDS
    .filter(([f])=>r[f]!=null&&String(r[f]).trim()!==''&&!(Array.isArray(r[f])&&!r[f].length)
      &&!(typeof r[f]==='object'&&!Array.isArray(r[f])&&!Object.keys(r[f]).length))
    .map(([f,label])=>`<strong>${esc(label)}:</strong> ${esc(fmtVal(r[f],KIND_OF[f]))}`);
  const machines=machineLines(rev);
  if(machines.length)machines.forEach(m=>lines.push(`<strong>Machines:</strong> ${esc(m)}`));
  else lines.push('<strong>Machines:</strong> none listed');
  return `<div class="why" style="margin-top:8px">${lines.join('<br>')}</div>`;
}

/* The listing's monthly capacity (plan 055): the sum over its machines of
   the capacity each carries; null when none of them carries one. */
function capacityOf(rev,l){
  const machines=(rev&&machinesByRev[rev.id])||(l&&machinesByRev[l.live_revision_id])||[];
  let total=null;
  machines.forEach(m=>{
    const v=Number((m.attributes||{}).monthly_capacity);
    if((m.attributes||{}).monthly_capacity!=null&&(m.attributes||{}).monthly_capacity!==''&&!isNaN(v))
      total=(total||0)+v;
  });
  return total;
}

const listingLabel=l=>{
  const rev=revById[l.live_revision_id]||{};
  const where=[rev.town,rev.country].filter(Boolean).join(', ');
  return `${(orgById[l.org_id]||{}).name||'(host)'}${where?' · '+where:''}`;
};

/* ── Seeker request queue (hub v2) ─────────────────────────────────── */

const NEED_FIELDS=[['material','Material'],['process','Process'],['quantity','Quantity'],
  ['cadence','Cadence'],['max_lead_time_days','Max lead time (days)'],
  ['needed_by','Needed by'],['services','Services'],['notes','Notes']];

/* Can this listing serve that request's region? `ships_to` holds REGION
   terms (vocab_terms kind='region': uk, ireland, europe, … worldwide) and
   seeker_requests.region is drawn from the same vocabulary, so the two
   compare directly; the request's COUNTRY never could. `worldwide` serves
   every region; an empty ships_to serves none; and a request with no region
   at all shows every live listing, for the desk to judge. */
function shipsTo(l,region){
  if(!region)return true;
  const to=(revById[l.live_revision_id]||{}).ships_to||[];
  const want=String(region).toLowerCase();
  return to.map(x=>String(x).toLowerCase()).some(r=>r==='worldwide'||r===want);
}

/* A host that named no region at all has not refused one: the picker offers
   it with the gap named beside it (handlers._live_listing reports
   ships_to_unset and never filters on it). */
function shipsToUnset(l){
  const to=(revById[l.live_revision_id]||{}).ships_to;
  return !to||!to.length;
}

function cardSummary(intro){
  const l=listingById(intro.listing_id);
  const rev=revById[intro.listing_revision_id]||(l?revById[l.live_revision_id]:null)||{};
  const capacity=capacityOf(rev,l);
  return [
    l?((orgById[l.org_id]||{}).name||'(host)'):'(listing withdrawn)',
    [rev.town,rev.country].filter(Boolean).join(', '),
    (rev.services||[]).map(t=>lab('service',t)).join(', '),
    capacity!=null?`${capacity} a month`:'',
  ].filter(Boolean).join(' · ');
}

function needLines(r){
  return NEED_FIELDS
    .filter(([f])=>r[f]!=null&&String(r[f]).trim()!==''&&!(Array.isArray(r[f])&&!r[f].length))
    .map(([f,label])=>`<strong>${esc(label)}:</strong> ${esc(fmtVal(r[f],KIND_OF[f]))}`).join('<br>');
}

function seekerCard(r){
  const q=pendingBySeekReq[r.id];
  /* Plan 067: the request's introductions, every stage but dead, each with
     its own controls (introManage: the stage, or where a spent offer is
     decided), as the host card's linked block renders them. Nothing here is
     approved: the pick went straight to the site. */
  const all=intros.filter(i=>i.seeker_request_id===r.id);
  const mine=all.filter(i=>i.stage!=='dead');
  const need=needLines(r);
  const where=[r.town,r.country].filter(Boolean).join(', ');

  const linked=mine.length
    ?mine.map(i=>`<div class="meta" style="align-items:center">
        <span>${stg('stage',i.stage,STAGE_LABEL[i.stage]||i.stage)} ${esc(introRef(i))} · ${esc(cardSummary(i))}</span>
        <div id="iact-${i.id}" class="actions" style="margin-top:0">${introManage(i)}</div></div>`).join('')
    :'';

  const taken=new Set(all.map(i=>String(i.listing_id)));
  const spare=listings.filter(l=>l.status==='live'&&!taken.has(String(l.id))
    &&(shipsTo(l,r.region)||shipsToUnset(l))
    &&orgVisible(orgById[l.org_id]));
  const adder=spare.length
    ?`<select id="addp-${r.id}" aria-label="Add a provider to ${esc(seekRef(r))}">
        <option value="">Add a provider…</option>
        ${spare.map(l=>`<option value="${esc(l.id)}">${esc(listingLabel(l))}${
          shipsToUnset(l)?' · ships-to unset':''}</option>`).join('')}
      </select>
      <button class="btn btn-gh btn-sm" onclick="addProvider(${r.id})">Add</button>`
    :`<span style="color:var(--fg-2);font-size:12.5px">No other visible listing to add (hidden accounts are left out)</span>`;

  /* The request's own status decides the buttons; the intent decorates.
     A declined or closed request has settled: its failure is shown, Try
     again is not. */
  const settled=!(r.status==='open'||r.status==='picked'||r.status==='desk');
  const failed=failedAbove(q,'Engine could not action this',!settled);
  let actions;
  if(q&&!failed){
    actions=`<div class="actions">${QUEUED_LINE}</div>`;
  }else if(r.status==='open'||r.status==='desk'){
    /* Plan 072: a request nobody matched, or one sent back to the desk, is
       decided in the Inbox (renderCol keeps these off the board). */
    actions=`<div class="actions">${failed}<span class="status">This request is decided in the Inbox. <a href="inbox.html">Open the Inbox</a></span></div>`;
  }else if(r.status==='picked'){
    /* A picked request keeps Add a provider and Decline: the inbox view lists
       only open and desk requests (plan 072). The statuses are held to the
       handler's by tests/test_board_action_preconditions.py. */
    actions=`<div class="actions">${failed}
      ${adder}
      <button class="btn btn-danger btn-sm" onclick="declineRequest(${r.id})">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>Decline</button></div>`;
  }else{
    actions=`<div class="actions">${failed}<span style="color:var(--fg-2);font-size:12.5px">
      ${esc(r.decision_note?'Declined: '+r.decision_note:'Closed')}</span></div>`;
  }

  return `<div class="row req s-${esc(r.status==='open'?'new':r.status)}">
    <div class="row-top">
      <span class="ref">${esc(seekRef(r))}</span>
      <span class="company">${esc((orgById[r.org_id]||{}).name||'(no account)')}</span>
      ${stg('seeker',r.status,SREQ_BADGE[r.status]||r.status)}
    </div>
    <div class="meta">${[where?`<span>${esc(where)}</span>`:'',
      r.created_at?`<span>received ${esc(String(r.created_at).slice(0,10))}</span>`:'',
      r.no_match?'<span>no automatic match</span>':''].filter(Boolean).join('')}</div>
    ${need?`<div class="why" style="margin-top:8px">${need}</div>`:''}
    ${linked}
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
    <div class="note-box">${HOSTS_HUB()
      ?'This records the introduction and emails the site its offer; the seeker is told when it answers. Nothing to send from Outlook.'
      :'This records the introduction: you send the email yourselves from Outlook, then move it to Introduced on the Introductions board.'}</div>
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
