window.RawDeal = window.RawDeal || {};

window.RawDeal.Animations = {
  /**
   * Animate a card flipping from the Arsenal pile to Ringside.
   * Returns a promise that resolves when the animation completes.
   */
  flipArsenalToRingside(card, fromEl, toEl) {
    return new Promise((resolve) => {
      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();

      const flying = window.RawDeal.CardRenderer.createCardEl(card, { faceDown: true });
      flying.classList.add('rd-card--flying');
      document.body.appendChild(flying);

      const startX = fromRect.left + fromRect.width / 2;
      const startY = fromRect.top + fromRect.height / 2;
      const endX = toRect.left + toRect.width / 2;
      const endY = toRect.top + toRect.height / 2;

      flying.style.left = `${startX}px`;
      flying.style.top = `${startY}px`;

      requestAnimationFrame(() => {
        flying.style.transform = `translate(-50%, -50%) translate(${endX - startX}px, ${endY - startY}px) rotateY(540deg) scale(0.85)`;
        flying.classList.add('rd-card--revealed');
      });

      const onDone = () => {
        flying.remove();
        resolve();
      };

      flying.addEventListener('transitionend', onDone, { once: true });
      setTimeout(onDone, 750);
    });
  },

  pulseEl(el) {
    el.classList.remove('rd-pulse');
    void el.offsetWidth;
    el.classList.add('rd-pulse');
  },
};