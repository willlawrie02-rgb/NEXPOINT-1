/* NexPoint Global Hub: type-ahead (spec 2026-09-03).
   One input pattern for every vocabulary field: the shared list is offered,
   the person can still type their own words where the field allows it, and
   what leaves the field is always a list of terms.

   Built as an ARIA 1.2 combobox with a listbox popup: the input keeps focus
   throughout and the highlighted option is named by aria-activedescendant,
   so a screen reader hears the option without the caret ever leaving the
   field. Mouse, touch and keyboard reach the same code path.           */
(function () {
  'use strict';

  let seq = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* accepts ['a','b'] or [{term,label}] */
  function normalise(list) {
    return (list || []).map((o) => (typeof o === 'string'
      ? { term: o, label: o }
      : { term: String(o.term), label: String(o.label == null ? o.term : o.label) }));
  }

  function attach(input, opts) {
    if (!input || input.dataset.taOn) return null;
    const cfg = opts || {};
    const multi = !!cfg.multi;
    const allowFree = !!cfg.allowFree;
    const onChange = typeof cfg.onChange === 'function' ? cfg.onChange : function () {};
    const id = 'ta' + (++seq);

    let options = normalise(cfg.options);
    let chosen = [];          /* [{term,label}], always a list, even single-select */
    let open = false;
    let active = -1;          /* index into `shown` */
    let shown = [];

    /* ── structure ─────────────────────────────────────────────────── */
    const wrap = document.createElement('div');
    wrap.className = 'ta';
    input.parentNode.insertBefore(wrap, input);

    const chips = document.createElement('div');
    chips.className = 'ta-chips';
    chips.hidden = true;
    if (multi) wrap.appendChild(chips);
    wrap.appendChild(input);

    const list = document.createElement('ul');
    list.className = 'ta-list';
    list.id = id + '-list';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    wrap.appendChild(list);

    input.dataset.taOn = '1';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', list.id);
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'none');
    input.setAttribute('spellcheck', 'false');

    /* ── state ─────────────────────────────────────────────────────── */
    function values() { return chosen.map((o) => o.term); }
    function fire() { onChange(multi ? values() : (values()[0] || ''), chosen.slice()); }

    function has(term) { return chosen.some((o) => o.term === term); }

    function add(option) {
      if (!option || !option.term) return;
      if (has(option.term)) { closeList(); return; }
      if (multi) chosen.push(option); else chosen = [option];
      if (multi) { input.value = ''; } else { input.value = option.label; }
      renderChips();
      closeList();
      fire();
    }

    function remove(term) {
      chosen = chosen.filter((o) => o.term !== term);
      if (!multi) input.value = '';
      renderChips();
      fire();
    }

    function renderChips() {
      if (!multi) return;
      chips.hidden = !chosen.length;
      chips.innerHTML = chosen.map((o) =>
        '<span class="ta-chip">' + esc(o.label) +
        '<button type="button" data-ta-rm="' + esc(o.term) + '" aria-label="Remove ' + esc(o.label) + '">' +
        '<span aria-hidden="true">&times;</span></button></span>').join('');
    }

    chips.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ta-rm]');
      if (!btn) return;
      remove(btn.getAttribute('data-ta-rm'));
      input.focus();
    });

    /* ── the popup ─────────────────────────────────────────────────── */
    function matches(q) {
      const needle = q.trim().toLowerCase();
      const pool = options.filter((o) => !(multi && has(o.term)));
      if (!needle) return pool.slice(0, 50);
      return pool.filter((o) => o.label.toLowerCase().indexOf(needle) !== -1).slice(0, 50);
    }

    function renderList() {
      shown = matches(input.value);
      const free = allowFree && input.value.trim() &&
        !shown.some((o) => o.label.toLowerCase() === input.value.trim().toLowerCase());
      if (free) shown = shown.concat([{ term: input.value.trim(), label: input.value.trim(), free: true }]);
      if (!shown.length) { closeList(); return; }
      list.innerHTML = shown.map((o, i) =>
        '<li class="ta-item' + (i === active ? ' is-active' : '') + '" role="option" id="' + id + '-o' + i +
        '" aria-selected="' + (i === active ? 'true' : 'false') + '" data-ta-i="' + i + '">' +
        esc(o.label) + (o.free ? ' <span class="ta-item__free">add</span>' : '') + '</li>').join('');
      openList();
      syncActive();
    }

    function openList() {
      if (open) return;
      open = true;
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    function closeList() {
      if (!open && active === -1) return;
      open = false;
      active = -1;
      list.hidden = true;
      list.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    function syncActive() {
      Array.prototype.forEach.call(list.children, (li, i) => {
        const on = i === active;
        li.classList.toggle('is-active', on);
        li.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) li.scrollIntoView({ block: 'nearest' });
      });
      if (active >= 0) input.setAttribute('aria-activedescendant', id + '-o' + active);
      else input.removeAttribute('aria-activedescendant');
    }

    function move(step) {
      if (!open) { renderList(); if (!open) return; }
      if (!shown.length) return;
      active = active < 0
        ? (step > 0 ? 0 : shown.length - 1)
        : (active + step + shown.length) % shown.length;
      syncActive();
    }

    list.addEventListener('mousedown', (e) => {
      /* mousedown, not click: the input must not lose focus and close the popup
         out from under the pointer before the choice registers */
      const li = e.target.closest('[data-ta-i]');
      if (!li) return;
      e.preventDefault();
      add(shown[+li.getAttribute('data-ta-i')]);
      input.focus();
    });

    input.addEventListener('input', renderList);
    input.addEventListener('focus', renderList);
    input.addEventListener('blur', () => { setTimeout(closeList, 120); });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); return; }
      if (e.key === 'Escape') { if (open) { e.stopPropagation(); closeList(); } return; }
      if (e.key === 'Enter') {
        if (active >= 0 && shown[active]) { e.preventDefault(); add(shown[active]); return; }
        const raw = input.value.trim();
        if (!raw) return;
        const exact = options.find((o) => o.label.toLowerCase() === raw.toLowerCase());
        if (exact) { e.preventDefault(); add(exact); return; }
        if (allowFree) { e.preventDefault(); add({ term: raw, label: raw, free: true }); }
        return;
      }
      if (e.key === 'Backspace' && multi && !input.value && chosen.length) {
        remove(chosen[chosen.length - 1].term);
      }
    });

    /* ── the handle a page holds ───────────────────────────────────── */
    const api = {
      value: function () { return multi ? values() : (values()[0] || ''); },
      chosen: function () { return chosen.slice(); },
      set: function (v) {
        const wanted = normalise(Array.isArray(v) ? v : (v ? [v] : []));
        chosen = wanted.map((w) => options.find((o) => o.term === w.term) || w);
        if (!multi) input.value = chosen.length ? chosen[0].label : '';
        renderChips();
        return api;
      },
      clear: function () { chosen = []; input.value = ''; renderChips(); return api; },
      setOptions: function (list2) { options = normalise(list2); return api; },
      input: input,
      destroy: function () {
        closeList();
        delete input.dataset.taOn;
        ['role', 'aria-autocomplete', 'aria-expanded', 'aria-controls', 'aria-activedescendant'].forEach((a) => input.removeAttribute(a));
        wrap.parentNode.insertBefore(input, wrap);
        wrap.parentNode.removeChild(wrap);
      },
    };
    if (cfg.value) api.set(cfg.value);
    return api;
  }

  window.NPTypeahead = { attach: attach };
})();
