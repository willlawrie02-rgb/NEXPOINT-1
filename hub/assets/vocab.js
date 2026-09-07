/* NexPoint Global Hub: the shared vocabulary (spec 2026-09-03).
   One list of materials, processes, services, machines and regions, so the
   listing form and the find form offer the same words and store the same
   terms. The worker owns the list (`/vocab`, `/attributes`); the seed below
   is the same data as migration 0031, kept here so a page still renders a
   full set of choices when the routes are not deployed yet or the network
   drops. Terms are canonical: never invent one here that the migration does
   not have, or a listing and a search will stop matching. */
(function () {
  'use strict';

  const API_BASE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? 'http://localhost:8787' : 'https://api.nexpoint.co.uk';

  /* ── the seed (migration 0031, verbatim terms and labels) ───────────── */

  const t = (term, label) => ({ term: term, label: label });

  /* regions are hub-agnostic */
  const REGIONS = [
    t('uk', 'UK'),
    t('ireland', 'Ireland'),
    t('europe', 'Europe'),
    t('north_america', 'North America'),
    t('south_america', 'South America'),
    t('middle_east', 'Middle East'),
    t('africa', 'Africa'),
    t('asia', 'Asia'),
    t('oceania', 'Oceania'),
    t('worldwide', 'Worldwide'),
  ];

  const MATERIALS = {
    print: [
      t('pa12_nylon12', 'PA12/Nylon 12'),
      t('pa11', 'PA11'),
      t('tpu', 'TPU'),
      t('pp', 'PP'),
      t('pa12_glass_filled', 'PA12 glass-filled'),
      t('resin_sla', 'resin (SLA)'),
      t('petg', 'PETG'),
      t('pla', 'PLA'),
      t('abs', 'ABS'),
      t('carbon_filled_nylon', 'carbon-filled nylon'),
    ],
    mill: [
      t('eva', 'EVA'),
      t('pp_sheet', 'PP sheet'),
      t('carbon_fibre', 'carbon fibre'),
      t('aluminium', 'aluminium'),
      t('titanium', 'titanium'),
      t('stainless', 'stainless'),
    ],
  };

  const PROCESSES = {
    print: [
      t('sls', 'SLS'),
      t('mjf', 'MJF'),
      t('fdm_fff', 'FDM/FFF'),
      t('sla', 'SLA'),
      t('dlp', 'DLP'),
    ],
    mill: [
      t('cnc_milling_3axis', 'CNC milling 3-axis'),
      t('cnc_milling_5axis', 'CNC milling 5-axis'),
      t('routing', 'routing'),
      t('laser_cutting', 'laser cutting'),
    ],
  };

  /* services are hub-agnostic */
  const SERVICES = [
    t('design_cad', 'design/CAD'),
    t('scan_processing', 'scan processing'),
    t('finishing_dyeing', 'finishing/dyeing'),
    t('assembly', 'assembly'),
    t('strapping_fitting', 'strapping/fitting'),
    t('kitting_packaging', 'kitting/packaging'),
    t('drop_ship', 'drop-ship'),
  ];

  const MACHINES = {
    print: [
      t('hp_mjf_5200', 'HP MJF 5200'),
      t('hp_mjf_4200', 'HP MJF 4200'),
      t('formlabs_fuse_1_plus', 'Formlabs Fuse 1+'),
      t('eos_p396', 'EOS P396'),
      t('sintratec_s2', 'Sintratec S2'),
      t('formlabs_form_4', 'Formlabs Form 4'),
      t('prusa_xl', 'Prusa XL'),
    ],
    mill: [
      t('cnc_router_3axis', '3-axis CNC router'),
      t('cnc_5axis', '5-axis CNC'),
      t('roland', 'Roland'),
      t('cutting_table', 'cutting table'),
      t('moulding_press', 'moulding press'),
    ],
  };

  /* Attribute definitions: the extra fields a listing or a machine row carries.
     `options: null` on a multiselect means the choices are free text. */
  const ATTRIBUTES = {
    listing: [
      { key: 'certifications', label: 'Certifications', type: 'multiselect',
        options: ['ISO 13485', 'ISO 9001', 'MDR'], required: false },
      { key: 'min_order_units', label: 'Minimum order units', type: 'number',
        options: null, required: false },
    ],
    machine: [
      { key: 'dye_colours', label: 'Dye colours', type: 'multiselect',
        options: null, required: false },
    ],
  };

  const KINDS = ['material', 'process', 'service', 'machine', 'region'];
  const APPLIES = ['listing', 'machine'];

  function seedFor(kind, hub) {
    if (kind === 'region') return REGIONS.slice();
    if (kind === 'service') return SERVICES.slice();
    if (kind === 'material') return (MATERIALS[hub] || []).slice();
    if (kind === 'process') return (PROCESSES[hub] || []).slice();
    if (kind === 'machine') return (MACHINES[hub] || []).slice();
    return [];
  }

  async function getJson(path) {
    let r;
    try { r = await fetch(API_BASE + path, { credentials: 'include' }); }
    catch (e) { return null; }
    if (!r.ok) return null;
    return r.json().catch(() => null);
  }

  /* One kind. A list that comes back empty is treated as "not deployed yet"
     rather than "nothing to offer": an empty type-ahead is a dead end, and the
     seed is honest about what the network actually works in. */
  async function loadKind(kind, hub) {
    const d = await getJson('/vocab?kind=' + encodeURIComponent(kind) + '&hub=' + encodeURIComponent(hub));
    if (!Array.isArray(d) || !d.length) return { terms: seedFor(kind, hub), source: 'seed' };
    const terms = d
      .filter((row) => row && row.term)
      .map((row) => t(String(row.term), String(row.label == null ? row.term : row.label)));
    return terms.length ? { terms: terms, source: 'api' } : { terms: seedFor(kind, hub), source: 'seed' };
  }

  /* The worker calls the shape field `kind`; every page calls it `type`, so
     one name wins here rather than in five call sites. */
  function normaliseAttr(row) {
    return {
      key: String(row.key),
      label: String(row.label == null ? row.key : row.label),
      type: String(row.type || row.kind || 'text'),
      options: Array.isArray(row.options) ? row.options.slice() : null,
      required: !!row.required,
      hint: row.hint == null ? '' : String(row.hint),
    };
  }

  async function loadAttrs(appliesTo, hub) {
    const d = await getJson('/attributes?hub=' + encodeURIComponent(hub) + '&applies_to=' + encodeURIComponent(appliesTo));
    if (!Array.isArray(d) || !d.length) {
      return { defs: ATTRIBUTES[appliesTo].map(normaliseAttr), source: 'seed' };
    }
    return { defs: d.filter((row) => row && row.key).map(normaliseAttr), source: 'api' };
  }

  const cache = {};

  /* NPVocab.load('print') → {regions, materials, processes, services, machines,
     attributes:{listing, machine}, source}. Resolves once per hub and is then
     handed back from cache, so several fields on one page share a single fetch. */
  function load(hub) {
    const key = hub === 'mill' ? 'mill' : 'print';
    if (cache[key]) return cache[key];
    cache[key] = Promise.all(
      KINDS.map((k) => loadKind(k, key)).concat(APPLIES.map((a) => loadAttrs(a, key)))
    ).then((parts) => {
      const byKind = {};
      KINDS.forEach((k, i) => { byKind[k] = parts[i]; });
      const attrs = {};
      APPLIES.forEach((a, i) => { attrs[a] = parts[KINDS.length + i]; });
      const sources = KINDS.map((k) => byKind[k].source).concat(APPLIES.map((a) => attrs[a].source));
      return {
        hub: key,
        regions: byKind.region.terms,
        materials: byKind.material.terms,
        processes: byKind.process.terms,
        services: byKind.service.terms,
        machines: byKind.machine.terms,
        attributes: { listing: attrs.listing.defs, machine: attrs.machine.defs },
        source: sources.every((s) => s === 'api') ? 'api'
          : sources.every((s) => s === 'seed') ? 'seed' : 'mixed',
      };
    });
    return cache[key];
  }

  /* Label for a stored term, so a saved listing reads in words even when the
     term has since left the live vocabulary. */
  function label(list, term) {
    const hit = (list || []).find((o) => o.term === term);
    return hit ? hit.label : String(term == null ? '' : term);
  }

  window.NPVocab = {
    load: load,
    label: label,
  };
})();
