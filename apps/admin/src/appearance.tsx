import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Preference = 'system' | 'light' | 'dark';
const key = 'nasl.theme';
function readPreference(): Preference {
  try {
    const value = localStorage.getItem(key);
    if (value === 'light' || value === 'dark') return value;
  } catch {
    /* Storage may be unavailable in private browsing. */
  }
  return 'system';
}
const Context = createContext({
  preference: 'system' as Preference,
  setPreference: (_value: Preference) => {},
});

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [preference, setValue] = useState(readPreference);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = preference === 'dark' || (preference === 'system' && media?.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? '#0f1624' : '#f3f4f7');
    };
    apply();
    media?.addEventListener('change', apply);
    return () => media?.removeEventListener('change', apply);
  }, [preference]);
  useEffect(() => {
    const onStorage = () => setValue(readPreference());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const setPreference = (value: Preference) => {
    setValue(value);
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Keep the in-memory choice. */
    }
  };
  return <Context.Provider value={{ preference, setPreference }}>{children}</Context.Provider>;
}
export const useAppearance = () => useContext(Context);
