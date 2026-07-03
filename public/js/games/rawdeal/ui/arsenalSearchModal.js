window.RawDeal = window.RawDeal || {};

/**
 * Modal for searching a player's full Arsenal (pick 1 to hand, or up to 3 to Ringside).
 */
window.RawDeal.ArsenalSearchModal = class ArsenalSearchModal {
  constructor(rootEl) {
    this.root = rootEl;
    this.messageEl = rootEl.querySelector('[data-rd-arsenal-search-message]');
    this.cardsEl = rootEl.querySelector('[data-rd-arsenal-search-cards]');
    this.confirmBtn = rootEl.querySelector('[data-rd-arsenal-search-confirm]');
    this.onSelect = null;
    this.onConfirm = null;
    this._prompt = null;

    this.confirmBtn?.addEventListener('click', () => {
      if (!this._prompt || this._prompt.purpose !== 'toRingside') return;
      const need = this._prompt.selectCount || 1;
      const selected = this._prompt.selectedIds || [];
      if (selected.length !== need) return;
      this.hide();
      if (this.onConfirm) this.onConfirm(selected);
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
      this.messageEl.textContent = prompt.message || 'Choose from Arsenal';
    }

    const isMulti = prompt.purpose === 'toRingside';
    if (this.confirmBtn) {
      this.confirmBtn.classList.toggle('hidden', !isMulti);
      const need = prompt.selectCount || 1;
      const picked = (prompt.selectedIds || []).length;
      this.confirmBtn.disabled = picked !== need;
      this.confirmBtn.textContent =
        need === 1 ? 'Confirm' : `Confirm (${picked}/${need})`;
    }

    if (this.cardsEl) {
      window.RawDeal.CardRenderer.clearContainer(this.cardsEl);
      const row = document.createElement('div');
      row.className = 'rd-hand';

      const selectedSet = new Set(prompt.selectedIds || []);

      for (const card of prompt.cards || []) {
        const el = window.RawDeal.CardRenderer.createCardEl(card, {
          small: true,
          clickable: true,
          onClick: (e) => {
            e.stopPropagation();
            if (this.onSelect) this.onSelect(card.instanceId);
          },
        });
        if (isMulti && selectedSet.has(card.instanceId)) {
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
      this.cardsEl.classList.toggle('rd-arsenal-search-modal__scroll--overflow', overflows);
    });
  }
};