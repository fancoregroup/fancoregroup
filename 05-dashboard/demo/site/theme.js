'use strict';
(() => {
  const key = 'fancore-dashboard-theme';
  const stylesheet = document.getElementById('dark-theme');
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const sun = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>';
  const moon = '<path d="M20.5 13.4A9 9 0 0 1 10.6 3.5a9 9 0 1 0 9.9 9.9Z"/>';
  let current = 'dark';

  function apply(value, persist = false) {
    current = value === 'orange' ? 'orange' : 'dark';
    const dark = current === 'dark';
    stylesheet.media = dark ? 'all' : 'not all';
    document.documentElement.dataset.theme = current;
    themeColor.content = dark ? '#111516' : '#ed6c05';
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      const action = dark ? 'Ativar tema laranja' : 'Ativar tema escuro';
      button.title = action;
      button.setAttribute('aria-label', action);
      button.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${dark ? sun : moon}</svg><span>${dark ? 'Tema laranja' : 'Tema escuro'}</span>`;
    });
    if (persist) {
      try { localStorage.setItem(key, current); } catch (_) { /* Mantém a escolha nesta página se o navegador bloquear armazenamento. */ }
    }
  }

  let saved;
  try { saved = localStorage.getItem(key); } catch (_) { /* Primeiro acesso ou armazenamento indisponível. */ }
  apply(saved);
  document.addEventListener('DOMContentLoaded', () => {
    apply(current);
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.addEventListener('click', () => apply(current === 'dark' ? 'orange' : 'dark', true));
    });
  });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) apply(event.newValue);
  });
})();
