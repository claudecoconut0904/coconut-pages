/* Coconut signature box + signed-form submit. No dependencies.
   CoconutSignature.mount(container, { onChange }) -> { isEmpty(), clear(), toDataURL() }
   CoconutSignature.submit(payload) -> Promise<{ ok, reference, emailed }>  (throws Error with a message a tech can read)
   Strokes are kept as points normalised to the box, so rotating the phone redraws them instead of losing them. */
(function () {
  var ENDPOINT = 'https://ojxebbsmsbgmhbxfsiey.supabase.co/functions/v1/signed-form';
  var INK = '#0A0A0A';

  function mount(container, opts) {
    opts = opts || {};
    container.innerHTML =
      '<div class="csig">' +
      '<div class="csig-head"><span class="csig-label">Customer signature</span><button type="button" class="csig-clear" disabled>Clear</button></div>' +
      '<div class="csig-box"><canvas class="csig-canvas" aria-label="Signature box. Sign with a finger."></canvas>' +
      '<div class="csig-hint">Sign here with your finger</div><div class="csig-line"></div><div class="csig-x">&times;</div></div>' +
      '</div>';
    if (!document.getElementById('csig-style')) {
      var st = document.createElement('style'); st.id = 'csig-style';
      st.textContent =
        '.csig{font-family:inherit}' +
        '.csig-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}' +
        '.csig-label{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#0A0A0A}' +
        '.csig-clear{font:inherit;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;min-height:36px;padding:0 14px;border:1px solid #0A0A0A;border-radius:6px;background:#fff;color:#0A0A0A;cursor:pointer}' +
        '.csig-clear:disabled{opacity:.35;cursor:default}' +
        '.csig-box{position:relative;height:190px;border:2px solid #0A0A0A;border-radius:10px;background:#fff;overflow:hidden;touch-action:none}' +
        '.csig-box.csig-missing{border-color:#C0392B;box-shadow:0 0 0 3px rgba(192,57,43,.15)}' +
        '.csig-canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:crosshair}' +
        '.csig-hint{position:absolute;left:0;right:0;top:42%;text-align:center;font-size:14px;color:#9AA0A6;pointer-events:none}' +
        '.csig-line{position:absolute;left:44px;right:20px;bottom:44px;border-bottom:1.5px solid #B9BEC4;pointer-events:none}' +
        '.csig-x{position:absolute;left:20px;bottom:38px;font-size:22px;line-height:1;color:#9AA0A6;pointer-events:none}' +
        '.csig-signed .csig-hint{display:none}';
      document.head.appendChild(st);
    }
    var root = container.querySelector('.csig'), box = container.querySelector('.csig-box'), canvas = container.querySelector('canvas');
    var clearBtn = container.querySelector('.csig-clear'), ctx = canvas.getContext('2d');
    var strokes = [], current = null, w = 0, h = 0;

    function draw(c, cw, ch, lw) {
      c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = INK; c.fillStyle = INK; c.lineWidth = lw;
      strokes.forEach(function (s) {
        if (s.length === 1) { c.beginPath(); c.arc(s[0][0] * cw, s[0][1] * ch, lw * 0.6, 0, Math.PI * 2); c.fill(); return; }
        c.beginPath(); c.moveTo(s[0][0] * cw, s[0][1] * ch);
        for (var i = 1; i < s.length - 1; i++) {                       // quadratic through the midpoints: smooth, no corners
          var mx = (s[i][0] + s[i + 1][0]) / 2 * cw, my = (s[i][1] + s[i + 1][1]) / 2 * ch;
          c.quadraticCurveTo(s[i][0] * cw, s[i][1] * ch, mx, my);
        }
        var last = s[s.length - 1]; c.lineTo(last[0] * cw, last[1] * ch); c.stroke();
      });
    }
    function render() {
      // Scale from the backing store actually allocated, not the live devicePixelRatio: the ratio can change
      // (zoom, moving between screens) without the box changing size, and the two must never disagree.
      if (!w || !h) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0); draw(ctx, w, h, 2.6);
    }
    function resize() {
      var b = box.getBoundingClientRect(); if (!b.width) return;
      w = b.width; h = b.height; var r = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * r); canvas.height = Math.round(h * r); render();
    }
    function changed() {
      var empty = strokes.length === 0;
      root.classList.toggle('csig-signed', !empty); clearBtn.disabled = empty; box.classList.remove('csig-missing');
      if (opts.onChange) opts.onChange(!empty);
    }
    function pt(e) { var b = canvas.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (e.clientY - b.top) / b.height))]; }

    canvas.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button > 0) return;
      if (Math.round(w * (window.devicePixelRatio || 1)) !== canvas.width) resize();
      e.preventDefault(); try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      current = [pt(e)]; strokes.push(current); render(); changed();
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!current) return; e.preventDefault();
      var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      (evs && evs.length ? evs : [e]).forEach(function (x) { current.push(pt(x)); });
      render();
    });
    function end() { current = null; }
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    clearBtn.addEventListener('click', function () { strokes = []; current = null; render(); changed(); });
    if (window.ResizeObserver) new ResizeObserver(resize).observe(box); else window.addEventListener('resize', resize);
    resize();

    return {
      isEmpty: function () { return strokes.length === 0; },
      clear: function () { strokes = []; render(); changed(); },
      flagMissing: function () { box.classList.add('csig-missing'); box.scrollIntoView({ block: 'center', behavior: 'smooth' }); },
      // Transparent PNG, always the same size whatever the phone, so every PDF looks alike.
      toDataURL: function () {
        var out = document.createElement('canvas'); out.width = 900; out.height = Math.round(900 * (h / w || 0.4));
        draw(out.getContext('2d'), out.width, out.height, 2.6 * (900 / (w || 900)) * 1.15);
        return out.toDataURL('image/png');
      },
    };
  }

  // Shrinks a camera photo to something an email can carry (longest side 1600 px, JPEG).
  function shrinkPhoto(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.78));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That photo could not be read.')); };
      img.src = url;
    });
  }

  function submit(payload) {
    return fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      .catch(function () { throw new Error('No connection. Check the signal and submit again; nothing was lost.'); })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || !j.ok) throw new Error(j.error || 'Could not submit. Try again.'); return j; }); });
  }

  window.CoconutSignature = { mount: mount, submit: submit, shrinkPhoto: shrinkPhoto, endpoint: ENDPOINT };
})();
