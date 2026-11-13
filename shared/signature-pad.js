/* Coconut signature box + signed-form submit. No dependencies.
   CoconutSignature.mount(container, { onChange }) -> { isEmpty(), clear(), flagMissing(), toDataURL() }
   CoconutSignature.submit(payload) -> Promise<{ ok, reference, emailed, copied }>  (throws Error with a message a tech can read)

   Signing happens in a full-screen "signing mode" (Richard 2026-11-13: the page moved and the sheet tried to
   close while customers signed). The box on the page is only a preview and the button that opens it. While
   signing mode is open the page cannot scroll, bounce or zoom: every touch move outside the canvas logic is
   swallowed. Strokes are stored in the coordinate space of the canvas they were drawn on and drawn to fit
   ("contain") anywhere else, so rotating the phone or showing the preview never stretches the signature. */
(function () {
  var ENDPOINT = 'https://ojxebbsmsbgmhbxfsiey.supabase.co/functions/v1/signed-form';
  var INK = '#0A0A0A';

  function css() {
    if (document.getElementById('csig-style')) return;
    var st = document.createElement('style'); st.id = 'csig-style';
    st.textContent =
      '.csig{font-family:inherit}' +
      '.csig-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}' +
      '.csig-label{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#0A0A0A}' +
      '.csig-btn{font:inherit;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;min-height:48px;padding:0 18px;border:1.5px solid #0A0A0A;border-radius:10px;background:#fff;color:#0A0A0A;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
      '.csig-btn:disabled{opacity:.35;cursor:default}' +
      '.csig-btn.pri{background:#1BA9FA;border-color:#1BA9FA;color:#04294D}' +
      '.csig-clear{min-height:36px;padding:0 14px;font-size:11px;border-width:1px;border-radius:6px}' +
      '.csig-box{position:relative;display:block;width:100%;height:150px;border:2px solid #0A0A0A;border-radius:10px;background:#fff;overflow:hidden;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
      '.csig-box.csig-missing{border-color:#C0392B;box-shadow:0 0 0 3px rgba(192,57,43,.15)}' +
      '.csig-box canvas{position:absolute;left:14px;right:14px;top:10px;bottom:30px;width:calc(100% - 28px);height:calc(100% - 40px);pointer-events:none}' +
      '.csig-hint{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;font:inherit;font-size:14px;font-weight:700;color:#04294D;pointer-events:none}' +
      '.csig-hint span{display:inline-block;background:#1BA9FA;border-radius:999px;padding:12px 22px}' +
      '.csig-signed .csig-hint{top:auto;bottom:8px;transform:none;font-size:11px;font-weight:600;color:#5B6068}' +
      '.csig-signed .csig-hint span{background:rgba(255,255,255,.9);padding:3px 10px}' +
      /* signing mode */
      'html.csig-lock,html.csig-lock body{overflow:hidden !important;overscroll-behavior:none !important}' +
      '.csig-ov{position:fixed;inset:0;z-index:1000;background:#fff;display:flex;flex-direction:column;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;' +
        'padding:calc(12px + env(safe-area-inset-top,0px)) calc(16px + env(safe-area-inset-right,0px)) calc(12px + env(safe-area-inset-bottom,0px)) calc(16px + env(safe-area-inset-left,0px));font-family:"Montserrat",Helvetica,Arial,sans-serif;color:#0A0A0A}' +
      '.csig-ov-top{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:10px}' +
      '.csig-ov-top b{font-size:18px;font-weight:900;text-transform:uppercase;letter-spacing:.01em}' +
      '.csig-ov-top small{font-size:12px;color:#5B6068;text-align:right}' +
      '.csig-pad{position:relative;flex:1;min-height:0;border:2px solid #0A0A0A;border-radius:12px;background:#fff;overflow:hidden;touch-action:none}' +
      '.csig-pad canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:crosshair}' +
      '.csig-line{position:absolute;left:56px;right:24px;bottom:30%;border-bottom:1.5px solid #B9BEC4;pointer-events:none}' +
      '.csig-x{position:absolute;left:24px;bottom:calc(30% - 6px);font-size:26px;line-height:1;color:#9AA0A6;pointer-events:none}' +
      '.csig-ghost{position:absolute;left:0;right:0;top:22%;text-align:center;font-size:15px;color:#9AA0A6;pointer-events:none}' +
      '.csig-ov.has .csig-ghost{display:none}' +
      '.csig-ov-btns{display:flex;gap:10px;margin-top:12px}' +
      '.csig-ov-btns .csig-btn{flex:1}.csig-ov-btns .csig-btn.pri{flex:2}';
    document.head.appendChild(st);
  }

  // Draws strokes (in `space` coordinates) to fit a w×h target, centred, never stretched.
  function draw(c, strokes, space, w, h, lw) {
    if (!space || !strokes.length) return;
    var k = Math.min(w / space.w, h / space.h), ox = (w - space.w * k) / 2, oy = (h - space.h * k) / 2;
    var X = function (p) { return ox + p[0] * k; }, Y = function (p) { return oy + p[1] * k; };
    c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = INK; c.fillStyle = INK; c.lineWidth = lw * k;
    strokes.forEach(function (s) {
      if (s.length === 1) { c.beginPath(); c.arc(X(s[0]), Y(s[0]), lw * k * 0.6, 0, Math.PI * 2); c.fill(); return; }
      c.beginPath(); c.moveTo(X(s[0]), Y(s[0]));
      for (var i = 1; i < s.length - 1; i++) c.quadraticCurveTo(X(s[i]), Y(s[i]), (X(s[i]) + X(s[i + 1])) / 2, (Y(s[i]) + Y(s[i + 1])) / 2);
      c.lineTo(X(s[s.length - 1]), Y(s[s.length - 1])); c.stroke();
    });
  }
  function fit(canvas, strokes, space, lw) {      // size the backing store to the element and redraw
    var b = canvas.getBoundingClientRect(); if (!b.width || !b.height) return null;
    var r = window.devicePixelRatio || 1;
    canvas.width = Math.round(b.width * r); canvas.height = Math.round(b.height * r);
    var c = canvas.getContext('2d'); c.setTransform(canvas.width / b.width, 0, 0, canvas.height / b.height, 0, 0);
    c.clearRect(0, 0, b.width, b.height); draw(c, strokes, space, b.width, b.height, lw);
    return b;
  }

  function mount(container, opts) {
    opts = opts || {}; css();
    container.innerHTML =
      '<div class="csig"><div class="csig-head"><span class="csig-label">Customer signature</span><button type="button" class="csig-btn csig-clear" disabled>Clear</button></div>' +
      '<button type="button" class="csig-box" aria-label="Customer signature. Tap to sign."><canvas></canvas><span class="csig-hint"><span>Tap to sign</span></span></button></div>';
    var root = container.querySelector('.csig'), box = container.querySelector('.csig-box'), preview = box.querySelector('canvas');
    var hint = container.querySelector('.csig-hint span'), clearBtn = container.querySelector('.csig-clear');
    var strokes = [], space = null, ov = null;

    // The ink alone (plus a margin): what the preview shows and what goes on the PDF, so the signature fills
    // its box whether it was signed in a tall portrait pad or a wide landscape one.
    function ink() {
      if (!strokes.length || !space) return null;
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      strokes.forEach(function (st) { st.forEach(function (p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }); });
      var pad = 14, w = Math.max(40, x1 - x0) + pad * 2, h = Math.max(24, y1 - y0) + pad * 2;
      return { w: w, h: h, strokes: strokes.map(function (st) { return st.map(function (p) { return [p[0] - x0 + pad, p[1] - y0 + pad]; }); }) };
    }
    function renderPreview() { var i = ink(); fit(preview, i ? i.strokes : [], i ? { w: i.w, h: i.h } : null, 2.6); }
    function changed() {
      var empty = strokes.length === 0;
      root.classList.toggle('csig-signed', !empty); clearBtn.disabled = empty; box.classList.remove('csig-missing');
      hint.textContent = empty ? 'Tap to sign' : 'Signed. Tap to sign again.';
      renderPreview(); if (opts.onChange) opts.onChange(!empty);
    }
    function wipe() { strokes = []; space = null; changed(); }
    clearBtn.addEventListener('click', wipe);
    if (window.ResizeObserver) new ResizeObserver(renderPreview).observe(box); else window.addEventListener('resize', renderPreview);

    function open() {
      if (ov) return;
      var before = { strokes: strokes.map(function (s) { return s.slice(); }), space: space };
      ov = document.createElement('div'); ov.className = 'csig-ov' + (strokes.length ? ' has' : '');
      ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Customer signature');
      ov.innerHTML = '<div class="csig-ov-top"><b>Customer signature</b><small>The screen is locked while you sign.</small></div>' +
        '<div class="csig-pad"><canvas aria-label="Sign here with a finger"></canvas><div class="csig-ghost">Sign here with your finger</div><div class="csig-line"></div><div class="csig-x">&times;</div></div>' +
        '<div class="csig-ov-btns"><button type="button" class="csig-btn" data-a="cancel">Cancel</button><button type="button" class="csig-btn" data-a="clear">Clear</button><button type="button" class="csig-btn pri" data-a="done">Done</button></div>';
      document.body.appendChild(ov);
      var canvas = ov.querySelector('canvas'), doneBtn = ov.querySelector('[data-a=done]'), clr = ov.querySelector('[data-a=clear]'), current = null, rect = null;
      function render() { rect = fit(canvas, strokes, space, 2.6); ov.classList.toggle('has', strokes.length > 0); doneBtn.disabled = !strokes.length; clr.disabled = !strokes.length; }
      // Lock the page: nothing scrolls, bounces or zooms while signing mode is open.
      var block = function (e) { if (e.cancelable) e.preventDefault(); };
      document.addEventListener('touchmove', block, { passive: false });
      document.addEventListener('gesturestart', block, { passive: false });
      document.addEventListener('dblclick', block, { passive: false });
      document.documentElement.classList.add('csig-lock');
      function pt(e) {                                  // pointer → stroke space
        var b = canvas.getBoundingClientRect();
        if (!space) space = { w: b.width, h: b.height };
        var k = Math.min(b.width / space.w, b.height / space.h), ox = (b.width - space.w * k) / 2, oy = (b.height - space.h * k) / 2;
        return [(e.clientX - b.left - ox) / k, (e.clientY - b.top - oy) / k];
      }
      canvas.addEventListener('touchstart', block, { passive: false });
      canvas.addEventListener('pointerdown', function (e) {
        if (e.button != null && e.button > 0) return;
        e.preventDefault(); try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        current = [pt(e)]; strokes.push(current); render();
      });
      canvas.addEventListener('pointermove', function (e) {
        if (!current) return; e.preventDefault();
        var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
        (evs && evs.length ? evs : [e]).forEach(function (x) { current.push(pt(x)); });
        render();
      });
      var end = function () { current = null; };
      canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
      var ro = window.ResizeObserver ? new ResizeObserver(render) : null; if (ro) ro.observe(canvas);
      window.addEventListener('resize', render);
      function close() {
        document.removeEventListener('touchmove', block, { passive: false }); document.removeEventListener('gesturestart', block, { passive: false }); document.removeEventListener('dblclick', block, { passive: false });
        document.documentElement.classList.remove('csig-lock'); window.removeEventListener('resize', render); if (ro) ro.disconnect();
        ov.remove(); ov = null; changed(); box.focus({ preventScroll: true });
      }
      ov.addEventListener('click', function (e) {
        var a = e.target.closest ? e.target.closest('[data-a]') : null; if (!a) return;
        if (a.dataset.a === 'clear') { strokes = []; space = null; current = null; render(); }
        if (a.dataset.a === 'cancel') { strokes = before.strokes; space = before.space; close(); }
        if (a.dataset.a === 'done') close();
      });
      render(); doneBtn.focus({ preventScroll: true });
    }
    box.addEventListener('click', open);
    renderPreview();

    return {
      isEmpty: function () { return strokes.length === 0; },
      clear: wipe,
      open: open,
      flagMissing: function () { box.classList.add('csig-missing'); box.scrollIntoView({ block: 'center', behavior: 'smooth' }); },
      // Transparent PNG of the ink, at most 900 x 600.
      toDataURL: function () {
        var out = document.createElement('canvas'), i = ink();
        if (!i) { out.width = 900; out.height = 300; return out.toDataURL('image/png'); }
        var k = Math.min(900 / i.w, 600 / i.h);
        out.width = Math.round(i.w * k); out.height = Math.round(i.h * k);
        draw(out.getContext('2d'), i.strokes, { w: i.w, h: i.h }, out.width, out.height, 2.6);
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
