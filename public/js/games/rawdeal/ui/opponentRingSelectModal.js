window.RawDeal = window.RawDeal || {};

/**
 * Modal for selecting a card from the opponent's Ring (e.g. Shake It Off).
 */
window.RawDeal.OpponentRingSelectModal = class OpponentRingSelectModal {
  constructor(rootEl) {
    this.root = rootEl;
    this.messageEl = rootEl.querySelector('[data-rd-opponent-ring-message]');
    this.bodyEl = rootEl.querySelector('[data-rd-opponent-ring-body]');
    this.confirmBtn = rootEl.querySelector('[data-rd-opponent-ring-confirm]');
    this.onConfirm = null;
    this.onToggleSelect = null;
    this._prompt = null;

    this.confirmBtn?.addEventListener('click', () => {
      if (!this._prompt?.selectedId) return;
      const selectedId = this._prompt.selectedId;
      const ringArea = this._findSelectedRingArea(selectedId);
      this.hide();
      if (this.onConfirm) this.onConfirm(selectedId, ringArea);
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
      this.messageEl.textContent = prompt.message || "Choose a card from opponent's Ring.";
    }

    if (this.confirmBtn) {
      this.confirmBtn.disabled = !prompt.selectedId;
    }

    if (this.bodyEl) {
      window.RawDeal.CardRenderer.clearContainer(this.bodyEl);

      const sections = prompt.sections || [];
      if (!sections.length) {
        const empty = document.createElement('p');
        empty.className = 'rd-opponent-ring-modal__empty';
        empty.textContent = "Opponent's Ring is empty.";
        this.bodyEl.appendChild(empty);
        return;
      }

      for (const section of sections) {
        if (!section.cards?.length) continue;

        const heading = document.createElement('p');
        heading.className = 'rd-opponent-ring-modal__section-label';
        heading.textContent = section.label;
        this.bodyEl.appendChild(heading);

        const row = document.createElement('div');
        row.className = 'rd-opponent-ring-modal__cards';

        for (const card of section.cards) {
          const selected = prompt.selectedId === card.instanceId;
          const el = window.RawDeal.CardRenderer.createCardEl(card, {
            small: true,
            clickable: !!card.selectable,
            onClick: card.selectable
              ? (e) => {
                  e.stopPropagation();
                  if (this.onToggleSelect) {
                    this.onToggleSelect(card.instanceId, card.ringArea);
                  }
                }
              : undefined,
          });

          if (!card.selectable) {
            el.classList.add('rd-card--unaffordable');
            el.title = `D ${card.ringDamage ?? 0} exceeds your Fortitude`;
          }
          if (selected) {
            el.classList.add('rd-card--selected');
          }
          row.appendChild(el);
        }

        this.bodyEl.appendChild(row);
      }
    }
  }

  hide() {
    this.root.classList.add('hidden');
    this._prompt = null;
    if (this.bodyEl) {
      window.RawDeal.CardRenderer.clearContainer(this.bodyEl);
    }
  }

  _findSelectedRingArea(instanceId) {
    for (const section of this._prompt?.sections || []) {
      const match = section.cards?.find((card) => card.instanceId === instanceId);
      if (match) return match.ringArea;
    }
    return null;
  }
};