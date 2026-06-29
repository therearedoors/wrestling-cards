window.RawDeal = window.RawDeal || {};

/**
 * Modal for revealing an opponent's hand (view, optional skip, or select-to-discard).
 */
window.RawDeal.HandRevealModal = class HandRevealModal {
  constructor(rootEl) {
    this.root = rootEl;
    this.messageEl = rootEl.querySelector('[data-rd-hand-reveal-message]');
    this.cardsEl = rootEl.querySelector('[data-rd-hand-reveal-cards]');
    this.doneBtn = rootEl.querySelector('[data-rd-hand-reveal-done]');
    this.skipBtn = rootEl.querySelector('[data-rd-hand-reveal-skip]');
    this.confirmBtn = rootEl.querySelector('[data-rd-hand-reveal-confirm]');
    this.onDismiss = null;
    this.onSkip = null;
    this.onConfirm = null;
    this.onToggleSelect = null;
    this._prompt = null;

    this.doneBtn?.addEventListener('click', () => {
      this.hide();
      if (this.onDismiss) this.onDismiss();
    });

    this.skipBtn?.addEventListener('click', () => {
      this.hide();
      if (this.onSkip) this.onSkip();
    });

    this.confirmBtn?.addEventListener('click', () => {
      if (!this._prompt || this._prompt.mode !== 'select') return;
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
      this.messageEl.textContent = prompt.message || "Opponent's hand";
    }

    const isSelect = prompt.mode === 'select';
    const allowSkip = !!prompt.allowSkip;

    if (this.doneBtn) {
      this.doneBtn.classList.toggle('hidden', isSelect);
      this.doneBtn.disabled = false;
    }
    if (this.skipBtn) {
      this.skipBtn.classList.toggle('hidden', isSelect || prompt.mode === 'view' || !allowSkip);
    }
    if (this.confirmBtn) {
      this.confirmBtn.classList.toggle('hidden', !isSelect);
      const need = prompt.selectCount || 1;
      const picked = (prompt.selectedIds || []).length;
      this.confirmBtn.disabled = picked !== need;
      this.confirmBtn.textContent =
        need === 1 ? 'Confirm discard' : `Confirm (${picked}/${need})`;
    }

    if (this.cardsEl) {
      window.RawDeal.CardRenderer.clearContainer(this.cardsEl);
      const row = document.createElement('div');
      row.className = 'rd-hand';

      const selectedSet = new Set(prompt.selectedIds || []);

      for (const card of prompt.cards || []) {
        const clickable = isSelect;
        const el = window.RawDeal.CardRenderer.createCardEl(card, {
          small: true,
          clickable,
          onClick: clickable
            ? (e) => {
                e.stopPropagation();
                if (this.onToggleSelect) this.onToggleSelect(card.instanceId);
              }
            : undefined,
        });
        if (isSelect && selectedSet.has(card.instanceId)) {
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
      this.cardsEl.classList.toggle('rd-hand-reveal-modal__scroll--overflow', overflows);
    });
  }
};