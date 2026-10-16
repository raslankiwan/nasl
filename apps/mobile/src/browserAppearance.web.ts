export function applyBrowserAppearance(dark: boolean, paper: string) {
  if (typeof document === 'undefined') return;
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.documentElement.style.backgroundColor = paper;
  document.body.style.backgroundColor = paper;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', paper);
}
