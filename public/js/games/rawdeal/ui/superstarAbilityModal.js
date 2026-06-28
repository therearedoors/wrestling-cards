window.RawDeal = window.RawDeal || {};

/**
 * Modal for optional pre-draw superstar abilities (e.g. The Rock — Ringside to Arsenal).
 */
window.RawDeal.SuperstarAbilityModal = class SuperstarAbilityModal {
  constructor(rootEl) {
    this.root = rootEl;
    this.messageEl = rootEl.querySelector('[data-rd-superstar-ability-message]');
    this.cardsEl = rootEl.querySelector('[data-rd-superstar-ability-cards]');
    this.passBtn = rootEl.querySelector('[data-rd-superstar-ability-pass]');
    this.confirmBtn = rootEl.querySelector('[data-rd-superstar-ability-confirm]');
    this.onPass = null;
    this.onConfirm = null;
    this.onToggleSelect = null;
    this._prompt = null;

    this.passBtn?.addEventListener('click', () => {
      this.hide();
      if (this.onPass) this.onPass();
    });

    this.confirmBtn?.addEventListener('click', () => {
      if (!this._prompt?.selectedId) return;
      const selectedId = this._prompt.selectedId;
      this.hide();
      if (this.onConfirm) this.onConfirm(selectedId);
    });
  }

  show(prompt) {
    if (!prompt) {
      this.hide();
      return;
    }

    this._prompt = prompt;
    this.root.classList.remove('hidden');

    if (this.messageEl) {
      this.messageEl.textContent = prompt.message || 'Superstar ability';
    }

    if (this.confirmBtn) {
      this.confirmBtn.disabled = !prompt.selectedId;
    }

    if (this.cardsEl) {
      window.RawDeal.CardRenderer.clearContainer(this.cardsEl);
      const row = document.createElement('div');
      row.className = 'rd-hand';

      for (const card of prompt.cards || []) {
        const selected = prompt.selectedId === card.instanceId;
        const el = window.RawDeal.CardRenderer.createCardEl(card, {
          small: true,
          clickable: true,
          onClick: (e) => {
            e.stopPropagation();
            if (this.onToggleSelect) this.onToggleSelect(card.instanceId);
          },
        });
        if (selected) {
          el.classList.add('rd-card--selected');
        }
        row.appendChild(el);
      }

      this.cardsEl.appendChild(row);
      this._updateScroll();
    }
  }

  hide() {
    this.root.classList.add('hidden');
    this._prompt = null;
    if (this.cardsEl) {
      window.RawDeal.CardRenderer.clearContainer(this.cardsEl);
    }
  }

  _updateScroll() {
    if (!this.cardsEl) return;
    requestAnimationFrame(() => {
      const overflows = this.cardsEl.scrollWidth > this.cardsEl.clientWidth + 1;
      this.cardsEl.classList.toggle('rd-superstar-ability-modal__scroll--overflow', overflows);
    });
  }
};