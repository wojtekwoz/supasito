// Supasito element picker. Injected by Tauri into every frame before the page's own scripts run.
// Only activates inside a localhost iframe (the site preview); never in the Supasito UI itself.
(() => {
  try {
    if (window.top === window && !window.__openPickerForce) return;
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && window.name !== 'open-mock-preview') return;
    if (window.__openPicker) return;
    window.__openPicker = true;
  } catch (_) { return; }

  let active = false;
  let hoverEl = null;
  let box = null;
  let label = null;

  const pagePath = () => (location.protocol === 'about:' ? '/' : location.pathname + location.search + location.hash);
  const post = (msg) => { try { window.parent.postMessage(Object.assign({ source: 'open-picker' }, msg), '*'); } catch (_) {} };

  function ensureOverlay() {
    if (box) return;
    box = document.createElement('div');
    box.setAttribute('data-open-overlay', '');
    Object.assign(box.style, {
      position: 'fixed', pointerEvents: 'none', zIndex: '2147483646', boxSizing: 'border-box',
      border: '1.5px solid #2743D6', background: 'rgba(39,67,214,0.08)', borderRadius: '2px',
      left: '0', top: '0', width: '0', height: '0', display: 'none', transition: 'all 40ms linear'
    });
    label = document.createElement('div');
    Object.assign(label.style, {
      position: 'absolute', left: '-1.5px', top: '-22px', padding: '2px 6px', font: '11px/16px -apple-system, system-ui, sans-serif',
      background: '#2743D6', color: '#fff', borderRadius: '3px 3px 0 0', whiteSpace: 'nowrap', maxWidth: '360px', overflow: 'hidden', textOverflow: 'ellipsis'
    });
    box.appendChild(label);
    (document.body || document.documentElement).appendChild(box);
  }

  function isOverlay(el) { return !!(el && el.closest && el.closest('[data-open-overlay]')); }

  function describe(el) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const classes = Array.from(el.classList || []).filter(c => !c.startsWith('astro-'));
    const srcEl = el.closest('[data-astro-source-file],[data-loc],[data-source-file]');
    let source = null;
    if (srcEl) {
      const file = srcEl.getAttribute('data-astro-source-file') || srcEl.getAttribute('data-source-file') || (srcEl.getAttribute('data-loc') || '').split(':')[0];
      const loc = srcEl.getAttribute('data-astro-source-loc') || srcEl.getAttribute('data-source-loc') || (srcEl.getAttribute('data-loc') || '').split(':').slice(1).join(':');
      if (file) source = { file, loc: loc || '' };
    }
    // React dev hints (Next.js): component chain from the fiber tree, plus a best-effort source frame.
    let react = null;
    try {
      const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
      let fiber = key ? el[key] : null;
      if (fiber) {
        const names = [];
        let f = fiber;
        let hops = 0;
        while (f && hops < 60 && names.length < 6) {
          let name = null;
          if (typeof f.name === 'string' && f.type === undefined && f.tag === undefined) {
            // React 19 "component info" for a Server Component owner (no client fiber exists for it)
            name = f.name;
          } else {
            const t = f.type;
            name = typeof t === 'function' ? (t.displayName || t.name) : (t && typeof t === 'object' && t.render ? (t.displayName || t.render.name) : null);
          }
          if (name && !/^(Fragment|Suspense|Provider|Consumer|Context|Root|Layout(Router)?|Render.*|Inner.*|Outer.*|Head|Script|Link|Image|Template|Error.*|Loading.*|NotFound.*|HotReload|Segment.*|App.*|Client.*|Server.*|Router.*|Scroll.*|Redirect.*|Http.*|Boundary.*)$/.test(name) && names[names.length - 1] !== name) names.push(name);
          f = f._debugOwner || f.owner || f.return;
          hops++;
        }
        let source = null;
        const st = fiber._debugStack && (fiber._debugStack.stack || String(fiber._debugStack));
        if (st) {
          const m = st.split('\n').map(l => l.match(/(?:webpack-internal:\/\/\/|\/_next\/src\/|\/src\/|\/app\/|\/components\/|\/pages\/)([^\s)]*?\.(?:tsx|jsx|ts|js|mdx)):(\d+):(\d+)/)).find(Boolean);
          if (m) source = { file: m[0].replace(/^webpack-internal:\/\/\/(\([^)]*\)\/)?\.?\/?/, '').replace(/:\d+:\d+$/, ''), loc: m[2] + ':' + m[3] };
        }
        react = { components: names, source };
      }
    } catch (_) {}
    let text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length > 140) text = text.slice(0, 140) + '…';
    let html = el.outerHTML.replace(/\s+/g, ' ').replace(/ data-astro-[a-z-]+="[^"]*"/g, '').trim();
    if (html.length > 700) html = html.slice(0, 700) + '…';
    return {
      page: pagePath(),
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      classes,
      text,
      selector: cssPath(el),
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      styles: {
        color: cs.color, 'background-color': cs.backgroundColor, 'font-family': cs.fontFamily.split(',')[0].replace(/"/g, ''),
        'font-size': cs.fontSize, 'font-weight': cs.fontWeight, 'line-height': cs.lineHeight, padding: cs.padding, margin: cs.margin, display: cs.display
      },
      outerHtml: html,
      source: source || (react && react.source) || null,
      react: react ? { components: react.components } : null
    };
  }

  function cssPath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 5) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift(part + '#' + cur.id); break; }
      const cls = Array.from(cur.classList || []).filter(c => !c.startsWith('astro-')).slice(0, 2);
      if (cls.length) part += '.' + cls.join('.');
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      cur = parent;
      if (cur === document.body) break;
    }
    return parts.join(' > ');
  }

  function highlight(el) {
    ensureOverlay();
    if (!el || el === document.documentElement || el === document.body) { box.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    const cls = Array.from(el.classList || []).filter(c => /^[a-zA-Z][\w-]{1,17}$/.test(c)).slice(0, 2).join('.');
    label.textContent = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '') + '  ' + Math.round(r.width) + '×' + Math.round(r.height);
    label.style.top = r.top < 24 ? '-1.5px' : '-22px';
  }

  function setActive(on) {
    active = !!on;
    ensureOverlay();
    document.documentElement.style.cursor = active ? 'crosshair' : '';
    if (!active) { box.style.display = 'none'; hoverEl = null; }
  }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.source !== 'open-host') return;
    if (d.type === 'pick') setActive(d.active);
    if (d.type === 'navigate' && typeof d.path === 'string') location.assign(d.path);
    if (d.type === 'reload') location.reload();
    if (d.type === 'ping') post({ type: 'ready', page: pagePath(), title: document.title });
  });

  document.addEventListener('mousemove', (e) => {
    if (!active) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isOverlay(el)) return;
    if (el !== hoverEl) { hoverEl = el; highlight(el); }
  }, true);

  document.addEventListener('scroll', () => { if (active && hoverEl) highlight(hoverEl); }, true);

  document.addEventListener('click', (e) => {
    if (!active) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isOverlay(el)) return;
    post({ type: 'selected', selection: describe(el) });
    setActive(false);
    post({ type: 'pick', active: false });
  }, true);

  document.addEventListener('keydown', (e) => {
    if (active && e.key === 'Escape') { setActive(false); post({ type: 'pick', active: false }); }
  }, true);

  const announce = () => post({ type: 'ready', page: pagePath(), title: document.title });
  window.addEventListener('DOMContentLoaded', announce);
  window.addEventListener('load', announce);
  window.addEventListener('popstate', announce);
  window.addEventListener('hashchange', announce);
  const _ps = history.pushState; history.pushState = function () { const r = _ps.apply(this, arguments); announce(); return r; };
})();
