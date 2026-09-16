/**
 * Kernel de Injeção Direta no Cliente do Baiak Idle
 * Roda no contexto do navegador Chromium e expõe window.__baiak_party
 */

export const KERNEL_SOURCE = `
(function() {
  if (window.__baiak_kernel_injected) return;
  window.__baiak_kernel_injected = true;

  console.log('[KERNEL-TS] 🚀 Baiak Autonomous Client Kernel v2 (TypeScript) ativo!');

  window.__baiak_party = {
    getState: function() {
      const shooters = [];
      const shooterEls = document.querySelectorAll('#bar-shooters .bar-member');
      shooterEls.forEach((el, idx) => {
        shooters.push({
          slot: idx,
          text: (el.textContent || '').trim().replace(/\\s+/g, ' '),
          classes: el.className
        });
      });

      const modal = document.getElementById('party-modal');
      const isOpen = modal && !modal.classList.contains('hidden');
      const formation = [];
      const available = [];

      if (isOpen) {
        document.querySelectorAll('#formation-slots .party-slot').forEach((el, idx) => {
          const nameEl = el.querySelector('.party-slot-name');
          const vocEl = el.querySelector('.party-slot-voc');
          const btn = el.querySelector('button, .mini-btn');
          formation.push({
            slot: idx,
            name: nameEl ? nameEl.textContent.trim() : null,
            voc: vocEl ? vocEl.textContent.trim() : null,
            action: btn ? btn.textContent.trim() : null,
            isEmpty: el.classList.contains('empty')
          });
        });

        document.querySelectorAll('#available-members .party-member-card').forEach((el) => {
          const nameEl = el.querySelector('.party-card-name');
          const vocEl = el.querySelector('.party-card-voc');
          const btn = el.querySelector('button, .mini-btn');
          available.push({
            name: nameEl ? nameEl.textContent.trim() : null,
            voc: vocEl ? vocEl.textContent.trim() : null,
            action: btn ? btn.textContent.trim() : null
          });
        });
      }

      return { shooters, isOpen, formation, available };
    },

    openModal: function() {
      const btn = document.getElementById('party-btn') || document.querySelector('[data-tab="party"], .hud-party-btn');
      if (btn) btn.click();
      return true;
    },

    closeModal: function() {
      const close = document.getElementById('party-modal-close') || document.querySelector('#party-modal .close-btn');
      if (close) close.click();
      return true;
    },

    benchMember: function(name) {
      if (!name) return { ok: false, reason: 'missing-name' };
      const modal = document.getElementById('party-modal');
      const wasClosed = !modal || modal.classList.contains('hidden');
      if (wasClosed) this.openModal();

      let targetBtn = null;
      document.querySelectorAll('#formation-slots .party-slot').forEach(el => {
        const nameEl = el.querySelector('.party-slot-name');
        if (nameEl && nameEl.textContent.toLowerCase().includes(name.toLowerCase())) {
          targetBtn = el.querySelector('button, .mini-btn');
        }
      });

      if (targetBtn) {
        targetBtn.click();
        if (wasClosed) setTimeout(() => this.closeModal(), 300);
        return { ok: true, action: 'benched', name };
      }
      return { ok: false, reason: 'not-found-in-formation' };
    },

    activateMember: function(name) {
      if (!name) return { ok: false, reason: 'missing-name' };
      const modal = document.getElementById('party-modal');
      const wasClosed = !modal || modal.classList.contains('hidden');
      if (wasClosed) this.openModal();

      let targetBtn = null;
      document.querySelectorAll('#available-members .party-member-card').forEach(el => {
        const nameEl = el.querySelector('.party-card-name');
        if (nameEl && nameEl.textContent.toLowerCase().includes(name.toLowerCase())) {
          targetBtn = el.querySelector('button, .mini-btn');
        }
      });

      if (targetBtn) {
        targetBtn.click();
        if (wasClosed) setTimeout(() => this.closeModal(), 300);
        return { ok: true, action: 'activated', name };
      }
      return { ok: false, reason: 'not-found-in-available' };
    },

    resetHuntAnalyzer: function() {
      const resetBtn = document.getElementById('hunt-analyzer-reset') || document.querySelector('.analyzer-reset-btn, [data-action="reset-analyzer"]');
      if (resetBtn) {
        resetBtn.click();
        return { ok: true };
      }
      return { ok: false, reason: 'reset-button-not-found' };
    }
  };
})();
`;
