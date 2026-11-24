/* The match maps (plan 052, items 23 and 24): Leaflet on OpenStreetMap
   tiles, the same vendored build the site map uses (hub/assets/vendor/
   leaflet, 1.9.4, BSD-2).

   The seeker's map, after Find capacity: the seeker's own town and one pin
   per ranked site, numbered as the cards are (plan 055: every ranked site
   is on the map, the best three filled, the rest outlined). Sites in the
   same town share one pin, which shows how many are there and opens a short
   anonymous list ("Site 2", "Site 3", with lead time and distance). Only a
   site among the best three carries a Choose button (plan 067, Q4: what was
   accepted and shown by name is what is picked); a pin beyond the three
   says so instead. Choosing on the map ticks the card; ticking a card
   lights its pin.

   The provider's map, on an offer: the seeker's town and the lab's own,
   with the need box that closes and opens again from the Request pin
   (plan 106, 19 November 2026).

   Plan 106 (19 November 2026): the seeker's map opens on
   its own town and the three best sites only, close in, not on the globe;
   the other pins stay drawn and fall in or out of that view as the map has
   them. A site among the three carries its company's name (and logo) on
   its pin's card, its title and its Choose button (C9: the worker names
   three and no more); every other site keeps "Site 5 · town".

   Every point is a town's, rounded by the worker to about a kilometre
   (Will, 8 Oct: every pin sits at town level; the address never reaches a
   map). Only a name the worker sent is shown. Progressive: when Leaflet is missing, or
   no point is known, mount returns null and the page carries on without a
   map. No search-as-you-type, no geolocation.                           */
