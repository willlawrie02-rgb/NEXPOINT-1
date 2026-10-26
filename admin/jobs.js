/* The jobs that need us (plan 072 PR 3): every kind of row the `inbox` view
   yields, as the Inbox (inbox.html) and the company page's Needs you
   (company.html) show it and decide it.

   Loaded after crm-shell.js and crm.js as <script src="jobs.js?v=072">:
   shared admin files are cached in browsers for up to four hours, so bump
   ?v= on every change (and on every page that links it).

   One global, NXJOBS:
   - KINDS: one entry per view kind, with its group, icon, label, the one
     line it shows, whether Not now is offered (notNow: the kinds no action
     clears, inbox_handlers.NOT_NOW_KINDS) and, for a kind decided in place,
     its panel(row, ctx). A later plan's kind is one entry here plus one
     view member. A kind with no entry still shows, in the green group with
     its kind name (Architecture rule 2): nothing in the view is hidden.
   - GROUPS: To approve, Waiting on us, Money, Problems, in that order.
   - The deciding renderers, moved from hub-board.js, orders.html and the
     Dashboard with the handlers they raise unchanged. Every decision is an
     inline choice with its own Cancel; there are no pop-ups. Every raise
     is a literal raise('<type>',{...},spot,verb) to the raise the page
     passes in ctx, so the payload-key tests read them as written.
   - TYPES (the decisions raised here) and TASK_TYPES (our tasks): each page
     that loads this adds both to its one intent read.
   - read(sb, rows): the rows the panels need for the jobs given, read once.
     It writes nothing; intent reads stay on the pages, by the board rules.

   ctx, as each page builds it: the tables read() returns (listings,
   revisions, machines, requests, introductions, orgs, evidence, lines,
   declarations, strikes, vocab, searches, web, steps, links, matchIntros),
   plus rows (the job rows), pending (the newest open intent per
   intentKey), ui ({open}), me (the signed-in address), raise, open, close,
   val, need, toast, retry and, on the company page, account(what, orgId),
   which calls the account panel's own Pause, Remove and Erase (D12). */
