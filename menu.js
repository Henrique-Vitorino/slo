// ===== Mobile menu (hamburger drawer) =====
// Self-contained: injects a hamburger button + slide-in drawer into the header,
// cloning the existing nav links and WhatsApp CTA. Works on every page.
(function () {
  var header = document.querySelector('.site-header .header-inner');
  if (!header || document.querySelector('.nav-toggle')) return;

  var navLinks = header.querySelector('.nav-links');
  var cta = header.querySelector('.header-cta');

  // Hamburger button
  var toggle = document.createElement('button');
  toggle.className = 'nav-toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-label', 'Abrir menu');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'mobile-menu');
  toggle.innerHTML = '<span class="material-symbols-outlined">menu</span>';
  header.appendChild(toggle);

  // Overlay
  var overlay = document.createElement('div');
  overlay.className = 'menu-overlay';
  overlay.hidden = true;

  // Drawer
  var drawer = document.createElement('aside');
  drawer.className = 'mobile-menu';
  drawer.id = 'mobile-menu';
  drawer.setAttribute('aria-label', 'Menu de navegação');

  var head = document.createElement('div');
  head.className = 'mobile-menu__head';
  var brand = document.createElement('span');
  brand.className = 'wordmark';
  brand.innerHTML = 'SLO<span class="wordmark-sub">suportelojaonline</span>';
  var closeBtn = document.createElement('button');
  closeBtn.className = 'mobile-menu__close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Fechar menu');
  closeBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
  head.appendChild(brand);
  head.appendChild(closeBtn);
  drawer.appendChild(head);

  // Clone nav links
  var nav = document.createElement('nav');
  nav.className = 'mobile-menu__nav';
  nav.setAttribute('aria-label', 'Navegação principal');
  if (navLinks) {
    navLinks.querySelectorAll('a').forEach(function (a) {
      nav.appendChild(a.cloneNode(true));
    });
  }
  drawer.appendChild(nav);

  // Clone CTA
  if (cta) {
    var ctaClone = cta.cloneNode(true);
    drawer.appendChild(ctaClone);
  }

  document.body.appendChild(overlay);
  document.body.appendChild(drawer);

  function openMenu() {
    document.body.classList.add('menu-open');
    overlay.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
  }
  function closeMenu() {
    document.body.classList.remove('menu-open');
    toggle.setAttribute('aria-expanded', 'false');
    setTimeout(function () {
      if (!document.body.classList.contains('menu-open')) overlay.hidden = true;
    }, 300);
  }

  toggle.addEventListener('click', openMenu);
  closeBtn.addEventListener('click', closeMenu);
  overlay.addEventListener('click', closeMenu);
  nav.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', closeMenu);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.body.classList.contains('menu-open')) closeMenu();
  });
  // Close if resized up to desktop
  window.matchMedia('(min-width: 861px)').addEventListener('change', function (e) {
    if (e.matches) closeMenu();
  });
})();