(function () {
  'use strict';
  var TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  function hasPoint(p) {
    return !!p && typeof p.lat === 'number' && typeof p.lng === 'number' &&
      isFinite(p.lat) && isFinite(p.lng);
  }
  function placeOf(o) { return [o.town, o.country].filter(Boolean).join(', '); }
  /* A site's name for its pin: its company when the worker named it (one of
     the three), else its rank, as before ("Site 2"). */
  function companyOf(s) { return s && typeof s.company === 'string' && s.company.trim() ? s.company.trim() : ''; }
  function nameOf(s, Noun) { return companyOf(s) || (Noun + ' ' + s.position); }
  function initials(name) {
    var w = String(name || '').replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    return ((w[0] || '').charAt(0) + (w[1] || '').charAt(0)).toUpperCase() || 'N';
  }
  /* The company's logo on a small white tile, whole; its initials when it
     has none or the link fails (it is signed for a minute). */
  function logoNode(s) {
    var tile = document.createElement('span');
    tile.className = 'np-pop__logo';
    tile.setAttribute('aria-hidden', 'true');
    var ini = initials(companyOf(s));
    var u = typeof s.logo_url === 'string' ? s.logo_url.trim() : '';
    if (/^(https?:\/\/|data:image\/)/i.test(u)) {
      var img = document.createElement('img');
      img.alt = '';
      img.addEventListener('error', function () { tile.textContent = ini; }, { once: true });
      img.src = u;
      tile.appendChild(img);
    } else tile.textContent = ini;
    return tile;
  }

  /* A town is a town: same town and country, whatever the case, is one pin.
     A site with no town falls back to its point. */
  function townKey(s) {
    var t = String(s.town || '').trim().toLowerCase();
    var c = String(s.country || '').trim().toLowerCase();
    return t ? t + '|' + c : s.point.lat.toFixed(2) + ',' + s.point.lng.toFixed(2);
  }

  function baseMap(box) {
    /* The OpenStreetMap credit stays on the map (its licence asks for it); the
       Leaflet badge does not (Will, 8 Oct), as on the site map. */
    var map = L.map(box, { zoomControl: true, attributionControl: false, worldCopyJump: true,
      scrollWheelZoom: false }).setView([30, 0], 2);
    L.control.attribution({ prefix: false }).addTo(map);
    L.tileLayer(TILES, { maxZoom: 18, attribution: ATTRIB }).addTo(map);
    return map;
  }

  function pinIcon(text, cls) {
    /* A zero-size anchor with the pin centred on it by CSS, so a word ("You")
       and a number make the same pin, sized to what it says. */
    return L.divIcon({ className: 'np-pin-wrap', iconSize: [0, 0], iconAnchor: [0, 0],
      popupAnchor: [0, -18], html: '<span class="np-pin ' + (cls || '') + '">' + text + '</span>' });
  }

  /* Two pins on one town would hide one under the other, so a "You" pin
     that shares its town with a site's sits just to the side of it. */
  function near(a, b) { return Math.abs(a.lat - b.lat) < 0.03 && Math.abs(a.lng - b.lng) < 0.03; }

  function youMarker(map, at, label, beside) {
    return L.marker([at.lat, at.lng], { icon: pinIcon('You', 'np-pin--you' + (beside ? ' np-pin--beside' : '')), keyboard: false,
      title: label, alt: label, zIndexOffset: -100 }).addTo(map);
  }

  /* A frame is set, never animated. These maps are remade whenever the list
     they sit in is redrawn (an accept, a decline, a new search), and a map
     removed in the middle of Leaflet's fly-to left the animation's last
     frame reading a pane that had gone: "Cannot read properties of
     undefined (reading '_leaflet_pos')", seen now and then on the account
     page when the machine was busy (12 and 13 October). */
  function frame(map, points, maxZoom) {
    if (!points.length) return;
    if (points.length === 1) { map.setView([points[0].lat, points[0].lng], 9, { animate: false }); return; }
    map.fitBounds(L.latLngBounds(points.map(function (p) { return [p.lat, p.lng]; })),
      { padding: [36, 36], maxZoom: maxZoom || 10, animate: false });
  }
  /* Taking a map down: stop whatever it is doing first, then remove it. */
  function takeDown(map) {
    try { map.stop(); } catch (e) { /* nothing running */ }
    try { map.remove(); } catch (e) { /* already gone */ }
  }

  /* The popup is built as nodes, not a string, so the Choose buttons are
     wired directly and nothing a card carries is ever read as markup. */
  function popupFor(group, opts) {
    var noun = opts.noun || 'site';
    var Noun = noun.charAt(0).toUpperCase() + noun.slice(1);
    var root = document.createElement('div');
    root.className = 'np-pop';
    var head = document.createElement('p');
    head.className = 'np-pop__head';
    var one = group.sites.length === 1;
    if (one && companyOf(group.sites[0])) {
      /* plan 106 (C9): a named site leads with its logo and company, the
         town and country beneath */
      head.classList.add('np-pop__head--named');
      head.appendChild(logoNode(group.sites[0]));
      var who = document.createElement('span');
      who.className = 'np-pop__who';
      var nm = document.createElement('b');
      nm.textContent = companyOf(group.sites[0]);
      var at = document.createElement('span');
      at.className = 'np-pop__at';
      at.textContent = placeOf(group.sites[0]);
      who.appendChild(nm);
      who.appendChild(at);
      head.appendChild(who);
    } else {
      head.textContent = one
        ? Noun + ' ' + group.sites[0].position + ' · ' + placeOf(group.sites[0])
        : group.sites.length + ' ' + noun + 's in ' + placeOf(group.sites[0]);
    }
    root.appendChild(head);
    var list = document.createElement('ul');
    list.className = 'np-pop__list';
    group.sites.forEach(function (s) {
      var li = document.createElement('li');
      var facts = document.createElement('span');
      var bits = [];
      if (group.sites.length > 1) bits.push(nameOf(s, Noun));
      if (s.lead != null) bits.push('Lead time ' + (Number(s.lead) === 1 ? '1 day' : s.lead + ' days'));
      if (s.distance != null) bits.push('~' + s.distance + ' km');
      facts.textContent = bits.join(' · ');
      li.appendChild(facts);
      if (s.best) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-primary np-pop__go';
        btn.setAttribute('data-choose', String(s.listing_id));
        btn.textContent = 'Choose ' + nameOf(s, Noun);
        btn.addEventListener('click', function () { opts.onPick(String(s.listing_id)); });
        li.appendChild(btn);
      } else {
        /* Plan 067 (Q3, Q4): a pin beyond the three is a town and a rank;
           it cannot be picked, and it says what can. */
        var note = document.createElement('span');
        note.className = 'np-pop__note';
        note.textContent = 'Only the three best fits are named and can be picked. ' +
          'Change your ask to see others, or tell the desk.';
        li.appendChild(note);
      }
      list.appendChild(li);
    });
    root.appendChild(list);
    return root;
  }

  /* The seeker's map. opts: {el, seeker: {lat,lng}|null, sites: [{listing_id,
     position, town, country, point, lead, distance, best}], onPick(id),
     onReveal(id), noun, assetBase}. Every ranked site is a pin, numbered by
     rank; a site flagged `best` (one of the three shown as cards) gets a
     filled pin, the rest are outlined (plan 055, decision 15). A click on a
     pin calls onReveal for each site under it before its popup opens, so a
     site outside the three gets its card. Returns {select(id), refresh(),
     destroy(), groups} or null. */
  function mount(opts) {
    var box = opts && opts.el;
    if (!box || !window.L) return null;
    var sites = (opts.sites || []).filter(function (s) { return hasPoint(s.point); });
    if (!sites.length) return null;

    var groups = [];
    var byKey = {};
    sites.forEach(function (s) {
      var k = townKey(s);
      if (!byKey[k]) { byKey[k] = { key: k, at: s.point, sites: [] }; groups.push(byKey[k]); }
      byKey[k].sites.push(s);
    });

    var map = baseMap(box);
    var noun = opts.noun || 'site';
    var points = [];
    var view = [];
    if (hasPoint(opts.seeker)) {
      youMarker(map, opts.seeker, 'Your town', groups.some(function (g) { return near(g.at, opts.seeker); }));
      points.push(opts.seeker);
      view.push(opts.seeker);
    }
    var markers = groups.map(function (g) {
      var one = g.sites.length === 1;
      var label = one
        ? nameOf(g.sites[0], noun.charAt(0).toUpperCase() + noun.slice(1)) + ', ' + placeOf(g.sites[0])
        : g.sites.length + ' ' + noun + 's in ' + placeOf(g.sites[0]);
      /* a town with one of the best three in it is a filled pin; a town
         with none is outlined, as the shared count pins always were */
      var best = g.sites.some(function (s) { return s.best === true; });
      var cls = (one ? '' : 'np-pin--group') + (best ? ' np-pin--best' : ' np-pin--more');
      var m = L.marker([g.at.lat, g.at.lng], {
        icon: pinIcon(one ? String(g.sites[0].position) : String(g.sites.length), cls.trim()),
        title: label, alt: label, riseOnHover: true,
      }).addTo(map);
      /* registered before bindPopup, so the cards are on the page before
         Leaflet's own click handler opens the popup */
      if (typeof opts.onReveal === 'function') m.on('click', function () {
        g.sites.forEach(function (s) { opts.onReveal(String(s.listing_id)); });
      });
      m.bindPopup(popupFor(g, { noun: noun, onPick: function (id) { m.closePopup(); opts.onPick(id); } }),
        { minWidth: 200, maxWidth: 280 });
      points.push(g.at);
      if (best) view.push(g.at);
      return { group: g, marker: m };
    });
    /* Plan 106 (W5.3): the first view is the seeker's town and the three
       best sites, close in (no closer than a town's surroundings), never
       the globe; with none of the three on the map, every pin. */
    if (view.length === (hasPoint(opts.seeker) ? 1 : 0)) view = points;
    function first() { frame(map, view, 11); }
    first();

    function select(id) {
      markers.forEach(function (x) {
        var on = x.group.sites.some(function (s) { return String(s.listing_id) === String(id); });
        var el = x.marker.getElement && x.marker.getElement();
        var pin = el && el.querySelector('.np-pin');
        if (pin) pin.classList.toggle('is-on', on);
      });
    }

    var dead = false;
    /* A map made while its step was hidden has no size, and Leaflet's fit
       then means nothing: the first time the box gains a size, it measures
       and takes the first view again (refresh() does the same on demand). */
    var watch = null;
    if (window.ResizeObserver) {
      var sized = box.offsetWidth > 0 && box.offsetHeight > 0;
      watch = new ResizeObserver(function () {
        if (dead) return;
        var now = box.offsetWidth > 0 && box.offsetHeight > 0;
        if (now && !sized) { map.invalidateSize(); first(); }
        sized = now;
      });
      watch.observe(box);
    }
    return {
      map: map,
      groups: groups,
      select: select,
      /* The step was hidden when the map was made, so Leaflet measures again;
         not if the map has gone in the meantime (a re-render inside 50 ms). */
      refresh: function () { setTimeout(function () { if (dead) return; map.invalidateSize(); first(); }, 50); },
      destroy: function () { dead = true; if (watch) watch.disconnect(); takeDown(map); },
    };
  }

  /* The provider's map: the seeker's town and the lab's own, two pins and
     nothing to choose. opts: {el, seeker: {lat,lng,town,country}, site:
     {lat,lng,town,country}, popup, boxOpen, onBox, topClear}. `popup` (plan 055,
     decision 7) is the need box: HTML the page built from the request, open
     on the Request pin. Plan 106 (Will, 19 November 2026): the box closes, by
     any element in it marked data-np-need-close (its cross), and pressing the
     Request pin opens it again; it never toggles shut from the pin. `boxOpen`
     (default true) is whether it starts open, and `onBox(open)` is told each
     time it opens or closes, so the page can keep the reader's choice across
     a redraw. The box is a popup of the map's own, not bound to the pin, so
     the pin's press only ever opens it. With the box open, the frame leaves
     room above the pins for it, so it never clips. Returns {refresh(),
     destroy(), openBox(), closeBox(), isBoxOpen()} or null. */
  function mountPair(opts) {
    var box = opts && opts.el;
    if (!box || !window.L) return null;
    var seeker = opts.seeker && hasPoint(opts.seeker.point) ? opts.seeker : null;
    var site = opts.site && hasPoint(opts.site.point) ? opts.site : null;
    if (!seeker && !site) return null;
    var map = baseMap(box);
    var points = [];
    var ask = null;
    var dead = false;
    if (site) {
      var lab = 'Your site, ' + placeOf(site);
      L.marker([site.point.lat, site.point.lng], { icon: pinIcon('You', 'np-pin--you'), title: lab, alt: lab })
        .addTo(map);
      points.push(site.point);
    }
    var pop = null;
    if (seeker) {
      var who = 'The request, ' + placeOf(seeker);
      ask = L.marker([seeker.point.lat, seeker.point.lng], {
        icon: pinIcon('Request', 'np-pin--ask' + (opts.popup ? ' np-pin--press' : '') + (site && near(site.point, seeker.point) ? ' np-pin--beside' : '')),
        title: opts.popup ? 'Show what they need' : who, alt: who })
        .addTo(map);
      points.push(seeker.point);
      if (opts.popup) {
        /* The offset is the one the bound popup had: its own [0, 2] on the
           pin's popupAnchor of [0, -18]. */
        pop = L.popup({ autoClose: false, closeOnClick: false, closeButton: false, closeOnEscapeKey: false,
          autoPan: false, className: 'np-need-pop', minWidth: 210, maxWidth: 260, offset: [0, -16] })
          .setLatLng([seeker.point.lat, seeker.point.lng])
          .setContent(opts.popup);
      }
    }
    var hasBox = !!(ask && pop);
    var boxOpen = hasBox && opts.boxOpen !== false;
    /* room the page keeps at the map's top for its own control (Hide map) */
    var topClear = Number(opts.topClear) > 0 ? Number(opts.topClear) : 0;
    var wired = false;
    function tell() { if (!dead && typeof opts.onBox === 'function') opts.onBox(boxOpen); }
    function isOpen() { return !!(pop && map.hasLayer(pop)); }
    function openBox() {
      if (!hasBox || dead) return;
      boxOpen = true;
      if (!isOpen()) pop.openOn(map);
      if (!wired && pop.getElement()) {
        wired = true;
        /* the container lasts; the content inside it is written again on every open */
        L.DomEvent.on(pop.getElement(), 'click', function (e) {
          var t = e.target && e.target.closest ? e.target.closest('[data-np-need-close]') : null;
          if (!t) return;
          L.DomEvent.stop(e);
          closeBox();
          var pin = ask.getElement && ask.getElement();
          if (pin && pin.focus) pin.focus();
        });
      }
      tell();
    }
    function closeBox() {
      if (!hasBox || dead) return;
      boxOpen = false;
      if (isOpen()) map.closePopup(pop);
      tell();
    }
    /* Where no frame fits both pins and the box (a narrow map, a phone),
       the box is kept inside the map: the view moves just enough for the
       box above the Request pin to show whole, the site's pin may go. */
    function keepBoxIn() {
      if (!hasBox || !boxOpen || !isOpen()) return;
      var el = pop.getElement();
      if (!el) return;
      var size = map.getSize();
      var w = el.offsetWidth, h = el.offsetHeight;
      var p = map.latLngToContainerPoint([seeker.point.lat, seeker.point.lng]);
      var dx = 0, dy = 0;
      var minY = Math.min(h + 30 + topClear, size.y - 40);
      if (p.y < minY) dy = p.y - minY;
      var minX = w / 2 + 8, maxX = size.x - w / 2 - 8;
      if (minX <= maxX) { if (p.x < minX) dx = p.x - minX; else if (p.x > maxX) dx = p.x - maxX; }
      if (dx || dy) map.panBy([dx, dy], { animate: false });
    }
    if (hasBox) {
      ask.on('click', function () { openBox(); keepBoxIn(); });
      ask.on('keypress', function (e) { if (e.originalEvent && e.originalEvent.keyCode === 13) { openBox(); keepBoxIn(); } });
    }
    /* With the box open, the frame is chosen by hand: the highest zoom at
       which both pins fit with the box's height above the Request pin, and,
       where one can be found, at which the box does not cover the site's
       pin (the two separate as the map zooms in). With it closed, the two
       pins are simply framed. */
    function framePair() {
      if (!points.length) return;
      if (!hasBox || !boxOpen) { frame(map, points); return; }
      var el = pop.getElement();
      var w = el ? el.offsetWidth : 260, h = el ? el.offsetHeight : 220;
      var size = map.getSize();
      var pins = [{ ll: seeker.point, top: h + 30 + topClear, side: w / 2 + 12 }];
      if (site) pins.push({ ll: site.point, top: 40, side: 40 });
      var fit = null, clear = null;
      for (var z = 2; z <= 11; z++) {
        var pts = pins.map(function (p) {
          var q = map.project([p.ll.lat, p.ll.lng], z);
          return { x: q.x, y: q.y, top: p.top, side: p.side };
        });
        var top = Math.min.apply(null, pts.map(function (p) { return p.y - p.top; }));
        var bottom = Math.max.apply(null, pts.map(function (p) { return p.y + 40; }));
        var left = Math.min.apply(null, pts.map(function (p) { return p.x - p.side; }));
        var right = Math.max.apply(null, pts.map(function (p) { return p.x + p.side; }));
        if (bottom - top > size.y || right - left > size.x) break;
        var view = { z: z, x: (left + right) / 2, y: (top + bottom) / 2 };
        fit = view;
        var covered = pts.length > 1 && Math.abs(pts[1].x - pts[0].x) < w / 2 + 24 &&
          pts[1].y < pts[0].y + 24 && pts[1].y > pts[0].y - h - 44;
        if (!covered) clear = view;
      }
      var v = clear || fit;
      if (!v) { frame(map, points); keepBoxIn(); return; }
      map.setView(map.unproject([v.x, v.y], v.z), v.z, { animate: false });
    }
    if (boxOpen) { boxOpen = false; openBox(); }
    framePair();
    return {
      map: map,
      /* The map was hidden or folded when it was made, so Leaflet measures
         again; the box comes back only if the reader left it open. */
      refresh: function () {
        setTimeout(function () {
          if (dead) return;
          map.invalidateSize();
          if (boxOpen && !isOpen()) pop.openOn(map);
          framePair();
        }, 50);
      },
      openBox: openBox,
      closeBox: closeBox,
      isBoxOpen: function () { return boxOpen; },
      destroy: function () { dead = true; takeDown(map); },
    };
  }

  window.NPMatchMap = { mount: mount, mountPair: mountPair, townKey: townKey };
})();