(function () {
'use strict';

const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ms=(name,cls)=>'<span class="ms'+(cls?' '+cls:'')+'" aria-hidden="true">'+esc(name)+'</span>';
const plural=(n,a,b)=>`${n} ${n===1?a:(b||a+'s')}`;
const personOf=e=>window.NXShell?window.NXShell.personOf(e):String(e||'');

const GROUPS=[{id:'approve',name:'To approve'},{id:'waiting',name:'Waiting on us'},{id:'money',name:'Money'},{id:'problem',name:'Problems'}];
const GROUP_NAME={};GROUPS.forEach(g=>{GROUP_NAME[g.id]=g.name;});
/* One job's group, as Needs you tags it (the prototype's words). */
const GROUP_TAG={approve:'To approve',waiting:'Waiting on us',money:'Money',problem:'Problem'};
const HUB_NAME={print:'3D Print Hub',mill:'Mill Hub',opportunities:'Opportunities Board',education:'Education list'};
const hubName=h=>HUB_NAME[h]||h||'hub';
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_NAMES=['January','February','March','April','May','June','July','August','September','October','November','December'];

/* London time: the day and the clock time a person reads. */
function london(v){
  const d=v instanceof Date?v:new Date(v);
  if(isNaN(d))return null;
  const p={};
  new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
    .formatToParts(d).forEach(x=>{p[x.type]=x.value;});
  return {y:Number(p.year),m:Number(p.month),d:Number(p.day),hm:p.hour+':'+p.minute,iso:`${p.year}-${p.month}-${p.day}`};
}
/* 12 Oct; another year's dates keep the year. A bare date is a day, not a moment. */
function day(v,now){
  if(!v)return '';
  const x=/^\d{4}-\d{2}-\d{2}$/.test(String(v))?(()=>{const [y,m,d]=String(v).split('-').map(Number);return {y,m,d};})():london(v);
  if(!x)return String(v);
  const year=(london(now||new Date())||{}).y;
  return x.d+' '+MONTHS[x.m-1]+(x.y===year?'':' '+x.y);
}
function ageText(h){
  const x=Number(h)||0;
  if(x<1)return 'Under an hour';
  if(x<24)return plural(Math.floor(x),'hour');
  return plural(Math.floor(x/24),'day');
}
function runTime(v,now){
  const at=london(v),today=london(now||new Date());
  if(!at)return 'an unknown time';
  return at.iso===(today&&today.iso)?at.hm:`${at.hm} on ${at.d} ${MONTHS[at.m-1]}`;
}
const monthName=p=>{const m=/^(\d{4})-(\d{2})$/.exec(String(p||''));return m?MONTH_NAMES[Number(m[2])-1]+' '+m[1]:String(p||'');};
const amount=(v,cur)=>{
  try{return Number(v||0).toLocaleString('en-GB',{style:'currency',currency:cur||'GBP',minimumFractionDigits:0,maximumFractionDigits:2});}
  catch(e){return `${cur||''} ${Number(v||0).toFixed(2)}`.trim();}
};

/* ── The kinds ────────────────────────────────────────────────────────── */

/* The view names a company it cannot name "(no name)", "(no organisation)"
   or "(sender not known)"; inside a sentence that reads as a person would
   say it: Someone, or an unknown sender. */
const PLACEHOLDER=/^\(.*\)$/;
const who=r=>!PLACEHOLDER.test(String(r.name||''))&&r.name?r.name:r.name==='(sender not known)'?'An unknown sender':'Someone';
const whom=r=>!PLACEHOLDER.test(String(r.name||''))&&r.name?r.name:r.name==='(sender not known)'?'an unknown sender':'someone';

/* A re-route's status column is its introduction's stage (declined or expired). */
const spentStage=r=>r.status;

const KINDS={
  listing:{group:'approve',icon:'storefront',label:'Listing request',
    line:r=>`${who(r)} has requested to be a provider on the ${hubName(r.hub)}`,panel:listingPanel},
  listing_change:{group:'approve',icon:'edit_document',label:'Listing change',
    line:r=>`${who(r)} changed its listing on the ${hubName(r.hub)}`,panel:changePanel},
  host_application:{group:'approve',icon:'how_to_reg',label:'Host application',notNow:true,
    line:r=>`${who(r)} applied to host on the ${hubName(r.hub)} through the old form`,panel:hostApplicationPanel},
  opportunity_post:{group:'approve',icon:'post_add',label:'Opportunity post',
    line:r=>`${who(r)} posted an opportunity`},
  /* The door's and the account pages' requests are filed under print by
     default, so the hub is not named. */
  enquiry:{group:'waiting',icon:'forum',label:'Desk question',
    line:r=>`${who(r)} wrote to the desk`},
  education:{group:'waiting',icon:'school',label:'Education sign-up',
    line:r=>`${who(r)} signed up for the Education list`,panel:educationPanel},
  introduction_to_make:{group:'waiting',icon:'handshake',label:'Introduction to make',
    line:r=>`${who(r)} asked to be introduced${r.ref?' to '+r.ref:''}`},
  seeker_request:{group:'waiting',icon:'travel_explore',label:'No match',
    line:r=>r.status==='desk'?`${who(r)}’s request ${r.ref} came back to the desk`:`No site matched ${whom(r)}’s request ${r.ref}`,panel:seekerPanel},
  reroute:{group:'waiting',icon:'alt_route',label:'Re-route',
    line:r=>spentStage(r)==='expired'?`${r.ref} expired: ${whom(r)} is waiting`:`${r.ref} was declined: ${whom(r)} is waiting`,panel:reroutePanel},
  /* One door (plan 020): a registration names nobody, no name and no address. */
  registration:{group:'waiting',icon:'mark_email_unread',label:'Registration',notNow:true,
    line:r=>`A registration has waited ${ageText(r.age_hours).toLowerCase()} for its email confirmation`,panel:registrationPanel},
  statements:{group:'money',icon:'request_quote',label:'Statements',
    line:r=>`${plural(Number(r.name)||0,'statement')} for ${r.ref} ready to invoice`},
  /* Plan 049's three: an invoice on its 14-day clock (status is the clock's
     day, the engine's count), a listing hidden for it, an invoice Xero did
     not raise. Record payment and Extend the clock are on Accounts until
     Money (075). */
  membership_unpaid:{group:'money',icon:'payments',label:'Membership unpaid',
    line:r=>{const d=Number(r.status);
      return isNaN(d)?`${who(r)} has not paid its membership invoice`
        :d>14?`${who(r)} has not paid its membership: its clock was extended past day 14`
        :`${who(r)} has not paid its membership: day ${d} of 14`;},panel:membershipPanel},
  listing_hidden:{group:'money',icon:'visibility_off',label:'Listing hidden',
    line:r=>`${who(r)} is hidden: its membership is unpaid`,panel:membershipPanel},
  invoice_not_raised:{group:'money',icon:'receipt_long',label:'Invoice not raised',
    line:r=>`${who(r)}’s membership invoice was not raised`,panel:membershipPanel},
  /* The Dashboard's "invoiced, payment outstanding" rows: the provider owes
     the fee, and Record commission is on the hub's board until Money (075).
     The Inbox opens that board; Needs you says where it is (opensBoard). */
  introduction_unpaid:{group:'money',icon:'currency_pound',label:'Introduction fee unpaid',opensBoard:true,
    line:r=>`${r.ref} was invoiced and is not yet paid: ${whom(r)} owes the fee`,panel:unpaidIntroPanel},
  retention:{group:'money',icon:'auto_delete',label:'Retention period over',
    line:r=>`${who(r)}: its records may now be erased`,panel:retentionPanel},
  dispute:{group:'problem',icon:'gavel',label:'Dispute',
    line:r=>/^evidence:/.test(String(r.item_id||''))
      ?`${who(r)} disputes an order email${r.ref?` (${r.ref})`:''}`
      :`A line on ${whom(r)}’s declaration is disputed${r.ref?` (${r.ref})`:''}`,panel:disputePanel},
  unmatched_email:{group:'problem',icon:'mark_email_unread',label:'Unmatched order email',
    line:r=>`An order email from ${whom(r)} has no INTRO reference`,panel:unmatchedPanel},
  flagged_host:{group:'problem',icon:'flag',label:'Flagged host',notNow:true,
    line:r=>`${who(r)} has ${r.status} unresolved`,panel:flaggedPanel},
  introduction:{group:'problem',icon:'forward_to_inbox',label:'Offer email not sent',notNow:true,
    line:r=>`The offer email for ${r.ref} has not gone to ${whom(r)}`,panel:introductionPanel},
  failed_run:{group:'problem',icon:'error',label:'Failed run',notNow:true,
    line:(r,now)=>`Engine run failed: ${r.name} at ${runTime(r.created_at,now)}`,panel:failedRunPanel},
};
function kindOf(r){
  return KINDS[(r||{}).kind]||{group:'waiting',icon:'inbox',label:humanise((r||{}).kind||'job'),line:x=>String(x.name||x.ref||x.kind||'')};
}
const lineOf=(r,now)=>kindOf(r).line(r,now);

/* Where a row opens (D2). A company page takes the job's key so it can
   scroll to it; a row whose board is the Inbox, or that no company page
   decides but has a panel here (a failed run, a registration), is decided
   in place; anything else opens the board where it is decided today. Only
   the admin's own pages are ever a link. */
const SAFE_BOARD=/^[a-z0-9-]+\.html(?:[?#][^\s"'<>]*)?$/i;
function inPlace(r){
  const b=String((r||{}).board||'');
  if(/^company\.html/.test(b)||(KINDS[r.kind]||{}).opensBoard)return false;
  if(/^inbox\.html/.test(b))return true;
  return !!(KINDS[r.kind]&&KINDS[r.kind].panel);
}
function hrefOf(r){
  const b=String((r||{}).board||'');
  if(!SAFE_BOARD.test(b)||inPlace(r))return null;
  if(/^company\.html\?/.test(b))return b+'&job='+encodeURIComponent(r.item_key||'');
  return b;
}
/* What a button that opens a card's board says (copy check, 23 October). */
const BOARD_LABEL=[[/^print-hub\.html/,'Open the 3D Print Hub board'],[/^mill-hub\.html/,'Open the Mill Hub board'],
  [/^opportunities\.html/,'Open the Opportunities Board'],[/^introductions\.html/,'Open the Introductions register'],
  [/^orders\.html/,'Open Orders'],[/^system\.html/,'Open System'],[/^inbox\.html/,'Open the Inbox'],[/^contacts\.html/,'Open Contacts']];
const boardLabel=b=>((BOARD_LABEL.find(([re])=>re.test(String(b||'')))||[])[1])||'Open the page that decides it';
const companyHref=r=>{
  const b=String(r.board||'');
  if(/^company\.html\?/.test(b)&&SAFE_BOARD.test(b))return b+'&job='+encodeURIComponent(r.item_key||'');
  return r.org_id?`company.html?org=${encodeURIComponent(r.org_id)}&job=${encodeURIComponent(r.item_key||'')}`:'contacts.html';
};
const domId=k=>String(k==null?'':k).replace(/[^A-Za-z0-9_-]/g,'_');

/* ── The tables, as the panels read them (moved from hub-board.js) ─────── */

let vocabMap={},revById={},machinesByRev={},orgById={},listings=[],intros=[],seekReqs=[],searchById={};
function use(ctx){
  const c=ctx||{};
  vocabMap=c.vocab||{};revById=c.revisions||{};machinesByRev=c.machines||{};orgById=c.orgs||{};
  listings=c.listings||[];intros=c.introductions||[];seekReqs=c.requests||[];searchById=c.searches||{};
}
const listingById=id=>listings.find(l=>String(l.id)===String(id))||null;
const seekReqById=id=>seekReqs.find(r=>String(r.id)===String(id))||null;
const orgName=id=>(orgById[id]||{}).name||'';
const introRef=i=>(i&&(i.ref||(i.id!=null?'INTRO-'+String(i.id).padStart(4,'0'):'')))||'';
const orgVisible=o=>!!o&&!o.hidden_at&&!o.removed_at;

/* A provider said no, or never answered: the desk may re-route round it. */
const SPENT_STAGES=['declined','expired'];
/* The ask is still open, lapsed unanswered, or declined: the same site may
   be asked again with a fresh window (plan 067), or the request re-routed. */
const REISSUABLE_STAGES=['awaiting_acceptance','expired','declined'];
const STAGE_WORD={proposed:'proposed',awaiting_acceptance:'awaiting acceptance',approved:'approved',introduced:'introduced',
  in_discussion:'in discussion',deal_done:'deal done',dead:'dead',invoiced:'invoiced',paid:'paid',expired:'expired',declined:'declined'};

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
/* An empty value says None: the CRM writes words, not dashes. */
const NONE='None';
function fmtVal(v,kind){
  if(v==null||v==='')return NONE;
  if(Array.isArray(v))return v.length?v.map(x=>kind?lab(kind,x):x).join(', '):NONE;
  if(typeof v==='object')return Object.entries(v).map(([k,x])=>`${humanise(k)}: ${x}`).join(', ')||NONE;
  return kind?lab(kind,v):String(v);
}
/* Arrays compare as sets: a host reordering "ships to" is not a change. */
const sameSet=(a,b)=>JSON.stringify((a||[]).map(String).sort())===JSON.stringify((b||[]).map(String).sort());
const sameVal=(a,b)=>Array.isArray(a)||Array.isArray(b)?sameSet(a,b)
  :JSON.stringify(a==null?null:a)===JSON.stringify(b==null?null:b);

/* Each row is [field, was, now, check]: check is 'review:<what>' for a
   change we review, or 'auto' for a count, lead time or monthly capacity,
   which goes live on its own (the worker's AUTO_MACHINE_FIELDS and _ATTRS). */
function revisionDiff(oldRev,newRev){
  const rows=[];
  REV_FIELDS.forEach(([f,label])=>{
    if(!sameVal((oldRev||{})[f],(newRev||{})[f]))
      rows.push([label,fmtVal((oldRev||{})[f],KIND_OF[f]),fmtVal((newRev||{})[f],KIND_OF[f]),'review:'+label.toLowerCase()]);
  });
  rows.push(...machineDiff(oldRev,newRev));
  return rows;
}

/* The machines compared one by one (plan 068): the same name, slug for slug, is
   the same machine, and two rows with one name pair up in position order, the
   rule the worker's classifyChanges and the engine's _change_lines use. */
const mslug=s=>String(s==null?'':s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
function machineDiff(oldRev,newRev){
  const rows=[];
  const line=m=>[m.name,m.count>1?`x${m.count}`:'',(m.materials||[]).length?`(${m.materials.map(t=>lab('material',t)).join(', ')})`:'',
    m.lead_time_days!=null?`${m.lead_time_days}d`:'',(m.attributes||{}).monthly_capacity!=null?`${m.attributes.monthly_capacity}/month`:''].filter(Boolean).join(' ');
  const pool=new Map();
  ((oldRev&&machinesByRev[oldRev.id])||[]).forEach(m=>{const k=mslug(m.name);if(!pool.has(k))pool.set(k,[]);pool.get(k).push(m);});
  ((newRev&&machinesByRev[newRev.id])||[]).forEach(m=>{
    const twin=(pool.get(mslug(m.name))||[]).shift();
    if(!twin){rows.push(['Machine added',NONE,line(m),'review:new machine']);return;}
    const a=twin.attributes||{},b=m.attributes||{};
    if(!sameVal(twin.materials,m.materials))rows.push([`${m.name}: materials`,fmtVal(twin.materials,'material'),fmtVal(m.materials,'material'),'review:material']);
    if(twin.count!==m.count)rows.push([`${m.name}: how many`,String(twin.count),String(m.count),'auto']);
    if(twin.lead_time_days!==m.lead_time_days)rows.push([`${m.name}: lead time`,`${twin.lead_time_days} days`,`${m.lead_time_days} days`,'auto']);
    [...new Set([...Object.keys(a),...Object.keys(b)])].sort().forEach(k=>{
      const words=k==='monthly_capacity'?'monthly capacity':k==='min_order'?'minimum order':k.replace(/_/g,' ');
      if(!sameVal(a[k],b[k]))rows.push([`${m.name}: ${words}`,fmtVal(a[k],KIND_OF[k]),fmtVal(b[k],KIND_OF[k]),AUTO_MACHINE_ATTRS.includes(k)?'auto':'review:'+words]);
    });
    if((twin.notes||'')!==(m.notes||''))rows.push([`${m.name}: notes`,twin.notes||NONE,m.notes||NONE,'review:notes']);
  });
  [...pool.values()].flat().forEach(m=>rows.push(['Machine removed',line(m),NONE,'review:machine removed']));
  return rows;
}

/* A save that changes a paired machine's count, lead time or monthly
   capacity (each goes live on its own, plan 068) beside a change we review
   waits as a whole (068 P1 as amended). Only a save that needs review has a
   pending revision, so a no-review change in one means the save mixes. The
   fields are the worker's AUTO_MACHINE_FIELDS and AUTO_MACHINE_ATTRS. */
const AUTO_MACHINE_FIELDS=['lead_time_days','count'],AUTO_MACHINE_ATTRS=['monthly_capacity'];
function mixesNoReview(oldRev,newRev){
  const pool=new Map();
  ((oldRev&&machinesByRev[oldRev.id])||[]).forEach(m=>{const k=mslug(m.name);if(!pool.has(k))pool.set(k,[]);pool.get(k).push(m);});
  return ((newRev&&machinesByRev[newRev.id])||[]).some(m=>{
    const twin=(pool.get(mslug(m.name))||[]).shift();
    if(!twin)return false;
    return AUTO_MACHINE_FIELDS.some(f=>!sameVal(twin[f],m[f]))
      ||AUTO_MACHINE_ATTRS.some(k=>!sameVal((twin.attributes||{})[k],(m.attributes||{})[k]));
  });
}

/* The change against the live listing, as the prototype's table: Field, Was,
   Now, and Check, a reviewed change or one that waits with the rest of a
   mixed save (it would go live on its own in a save of its own). */
function diffTable(rows,mixed){
  const check=c=>c==='auto'?`<span class="st">${mixed?'Waits with the rest':'Goes live on its own'}</span>`
    :`<span class="st info">Review: ${esc(String(c||'review:change').slice(7))}</span>`;
  return `<div class="tscroll"><table class="tbl compact"><thead><tr><th>Field</th><th>Was</th><th>Now</th><th>Check</th></tr></thead><tbody>${
    rows.map(([f,a,b,c])=>`<tr><td>${esc(f)}</td><td>${esc(a)}</td><td class="strong">${esc(b)}</td><td>${check(c)}</td></tr>`).join('')}</tbody></table></div>`;
}

/* One line per machine, everything the host said about it (plan 055):
   name, how many, materials, process, lead time, the monthly capacity and
   minimum order it carries as attributes (left out when absent), notes. */
function machineLines(rev){
  return ((rev&&machinesByRev[rev.id])||[]).map(m=>{
    const a=m.attributes||{};
    return [
      m.name||'(unnamed machine)',
      m.count>1?`×${m.count}`:'',
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
/* What the host submitted, as the prototype's list (rows for kv()):
   Machines (one line each, everything the host said about it), Materials,
   Capacity, Lead time, Ships to, Quality, Services, Address, Attributes.
   Fields the host left empty are left out. */
function submittedTable(rev){
  const r=rev||{}, ms=(r.id!=null&&machinesByRev[r.id])||[], rows=[];
  const has=v=>v!=null&&String(v).trim()!==''&&!(Array.isArray(v)&&!v.length)&&!(typeof v==='object'&&!Array.isArray(v)&&!Object.keys(v).length);
  const machines=machineLines(rev);
  rows.push(['Machines',machines.length?machines.map(esc).join('<br>'):'None listed']);
  const mats=[...new Set(ms.flatMap(m=>m.materials||[]))];
  if(mats.length)rows.push(['Materials',esc(mats.map(t=>lab('material',t)).join(', '))]);
  const cap=capacityOf(rev);
  if(cap!=null)rows.push(['Capacity',esc(`${cap} a month`)]);
  const leads=ms.map(m=>m.lead_time_days).filter(v=>v!=null);
  if(leads.length){const lo=Math.min(...leads),hi=Math.max(...leads);rows.push(['Lead time',esc(lo===hi?`${lo} days`:`${lo} to ${hi} days`)]);}
  if(has(r.ships_to))rows.push(['Ships to',esc(fmtVal(r.ships_to,'region'))]);
  if(has(r.quality_notes))rows.push(['Quality',esc(r.quality_notes)]);
  if(has(r.services))rows.push(['Services',esc(fmtVal(r.services,'service'))]);
  const where=['address_line','town','postcode','country'].map(f=>r[f]).filter(has).join(', ');
  if(where)rows.push(['Address',esc(where)]);
  if(has(r.attributes))rows.push(['Attributes',esc(fmtVal(r.attributes))]);
  return rows;
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

/* Can this listing serve that request's region? `ships_to` holds REGION
   terms (vocab_terms kind='region': uk, ireland, europe, … worldwide) and
   seeker_requests.region is drawn from the same vocabulary, so the two
   compare directly: the request's COUNTRY never could. `worldwide`
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
   agrees (add-provider's _live_listing reports ships_to_unset and never
   filters on it), so the picker offers these listings with the gap named
   beside them and lets the desk judge. */
function shipsToUnset(l){
  const to=(revById[l.live_revision_id]||{}).ships_to;
  return !to||!to.length;
}

/* What the seeker asked for, as the prototype's list (rows for kv()): Wants,
   Volume, Ships to, Lead time, then Needed by, Services and Notes. */
function needLines(r){
  const rows=[], has=v=>v!=null&&String(v).trim()!==''&&!(Array.isArray(v)&&!v.length);
  const want=[has(r.material)?fmtVal(r.material,'material'):'',has(r.process)?fmtVal(r.process,'process'):''].filter(Boolean).join(', ');
  if(want)rows.push(['Wants',esc(want)]);
  const vol=[has(r.quantity)?String(r.quantity):'',has(r.cadence)?lab('cadence',r.cadence).toLowerCase():''].filter(Boolean).join(', ');
  if(vol)rows.push(['Volume',esc(vol)]);
  if(has(r.region))rows.push(['Ships to',esc(lab('region',r.region))]);
  if(has(r.max_lead_time_days))rows.push(['Lead time',esc(`Within ${r.max_lead_time_days} days`)]);
  if(has(r.needed_by))rows.push(['Needed by',esc(day(r.needed_by))]);
  if(has(r.services))rows.push(['Services',esc(fmtVal(r.services,'service'))]);
  if(has(r.notes))rows.push(['Notes',esc(r.notes)]);
  return rows;
}

/* The row that supersedes a spent offer: one re-routed from it, or any
   offer on its request still live (not declined, expired or dead). */
function successorOf(i){
  if(i.seeker_request_id==null)return null;
  return intros.find(x=>x.id!==i.id&&x.seeker_request_id===i.seeker_request_id
    &&(x.rerouted_from===i.id||(!SPENT_STAGES.includes(x.stage)&&x.stage!=='dead')))||null;
}

/* Where a spent offer can go next: the next best from the search the seeker
   ran, in the order it was ranked (the first listing still live, visible
   and not yet on this request; the spent one is on it, so it never comes
   back), and every other live, visible listing on the hub that ships there. */
function rerouteControl(i){
  if(i.seeker_request_id==null)return {best:null,options:[]};
  const req=seekReqById(i.seeker_request_id);
  const taken=new Set(intros.filter(x=>x.seeker_request_id===i.seeker_request_id)
    .map(x=>String(x.listing_id)));
  const options=listings.filter(l=>l.status==='live'&&l.hub===i.hub&&!taken.has(String(l.id))
    &&shipsTo(l,req&&req.region)
    &&orgVisible(orgById[l.org_id]));
  const search=req&&req.search_id!=null?searchById[req.search_id]:null;
  const next=search?(search.ranked||[]).map(e=>listingById(e.listing_id))
    .find(l=>l&&l.status==='live'&&!taken.has(String(l.id))&&orgVisible(orgById[l.org_id])):null;
  return {best:next||null,options};
}

/* The ingest step's guess at who sent an email. 'unknown' is a real
   answer, not a party, so it is said as one (orders.html). */
function partyGuess(party){
  if(party==='provider')return 'Looks like the provider';
  if(party==='seeker')return 'Looks like the seeker';
  return 'Sender not recognised';
}
const STRIKE_SOURCE={seeker_check:'Seeker check',audit:'Audit',no_declaration:'No declaration',undeclared_evidence:'Undeclared evidence'};

/* ── The pieces every panel is built from (crm.css components) ─────────── */

const btn=(act,label,icon,data,cls)=>`<button type="button" class="btn sm${cls?' '+cls:''}" data-act="${act}"${
  Object.entries(data||{}).map(([k,v])=>` data-${k}="${esc(v)}"`).join('')}>${icon?ms(icon,'sm'):''}${esc(label)}</button>`;
const link=(href,label,icon,cls)=>`<a class="btn sm${cls?' '+cls:''}" href="${esc(href)}">${icon?ms(icon,'sm'):''}${esc(label)}</a>`;
const cancel=()=>btn('jobClose','Cancel','',{},'quiet');
const kv=rows=>rows.length?`<dl class="kv">${rows.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`:'';
const para=html=>`<p>${html}</p>`;
const input=(id,ph,v)=>`<label class="sr" for="${id}">${esc(ph)}</label><input class="input" id="${id}" placeholder="${esc(ph)}" value="${esc(v||'')}">`;
const choice=(text,inner)=>`<div class="inline-choice"><span>${text}</span>${inner}</div>`;
const missing=what=>({body:para(esc(what)+' could not be read. It may have been decided already; the next refresh says.')});
const isOpen=(ctx,what,r)=>!!(ctx&&ctx.ui&&ctx.ui.open===`job:${what}:${r.item_key}`);
/* A control's id carries its own job: two jobs on one page never share one,
   so a decision reads the field its own job drew. */
const fid=(name,r)=>name+'-'+domId(r.item_key);
/* The handlers' sentences come without a full stop; the page adds it, once. */
const sentence=n=>{const t=String(n==null||n===''?'No reason recorded':n).trim();return /[.!?]$/.test(t)?t:t+'.';};
const failLine=q=>`<div class="actions"><span class="status-line fail">${ms('error','sm')}Failed: ${esc(sentence(q.result_note))}</span>${
  btn('jobRetry','Try again','refresh',{intent:q.id},'quiet')}</div>`;
const QUEUED='<span class="status-line">'+ms('schedule','sm')+'Queued, moments away.</span>';

/* ── The deciding panels ──────────────────────────────────────────────── */

/* A first listing (068, register D5): the whole submission and the period
   the host chose. Approve is one click; the board never chooses the period,
   so a submission with none, on a site not yet billed, is withheld (P8). */
function listingPanel(r,ctx){
  const l=listingById(r.item_id);
  if(!l)return missing('This listing');
  const pending=revById[l.pending_revision_id],live=revById[l.live_revision_id];
  const rev=pending||live||{};
  const org=orgById[l.org_id]||{};
  /* Billed: a status that is not none AND a period on record, the worker's
     and the engine's rule; a status with no period is approved on the
     period the host chose on the form. */
  const billed=!!org.sub_status&&org.sub_status!=='none'&&(org.sub_period==='annual'||org.sub_period==='monthly');
  const chosen=!!pending&&(pending.billing_period==='annual'||pending.billing_period==='monthly');
  const period=chosen?(pending.billing_period==='monthly'?'Monthly, £100 a month, chosen by the host':'Yearly, £1,000 a year, chosen by the host')
    :billed?'Already billed: one membership covers both hubs':'';
  const k=r.item_key;
  return {intent:'listing:'+l.id,
    body:para(`Submitted ${esc(day(rev.submitted_at||l.created_at))}. Approving puts it live and starts the membership; the host is emailed once.`)
      +kv(submittedTable(rev).concat(period?[['Membership',esc(period)]]:[]))
      +(billed||chosen?'':`<div class="hint">${ms('info')}<span>No billing period on this submission: the host chooses yearly or monthly on the listing form. Decline with a note asking them to choose.</span></div>`),
    actions:((billed||chosen)?btn('jobApproveListing','Approve','check',{key:k},'primary'):'')
      +btn('jobOpen','Decline with a note','',{key:k,ui:'decline'}),
    choice:isOpen(ctx,'decline',r)?choice('What needs changing before this listing can go live? The host is sent this note.',
      input(fid('jb-note',r),'What needs changing')+btn('jobDeclineListing','Decline the listing','',{key:k},'danger')+cancel()):''};
}

/* A change to a live listing (068 D6): field by field and machine by
   machine against what is live, and said when the save waits as a whole. */
function changePanel(r,ctx){
  const l=listingById(r.item_id);
  const pending=l&&revById[l.pending_revision_id],live=l&&revById[l.live_revision_id];
  if(!l||!pending)return missing('This change');
  const changes=revisionDiff(live,pending);
  const k=r.item_key;
  return {intent:'listing:'+l.id,
    body:para('The live listing stays as it is until you approve.')
      +(mixesNoReview(live,pending)?para('This save mixes a change that goes live on its own with one we review, so it waits as a whole.'):'')
      +(changes.length?diffTable(changes,mixesNoReview(live,pending)):para('Nothing differs from the live listing.')),
    actions:btn('jobApproveChange','Approve the change','check',{key:k},'primary')+btn('jobOpen','Decline the change','',{key:k,ui:'decline'}),
    choice:isOpen(ctx,'decline',r)?choice('What needs changing? The host is sent this note; the live listing stays as it is.',
      input(fid('jb-note',r),'What needs changing')+btn('jobDeclineChange','Decline the change','',{key:k},'danger')+cancel()):''};
}

/* A request nobody matched, or one the seeker sent back to the desk
   (register §2, 067): the ask, and every live site on the hub that ships
   there, in the board's order, each introduced by hand (add-provider
   emails that site its offer). Paused and removed hosts are left out. The
   statuses are the ones the view lists, both of which the handlers accept
   (DECLINABLE_REQUEST_STATUSES, PROVIDER_ADDABLE_STATUSES). */
const SEEKER_OPEN=['open','desk'];
function seekerPanel(r,ctx){
  const req=seekReqById(r.item_id);
  if(!req)return missing('This request');
  if(!SEEKER_OPEN.includes(req.status))return {body:para(`This request is ${esc(req.status)} now, so nothing is left to decide here.`)};
  const onReq=intros.filter(i=>i.seeker_request_id===req.id);
  const taken=new Set(onReq.map(i=>String(i.listing_id)));
  /* An offer made since (Introduce by hand) is listed; while one waits for
     its answer the request is not declined from here. */
  const live=onReq.filter(i=>!['declined','expired','dead'].includes(i.stage));
  const siteOf=i=>orgName((listingById(i.listing_id)||{}).org_id||i.org_a)||'the site';
  const waiting=live.find(i=>i.stage==='awaiting_acceptance');
  const spare=listings.filter(l=>l.hub===req.hub&&l.status==='live'&&!taken.has(String(l.id))
    &&(shipsTo(l,req.region)||shipsToUnset(l))
    &&orgVisible(orgById[l.org_id]));
  const where=[req.town,req.country].filter(Boolean).join(', ');
  const k=r.item_key;
  const row=(l,n)=>{
    const rev=revById[l.live_revision_id]||{}, cap=capacityOf(rev,l), town=[rev.town,rev.country].filter(Boolean).join(', ');
    const sub=[cap!=null?`${cap} a month`:'',(rev.services||[]).map(t=>lab('service',t)).join(', '),shipsToUnset(l)?'Ships to: not set':''].filter(Boolean).join(', ');
    return `<div class="mini"><span><span><span class="rank num">${n+1}</span><span class="strong">${esc(orgName(l.org_id)||'(host)')}</span>${town?', '+esc(town):''}</span>${
      sub?`<span class="item-sub">${esc(sub)}</span>`:''}</span>${btn('jobIntroduce','Introduce by hand','',{key:k,listing:l.id})}</div>`;
  };
  return {intent:'seeker:'+req.id,
    body:(req.status==='desk'?para('The seeker told the desk the shortlist did not fit.'):req.no_match?para('The search matched nobody.'):'')
      +kv(needLines(req).concat(where?[['Where',esc(where)]]:[]))
      +(live.length?`<div>${live.map(i=>`<div class="mini"><span><span class="strong">${esc(introRef(i))}</span><span class="item-sub">${
          esc(siteOf(i)+', '+(STAGE_WORD[i.stage]||i.stage))}</span></span></div>`).join('')}</div>`:'')
      +(waiting?para(`An offer to ${esc(siteOf(waiting))} is waiting for its answer.`):'')
      +(spare.length?para(`Live sites on the ${esc(hubName(req.hub))} that ship there:`)+`<div>${spare.slice(0,8).map(row).join('')}</div>`
        :para(`No live site on the ${esc(hubName(req.hub))} ships there. Paused and removed hosts are left out.`)),
    actions:waiting?'':btn('jobOpen','Decline with a reason','',{key:k,ui:'decline'}),
    choice:!waiting&&isOpen(ctx,'decline',r)?choice('Why can we not match this request? Kept on the record; the seeker is told only that we could not match it.',
      input(fid('jb-note',r),'Reason, kept on the request')+btn('jobDeclineRequest','Decline the request','',{key:k},'danger')+cancel()):''};
}

/* A declined or expired offer with nothing after it (067 Q7, D9): re-route
   to the next best, or send the same site the offer again. A spent offer
   with a successor is history; the engine refuses both, so neither is
   offered and the panel says so. */
function reroutePanel(r,ctx){
  const i=intros.find(x=>String(x.id)===String(r.item_id));
  if(!i)return missing('This introduction');
  const later=successorOf(i);
  if(later)return {body:para(`Superseded by ${esc(introRef(later))} (${esc(STAGE_WORD[later.stage]||later.stage)}). Nothing is left to decide here.`)};
  const req=seekReqById(i.seeker_request_id);
  const l=listingById(i.listing_id);
  const provider=orgName((l||{}).org_id||i.org_a)||'the site';
  const seeker=orgName(i.org_b)||r.name;
  const spentAt=i.stage==='declined'?i.declined_at:i.acceptance_expires_at;
  const {best,options}=rerouteControl(i);
  const k=r.item_key;
  let actions='';
  if(best)actions+=btn('jobReroute',`Re-route to ${orgName(best.org_id)||'the next best'}, next best`,'alt_route',{key:k,listing:best.id},'primary');
  if(options.length)actions+=btn('jobOpen','Re-route to another site','',{key:k,ui:'reroute'});
  if(!best&&!options.length)actions+='<span class="status-line">No other visible listing to re-route to. Paused and removed hosts are left out.</span>';
  if(REISSUABLE_STAGES.includes(i.stage))actions+=btn('jobOpen',`Resend to ${provider}`,'replay',{key:k,ui:'resend'});
  let ui='';
  if(isOpen(ctx,'resend',r))ui=choice(`Send the offer for ${esc(introRef(i))} to the same site again? A fresh 14-day window; nothing else on the introduction changes.`,
    btn('jobResend','Resend the offer','',{key:k},'primary')+cancel());
  else if(isOpen(ctx,'reroute',r))ui=choice('Re-route to which site? That site is emailed the offer, and the seeker is told which site it went to.',
    `<label class="sr" for="${fid('jb-site',r)}">Site</label><select class="input" id="${fid('jb-site',r)}"><option value="">Choose a site</option>${
      options.map(o=>{const rev=revById[o.live_revision_id]||{};return `<option value="${esc(o.id)}">${esc([orgName(o.org_id)||'(host)',rev.town].filter(Boolean).join(', '))}</option>`;}).join('')}</select>`
    +btn('jobRerouteTo','Re-route','',{key:k},'primary')+cancel());
  return {intent:'intro:'+i.id,
    body:para(`${esc(seeker)} picked ${esc(provider)}, who ${i.stage==='declined'?'said no':'did not answer within 14 days'}. A request goes to one site at a time, so it is waiting on us.`)
      +kv([['Reference',esc(introRef(i))],[i.stage==='declined'?'Declined':'Expired',esc(day(spentAt)||'Date not recorded')]]
        .concat(req?needLines(req):[])),
    actions,choice:ui};
}

/* An offer the desk approved whose email has not gone (plan 023): the
   06:15 retry sends it; Send it now is the same reissue the board offered. */
function introductionPanel(r){
  return {intent:'intro:'+r.item_id,
    body:para('The offer email has not gone. The 06:15 run tries again.'),
    actions:btn('jobSendNow','Send it now','send',{key:r.item_key},'primary')};
}

/* A disputed declaration line, or a disputed order email (register §2):
   both sides and the order emails for that introduction and month, then
   one of two decisions, each with a note asked in place. Editing a line's
   value waits for Money (Will, 22 October). */
function disputePanel(r,ctx){
  const [what,rawId]=String(r.item_id||'').split(':');
  const id=Number(rawId), k=r.item_key;
  const named=n=>n&&!PLACEHOLDER.test(n)?n:'';
  let body='', host='', seeker='';
  if(what==='line'){
    const line=(ctx.lines||[]).find(x=>String(x.id)===rawId);
    if(!line)return missing('This line');
    const decl=(ctx.declarations||[]).find(d=>d.id===line.declaration_id)||{};
    const intro=intros.find(i=>i.id===line.introduction_id)||{};
    host=named(orgName(decl.org_id)||r.name);seeker=named(orgName(intro.org_b));
    const emails=(ctx.evidence||[]).filter(e=>e.introduction_id===line.introduction_id&&e.status==='matched'&&(!decl.period||e.period===decl.period));
    const units=emails.reduce((t,e)=>t+(Number(e.units_guess)||0),0);
    const shows=emails.length?plural(emails.length,'order email')+(units?`, ${units} units`:''):'None filed';
    body=`<div class="tscroll"><table class="tbl compact"><thead><tr><th>Line</th><th>${esc(host||'The host')} declared</th><th>${esc(seeker||'The seeker')} says</th><th>Order emails show</th></tr></thead><tbody><tr>`+
      `<td>${esc([introRef(intro)||r.ref,hubName(decl.hub||intro.hub),monthName(decl.period)].filter(Boolean).join(', '))}</td>`+
      `<td>${esc([line.units!=null?`${line.units} units`:'',amount(line.value,line.currency)].filter(Boolean).join(', '))}</td>`+
      `<td>${esc(line.dispute_note||'No note given')}</td><td>${esc(shows)}</td></tr></tbody></table></div>`+
      (emails.length?emailsBlock(emails,ctx):'');
  }else{
    const e=(ctx.evidence||[]).find(x=>String(x.id)===rawId);
    if(!e)return missing('This order email');
    const intro=intros.find(i=>i.id===e.introduction_id)||{};
    host=named(orgName(e.org_provider)||r.name);seeker=named(orgName(e.org_seeker)||orgName(intro.org_b));
    body=`<p class="quote">From ${esc(e.from_email||'an unknown sender')}, ${esc(day(e.received_at||e.created_at))}: “${esc(e.subject||'(no subject)')}”</p>`
      +kv([['Dispute',esc(e.dispute_note||'No note given')]])+outlookButton(e,ctx);
  }
  const use=`Use ${seeker||'the seeker'}’s figure`, keep=`Keep ${host||'the host'}’s figure`;
  const res=isOpen(ctx,'upheld',r)?'upheld':isOpen(ctx,'dismissed',r)?'dismissed':null;
  return {intent:`dispute:${what}:${id}`,body,
    actions:btn('jobOpen',use,'check',{key:k,ui:'upheld'},'primary')+btn('jobOpen',keep,'',{key:k,ui:'dismissed'}),
    choice:res?choice(esc(res==='upheld'?use:keep)+'? A note for the record is kept beside the dispute.',
      input(fid('jb-note',r),'Note for the record')+btn('jobSettle',res==='upheld'?use:keep,'',{key:k,res},'primary')+cancel()):''};
}
/* Open in Outlook, where 071's index has a link for the email (the signed-in person's mailbox first). */
function outlookButton(e,ctx){
  const links=(ctx.links||{})[e.internet_message_id];
  const l=links&&window.NXCRM?window.NXCRM.outlookLink(links,ctx.me):null;
  return l?`<a class="btn sm" href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${ms('open_in_new','sm')}${esc(l.label)}</a>`:'';
}
function emailsBlock(emails,ctx){
  if(!emails.length)return para('No order email was filed for it.');
  return `<div>${emails.map(e=>`<div class="mini"><span><span class="strong">${esc(e.subject||'(no subject)')}</span><span class="item-sub">${
    esc([e.from_email,day(e.received_at)].filter(Boolean).join(', '))}</span></span>${outlookButton(e,ctx)}</div>`).join('')}</div>`;
}

/* An order email the CC inbox matched to no introduction (register §2):
   match it to one of this company's introductions (every live one when
   there is no company), or mark it not an introduction order. */
function unmatchedPanel(r,ctx){
  const e=(ctx.evidence||[]).find(x=>String(x.id)===String(r.item_id));
  if(!e)return missing('This order email');
  const party=e.org_provider?orgName(e.org_provider):e.org_seeker?orgName(e.org_seeker):'';
  const opts=ctx.matchIntros||[];
  const k=r.item_key;
  return {intent:'evidence:'+e.id,
    body:`<p class="quote">From ${esc(e.from_email||'an unknown sender')}, ${esc(day(e.received_at||e.created_at))}: “${esc(e.subject||'(no subject)')}”</p>`
      +kv([['Quoted reference',esc(e.ref_text||NONE)],['Sender',esc(partyGuess(e.sender_party)+(party?` (${party})`:''))]]),
    actions:(opts.length?`<label class="sr" for="${fid('jb-intro',r)}">Introduction</label><select class="input" id="${fid('jb-intro',r)}"><option value="">Match to an introduction</option>${
        opts.map(i=>`<option value="${esc(i.id)}">${esc(introRef(i))}, ${esc(orgName(i.org_a)||'(provider)')} to ${esc(orgName(i.org_b)||'(seeker)')}</option>`).join('')}</select>`
        +btn('jobMatch','Match it','link',{key:k},'primary')
      :'<span class="status-line">No introduction to match it to yet.</span>')
      +btn('jobOpen','Mark as not an introduction order','',{key:k,ui:'notorder'}),
    choice:isOpen(ctx,'notorder',r)?choice('Mark this email as not an introduction order? It stays on the record, matched to no introduction.',
      btn('jobNotAnOrder','Mark it not an order','',{key:k},'primary')+cancel()):''};
}

/* Two or more strikes opened in a year and uncured, on a host still on
   (Will's ruling of 10 September: a person decides). Pause and Remove are
   the account panel's own (D12); Keep it live is Not now, with its reason. */
function flaggedPanel(r,ctx){
  const orgId=r.org_id||r.item_id;
  const yearAgo=Date.now()-365*864e5;
  const open=(ctx.strikes||[]).filter(s=>s.org_id===orgId&&!s.cured_at&&new Date(s.opened_at).getTime()>yearAgo)
    .sort((a,b)=>String(a.opened_at).localeCompare(String(b.opened_at)));
  const k=r.item_key;
  return {ownNotNow:true,notNow:{ask:'Why keep it live? The card comes back if another strike opens.',go:'Keep it live',verb:'Kept live'},
    body:para('Two or more unresolved strikes in 12 months. Pausing takes the listing off search results; the host stays on the system.')
      +kv(open.map((s,n)=>[`Strike ${n+1}`,esc(`${day(s.opened_at)}: ${[STRIKE_SOURCE[s.source]||humanise(s.source),s.notes].filter(Boolean).join(', ')}.${s.cure_by?` Cure by ${day(s.cure_by)}.`:''}`)])),
    actions:(ctx.account
        ?btn('jobAccount','Pause the listing','pause_circle',{key:k,what:'pause'},'primary')+btn('jobOpen','Keep it live','',{key:k,ui:'nn'})
          +btn('jobAccount','Remove the host','remove_circle',{key:k,what:'remove'},'danger')
        :link(companyHref(r),'Open the company page','open_in_new','primary')+btn('jobOpen','Keep it live','',{key:k,ui:'nn'}))};
}

/* An Education list sign-up (plan 026's panel, moved from the Dashboard):
   Approve, or Decline with a reason that is recorded and never sent. */
function educationPanel(r,ctx){
  const w=(ctx.web||[]).find(x=>String(x.id)===String(r.item_id));
  if(!w)return missing('This sign-up');
  const k=r.item_key;
  return {intent:'web:'+w.id,
    body:kv([['Name',esc(w.contact_name||'(no name given)')],['Email',esc(w.email||'None given')],['Signed up',esc(day(w.created_at))]]),
    actions:btn('jobEducation','Approve','check',{key:k,status:'approved'},'primary')+btn('jobOpen','Decline with a reason','',{key:k,ui:'decline'}),
    choice:isOpen(ctx,'decline',r)?choice('Why is this declined? Recorded on the sign-up, never sent to the person.',
      input(fid('jb-note',r),'Reason, recorded on the sign-up')+btn('jobEducation','Decline the sign-up','',{key:k,status:'declined'},'danger')+cancel()):''};
}

/* The payment clock (the design's): a bar for the 14 days with ticks at days
   7 and 12, blue until day 14, red once the listing has hidden itself; the
   label says which reminders have gone. `n` is the clock's day. */
function clockHtml(inv,n){
  const hidden=!!inv.hidden_at&&!inv.restored_at, d=Math.max(0,Math.min(n,14));
  const text=hidden?'Day 14 passed: hidden until paid'
    :inv.extended_to&&n>14?`Extended by hand to ${day(inv.extended_to)}`
    :n>14?`Day ${n} of 14: it hides at the next scheduled check`
    :`Day ${n} of 14${inv.reminder_12_at?', reminders sent on days 7 and 12':inv.reminder_7_at?', reminder sent on day 7':''}`;
  return `<div class="clock ${hidden||(n>14&&!inv.extended_to)?'red':'blue'}" role="img" aria-label="${esc(text)}"><div class="cbar"><i style="width:${(d/14*100).toFixed(1)}%"></i><b style="left:50%"></b><b style="left:85.7%"></b></div><span class="clabel">${esc(text)}</span></div>`;
}
/* The clock's day: London today less its start, the engine's count. */
const clockDay=(inv,today)=>inv.clock_start?Math.round((Date.parse(today+'T12:00:00Z')-Date.parse(String(inv.clock_start).slice(0,10)+'T12:00:00Z'))/864e5):null;
const XERO=/^https:\/\/(in\.)?xero\.com\//;
function membershipPanel(r,ctx){
  const inv=(ctx.invoices||[]).find(x=>String(x.id)===String(r.item_id));
  if(!inv)return {body:para(esc('This invoice could not be read. It may have been paid already; the next refresh says.')),
    actions:link('organisations.html','Open Accounts','payments')};
  const n=r.kind==='membership_unpaid'&&!isNaN(Number(r.status))?Number(r.status):clockDay(inv,ctx.today||todayIn());
  const what=[inv.xero_invoice_number,amount(inv.amount,inv.currency),inv.period==='monthly'?'Monthly':'Yearly',
    inv.invoice_date?'raised '+day(inv.invoice_date):''].filter(Boolean).join(', ');
  const sent=[inv.reminder_7_at?`day 7 (${day(inv.reminder_7_at)})`:'',inv.reminder_12_at?`day 12 (${day(inv.reminder_12_at)})`:''].filter(Boolean);
  const rows=[['Invoice',esc(what)]];
  if(r.kind==='invoice_not_raised')rows.push(['Xero said',esc([inv.last_error||'No reason recorded',inv.last_error_at?day(inv.last_error_at):''].filter(Boolean).join(', '))]);
  else{
    rows.push(['Reminders',esc(sent.length?'Sent on '+sent.join(' and '):'None yet')]);
    if(inv.hidden_at&&!inv.restored_at)rows.push(['Hidden since',esc(day(inv.hidden_at))]);
    else if(inv.extended_to||inv.hide_on)rows.push(['Hides on',esc(day(inv.extended_to||inv.hide_on)+', unless paid')]);
  }
  return {body:(r.kind==='invoice_not_raised'||n==null?'':clockHtml(inv,n))+kv(rows)
      +para('Record payment and Extend the clock are on Accounts until Money ships.'),
    actions:link('organisations.html','Open Accounts','payments')+(XERO.test(String(inv.xero_online_url||''))?link(inv.xero_online_url,'Open in Xero','open_in_new','quiet'):'')};
}

function unpaidIntroPanel(r){
  const b=String(r.board||'');
  return {body:para('Record commission is on the hub’s board until Money ships.'),
    actions:SAFE_BOARD.test(b)?link(b,boardLabel(b),'open_in_new'):''};
}

function retentionPanel(r,ctx){
  return {body:para('The records may now be erased.'),
    actions:ctx.account?btn('jobAccount','Erase the records','auto_delete',{key:r.item_key,what:'erase'},'danger')
      :link(companyHref(r),'Open the company page','open_in_new')};
}

function failedRunPanel(r,ctx){
  const steps=(ctx.steps||[]).filter(s=>String(s.run_id)===String(r.item_id)).sort((a,b)=>a.seq-b.seq);
  const bad=steps.filter(s=>s.status==='failed').pop()||steps[steps.length-1];
  return {body:bad?kv([['Failing step',esc(bad.name)],['Detail',esc(bad.detail||'No detail recorded')]]):para('No step of this run was recorded.'),
    actions:link('system.html','Open System','monitor_heart','primary')};
}

function registrationPanel(r){
  const b=String(r.board||'');
  return {body:para('The account exists only once the link in the email is clicked.'),
    actions:link(SAFE_BOARD.test(b)&&!/^inbox\.html/.test(b)?b:'contacts.html?view=people&portal=portal','Open Contacts','contacts')};
}

function hostApplicationPanel(){
  return {body:para('This came through the old host form, which files nothing new. A site now lists itself from its account page.')};
}

/* One job's panel: the panel's own body, then a failed intent above the
   buttons (never instead of them), then the buttons, or the queued line
   in their place, then the inline choice that is open. Not now is offered
   on every notNow kind. */
function body(r,ctx){
  const c=ctx||{};
  use(c);
  const k=KINDS[r.kind];
  if(!k||!k.panel){
    const href=hrefOf(r);
    return `<div class="dbody">${para('Decided on its own page.')}</div>${href?`<div class="actions">${link(href,boardLabel(href),'open_in_new')}</div>`:''}`;
  }
  const p=k.panel(r,c)||{};
  const keys=[p.intent,k.notNow?'nn:'+r.item_key:null].filter(Boolean);
  const qs=keys.map(x=>(c.pending||{})[x]).filter(Boolean);
  const queued=qs.find(q=>q.status!=='failed');
  const fails=qs.filter(q=>q.status==='failed').map(failLine).join('');
  let actions=p.actions||'';
  if(k.notNow&&!p.ownNotNow)actions+=btn('jobOpen','Not now','',{key:r.item_key,ui:'nn'},'quiet');
  let ui=queued?'':(p.choice||'');
  if(!queued&&k.notNow&&isOpen(c,'nn',r)){
    const nn=p.notNow||{ask:'Not now. Why?',go:'Not now'};
    ui+=choice(esc(nn.ask),input(fid('jb-why',r),'Reason, kept with the card')+btn('jobNotNow',nn.go,'',{key:r.item_key},'primary')+cancel());
  }
  return `<div class="dbody">${p.body||''}</div>${fails}${queued?`<div class="actions">${QUEUED}</div>`:actions?`<div class="actions">${actions}</div>`:''}${ui}`;
}
/* The job as Needs you shows it: its group, label, line and age above the panel. */
function item(r,ctx){
  const k=kindOf(r),key=r.item_key||'';
  return `<div class="ditem${ctx&&ctx.flash&&ctx.flash===key?' focus':''}" id="job-${esc(domId(key))}"><div class="ditem-top"><div class="co" style="gap:6px"><span class="ditem-meta"><span class="gtag ${esc(k.group)}">${
    esc(GROUP_TAG[k.group]||k.group)}</span><span>${esc(k.label)}</span></span><span class="ditem-title">${esc(lineOf(r))}</span></div><span class="st num">${
    esc(ageText(r.age_hours))}</span></div>${body(r,ctx)}</div>`;
}

/* ── The decisions ────────────────────────────────────────────────────── */

const rowOf=(el,ctx)=>((ctx&&ctx.rows)||[]).find(r=>r.item_key===el.dataset.key)||null;
const spot=r=>'job:'+r.item_key;
const ACT={
  jobOpen(el,ctx){ctx.open(`job:${el.dataset.ui}:${el.dataset.key}`);},
  jobClose(el,ctx){ctx.close();},
  jobRetry(el,ctx){if(ctx.retry)return ctx.retry(el.dataset.intent);},
  jobAccount(el,ctx){const r=rowOf(el,ctx);if(r&&ctx.account)ctx.account(el.dataset.what,r.org_id||r.item_id);},
  jobApproveListing(el,ctx){
    const r=rowOf(el,ctx);if(!r)return;
    return ctx.raise('approve-listing',{listing_id:r.item_id},spot(r),'Approved');
  },
  jobDeclineListing(el,ctx){
    const r=rowOf(el,ctx);if(!r)return;
    const note=ctx.val(fid('jb-note',r)).trim();
    if(!note)return ctx.need(fid('jb-note',r),'Say what needs changing: the host is sent the note.');
    return ctx.raise('decline-listing',{listing_id:r.item_id,note},spot(r),'Declined');
  },
  jobApproveChange(el,ctx){
    const r=rowOf(el,ctx);if(!r)return;
    return ctx.raise('approve-listing-revision',{listing_id:r.item_id},spot(r),'Change approved');
  },
  jobDeclineChange(el,ctx){
    const r=rowOf(el,ctx);if(!r)return;
    const note=ctx.val(fid('jb-note',r)).trim();
    if(!note)return ctx.need(fid('jb-note',r),'Say what needs changing: the host is sent the note.');
    return ctx.raise('decline-listing-revision',{listing_id:r.item_id,note},spot(r),'Change declined');
  },
  jobIntroduce(el,ctx){
    const r=rowOf(el,ctx);if(!r||!el.dataset.listing)return;
    return ctx.raise('add-provider',{request_id:Number(r.item_id),listing_id:el.dataset.listing},spot(r),'Introduced');
  },
  jobDeclineRequest(el,ctx){
    const r=rowOf(el,ctx);if(!r)return;
    const reason=ctx.val(fid('jb-note',r)).trim();
    if(!reason)return ctx.need(fid('jb-note',r),'Give a reason: every declined request keeps one on the record.');
    return ctx.raise('decline-intro-request',{request_id:Number(r.item_id),reason},spot(r),'Declined');
  },
  jobReroute(el,ctx){
    const r=rowOf(el,ctx);if(!r||!el.dataset.listing)return;
    return ctx.raise('reroute-introduction',{introduction_id:Number(r.item_id),listing_id:el.dataset.listing},spot(r),'Re-routed');
  },
  jobRerouteTo(el,ctx){
    const r=rowOf(el,ctx);if(!r)return;
    const listing=ctx.val(fid('jb-site',r));
    if(!listing)return ctx.need(fid('jb-site',r),'Choose the site to re-route to first.');
    return ctx.raise('reroute-introduction',{introduction_id:Number(r.item_id),listing_id:listing},spot(r),'Re-routed');
  },
  /* reissue-acceptance (plan 067): stage back to awaiting_acceptance, the
     provider_notified_at stamp cleared and the offer emailed again with a
     fresh 14-day window; nothing else changes (handlers._reissue_acceptance). */
  jobResend(el,ctx){
    const r=rowOf(el,ctx);if(!r)return;
    return ctx.raise('reissue-acceptance',{introduction_id:Number(r.item_id)},spot(r),'Offer sent again');
  },
  jobSendNow(el,ctx){
    const r=rowOf(el,ctx);if(!r)return;
    return ctx.raise('reissue-acceptance',{introduction_id:Number(r.item_id)},spot(r),'Offer sent');
  },
  jobSettle(el,ctx){
    const r=rowOf(el,ctx);if(!r)return;
    const [kind,id]=String(r.item_id||'').split(':');
    const resolution=el.dataset.res==='upheld'?'upheld':'dismissed';
    const note=ctx.val(fid('jb-note',r)).trim();
    return ctx.raise('resolve-dispute',{kind,id:Number(id),resolution,note},spot(r),resolution==='upheld'?'Seeker’s figure used':'Host’s figure kept');
  },
  jobMatch(el,ctx){
    const r=rowOf(el,ctx);if(!r)return;
    const intro=ctx.val(fid('jb-intro',r));
    if(!intro)return ctx.need(fid('jb-intro',r),'Choose the introduction this email belongs to first.');
    return ctx.raise('match-order-evidence',{evidence_id:Number(r.item_id),introduction_id:Number(intro)},spot(r),'Matched');
  },
  jobNotAnOrder(el,ctx){
    const r=rowOf(el,ctx);if(!r)return;
    return ctx.raise('match-order-evidence',{evidence_id:Number(r.item_id),introduction_id:null},spot(r),'Marked not an introduction order');
  },
  jobEducation(el,ctx){
    const r=rowOf(el,ctx);if(!r)return;
    if(el.dataset.status==='approved')return ctx.raise('review-web-request',{request_id:Number(r.item_id),status:'approved'},spot(r),'Approved');
    const reason=ctx.val(fid('jb-note',r)).trim();
    if(!reason)return ctx.need(fid('jb-note',r),'Give a reason: every declined request keeps one on the record.');
    return ctx.raise('review-web-request',{request_id:Number(r.item_id),status:'declined',reason},spot(r),'Declined');
  },
  /* Not now (D4): the card leaves the queue for Done today with Put back, and
     comes back by itself when the job changes (its key carries the state). */
  jobNotNow(el,ctx){
    const r=rowOf(el,ctx);if(!r)return;
    const reason=ctx.val(fid('jb-why',r)).trim();
    if(!reason)return ctx.need(fid('jb-why',r),'Say why: the next person needs the reason.');
    const kept=r.kind==='flagged_host';
    return ctx.raise('dismiss-inbox-item',{item_key:r.item_key,kind:r.kind,reason},spot(r),kept?'Kept live':'Put off',
      kept?'Kept live: set aside below':'Not now: set aside below');
  },
};

/* ── Our tasks (D3): one list, shared, each signed with who added it ──── */

const TASK_TYPES=['add-task','edit-task','done-task'];
function sundayOf(today){
  const d=new Date(today+'T12:00:00Z');
  d.setUTCDate(d.getUTCDate()+((7-d.getUTCDay())%7));
  return d.toISOString().slice(0,10);
}
/* Overdue, Today, This week (to Sunday), Later; a task with no date is Later. */
function dueBucket(due,today){
  if(!due)return 'Later';
  if(due<today)return 'Overdue';
  if(due===today)return 'Today';
  if(due<=sundayOf(today))return 'This week';
  return 'Later';
}
function dueText(due){
  if(!due)return 'No date';
  const d=new Date(due+'T12:00:00Z');
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()]+' '+d.getUTCDate()+' '+MONTHS[d.getUTCMonth()];
}
const BUCKETS=['Overdue','Today','This week','Later'];
const todayIn=now=>(london(now||new Date())||{}).iso;
const coOf=(ctx,id)=>id==null?null:((ctx.companies||{})[id]||null);
function companyField(ctx,id,value){
  const names=(ctx.companyList||[]).map(c=>`<option value="${esc(c.name)}"></option>`).join('');
  return `<label class="sr" for="${id}">Company</label><input class="input" id="${id}" list="${id}-list" placeholder="Company, if there is one" value="${esc(value||'')}" autocomplete="off"><datalist id="${id}-list">${names}</datalist>`;
}
/* Add task, asked in place: what needs doing, the company (typed, with the
   names from Contacts to pick from) unless the page presets it, the due date. */
function taskForm(ctx,t,o){
  const opt=o||{}, f=opt.form||(t?'te-'+t.id:'tk');
  const co=t?coOf(ctx,t.company_id):null;
  return `<div class="inline-choice">${input(f+'-title','What needs doing, for example: call about pricing',t?t.title:'')}${
    opt.companyId==null?companyField(ctx,f+'-co',co?co.name:''):''}<label class="sr" for="${f}-due">Due</label><input class="input" type="date" id="${f}-due" value="${esc(t?t.due_on||'':'')}">${
    t?btn('taskSave','Save the task','',{task:t.id,form:f},'primary'):btn('taskAdd','Add task','',{form:f,company:opt.companyId==null?'':opt.companyId},'primary')}${
    btn('taskClose','Cancel','',{},'quiet')}</div>`;
}
/* canEdit false where the page has no list of companies to move a task to (the company page). */
function taskRow(t,ctx,showCo,canEdit){
  const b=dueBucket(t.due_on,ctx.today||todayIn()), q=(ctx.pending||{})['task:'+t.id];
  const failed=!!q&&q.status==='failed', queued=!!q&&!failed;
  const co=coOf(ctx,t.company_id);
  const due=b==='Overdue'?`<span class="late">Overdue, ${esc(dueText(t.due_on))}</span>`:`<span>${esc(b==='Today'?'Today':dueText(t.due_on))}</span>`;
  const meta=due+(showCo&&co?`<a class="linkish" href="company.html?id=${esc(co.id)}">${esc(co.name)}</a>`:'')+`<span>${esc(personOf(t.created_by))}</span>`
    +(queued?'<span class="status-line">Queued</span>':'');
  const tick=queued?`<span class="tick on" aria-hidden="true">${ms('check')}</span>`
    :`<button type="button" class="tick" data-act="taskDone" data-task="${esc(t.id)}" aria-label="Mark done: ${esc(t.title)}">${ms('check')}</button>`;
  const editing=!!(ctx.ui&&ctx.ui.open==='task:edit:'+t.id);
  return `<div class="task-row" id="task-${esc(t.id)}">${tick}<div class="task-main"><span class="task-text">${esc(t.title)}</span><span class="task-meta">${meta}</span>${
    failed?failLine(q):''}${editing?taskForm(ctx,t):''}</div>${queued||editing||canEdit===false?'':btn('taskEdit','Edit','',{task:t.id},'quiet')}</div>`;
}
function findCompany(ctx,typed){
  const t=String(typed||'').trim().toLowerCase();
  return (ctx.companyList||[]).find(c=>String(c.name).trim().toLowerCase()===t)||null;
}
const taskOf=(el,ctx)=>((ctx.tasks||[]).find(t=>String(t.id)===String(el.dataset.task)))||null;
Object.assign(ACT,{
  taskOpen(el,ctx){ctx.open('task:add'+(el.dataset.form?':'+el.dataset.form:''));},
  taskClose(el,ctx){ctx.close();},
  taskEdit(el,ctx){ctx.open('task:edit:'+el.dataset.task);},
  taskAdd(el,ctx){
    const f=el.dataset.form||'tk';
    const title=ctx.val(f+'-title').trim();
    if(!title)return ctx.need(f+'-title','Say what needs doing first.');
    if(title.length>300)return ctx.need(f+'-title','A task’s title can be at most 300 characters.');
    let company_id=el.dataset.company!=null&&el.dataset.company!==''?Number(el.dataset.company):null;
    if(company_id==null){
      const typed=ctx.val(f+'-co').trim();
      if(typed){
        const co=findCompany(ctx,typed);
        if(!co)return ctx.need(f+'-co',`No company in Contacts is called ${typed}: pick one from the list, or leave it empty.`);
        company_id=co.id;
      }
    }
    const due_on=ctx.val(f+'-due').trim()||null;
    return ctx.raise('add-task',{title,company_id,due_on},'tasks','Task added');
  },
  taskSave(el,ctx){
    const t=taskOf(el,ctx);if(!t)return;
    const f=el.dataset.form||'tk';
    const title=ctx.val(f+'-title').trim();
    if(!title)return ctx.need(f+'-title','Say what needs doing.');
    if(title.length>300)return ctx.need(f+'-title','A task’s title can be at most 300 characters.');
    const typed=ctx.val(f+'-co').trim(), due_on=ctx.val(f+'-due').trim()||null;
    /* The company as it is (archived since, perhaps): the handler keeps it
       without a lookup when the edit does not name it. */
    const was=coOf(ctx,t.company_id);
    if(was?typed.toLowerCase()===String(was.name).trim().toLowerCase():!typed)
      return ctx.raise('edit-task',{task_id:t.id,title,due_on},'task:'+t.id,'Task saved');
    const co=typed?findCompany(ctx,typed):null;
    if(typed&&!co)return ctx.need(f+'-co',`No company in Contacts is called ${typed}: pick one from the list, or leave it empty.`);
    const company_id=co?co.id:null;
    return ctx.raise('edit-task',{task_id:t.id,title,due_on,company_id},'task:'+t.id,'Task saved');
  },
  taskDone(el,ctx){
    const t=taskOf(el,ctx);if(!t)return;
    return ctx.raise('done-task',{task_id:t.id,done:true},'task:'+t.id,'Task done');
  },
  taskPutBack(el,ctx){
    const t=taskOf(el,ctx);if(!t)return;
    return ctx.raise('done-task',{task_id:t.id,done:false},'task:'+t.id,'Task put back');
  },
});

/* ── The intents: which job each belongs to, and Done today's words ─────── */

const TYPES=['approve-listing','decline-listing','approve-listing-revision','decline-listing-revision',
  'add-provider','decline-intro-request','reroute-introduction','reissue-acceptance',
  'resolve-dispute','match-order-evidence','review-web-request','dismiss-inbox-item'];
const LISTING_TYPES=TYPES.slice(0,4);
/* The key a job looks its newest open intent up by (the page reduces the
   intents newest-wins, then calls this for each). */
function intentKey(i){
  const p=i.payload_json||{};
  if(LISTING_TYPES.includes(i.type))return 'listing:'+p.listing_id;
  if(i.type==='add-provider'||i.type==='decline-intro-request')return 'seeker:'+p.request_id;
  if(i.type==='reroute-introduction'||i.type==='reissue-acceptance')return 'intro:'+p.introduction_id;
  if(i.type==='resolve-dispute')return `dispute:${p.kind}:${p.id}`;
  if(i.type==='match-order-evidence')return 'evidence:'+p.evidence_id;
  if(i.type==='review-web-request')return 'web:'+p.request_id;
  if(i.type==='dismiss-inbox-item'||i.type==='restore-inbox-item')return 'nn:'+p.item_key;
  if(i.type==='edit-task'||i.type==='done-task')return 'task:'+p.task_id;
  if(i.type==='add-task')return 'add:'+String(p.title||'').trim().toLowerCase();
  if(i.type==='tick-task')return 'tick:'+(p.source||'')+'\u0001'+(p.task||'');
  if(i.type==='rerun-job')return 'rerun:'+p.job;
  return null;
}
const DONE_WORDS={
  'approve-listing':['approve','Listing approved'],
  'decline-listing':['approve','Listing declined'],
  'approve-listing-revision':['approve','Listing change approved'],
  'decline-listing-revision':['approve','Listing change declined'],
  'add-provider':['waiting','Introduced by hand'],
  'decline-intro-request':['waiting','Request declined'],
  'reroute-introduction':['waiting','Offer re-routed'],
  'reissue-acceptance':['waiting','Offer sent'],
  'review-web-request':['waiting',p=>p.status==='approved'?'Request approved':p.status==='declined'?'Request declined':'Request marked reviewing'],
  'resolve-dispute':['problem',p=>p.resolution==='upheld'?'Dispute: the seeker’s figure used':'Dispute: the host’s figure kept'],
  'match-order-evidence':['problem',p=>p.introduction_id==null?'Marked not an introduction order':'Order email matched'],
  'dismiss-inbox-item':[p=>(KINDS[p.kind]||{}).group||null,p=>(p.kind==='flagged_host'?'Kept live: ':'Not now: ')+(p.reason||'no reason given')],
  'tick-task':[null,p=>'Workspace task ticked: '+(p.task||'')],
  'done-task':[null,(p,o)=>{const t=o&&o.taskTitle?o.taskTitle(p.task_id):'';return (p.done?'Task done':'Task put back')+(t?': '+t:'');}],
  'rerun-job':['problem',p=>'Re-run asked for: '+(p.job||'a job')],
};
/* `opt.taskTitle(id)` names a task the page has read. */
function doneWords(i,opt){
  const p=i.payload_json||{}, w=DONE_WORDS[i.type];
  if(!w)return {group:null,label:humanise(i.type),notNow:false};
  return {group:typeof w[0]==='function'?w[0](p):w[0],label:typeof w[1]==='function'?w[1](p,opt):w[1],notNow:i.type==='dismiss-inbox-item'};
}

/* ── What the panels read ─────────────────────────────────────────────── */

/* The rows the panels need for the jobs given, each table once. A read that
   fails says so in `problems` and leaves the rest standing. `opt.orgIds`
   are the company's accounts (their introductions are what an unmatched
   email can be matched to); with none, every live introduction is offered. */
async function read(sb,rows,opt){
  const o=opt||{};
  const out={listings:[],revisions:{},machines:{},requests:[],introductions:[],orgs:{},evidence:[],lines:[],declarations:[],
    strikes:[],vocab:{},searches:{},web:[],steps:[],links:{},matchIntros:[],invoices:[],problems:[]};
  const none=Promise.resolve({data:[],error:null});
  const got=(what,q)=>{if(q&&q.error)out.problems.push(`Could not read ${what}: ${q.error.message}.`);return (q&&q.data)||[];};
  const of=(...kinds)=>(rows||[]).filter(r=>kinds.includes(r.kind));
  const uniq=a=>[...new Set(a.filter(v=>v!=null&&v!==''&&!(typeof v==='number'&&isNaN(v))))];
  const idAfter=(r,prefix)=>Number(String(r.item_id||'').slice(prefix.length));
  const listingIds=uniq(of('listing','listing_change').map(r=>r.item_id));
  const reqIds=uniq(of('seeker_request').map(r=>Number(r.item_id)));
  const introIds=uniq(of('reroute','introduction').map(r=>Number(r.item_id)));
  const lineIds=uniq(of('dispute').filter(r=>/^line:/.test(r.item_id)).map(r=>idAfter(r,'line:')));
  const evIds=uniq([...of('dispute').filter(r=>/^evidence:/.test(r.item_id)).map(r=>idAfter(r,'evidence:')),...of('unmatched_email').map(r=>Number(r.item_id))]);
  const eduIds=uniq(of('education').map(r=>Number(r.item_id)));
  const runIds=uniq(of('failed_run').map(r=>String(r.item_id)));
  const flagged=uniq(of('flagged_host').map(r=>r.org_id||r.item_id));
  const orgIds=uniq(of('retention').map(r=>r.org_id||r.item_id));
  const invIds=uniq(of('membership_unpaid','listing_hidden','invoice_not_raised').map(r=>Number(r.item_id)));
  const words=listingIds.length||reqIds.length||introIds.length;

  const [vq,lq,rq,iq,dlq,eq,wq,sq,kq,mq]=await Promise.all([
    words?sb.from('vocab_terms').select('kind,term,label'):none,
    listingIds.length?sb.from('listings').select('*').in('id',listingIds):none,
    reqIds.length?sb.from('seeker_requests').select('*').in('id',reqIds):none,
    introIds.length?sb.from('introductions').select('*').in('id',introIds):none,
    lineIds.length?sb.from('declaration_lines').select('*').in('id',lineIds):none,
    evIds.length?sb.from('order_evidence').select('*').in('id',evIds):none,
    eduIds.length?sb.from('web_requests').select('*').in('id',eduIds):none,
    runIds.length?sb.from('engine_steps').select('run_id,seq,name,status,detail').in('run_id',runIds):none,
    flagged.length?sb.from('strikes').select('*').in('org_id',flagged):none,
    invIds.length?sb.from('membership_invoices').select('id,org_id,period,amount,currency,xero_invoice_number,xero_online_url,invoice_date,invoiced_at,clock_start,hide_on,reminder_7_at,reminder_12_at,hidden_at,restored_at,extended_to,paid_at,voided_at,last_error,last_error_at').in('id',invIds):none,
  ]);
  got('the vocabulary',vq).forEach(v=>{(out.vocab[v.kind]=out.vocab[v.kind]||{})[v.term]=v.label;});
  out.listings=got('the listings',lq);
  out.requests=got('the requests',rq);
  out.introductions=got('the introductions',iq);
  out.lines=got('the disputed lines',dlq);
  out.evidence=got('the order emails',eq);
  out.web=got('the sign-ups',wq);
  out.steps=got('the failed runs',sq);
  out.strikes=got('the strikes',kq);
  out.invoices=got('the membership invoices',mq);

  /* Second: the requests behind the spent offers, every offer on each
     request (for the successor and what is already taken), the live sites
     on those hubs, and the declarations, introductions and order emails
     behind the disputed lines. */
  const allReqIds=uniq([...reqIds,...out.introductions.filter(i=>/^(declined|expired)$/.test(i.stage)).map(i=>i.seeker_request_id)]);
  const lineIntroIds=uniq(out.lines.map(l=>l.introduction_id));
  const declIds=uniq(out.lines.map(l=>l.declaration_id));
  const moreReqIds=allReqIds.filter(id=>!out.requests.some(r=>r.id===id));
  const [mrq,oiq,dq,liq,leq]=await Promise.all([
    moreReqIds.length?sb.from('seeker_requests').select('*').in('id',moreReqIds):none,
    allReqIds.length?sb.from('introductions').select('*').in('seeker_request_id',allReqIds):none,
    declIds.length?sb.from('declarations').select('*').in('id',declIds):none,
    lineIntroIds.length?sb.from('introductions').select('*').in('id',lineIntroIds):none,
    lineIntroIds.length?sb.from('order_evidence').select('*').in('introduction_id',lineIntroIds):none,
  ]);
  out.requests=out.requests.concat(got('the requests',mrq));
  const seen=new Set(out.introductions.map(i=>i.id));
  [...got('the offers on each request',oiq),...got('the introductions',liq)].forEach(i=>{if(!seen.has(i.id)){seen.add(i.id);out.introductions.push(i);}});
  out.declarations=got('the declarations',dq);
  const seenEv=new Set(out.evidence.map(e=>e.id));
  got('the order emails',leq).forEach(e=>{if(!seenEv.has(e.id)){seenEv.add(e.id);out.evidence.push(e);}});
  const hubs=uniq(out.requests.filter(r=>allReqIds.includes(r.id)).map(r=>r.hub));
  const searchIds=uniq(out.requests.map(r=>r.search_id));
  const unmatched=of('unmatched_email');
  const [cq,hq,mq1,mq2]=await Promise.all([
    hubs.length?sb.from('listings').select('*').in('hub',hubs).eq('status','live').order('created_at',{ascending:false}):none,
    searchIds.length?sb.from('hub_searches').select('id,ranked,named_org_ids').in('id',searchIds):none,
    unmatched.length?(o.orgIds&&o.orgIds.length?sb.from('introductions').select('id,ref,hub,org_a,org_b,stage').in('org_a',o.orgIds)
      :sb.from('introductions').select('id,ref,hub,org_a,org_b,stage').neq('stage','dead').order('id',{ascending:false}).limit(1000)):none,
    unmatched.length&&o.orgIds&&o.orgIds.length?sb.from('introductions').select('id,ref,hub,org_a,org_b,stage').in('org_b',o.orgIds):none,
  ]);
  const seenL=new Set(out.listings.map(l=>String(l.id)));
  got('the live sites',cq).forEach(l=>{if(!seenL.has(String(l.id))){seenL.add(String(l.id));out.listings.push(l);}});
  if(hq&&hq.error)out.problems.push(`Could not read the hub searches: ${hq.error.message}. Re-routing offers the list of sites only.`);
  ((hq&&hq.data)||[]).forEach(s=>{out.searches[s.id]=s;});
  const seenM=new Set();
  [...got('the introductions to match to',mq1),...got('the introductions to match to',mq2)].forEach(i=>{
    if(!seenM.has(i.id)&&i.stage!=='dead'){seenM.add(i.id);out.matchIntros.push(i);}});

  /* Last: the revisions and machines of every listing, the accounts every
     row names, and Outlook's links for the order emails shown. */
  const revIds=uniq(out.listings.flatMap(l=>[l.live_revision_id,l.pending_revision_id]));
  const allOrgs=uniq([...orgIds,...flagged,...out.listings.map(l=>l.org_id),...out.requests.map(r=>r.org_id),
    ...out.introductions.flatMap(i=>[i.org_a,i.org_b]),...out.matchIntros.flatMap(i=>[i.org_a,i.org_b]),
    ...out.declarations.map(d=>d.org_id),...out.evidence.flatMap(e=>[e.org_provider,e.org_seeker])]);
  const msgIds=uniq(out.evidence.map(e=>e.internet_message_id));
  const [rvq,mcq,orq,xq]=await Promise.all([
    revIds.length?sb.from('listing_revisions').select('*').in('id',revIds):none,
    revIds.length?sb.from('listing_machines').select('*').in('revision_id',revIds).order('position',{ascending:true}):none,
    allOrgs.length?sb.from('organisations').select('id,name,hidden_at,removed_at,sub_status,sub_period,sub_due_at,sub_rate_gbp').in('id',allOrgs):none,
    msgIds.length?sb.from('crm_email_index').select('internet_message_id,web_links').in('internet_message_id',msgIds):none,
  ]);
  got('the listing revisions',rvq).forEach(r=>{out.revisions[r.id]=r;});
  got('the machines',mcq).forEach(m=>{(out.machines[m.revision_id]=out.machines[m.revision_id]||[]).push(m);});
  got('the accounts',orq).forEach(x=>{out.orgs[x.id]=x;});
  ((xq&&xq.data)||[]).forEach(x=>{if(x.internet_message_id)out.links[x.internet_message_id]=x.web_links||{};});
  return out;
}

window.NXJOBS={GROUPS,KINDS,TYPES,TASK_TYPES,BUCKETS,kindOf,lineOf,ageText,day,sentence,clockHtml,clockDay,boardLabel,runTime,hubName,hrefOf,inPlace,domId,
  read,use,body,item,ACT,intentKey,doneWords,london,todayIn,dueBucket,dueText,sundayOf,taskRow,taskForm,
  humanise,lab,fmtVal,revisionDiff,machineDiff,mixesNoReview,diffTable,submittedTable,machineLines,needLines,
  shipsTo,shipsToUnset,capacityOf,successorOf,rerouteControl,partyGuess,
  SPENT_STAGES,REISSUABLE_STAGES,REV_FIELDS,KIND_OF,CADENCE_LABEL};
})();
