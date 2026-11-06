/* The logo banner (plan 088): the companies that have agreed to work with
   NexPoint, on the home page. Shown without asking and removed on request.

   A name appears only once it is on this list, and it goes on this list only
   after the operator has confirmed it. This repo is public, so a name or its
   logo must not be committed before then: not here, in a PR or in a commit.

   To add a company, put its logo in assets/img/logos/ and add a line:
     { name: 'The company', logo: 'assets/img/logos/the-company.svg', confirmed: 'YYYY-MM-DD' },
   The logo is a transparent SVG or PNG, as the company drew it, and it sits
   straight on the canvas: never in a box, card or tile, and never redrawn.
   To remove one, delete its line and its file. Either way raise the ?v= on this
   script in index.html, or a browser can hold the old list for four hours. */
window.NP_LOGO_BANNER = [
];

(function initLogoBanner() {
  const section = document.getElementById('logoBanner');
  const row = document.getElementById('logoBannerRow');
  if (!section || !row) return;
  /* a line without its confirmation date is not confirmed */
  const shown = window.NP_LOGO_BANNER.filter((c) => c.name && c.logo && c.confirmed);
  shown.forEach((c) => {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = c.logo;
    img.alt = c.name;
    img.loading = 'lazy';
    /* a logo that does not load leaves no gap and no broken picture */
    img.addEventListener('error', () => {
      li.remove();
      section.hidden = !row.children.length;
    });
    li.appendChild(img);
    row.appendChild(li);
  });
  section.hidden = !shown.length;
})();
