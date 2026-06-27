window.RawDeal = window.RawDeal || {};

/**
 * View-only modal for inspecting a full Ring or Ringside pile.
 */
window.RawDeal.PileViewModal = class PileViewModal {
  constructor(rootEl) {
    this.root = rootEl;
    this.titleEl = rootEl.querySelector('[data-rd-pile-view-title]');
    this.bodyEl = rootEl.querySelector('[data-rd-pile-view-body]');
    this.doneBtn = rootEl.querySelector('[data-rd-pile-view-done]');
    this.backdrop = rootEl.querySelector('.rd-pile-view-modal__backdrop');

    this.doneBtn?.addEventListener('click', () => this.hide());
    this.backdrop?.addEventListener('click', () => this.hide());

    this._onKeyDown = (e) => {
      if (e.key === 'Escape' && !this.root.classList.contains('hidden')) {
        this.hide();
      }
    };
    document.addEventListener('keydown', this._onKeyDown);
  }

  show({ title, sections }) {
    if (!title) {
      this.hide();
      return;
    }

    this.root.classList.remove('hidden');

    if (this.titleEl) {
      this.titleEl.textContent = title;
    }

    if (this.bodyEl) {
      window.RawDeal.CardRenderer.clearContainer(this.bodyEl);

      const allCards = (sections || []).flatMap((s) => s.cards || []);
      if (allCards.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'rd-pile-view-modal__empty';
        empty.textContent = 'No cards in this pile.';
        this.bodyEl.appendChild(empty);
        return;
      }

      for (const section of sections || []) {
        if (!section.cards?.length) continue;

        if (section.label) {
          const heading = document.createElement('p');
          heading.className = 'rd-pile-view-modal__section-label';
          heading.textContent = section.label;
          this.bodyEl.appendChild(heading);
        }

        const row = document.createElement('div');
        row.className = 'rd-pile-view-modal__cards';

        for (const card of section.cards) {
          row.appendChild(window.RawDeal.CardRenderer.createCardEl(card, { small: true }));
        }

        this.bodyEl.appendChild(row);
      }
    }
  }

  hide() {
    this.root.classList.add('hidden');
    if (this.bodyEl) {
      window.RawDeal.CardRenderer.clearContainer(this.bodyEl);
    }
  }

  isVisible() {
    return !this.root.classList.contains('hidden');
  }
};