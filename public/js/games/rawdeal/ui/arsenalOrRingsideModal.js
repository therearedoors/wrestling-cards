window.RawDeal = window.RawDeal || {};

/**
 * Modal for picking 1 card from Arsenal or Ringside (Mr. Socko, etc.).
 */
window.RawDeal.ArsenalOrRingsideModal = class ArsenalOrRingsideModal {
  constructor(rootEl) {
    this.root = rootEl;
    this.messageEl = rootEl.querySelector('[data-rd-arsenal-ringside-message]');
    this.arsenalCardsEl = rootEl.querySelector('[data-rd-arsenal-ringside-arsenal-cards]');
    this.ringsideCardsEl = rootEl.querySelector('[data-rd-arsenal-ringside-ringside-cards]');
    this.confirmBtn = rootEl.querySelector('[data-rd-arsenal-ringside-confirm]');
    this.onSelect = null;
    this.onConfirm = null;
    this._prompt = null;

    this.confirmBtn?.addEventListener('click', () => {
      if (!this._prompt?.selectedId || !this._prompt?.selectedZone) return;
      const selectedId = this._prompt.selectedId;
      const selectedZone = this._prompt.selectedZone;
      this.hide();
      if (this.onConfirm) {
        this.onConfirm(selectedId, selectedZone);
      }
    });
  }

  _pickCard(instanceId, zone) {
    this.hide();
    if (this.onSelect) {
      this.onSelect(instanceId, zone);
    }
  }

  show(prompt) {
    if (!prompt) {
      this.hide();
      return;
    }

    this._prompt = prompt;
    this.root.classList.remove('hidden');

    if (this.messageEl) {
      this.messageEl.textContent = prompt.message || 'Choose from Arsenal or Ringside';
    }

    if (this.confirmBtn) {
      this.confirmBtn.classList.add('hidden');
    }

    this._renderZone(
      this.arsenalCardsEl,
      prompt.arsenalCards || [],
      'arsenal',
      prompt.selectedId,
      prompt.selectedZone
    );
    this._renderZone(
      this.ringsideCardsEl,
      prompt.ringsideCards || [],
      'ringside',
      prompt.selectedId,
      prompt.selectedZone
    );
  }

  _renderZone(container, cards, zone, selectedId, selectedZone) {
    if (!container) return;
    window.RawDeal.CardRenderer.clearContainer(container);
    const row = document.createElement('div');
    row.className = 'rd-hand';

    for (const card of cards) {
      const selected = selectedId === card.instanceId && selectedZone === zone;
      const el = window.RawDeal.CardRenderer.createCardEl(card, {
        small: true,
        clickable: true,
        onClick: (e) => {
          e.stopPropagation();
          this._pickCard(card.instanceId, zone);
        },
      });
      if (selected) {
        el.classList.add('rd-card--selected');
      }
      row.appendChild(el);
    }

    container.appendChild(row);
  }

  hide() {
    this.root.classList.add('hidden');
    this._prompt = null;
    if (this.arsenalCardsEl) {
      window.RawDeal.CardRenderer.clearContainer(this.arsenalCardsEl);
    }
    if (this.ringsideCardsEl) {
      window.RawDeal.CardRenderer.clearContainer(this.ringsideCardsEl);
    }
  }
};