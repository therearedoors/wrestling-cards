window.RawDeal = window.RawDeal || {};

window.RawDeal.CardPreview = class CardPreview {
  constructor(rootEl) {
    this.root = rootEl;
    this.els = {
      empty: rootEl.querySelector('.rd-preview__empty'),
      content: rootEl.querySelector('.rd-preview__content'),
      type: rootEl.querySelector('.rd-preview__type'),
      name: rootEl.querySelector('.rd-preview__name'),
      stats: rootEl.querySelector('.rd-preview__stats'),
      rules: rootEl.querySelector('.rd-preview__rules'),
      flavor: rootEl.querySelector('.rd-preview__flavor'),
      cardMount: rootEl.querySelector('.rd-preview__card-mount'),
    };
  }

  show(card) {
    if (!card || !card.id) {
      this.clear();
      return;
    }

    this.els.empty.classList.add('hidden');
    this.els.content.classList.remove('hidden');

    const utils = window.RawDeal.CardUtils;
    const color = window.RawDeal.CARD_COLORS[utils.primaryType(card)] || '#555';
    this.els.content.style.setProperty('--preview-color', color);

    this.els.type.textContent = this._typeLabel(card);
    this.els.name.textContent = card.name;
    this.els.stats.innerHTML = this._statsHtml(card);
    this.els.rules.textContent = this._rulesText(card);
    this.els.flavor.textContent = card.flavor || '';
    this.els.flavor.closest('.rd-preview__section').classList.toggle('hidden', !card.flavor);

    window.RawDeal.CardRenderer.clearContainer(this.els.cardMount);
    this.els.cardMount.appendChild(
      window.RawDeal.CardRenderer.createCardEl(card, { preview: true })
    );
  }

  clear() {
    this.els.empty.classList.remove('hidden');
    this.els.content.classList.add('hidden');
    window.RawDeal.CardRenderer.clearContainer(this.els.cardMount);
  }

  _typeLabel(card) {
    const utils = window.RawDeal.CardUtils;
    if (utils.isSuperstar(card)) return 'Superstar';
    if (utils.isHybrid(card)) return utils.typesLabel(card);
    return utils.typeLabel(card, utils.primaryType(card));
  }

  _statsHtml(card) {
    const parts = [];
    if (card.handSize !== undefined) parts.push(`<span>Hand ${card.handSize}</span>`);
    if (card.superstarValue !== undefined) parts.push(`<span>SV ${card.superstarValue}</span>`);
    if (card.fortitude !== undefined) parts.push(`<span class="rd-preview__fort">Fortitude ${card.fortitude}</span>`);
    if (card.damage) parts.push(`<span class="rd-preview__dmg">Damage ${card.damage}</span>`);
    return parts.join('');
  }

  _rulesText(card) {
    const utils = window.RawDeal.CardUtils;
    if (utils.isSuperstar(card) && card.ability) return card.ability;
    return card.text || '';
  }
};