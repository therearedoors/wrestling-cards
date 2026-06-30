window.RawDeal = window.RawDeal || {};

/**
 * Modal for Ringside card selection (superstar abilities, Roll Out of the Ring, etc.).
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
      if (!this._prompt || !this._canConfirm(this._prompt)) return;
      const selection = this._selectionForConfirm(this._prompt);
      this.hide();
      if (this.onConfirm) this.onConfirm(selection);
    });
  }

  _selectCount(prompt) {
    return prompt.selectCount ?? 1;
  }

  _selectedIds(prompt) {
    return prompt.selectedIds || [];
  }

  _isSelected(prompt, instanceId) {
    if (this._selectCount(prompt) > 1) {
      return this._selectedIds(prompt).includes(instanceId);
    }
    return prompt.selectedId === instanceId;
  }

  _canConfirm(prompt) {
    if (this._selectCount(prompt) > 1) {
      return this._selectedIds(prompt).length === this._selectCount(prompt);
    }
    return !!prompt.selectedId;
  }

  _selectionForConfirm(prompt) {
    if (this._selectCount(prompt) > 1) {
      return [...this._selectedIds(prompt)];
    }
    return prompt.selectedId;
  }

  show(prompt) {
    if (!prompt) {
      this.hide();
      return;
    }

    this._prompt = prompt;
    this.root.classList.remove('hidden');

    if (this.messageEl) {
      this.messageEl.textContent = prompt.message || 'Choose from Ringside';
    }

    if (this.passBtn) {
      const showPass = prompt.allowPass !== false;
      this.passBtn.classList.toggle('hidden', !showPass);
      this.passBtn.disabled = !showPass;
    }

    if (this.confirmBtn) {
      this.confirmBtn.disabled = !this._canConfirm(prompt);
    }

    if (this.cardsEl) {
      window.RawDeal.CardRenderer.clearContainer(this.cardsEl);
      const row = document.createElement('div');
      row.className = 'rd-hand';

      for (const card of prompt.cards || []) {
        const selected = this._isSelected(prompt, card.instanceId);
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