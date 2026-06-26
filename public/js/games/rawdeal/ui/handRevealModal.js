window.RawDeal = window.RawDeal || {};

/**
 * View-only modal for revealing an opponent's hand.
 * Prompt shape: { message, cards: Card[] }
 */
window.RawDeal.HandRevealModal = class HandRevealModal {
  constructor(rootEl) {
    this.root = rootEl;
    this.messageEl = rootEl.querySelector('[data-rd-hand-reveal-message]');
    this.cardsEl = rootEl.querySelector('[data-rd-hand-reveal-cards]');
    this.doneBtn = rootEl.querySelector('[data-rd-hand-reveal-done]');
    this.onDismiss = null;

    this.doneBtn?.addEventListener('click', () => {
      this.hide();
      if (this.onDismiss) this.onDismiss();
    });
  }

  show(prompt) {
    if (!prompt) {
      this.hide();
      return;
    }

    this.root.classList.remove('hidden');
    if (this.messageEl) {
      this.messageEl.textContent = prompt.message || "Opponent's hand";
    }

    if (this.cardsEl) {
      window.RawDeal.CardRenderer.clearContainer(this.cardsEl);
      const row = document.createElement('div');
      row.className = 'rd-hand';

      for (const card of prompt.cards || []) {
        const el = window.RawDeal.CardRenderer.createCardEl(card, { small: true });
        row.appendChild(el);
      }

      this.cardsEl.appendChild(row);
      this._updateScroll();
    }
  }

  hide() {
    this.root.classList.add('hidden');
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