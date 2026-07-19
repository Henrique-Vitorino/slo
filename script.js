// Current year in footer
document.getElementById('year').textContent = new Date().getFullYear();

// ===== Scroll reveal =====
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('in-view');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));

// ===== Animate bar chart when hero mockup enters view =====
const bars = document.querySelector('.bars');
if (bars) {
  const barObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        setTimeout(() => bars.classList.add('animate'), 250);
        barObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.4 });
  barObserver.observe(bars);
}

// ===== Back-to-top button =====
const backToTop = document.getElementById('backToTop');
window.addEventListener('scroll', () => {
  if (window.scrollY > 600) backToTop.classList.add('visible');
  else backToTop.classList.remove('visible');
}, { passive: true });

backToTop.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ===== Smooth scroll for anchor links (accounting for fixed header) =====
document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (e) => {
    const targetId = link.getAttribute('href');
    if (targetId === '#' || targetId === '#top') {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const target = document.querySelector(targetId);
    if (target) {
      e.preventDefault();
      const offset = 72;
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  });
});

// ===== Lead capture form (auditoria gratuita) =====
const leadForm = document.getElementById('lead-form');
if (leadForm) {
  const feedback = document.getElementById('lead-feedback');
  const submitBtn = document.getElementById('lead-submit');

  const showFeedback = (msg, ok) => {
    feedback.textContent = msg;
    feedback.classList.remove('hidden', 'ok', 'err');
    feedback.classList.add(ok ? 'ok' : 'err');
  };

  leadForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Fill in https:// if the user didn't type it
    const siteInput = document.getElementById('lead-site');
    if (siteInput && siteInput.value.trim() && !/^https?:\/\//i.test(siteInput.value.trim())) {
      siteInput.value = 'https://' + siteInput.value.trim();
    }

    if (!leadForm.reportValidity()) return;

    submitBtn.disabled = true;
    feedback.classList.add('hidden');

    try {
      const res = await fetch(leadForm.action, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new FormData(leadForm),
      });
      if (!res.ok) throw new Error();
      leadForm.reset();
      showFeedback('Recebido! Sua auditoria chega no seu e-mail em até 48h úteis. 🎉', true);
      if (typeof gtag === 'function') gtag('event', 'generate_lead', { method: 'auditoria_gratuita' });
    } catch {
      showFeedback('Não foi possível enviar agora. Tente novamente ou chame a gente no WhatsApp.', false);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// ===== Collapse nav under 860px (design hides links; log for extensibility) =====
const mq = window.matchMedia('(max-width: 860px)');
function handleNav(e) {
  document.querySelector('.nav-links')?.toggleAttribute('data-collapsed', e.matches);
}
mq.addEventListener('change', handleNav);
handleNav(mq);
