/* The site map on account creation (plan 046, Will's answers of 6 Oct):
   Leaflet on OpenStreetMap tiles, a pin or a place search fills region,
   country and town, and the three fields stay editable. Progressive: when
   Leaflet is missing the fields stand alone. No browser geolocation: the
   site's permissions-policy switches it off, and a lab's location is the
   lab's, not the registrant's phone's. Leaflet is vendored beside this file
   (hub/assets/vendor/leaflet, 1.9.4, BSD-2) so no CDN is in the loading
   path; the tiles are the one outside request, and the privacy page says so. */
(function () {
  'use strict';
  var REGION_LABEL = { uk: 'UK', ireland: 'Ireland', europe: 'Europe', north_america: 'North America',
    south_america: 'South America', middle_east: 'Middle East', africa: 'Africa', asia: 'Asia', oceania: 'Oceania' };
  var TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  function place(d) {
    return { town: d.town || '', country: d.country || '', region: REGION_LABEL[d.region] || '' };
  }

  function mount(opts) {
    var box = opts.el;
    if (!box || !window.L) return null;
    var base = opts.assetBase || '';
    L.Icon.Default.imagePath = base + '/hub/assets/vendor/leaflet/images/';
    /* The OpenStreetMap credit stays on the map (its licence asks for it); the
       Leaflet badge does not (Will, 8 Oct): the control carries no prefix. */
    var map = L.map(box, { zoomControl: true, attributionControl: false, worldCopyJump: true }).setView([30, 0], 2);
    L.control.attribution({ prefix: false }).addTo(map);
    L.tileLayer(TILES, { maxZoom: 18, attribution: ATTRIB }).addTo(map);
    var marker = null;
    function pin(lat, lng, zoom) {
      if (marker) marker.setLatLng([lat, lng]); else marker = L.marker([lat, lng]).addTo(map);
      if (zoom) map.setView([lat, lng], zoom);
    }
    function lookup(lat, lng) {
      return opts.api('/geocode/reverse?lat=' + lat.toFixed(4) + '&lng=' + lng.toFixed(4))
        .then(function (d) {
          if (d && d.ok && (d.town || d.country)) opts.onPlace(place(d));
          else opts.onMiss();
        })
        .catch(function () { opts.onMiss(); });
    }
    map.on('click', function (e) {
      pin(e.latlng.lat, e.latlng.lng, false);
      lookup(e.latlng.lat, e.latlng.lng);
    });
    return {
      map: map,
      search: function (q) {
        if (!q) return Promise.resolve();
        return opts.api('/geocode/search?q=' + encodeURIComponent(q)).then(function (d) {
          if (!d || !d.ok || !d.point) { opts.onMiss(); return; }
          pin(d.point.lat, d.point.lng, 10);
          return lookup(d.point.lat, d.point.lng);
        }).catch(function () { opts.onMiss(); });
      },
      /* The modal is laid out after the map is made, so Leaflet measures it once more. */
      refresh: function () { setTimeout(function () { map.invalidateSize(); }, 50); },
      /* Called when the person leaves the step: Leaflet listens on the window
         for resizes until its map is removed. */
      destroy: function () { try { map.remove(); } catch (e) { /* already gone */ } },
    };
  }
  window.NPSiteMap = { mount: mount };
})();
