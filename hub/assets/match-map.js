/* The match maps (plan 052, items 23 and 24): Leaflet on OpenStreetMap
   tiles, the same vendored build the site map uses (hub/assets/vendor/
   leaflet, 1.9.4, BSD-2).

   The seeker's map, after Find capacity: the seeker's own town and one pin
   per shortlisted site, numbered as the cards are. Sites in the same town
   share one pin, which shows how many are there and opens a short anonymous
   list ("Site 2", "Site 3", with lead time and distance), each with its own
   Choose button. Choosing on the map ticks the card; ticking a card lights
   its pin.

   The provider's map, on an offer: the seeker's town and the lab's own.

   Every point is a town's, rounded by the worker to about a kilometre
   (Will, 8 Oct: every pin sits at town level; the address never reaches a
   map). Nothing here names a site. Progressive: when Leaflet is missing, or
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

  function frame(map, points) {
    if (!points.length) return;
    if (points.length === 1) { map.setView([points[0].lat, points[0].lng], 9); return; }
    map.fitBounds(L.latLngBounds(points.map(function (p) { return [p.lat, p.lng]; })),
      { padding: [36, 36], maxZoom: 10 });
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
    head.textContent = group.sites.length === 1
      ? Noun + ' ' + group.sites[0].position + ' · ' + placeOf(group.sites[0])
      : group.sites.length + ' ' + noun + 's in ' + placeOf(group.sites[0]);
    root.appendChild(head);
    var list = document.createElement('ul');
    list.className = 'np-pop__list';
    group.sites.forEach(function (s) {
      var li = document.createElement('li');
      var facts = document.createElement('span');
      var bits = [];
      if (group.sites.length > 1) bits.push(Noun + ' ' + s.position);
      if (s.lead != null) bits.push('Lead time ' + (Number(s.lead) === 1 ? '1 day' : s.lead + ' days'));
      if (s.distance != null) bits.push('~' + s.distance + ' km');
      facts.textContent = bits.join(' · ');
      li.appendChild(facts);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary np-pop__go';
      btn.setAttribute('data-choose', String(s.listing_id));
      btn.textContent = 'Choose ' + Noun + ' ' + s.position;
      btn.addEventListener('click', function () { opts.onPick(String(s.listing_id)); });
      li.appendChild(btn);
      list.appendChild(li);
    });
    root.appendChild(list);
    return root;
  }

  /* The seeker's map. opts: {el, seeker: {lat,lng}|null, sites: [{listing_id,
     position, town, country, point, lead, distance}], onPick(id), noun,
     assetBase}. Returns {select(id), refresh(), destroy(), groups} or null. */
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
    if (hasPoint(opts.seeker)) {
      youMarker(map, opts.seeker, 'Your town', groups.some(function (g) { return near(g.at, opts.seeker); }));
      points.push(opts.seeker);
    }
    var markers = groups.map(function (g) {
      var one = g.sites.length === 1;
      var label = one
        ? noun.charAt(0).toUpperCase() + noun.slice(1) + ' ' + g.sites[0].position + ', ' + placeOf(g.sites[0])
        : g.sites.length + ' ' + noun + 's in ' + placeOf(g.sites[0]);
      var m = L.marker([g.at.lat, g.at.lng], {
        icon: pinIcon(one ? String(g.sites[0].position) : String(g.sites.length), one ? '' : 'np-pin--group'),
        title: label, alt: label, riseOnHover: true,
      }).addTo(map);
      m.bindPopup(popupFor(g, { noun: noun, onPick: function (id) { m.closePopup(); opts.onPick(id); } }),
        { minWidth: 200, maxWidth: 280 });
      points.push(g.at);
      return { group: g, marker: m };
    });
    frame(map, points);

    function select(id) {
      markers.forEach(function (x) {
        var on = x.group.sites.some(function (s) { return String(s.listing_id) === String(id); });
        var el = x.marker.getElement && x.marker.getElement();
        var pin = el && el.querySelector('.np-pin');
        if (pin) pin.classList.toggle('is-on', on);
      });
    }

    return {
      map: map,
      groups: groups,
      select: select,
      /* The step was hidden when the map was made, so Leaflet measures again. */
      refresh: function () { setTimeout(function () { map.invalidateSize(); frame(map, points); }, 50); },
      destroy: function () { try { map.remove(); } catch (e) { /* already gone */ } },
    };
  }

  /* The provider's map: the seeker's town and the lab's own, two pins and
     nothing to choose. opts: {el, seeker: {lat,lng,town,country}, site:
     {lat,lng,town,country}}. Returns {refresh(), destroy()} or null. */
  function mountPair(opts) {
    var box = opts && opts.el;
    if (!box || !window.L) return null;
    var seeker = opts.seeker && hasPoint(opts.seeker.point) ? opts.seeker : null;
    var site = opts.site && hasPoint(opts.site.point) ? opts.site : null;
    if (!seeker && !site) return null;
    var map = baseMap(box);
    var points = [];
    if (site) {
      var lab = 'Your site, ' + placeOf(site);
      L.marker([site.point.lat, site.point.lng], { icon: pinIcon('You', 'np-pin--you'), title: lab, alt: lab })
        .addTo(map);
      points.push(site.point);
    }
    if (seeker) {
      var who = 'The request, ' + placeOf(seeker);
      L.marker([seeker.point.lat, seeker.point.lng], {
        icon: pinIcon('Request', 'np-pin--ask' + (site && near(site.point, seeker.point) ? ' np-pin--beside' : '')),
        title: who, alt: who })
        .addTo(map);
      points.push(seeker.point);
    }
    frame(map, points);
    return {
      map: map,
      refresh: function () { setTimeout(function () { map.invalidateSize(); frame(map, points); }, 50); },
      destroy: function () { try { map.remove(); } catch (e) { /* already gone */ } },
    };
  }

  window.NPMatchMap = { mount: mount, mountPair: mountPair, townKey: townKey };
})();
