/* The film tags (plan 088): at a set moment in a film, a link appears to the
   page the film is talking about. The films themselves are not touched.

   To change a tag, change its line below and raise the ?v= on the film's page.
   Times are seconds into the film, read from its captions. `to` left out means
   the tag stays to the end; `strangers` keeps it from an account already signed
   in. The film's `length` is what check/sweep.mjs holds
   the times to, with every link and its anchor. */
window.NP_FILM_TAGS = {
  /* NexPoint in two minutes (v2) */
  home: { length: 130.24, tags: [
    { from: 65.96, to: 80.7, label: 'See the one-to-one service', href: '#services' },
    { from: 81.7, to: 89.5, label: 'Enter the Global Portal', href: 'https://nexpoint.co.uk/hub/' },
    { from: 89.52, to: 95.42, label: 'Explore the 3D Print Hub', href: 'https://printhub.nexpoint.co.uk/' },
    { from: 95.42, to: 99.5, label: 'Explore the Mill Hub', href: 'https://millhub.nexpoint.co.uk/' },
    { from: 99.5, to: 107.6, label: 'See the Opportunities Board', href: 'https://opportunities.nexpoint.co.uk/' },
    { from: 113.06, label: 'Request an intro call', href: '#book' },
  ] },
  /* One trusted network, four areas (v2) */
  portal: { length: 90.48, tags: [
    { from: 9.68, to: 16.56, label: 'Explore the 3D Print Hub', href: 'https://printhub.nexpoint.co.uk/' },
    { from: 17.18, to: 25.66, label: 'Explore the Mill Hub', href: 'https://millhub.nexpoint.co.uk/' },
    { from: 26.56, to: 37.56, label: 'See the Opportunities Board', href: 'https://opportunities.nexpoint.co.uk/' },
    { from: 49.64, to: 62.04, label: 'Create your account', href: 'https://nexpoint.co.uk/hub/?join=1', strangers: true },
    { from: 63.2, to: 77, label: 'Open your account page', href: 'https://nexpoint.co.uk/hub/account/' },
    { from: 78.32, label: 'Create your account', href: 'https://nexpoint.co.uk/hub/?join=1', strangers: true },
  ] },
  /* The 3D Print Hub (v3, the film the page plays) */
  print: { length: 89.67, tags: [
    { from: 21.97, to: 37.09, label: 'Offer 3D print capacity', href: 'offer.html' },
    { from: 41.8, to: 60.6, label: 'Find 3D print capacity', href: 'find.html' },
    { from: 61.06, to: 80.42, label: 'Open your account page', href: 'https://nexpoint.co.uk/hub/account/' },
    { from: 80.98, label: 'Find 3D print capacity', href: 'find.html' },
    { from: 80.98, label: 'Offer 3D print capacity', href: 'offer.html' },
  ] },
  /* The Mill Hub (v3) */
  mill: { length: 84.83, tags: [
    { from: 30.64, to: 47.8, label: 'Find milled capacity', href: 'find.html' },
    { from: 48.14, to: 62.1, label: 'Offer milling capacity', href: 'offer.html' },
    { from: 62.95, to: 74.91, label: 'Open your account page', href: 'https://nexpoint.co.uk/hub/account/' },
    { from: 75.76, label: 'Find milled capacity', href: 'find.html' },
    { from: 75.76, label: 'Offer milling capacity', href: 'offer.html' },
  ] },
  /* The Opportunities Board (v1) */
  opportunities: { length: 91.93, tags: [
    { from: 40.82, to: 50.62, label: 'See how introductions work', href: '#how' },
    { from: 58.4, to: 64.14, label: 'View live opportunities', href: '#briefs' },
    { from: 77.36, to: 84.66, label: 'Post an opportunity', href: '#post' },
    { from: 84.98, label: 'View live opportunities', href: '#briefs' },
  ] },
};

(function initFilmTags() {
  const OVER_FROM = 480;   // below this frame width the tags leave the picture for the strip under it

  function mount(video) {
    const film = window.NP_FILM_TAGS[video.dataset.filmTags];
    const frame = video.closest('.film__frame');
    if (!film || !frame) return;

    const box = document.createElement('div');
    box.className = 'film-tags film-tags--over';
    box.hidden = true;
    const tags = film.tags.map((tag) => {
      const a = document.createElement('a');
      a.className = 'film-tag';
      a.href = tag.href;
      a.textContent = tag.label;
      const icon = document.createElement('span');
      icon.className = 'material-symbols-outlined';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = 'arrow_forward';
      a.appendChild(icon);
      /* so the narration never carries on behind the next page */
      a.addEventListener('click', () => video.pause());
      /* a tag the visitor is on stays until they leave it, so it never moves from under the pointer or the keyboard */
      a.addEventListener('blur', draw);
      a.addEventListener('mouseleave', draw);
      return { tag, a };
    });

    function draw() {
      const t = video.currentTime;
      let shown = 0;
      tags.forEach(({ tag, a }) => {
        const due = t >= tag.from && (tag.to === undefined || t < tag.to) && !(tag.strangers && document.body.hasAttribute('data-np-signed-in'));
        const held = a.isConnected && (a === document.activeElement || a.matches(':hover'));
        if (due || held) { if (!a.isConnected) box.appendChild(a); shown++; } else a.remove();
      });
      box.hidden = !shown && box.classList.contains('film-tags--over');
    }

    /* The strip goes after the frame, or after the hero's reveal box where the
       frame sits inside one, because the frame clips what leaves it. */
    function place() {
      const over = frame.clientWidth >= OVER_FROM;
      box.classList.toggle('film-tags--over', over);
      box.classList.toggle('film-tags--under', !over);
      if (over) { if (box.parentNode !== frame) frame.appendChild(box); }
      else (frame.closest('.hero-reveal') || frame).after(box);
      draw();
    }

    ['timeupdate', 'seeked', 'play', 'pause', 'ended'].forEach((e) => video.addEventListener(e, draw));
    if (window.ResizeObserver) new ResizeObserver(place).observe(frame);
    window.addEventListener('resize', place);
    place();
  }

  document.querySelectorAll('video[data-film-tags]').forEach(mount);
})();
