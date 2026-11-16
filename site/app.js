// CORDITE website: platform detection, live release details, screenshot viewer.
// No dependencies, no tracking. The only request it makes is one call to the GitHub API.
(() => {
  'use strict';
  const root = document.documentElement;
  root.classList.add('js');
  const REPO = root.dataset.repo;
  const DL = `https://github.com/${REPO}/releases/latest/download/`;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  // ---------------------------------------------------------------- navigation bar
  const nav = $('#nav');
  const onScroll = () => nav.classList.toggle('solid', window.scrollY > 40);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---------------------------------------------------------------- reveal on scroll
  const reveal = $$('.reveal');
  const bars = $$('.bars');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const n = e.target;
          io.unobserve(n);
          n.classList.add('in');
          if (!n.classList.contains('reveal')) continue;
          // Hand the element back to its own hover transitions once it has arrived.
          const done = (ev) => {
            if (ev.target !== n) return;
            n.removeEventListener('transitionend', done);
            n.classList.remove('reveal', 'in');
            n.style.transitionDelay = '';
          };
          n.addEventListener('transitionend', done);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    reveal.forEach((n, i) => {
      n.style.transitionDelay = `${(i % 3) * 70}ms`;
      io.observe(n);
    });
    bars.forEach((n) => io.observe(n));
  } else {
    reveal.concat(bars).forEach((n) => n.classList.add('in'));
  }

  // ---------------------------------------------------------------- which build is yours
  const ua = navigator.userAgent || '';
  const uad = navigator.userAgentData;
  const plat = (uad && uad.platform) || navigator.platform || '';
  let os = 'other';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(plat) && navigator.maxTouchPoints > 1)) os = 'ios';
  else if (/Android/i.test(ua)) os = 'android';
  else if (/Win/i.test(plat) || /Windows/i.test(ua)) os = 'windows';
  else if (/Mac/i.test(plat) || /Macintosh/i.test(ua)) os = 'mac';
  else if (/Linux|X11|CrOS/i.test(`${plat} ${ua}`)) os = 'linux';

  const cta = $('#cta');
  const ctaLabel = $('#cta-label');
  const ctaSub = $('#cta-sub');
  const setCta = (label, sub, asset) => {
    ctaLabel.textContent = label;
    ctaSub.textContent = sub;
    if (asset) {
      cta.dataset.asset = asset;
      cta.href = DL + asset;
    } else {
      delete cta.dataset.asset;
      cta.href = './play/';
    }
  };
  if (os === 'windows') setCta('Download for Windows', 'Installer · 64-bit', 'Cordite-Setup-win-x64.exe');
  else if (os === 'mac') setCta('Download for macOS', 'Apple Silicon · Intel build below', 'Cordite-mac-arm64.dmg');
  else if (os === 'linux') setCta('Download for Linux', 'AppImage · 64-bit', 'Cordite-linux-x64.AppImage');
  else if (os === 'android') setCta('Download for Android', 'APK · touch and gamepad', 'Cordite-android.apk');
  else if (os === 'ios') setCta('Play on iPhone and iPad', 'Then Share · Add to Home Screen', null);

  const mine = $(`.platform[data-os="${os}"]`);
  if (mine) mine.classList.add('mine');

  // ---------------------------------------------------------------- live release details
  let release = null;
  const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(n >= 104857600 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  function applyRelease() {
    if (!release) return;
    const assets = new Map((release.assets || []).map((a) => [a.name, a]));
    for (const a of $$('[data-asset]')) {
      const hit = assets.get(a.dataset.asset);
      const size = $('.size', a);
      const ok = hit && typeof hit.browser_download_url === 'string' && hit.browser_download_url.startsWith('https://github.com/');
      if (ok) {
        a.href = hit.browser_download_url;
        a.classList.remove('missing');
        a.removeAttribute('aria-disabled');
        if (size) size.textContent = fmtSize(hit.size);
      } else if (a === cta) {
        a.href = '#download';
      } else {
        a.classList.add('missing');
        a.removeAttribute('href');
        a.setAttribute('aria-disabled', 'true');
        if (size) size.textContent = 'not in this build';
      }
    }
    if (release.tag_name) $('#rel-version').textContent = release.tag_name;
    if (release.published_at) {
      const when = new Date(release.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      $('#rel-date').textContent = `Released ${when}`;
      $('#rel-line').textContent = ` (${release.tag_name}, ${when})`;
    }
  }

  function noRelease() {
    $('#no-release').hidden = false;
    for (const a of $$('.dl[data-asset]')) {
      a.classList.add('missing');
      a.removeAttribute('href');
      a.setAttribute('aria-disabled', 'true');
    }
    cta.href = '#download';
  }

  fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    .then((r) => {
      if (r.status === 404) {
        noRelease();
        return null;
      }
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    })
    .then((rel) => {
      release = rel;
      applyRelease();
    })
    .catch(() => {
      /* Offline or rate limited: the links already point at the latest release. */
    });

  // Chromium can tell an Intel Mac from an Apple Silicon one; everything else gets Apple Silicon by default.
  if (os === 'mac' && uad && typeof uad.getHighEntropyValues === 'function') {
    uad
      .getHighEntropyValues(['architecture'])
      .then((v) => {
        if (v.architecture !== 'x86') return;
        setCta('Download for macOS', 'Intel · Apple Silicon build below', 'Cordite-mac-x64.dmg');
        applyRelease();
      })
      .catch(() => {});
  }

  // ---------------------------------------------------------------- screenshot viewer
  const lb = $('#lightbox');
  const lbImg = $('#lb-img');
  const lbCap = $('#lb-cap');
  const shots = $$('.shot');
  const lbButtons = $$('button', lb);
  let current = 0;
  let lastFocus = null;

  const show = (i) => {
    current = (i + shots.length) % shots.length;
    const s = shots[current];
    lbImg.src = s.dataset.full;
    lbImg.alt = $('img', s).alt;
    lbCap.textContent = s.dataset.cap || '';
  };
  const open = (i) => {
    lastFocus = document.activeElement;
    show(i);
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
    $('.lb-close', lb).focus();
  };
  const close = () => {
    lb.hidden = true;
    document.body.style.overflow = '';
    lbImg.removeAttribute('src');
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  };
  shots.forEach((s, i) => s.addEventListener('click', () => open(i)));
  $('.lb-close', lb).addEventListener('click', close);
  $('.prev', lb).addEventListener('click', () => show(current - 1));
  $('.next', lb).addEventListener('click', () => show(current + 1));
  lb.addEventListener('click', (e) => {
    if (e.target === lb) close();
  });
  document.addEventListener('keydown', (e) => {
    if (lb.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') show(current - 1);
    else if (e.key === 'ArrowRight') show(current + 1);
    else if (e.key === 'Tab') {
      // Keep keyboard focus inside the viewer while it is open.
      const visible = lbButtons.filter((b) => b.offsetParent !== null);
      const at = visible.indexOf(document.activeElement);
      const next = visible[(at + (e.shiftKey ? -1 : 1) + visible.length) % visible.length];
      e.preventDefault();
      if (next) next.focus();
    }
  });

  // ---------------------------------------------------------------- copy buttons
  for (const b of $$('.copy')) {
    b.addEventListener('click', async () => {
      const text = $(`#${b.dataset.copy}`).textContent;
      try {
        await navigator.clipboard.writeText(text);
        b.textContent = 'Copied';
      } catch {
        b.textContent = 'Select it';
      }
      setTimeout(() => (b.textContent = 'Copy'), 1600);
    });
  }
})();
