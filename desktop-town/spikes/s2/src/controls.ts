/** In-app benchmark launcher: WebKitGTK users need not edit Tauri config or open DevTools. */
const count = document.querySelector<HTMLInputElement>('#actors');
const apply = document.querySelector<HTMLButtonElement>('#apply-count');
const idle = document.querySelector<HTMLButtonElement>('#bench-idle');
const walk = document.querySelector<HTMLButtonElement>('#bench-walk');
const soak = document.querySelector<HTMLButtonElement>('#bench-soak');
if (!count || !apply || !idle || !walk || !soak) throw new Error('S2 benchmark controls missing');
count.value = new URLSearchParams(location.search).get('actors') ?? '1';
function launch(mode?: 'idle' | 'walk', seconds?: number): void {
  const n = Number(count!.value);
  if (!Number.isSafeInteger(n) || n < 0 || n > 128) { count!.setCustomValidity('Enter an integer from 0 to 128'); count!.reportValidity(); return; }
  count!.setCustomValidity('');
  const url = new URL(location.href);
  url.searchParams.set('actors', String(n));
  if (mode && seconds) { url.searchParams.set('benchmark', mode); url.searchParams.set('seconds', String(seconds)); }
  else { url.searchParams.delete('benchmark'); url.searchParams.delete('seconds'); }
  location.assign(url.toString());
}
apply.addEventListener('click', () => launch());
idle.addEventListener('click', () => launch('idle', 60));
walk.addEventListener('click', () => launch('walk', 60));
soak.addEventListener('click', () => launch('walk', 1800));

export {}; // Each source file is an isolated ES module.
