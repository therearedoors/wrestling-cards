window.RawDeal = window.RawDeal || {};

/**
 * Reusable choice modal for engine-driven player decisions.
 * Prompt shape: { message, options: [{ id, label }] }
 */
window.RawDeal.ChoiceModal = class ChoiceModal {
  constructor(rootEl) {
    this.root = rootEl;
    this.messageEl = rootEl.querySelector('[data-rd-choice-message]');
    this.actionsEl = rootEl.querySelector('[data-rd-choice-actions]');
    this.onSelect = null;
  }

  show(prompt) {
    if (!prompt?.options?.length) {
      this.hide();
      return;
    }

    this.root.classList.remove('hidden');
    if (this.messageEl) {
      this.messageEl.textContent = prompt.message || 'Choose one:';
    }

    if (this.actionsEl) {
      this.actionsEl.innerHTML = '';
      for (const option of prompt.options) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rd-btn rd-btn--primary rd-choice-modal__btn';
        btn.textContent = option.label;
        btn.addEventListener('click', () => {
          if (this.onSelect) this.onSelect(option.id);
        });
        this.actionsEl.appendChild(btn);
      }
    }
  }

  hide() {
    this.root.classList.add('hidden');
    if (this.actionsEl) this.actionsEl.innerHTML = '';
  }
};