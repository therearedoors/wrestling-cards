window.RawDeal = window.RawDeal || {};

window.RawDeal.DevConsole = class DevConsole {
  constructor(rootEl, engine) {
    this.engine = engine;
    this.logEl = rootEl.querySelector('[data-rd-dev-log]');
    this.inputEl = rootEl.querySelector('[data-rd-dev-input]');
    this.formEl = rootEl.querySelector('[data-rd-dev-form]');

    this.formEl?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
  }

  log(message, isError = false) {
    if (!this.logEl || !message) return;
    const line = document.createElement('div');
    line.className = `rd-dev-console__line${isError ? ' rd-dev-console__line--error' : ''}`;
    line.textContent = message;
    this.logEl.appendChild(line);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  submit() {
    const line = this.inputEl?.value?.trim();
    if (!line) return;

    this.log(`> ${line}`);
    const result = window.RawDeal.DevCommands.execute(this.engine, line);
    if (result.message) {
      this.log(result.message, !result.ok);
    }

    if (this.inputEl) this.inputEl.value = '';
  }
};