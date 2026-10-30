/* Kortiz v27 — Public landing (standalone HTML and Firebase SPA).
   Scroll-aware header, accessible mobile nav, interactive rotating demo and FAQ search. */
(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tr = text => window.KortizI18n?.translate?.(text) || text;
  let activePage = null;
  let revealObserver = null;
  let sectionObserver = null;
  let headerScrollHandler = null;
  let demoTimer = null;
  let demoPlay = true;
  let demoPage = null;
  let faqInput = null;
  const tabNames = ['budget', 'expenses', 'refunds', 'chat'];

  function closeMenu(page) {
    if (!page) return;
    $('.lp-nav', page)?.classList.remove('lp-open');
    $('.lp-mobile-toggle', page)?.setAttribute('aria-expanded', 'false');
    $('.lp-mobile-toggle', page)?.setAttribute('aria-label', tr('Ouvrir le menu'));
    page.classList.remove('lp-menu-open');
  }

  function setDemoPlaying(playing) {
    demoPlay = playing;
    const page = demoPage;
    const btn = page && $('[data-preview-play]', page);
    if (btn) {
      btn.setAttribute('aria-pressed', String(!playing));
      btn.setAttribute('aria-label', tr(playing ? 'Mettre la démo en pause' : 'Reprendre la démo'));
      $('[data-preview-icon]',btn).textContent = playing ? 'Ⅱ' : '▶';
      $('[data-preview-play-label]',btn).textContent = tr(playing ? 'Pause' : 'Lecture');
    }
    page?.classList.toggle('lp-demo-playing', playing);
    if (demoTimer) clearInterval(demoTimer);
    demoTimer = null;
    if (playing && page && !reduceMotion()) {
      // The animation only advances when the demo is visible and the tab is foregrounded.
      demoTimer = setInterval(() => {
        if (document.visibilityState === 'hidden' || !page.isConnected) return;
        const area = $('.lp-interactive', page);
        if (!area) return;
        const rect = area.getBoundingClientRect();
        if (rect.bottom <= 0 || rect.top >= window.innerHeight) return;
        const current = $('[data-preview-tab].is-active', page)?.dataset.previewTab || tabNames[0];
        activateTab(tabNames[(tabNames.indexOf(current) + 1) % tabNames.length], true);
      }, 5500);
    }
  }
  function activateTab(name, automatic = false) {
    const page = demoPage;
    if (!page || !tabNames.includes(name)) return;
    $$('[data-preview-tab]', page).forEach(button => {
      const selected = button.dataset.previewTab === name;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-selected', String(selected));
      button.setAttribute('tabindex', selected ? '0' : '-1');
    });
    $$('[data-preview-panel]', page).forEach(panel => {
      const visible = panel.dataset.previewPanel === name;
      panel.classList.toggle('is-active', visible);
      panel.hidden = !visible;
    });
    if (!automatic) setDemoPlaying(false);
  }
  function initDemo(page) {
    demoPage = page;
    if (!$('[data-preview-tab]', page)) return;
    activateTab('budget', true);
    setDemoPlaying(!reduceMotion());
  }

  function initFaq(page) {
    const input = $('#lp-faq-search', page);
    const count = $('#lp-faq-results', page);
    const empty = $('#lp-faq-empty', page);
    const clear = $('[data-faq-clear]', page);
    if (!input || !count || !empty || !clear) return;
    faqInput = input;
    const items = $$('.mk-faq-item', page);
    const norm = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase().replace(/\s+/g,' ').trim();
    const update = () => {
      const term = norm(input.value);
      let matches = 0;
      for (const item of items) {
        const visible = !term || norm(item.textContent).includes(term);
        item.hidden = !visible;
        if (visible) matches++;
        if (!visible) item.open = false;
      }
      count.textContent = `${matches} / ${items.length} ${tr('questions affichées')}`;
      empty.hidden = matches !== 0;
      clear.hidden = !term;
    };
    input.addEventListener('input', update);
    clear.addEventListener('click', () => {
      input.value = '';
      update();
      input.focus();
    });
    update();
  }

  function initScrollHeader(page) {
    const header = $('.lp-header', page);
    if (!header) return;
    if (headerScrollHandler) window.removeEventListener('scroll', headerScrollHandler);
    let lastY = window.scrollY || 0;
    let deltaTotal = 0;
    let ticking = false;
    headerScrollHandler = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        ticking = false;
        if (!page.isConnected) return;
        const y = Math.max(window.scrollY || 0,0);
        const delta = y - lastY;
        if (Math.abs(delta) > 60) deltaTotal = 0;
        deltaTotal = deltaTotal * .55 + delta;
        header.classList.toggle('lp-scrolled', y > 12);
        if (page.classList.contains('lp-menu-open') || y < 105 || deltaTotal < -11) {
          header.classList.remove('lp-hidden');
        } else if (deltaTotal > 13 && y > 165) {
          header.classList.add('lp-hidden');
        }
        lastY = y;
      });
    };
    window.addEventListener('scroll', headerScrollHandler, {passive:true});
    headerScrollHandler();
  }

  function init(page) {
    if (!page || page === activePage) return;
    revealObserver?.disconnect();
    sectionObserver?.disconnect();
    activePage = page;
    closeMenu(page);
    initScrollHeader(page);
    initDemo(page);
    initFaq(page);
    if (reduceMotion() || !('IntersectionObserver' in window)) {
      $$('.lp-reveal', page).forEach(el => el.classList.add('lp-visible'));
      return;
    }
    page.classList.add('lp-enhanced');
    revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('lp-visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, {rootMargin:'0px 0px 50px 0px',threshold:0.04});
    $$('.lp-reveal',page).forEach(el => revealObserver.observe(el));
    sectionObserver = new IntersectionObserver(entries => {
      for(const entry of entries) {
        if (!entry.isIntersecting) continue;
        $$('.lp-nav a[data-landing-scroll]',page).forEach(a => a.classList.toggle('lp-active', a.getAttribute('href') === '#' + entry.target.id));
      }
    }, {rootMargin:'-24% 0px -68% 0px',threshold:0});
    ['fonctionnalites','faq','interactive-preview'].forEach(id => {
      const section = $('#' + id,page);
      if (section) sectionObserver.observe(section);
    });
  }
  function goWithTransition(page, href) {
    closeMenu(page);
    if (reduceMotion()) { location.assign(href); return; }
    page.classList.add('lp-leaving');
    setTimeout(() => location.assign(href), 240);
  }

  document.addEventListener('click',event => {
    const page = event.target.closest('.lp-page');
    if (!page) return;
    if (event.target.closest('[data-landing-menu]')) {
      const nav = $('.lp-nav',page);
      const toggle = $('[data-landing-menu]',page);
      if (!nav || !toggle) return;
      const willOpen = !nav.classList.contains('lp-open');
      nav.classList.toggle('lp-open',willOpen);
      page.classList.toggle('lp-menu-open',willOpen);
      toggle.setAttribute('aria-expanded',String(willOpen));
      toggle.setAttribute('aria-label',tr(willOpen?'Fermer le menu':'Ouvrir le menu'));
      $('.lp-header',page)?.classList.remove('lp-hidden');
      return;
    }
    if (event.target.closest('[data-preview-play]')) {
      setDemoPlaying(!demoPlay);
      return;
    }
    const tab = event.target.closest('[data-preview-tab]');
    if (tab) { activateTab(tab.dataset.previewTab); return; }
    const anchor = event.target.closest('a[data-landing-scroll]');
    if (anchor) {
      const dest = anchor.getAttribute('href');
      if (!/^#[a-z0-9-]+$/i.test(dest)) return;
      const target = $(dest,page);
      if (!target) return;
      event.preventDefault();
      closeMenu(page);
      target.scrollIntoView({behavior:reduceMotion()?'auto':'smooth',block:'start'});
      if (!$('#app')) history.replaceState(null,'',dest);
      return;
    }
    const link = event.target.closest('a[data-landing-go]');
    if (link && !(event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.button !== 0)) {
      const dest = link.getAttribute('href');
      if (dest?.startsWith('/?entry=')) {event.preventDefault();goWithTransition(page,dest);return;}
    }
    if (page.classList.contains('lp-menu-open') && !event.target.closest('.lp-nav,.lp-mobile-toggle')) closeMenu(page);
  });
  document.addEventListener('keydown',event => {
    const tab = event.target.closest('[data-preview-tab]');
    if (tab && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      const ix = tabNames.indexOf(tab.dataset.previewTab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabNames.length-1
        : (ix + (event.key === 'ArrowRight' ? 1 : -1) + tabNames.length)%tabNames.length;
      event.preventDefault();activateTab(tabNames[next]);
      $('[data-preview-tab="'+tabNames[next]+'"]',demoPage)?.focus();
    }
    if (event.key === 'Escape' && activePage) closeMenu(activePage);
  });
  window.addEventListener('pageshow', () => activePage?.classList.remove('lp-leaving'));
  document.addEventListener('DOMContentLoaded',() => init($('.lp-page')));
  window.KortizLanding = {init};
})();
