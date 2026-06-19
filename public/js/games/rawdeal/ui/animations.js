window.RawDeal = window.RawDeal || {};

window.RawDeal.Animations = {
  /**
   * Fly a face-down card from Arsenal, flip it at Ringside, then land it in the pile.
   * onReveal fires when the flip completes — that's when the card joins Ringside.
   */
  flipArsenalToRingside(card, fromEl, toEl, options = {}) {
    const { onReveal, isReversal = false } = options;

    return new Promise((resolve) => {
      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();
      const cardW = 58;
      const gap = 4;
      const existingCards = toEl.querySelectorAll('.rd-card').length;

      const startX = fromRect.left + fromRect.width / 2;
      const startY = fromRect.top + fromRect.height / 2;
      const endX = toRect.left + 10 + existingCards * (cardW + gap) + cardW / 2;
      const endY = toRect.top + toRect.height / 2;

      const flying = window.RawDeal.CardRenderer.createCardEl(card, { small: true });
      flying.classList.add('rd-card--flying', 'rd-card--face-down');
      if (isReversal) flying.classList.add('rd-card--flying-reversal');
      document.body.appendChild(flying);

      const inner = flying.querySelector('.rd-card__inner');
      let revealed = false;

      const landCard = () => {
        if (revealed) return;
        revealed = true;
        if (onReveal) onReveal();
        flying.style.transition = 'opacity 0.12s ease';
        flying.style.opacity = '0';
        setTimeout(() => {
          flying.remove();
          resolve();
        }, 130);
      };

      flying.style.left = `${startX}px`;
      flying.style.top = `${startY}px`;
      flying.style.transform = 'translate(-50%, -50%)';

      requestAnimationFrame(() => {
        flying.style.transition = 'left 0.45s cubic-bezier(0.4, 0, 0.2, 1), top 0.45s cubic-bezier(0.4, 0, 0.2, 1)';
        flying.style.left = `${endX}px`;
        flying.style.top = `${endY}px`;
      });

      setTimeout(() => {
        inner.style.transition = 'transform 0.4s ease-in-out';
        flying.classList.remove('rd-card--face-down');

        const onFlipDone = (e) => {
          if (e.propertyName !== 'transform') return;
          inner.removeEventListener('transitionend', onFlipDone);
          landCard();
        };

        inner.addEventListener('transitionend', onFlipDone);
        setTimeout(landCard, 450);
      }, 460);
    });
  },

  pulseEl(el) {
    el.classList.remove('rd-pulse');
    void el.offsetWidth;
    el.classList.add('rd-pulse');
  },
};