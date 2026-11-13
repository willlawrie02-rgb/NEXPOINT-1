/* The logo banner (plan 088): the companies that have agreed to work with
   NexPoint, on the home page and the Global Portal page. Shown without asking
   and removed on request.

   A name appears only once it is on this list, and it goes on this list only
   after the operator has confirmed it. This repo is public, so a name or its
   logo must not be committed before then: not here, in a PR or in a commit.

   To add a company, put its logo in assets/img/logos/ and add a line:
     { name: 'The company', logo: 'assets/img/logos/the-company.svg', confirmed: 'YYYY-MM-DD' },
   The logo is a transparent SVG or PNG, as the company drew it, and it sits
   straight on the canvas: never in a box, card or tile, and never redrawn. A
   line with no logo shows the name in type. A logo's address is read from the
   site root (worked out from this script's own address), so the same line works
   on / and on /hub/. To remove one, delete its line and its file. Either way
   raise the ?v= on this script in index.html and hub/index.html, or a browser
   can hold the old list for four hours. */
window.NP_LOGO_BANNER = [
];

(function initLogoBanner() {
  const section = document.getElementById('logoBanner');
  const row = document.getElementById('logoBannerRow');
  const track = section && section.querySelector('.logos__track');
  const box = section && section.querySelector('.logos__box');
  if (!section || !row || !track || !box) return;
  const script = document.currentScript;
  const root = new URL('..', script && script.src ? script.src : location.href);
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  const SECONDS_PER_LOGO = 4, LEAST_SECONDS = 30;

  /* a line without its confirmation date is not confirmed */
  const shown = window.NP_LOGO_BANNER.filter((c) => c.name && c.confirmed);
  section.hidden = !shown.length;
  if (!shown.length) return;

  const asName = (li, name) => {
    li.className = 'logos__name';
    li.textContent = name;
  };
  shown.forEach((c) => {
    const li = document.createElement('li');
    if (!c.logo) asName(li, c.name);
    else {
      const img = document.createElement('img');
      img.alt = c.name;
      img.decoding = 'async';
      /* the row is measured once each logo has its width */
      img.addEventListener('load', later);
      /* a logo that does not load shows its name instead */
      img.addEventListener('error', () => { asName(li, c.name); later(); });
      img.src = new URL(c.logo, root).href;
      li.appendChild(img);
    }
    row.appendChild(li);
  });

  /* The row moves only when one copy is wider than its box and motion is not
     reduced; then the list is drawn a second time, hidden from a screen reader,
     and the track slides by one copy, 4 seconds a logo and never under 30. */
  let copy = null, queued = 0;
  function measure() {
    queued = 0;
    section.classList.add('logos--moving');
    const one = row.offsetWidth - parseFloat(getComputedStyle(row).paddingRight || 0);
    const move = !still.matches && one > box.clientWidth;
    if (copy) { copy.remove(); copy = null; }
    if (!move) { section.classList.remove('logos--moving'); return; }
    copy = row.cloneNode(true);
    copy.removeAttribute('id');
    copy.setAttribute('aria-hidden', 'true');
    copy.querySelectorAll('img').forEach((img) => { img.alt = ''; });
    track.appendChild(copy);
    track.style.setProperty('--logos-duration', Math.max(LEAST_SECONDS, SECONDS_PER_LOGO * shown.length) + 's');
  }
  function later() { if (!queued) queued = requestAnimationFrame(measure); }
  window.addEventListener('resize', later, { passive: true });
  if (still.addEventListener) still.addEventListener('change', later); else still.addListener(later);
  later();
})();
