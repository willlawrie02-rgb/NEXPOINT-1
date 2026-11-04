/* Plan 079, Phase 2: the CRM saves first. A press changes the record at once,
   through a crm_* function (migration 0091), and the engine follows up from the
   records. One switch, crm_settings.direct_writes, returns every page to the
   intent route; off is the default, and a page that cannot read it stays off.

   Loaded after crm-shell.js as <script src="save.js?v=079">: shared admin files
   are cached in browsers for up to four hours, so bump ?v= on every later change.

   One global, NXSAVE. A page's raise asks direct(type), and then press(): true
   saved, false refused (the form stays open), null take the intent route, which
   with the switch off the page reaches exactly as it always has. FUNCTIONS is a
   literal because the tests read it: boards.PAGE_RPCS, the migration and this
   map are held equal. Anything with an outside effect is not here and never
   will be (D7): it stays an intent. */
(function () {
  'use strict';
  const FUNCTIONS = {
    'edit-company': 'crm_edit_company',
    'tag-company': 'crm_tag_company',
    'add-person': 'crm_add_person',
    'edit-person': 'crm_edit_person',
    'add-site': 'crm_add_site',
    'edit-site': 'crm_edit_site',
    'add-card': 'crm_add_card',
    'edit-card': 'crm_edit_card',
    'move-card': 'crm_move_card',
    'set-card-next': 'crm_set_card_next',
    'mark-card-dead': 'crm_mark_card_dead',
    'revive-card': 'crm_revive_card',
    'link-card-site': 'crm_link_card_site',
    'add-task': 'crm_add_task',
    'edit-task': 'crm_edit_task',
    'done-task': 'crm_done_task',
    'add-prospect-option': 'crm_add_prospect_option',
  };
  /* The function is not there: 0091 has not been applied, or the cache has not caught up. */
  const MISSING = ['PGRST202', '42883'];
  const REFUSAL = 'P0001';
  /* A stalled connection must not hold the lock for ever. */
  const NO_ANSWER_MS = 30000;

  let on = false, busy = false;

  /* The rows of crm_settings a page read. Anything but a row saying on is off. */
  function use(rows) {
    on = (rows || []).some((r) => r.key === 'direct_writes' && r.value === 'on');
  }
  const moved = (type) => Object.prototype.hasOwnProperty.call(FUNCTIONS, type);
  const direct = (type) => on && moved(type);

  /* The intents a page should show. A failed row is cleared by a newer done row
     for the same key, and with the switch on the direct route writes none, so
     its Failed line would stay however often the thing was then saved. Read off
     the page, it stays in the table; switched off, the page shows it again. */
  const live = (rows) => (on ? (rows || []).filter((i) => !(i.status === 'failed' && moved(i.type))) : rows || []);

  /* {ok}, or {missing}, or {error} with a sentence for a person. Only a missing
     function falls back to the intent: a timeout may have committed, and an
     intent on top of it would do the thing twice. */
  async function save(sb, type, payload) {
    let answer, timer;
    try {
      const late = new Promise((resolve) => {
        timer = setTimeout(() => resolve({ error: { message: 'no answer after 30 seconds' } }), NO_ANSWER_MS);
      });
      answer = await Promise.race([sb.rpc(FUNCTIONS[type], { p: payload }), late]);
    } catch (e) {
      answer = { error: { message: String((e && e.message) || e) } };
    }
    clearTimeout(timer);
    const error = answer.error;
    if (!error) return { ok: true, data: answer.data };
    if (MISSING.includes(error.code)) return { missing: true };
    const said = String(error.message || 'no reason given');
    if (error.code === REFUSAL) return { error: `Not saved: ${said.replace(/^crm(_[a-z_]+)?: /, '')}.` };
    return { error: `It may not have saved (${said}). Reload the page to see where it stands before pressing again.` };
  }

  /* A press through the direct route. `saved` closes the form and reloads. The
     placeholder row that guarded a double press belongs to the intent route, so
     here one press at a time is the guard, until the page has reloaded: the form
     is still there to press between the answer and the render. */
  async function press(sb, type, payload, saved) {
    if (busy) {
      NXShell.toast('Still saving the last change; one moment.');
      return false;
    }
    busy = true;
    try {
      const answer = await save(sb, type, payload);
      if (answer.missing) return null;
      if (answer.error) {
        NXShell.toast(answer.error);
        return false;
      }
      NXShell.toast('Saved');
      await saved();
      return true;
    } finally {
      busy = false;
    }
  }

  window.NXSAVE = { FUNCTIONS, use, direct, live, save, press };
})();
