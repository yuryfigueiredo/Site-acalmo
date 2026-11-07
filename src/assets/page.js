const button = document.querySelector('#page-theme');
function render() { const dark = document.documentElement.dataset.theme === 'dark'; button.textContent = dark ? 'Modo claro' : 'Modo noturno'; button.setAttribute('aria-pressed', String(dark)); const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = dark ? '#091e32' : '#eef5f0'; }
button?.addEventListener('click', () => { const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme; try { localStorage.setItem('acalmo:theme', theme); } catch { /* Choice still works in this page. */ } render(); });
if (button) render();
document.querySelector('#print-guide')?.addEventListener('click', () => window.print());

// Mesmo diálogo nativo da página inicial: foco preso, Esc e toque fora fecham, e o gatilho recebe o foco de volta.
const menuTrigger = document.querySelector('#page-menu');
const menu = document.querySelector('#page-menu-dialog');
if (menu && menuTrigger) {
  menuTrigger.addEventListener('click', () => { if (!menu.open) menu.showModal(); });
  menu.querySelector('[data-close]')?.addEventListener('click', () => menu.close());
  menu.addEventListener('click', event => { if (event.target === menu) menu.close(); });
  menu.addEventListener('close', () => menuTrigger.focus({ preventScroll: true }));
  menu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => menu.close()));
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
