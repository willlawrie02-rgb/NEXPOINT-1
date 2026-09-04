/* Global Hub explainer — the story player (signed story, approved 2026-09-03).
   Plays four short clips in sequence: the need, the unseen supply, a person
   weighs the fit, a personal introduction. Engine mirrors the retired
   hub/assets/explainer.js clock (root class "xp", caption/dots/end-card
   pattern) but drives scene changes off each clip's own `ended` event instead
   of a fixed timer. Bails to the static storyboard already sitting in the
   mount — under reduced motion, when the mount is missing, or for any page
   without the mount. No portal.js dependency. */
(function () {
  'use strict';
  var mount = document.getElementById('explainer');
  if (!mount) return;
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var HOLD_MS = 2000;     // hold each clip's final frame before advancing
  var END_MS = 3000;      // end-card dwell before looping back to scene 1
  var FALLBACK_MS = 5000; // poster dwell when a clip errors, ~= a clip's length

  var SCENES = [
    {
      title: 'The need',
      body: 'You have the work — a scan ready to make — but not the machine.',
      poster: '/hub/assets/media/poster-scene1.jpg',
      src: '/hub/assets/media/scene1-need.mp4'
    },
    {
      title: 'The unseen supply',
      body: "Somewhere in the network, a certified lab has exactly that capacity. You've never met.",
      poster: '/hub/assets/media/poster-scene2.jpg',
      src: '/hub/assets/media/scene2-supply.mp4'
    },
    {
      title: 'A person weighs the fit',
      body: 'You introduce yourself once. Chris or Will reads it personally and weighs the fit — no algorithm.',
      poster: '/hub/assets/media/poster-scene3.jpg',
      src: '/hub/assets/media/scene3-match.mp4'
    },
    {
      title: 'A personal introduction',
      body: 'When it fits, we introduce you directly. The relationship — and the customer — is yours.',
      poster: '/hub/assets/media/poster-scene4.jpg',
      src: '/hub/assets/media/scene4-introduction.mp4'
    }
  ];

  /* ── build the component ── */
  var root = document.createElement('div');
  root.className = 'xp';
  root.setAttribute('data-scene', '0');
  root.setAttribute('aria-label', 'How the Global Hub works');

  var stage = document.createElement('div');
  stage.className = 'xp-videowrap';
  var video = document.createElement('video');
  video.className = 'xp-video';
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.preload = 'metadata';
  stage.appendChild(video);
  var fallback = document.createElement('img');
  fallback.className = 'xp-fallback';
  fallback.alt = '';
  fallback.hidden = true;
  stage.appendChild(fallback);
  root.appendChild(stage);

  var cap = document.createElement('div'); cap.className = 'xp-caption';
  var capT = document.createElement('span'); capT.className = 'xp-cap-title'; cap.appendChild(capT);
  var capB = document.createElement('p'); capB.className = 'xp-cap-body'; cap.appendChild(capB);
  root.appendChild(cap);

  var dotsWrap = document.createElement('div'); dotsWrap.className = 'xp-dots';
  var dots = SCENES.map(function (s, idx) {
    var b = document.createElement('button');
    b.className = 'xp-dot'; b.type = 'button';
    b.setAttribute('aria-label', 'Scene ' + (idx + 1) + ': ' + s.title);
    b.addEventListener('click', function () { goTo(idx); });
    dotsWrap.appendChild(b); return b;
  });
  root.appendChild(dotsWrap);

  var end = document.createElement('div'); end.className = 'xp-end';
  var endP = document.createElement('p'); endP.textContent = 'Introduced, not sold.'; end.appendChild(endP);
  root.appendChild(end);

  /* ── the clock ── */
  var current = -1, timer = null;

  function scheduleNext(delay) {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (current === SCENES.length - 1) {
        root.classList.add('is-end');
        timer = setTimeout(function () { goTo(0); }, END_MS);
      } else {
        goTo(current + 1);
      }
    }, delay);
  }

  function goTo(i) {
    clearTimeout(timer);
    root.classList.remove('is-end');
    current = i;
    root.setAttribute('data-scene', String(i));
    dots.forEach(function (b, idx) { b.classList.toggle('is-on', idx === i); });
    capT.textContent = SCENES[i].title;
    capB.textContent = SCENES[i].body;
    fallback.hidden = true;
    video.hidden = false;
    video.poster = SCENES[i].poster;
    video.src = SCENES[i].src;
    video.load();
    var p = video.play();
    if (p && p.catch) p.catch(function () {}); // autoplay refusal is not an error we surface
  }

  /* one listener each — never re-attached per scene, so they never stack */
  video.addEventListener('ended', function () {
    scheduleNext(HOLD_MS);
  });
  video.addEventListener('error', function () {
    fallback.src = SCENES[current] ? SCENES[current].poster : '';
    fallback.hidden = false;
    video.hidden = true;
    scheduleNext(FALLBACK_MS);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      clearTimeout(timer);
      video.pause();
      return;
    }
    if (root.classList.contains('is-end')) {
      timer = setTimeout(function () { goTo(0); }, END_MS);
    } else if (video.ended) {
      scheduleNext(HOLD_MS);
    } else if (!video.hidden) {
      var p = video.play();
      if (p && p.catch) p.catch(function () {});
    }
  });

  mount.innerHTML = '';
  mount.appendChild(root);
  goTo(0);
})();
