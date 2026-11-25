/* Numbers change only by typing (plan 106, W5.2; Will, 19 November 2026:
   "The numbers should only be able to be changed by typing").

   A number box in a browser steps its value under the mouse wheel or the
   trackpad while it has focus, and on the Up and Down arrow keys, so a
   seeker scrolling past "How many" could change it without seeing. The
   boxes stay type="number" (the phone's number keypad, and every form's
   own validation and the values it sends are as they were); this guard
   takes away the three ways a number moves without being typed:

   - the wheel: a focused number box under the wheel lets go of its focus
     before the browser acts, so the browser no longer steps it and the
     page scrolls as it would anywhere else;
   - the arrow keys: Up and Down do nothing in a number box;
   - the small step buttons inside the box are not drawn.

   One shared helper for the find form (find.js) and the listing form
   (listing-form.js). guard(root) listens once on root, so rows a form adds
   later are covered too. Nothing else on the page is touched.            */
(function () {
  'use strict';
  var STYLE_ID = 'np-typed-numbers';
  var CSS = 'input[type="number"]{-moz-appearance:textfield;appearance:textfield}' +
    'input[type="number"]::-webkit-inner-spin-button,input[type="number"]::-webkit-outer-spin-button{-webkit-appearance:none;appearance:none;margin:0}';

  function isNumber(t) {
    return !!t && t.tagName === 'INPUT' && String(t.type).toLowerCase() === 'number';
  }

  function addStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function onWheel(e) {
    var t = e.target;
    /* passive: the scroll itself is never held up; only the focus goes */
    if (isNumber(t) && document.activeElement === t) t.blur();
  }

  function onKey(e) {
    if (!isNumber(e.target)) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Up' || e.key === 'Down') e.preventDefault();
  }

  function guard(root) {
    root = root || document;
    if (root.__npTypedNumbers) return root;
    root.__npTypedNumbers = true;
    addStyle();
    root.addEventListener('wheel', onWheel, { passive: true });
    root.addEventListener('keydown', onKey);
    return root;
  }

  window.NPTypedNumbers = { guard: guard };
})();
