import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LanguageToggle } from './LanguageToggle';
import type { StaffUser } from '../auth/useAuth';
import { UserLink } from './UserLink';
import { AppPreferences } from './AppPreferences';

interface Props {
  user: StaffUser;
  onSignOut: () => void;
}

export function Layout({ user, onSignOut }: Props) {
  const { t } = useTranslation(['admin', 'common', 'auth']);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [menuOpen]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">
        {t('admin:skipToContent')}
      </a>
      <header className="mobile-header">
        <div className="brand">
          <span>نَسْل</span> <small>{t('admin:title')}</small>
        </div>
        <button
          ref={menuButton}
          className="menu-toggle"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="admin-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d={menuOpen ? 'M6 6l12 12M18 6L6 18' : 'M4 6h16M4 12h16M4 18h16'} />
          </svg>
          {t(menuOpen ? 'admin:closeMenu' : 'admin:menu')}
        </button>
      </header>
      <aside id="admin-navigation" className={`sidebar${menuOpen ? ' is-open' : ''}`}>
        <div className="brand">
          <span>نَسْل</span> Nasl
          <small>{t('admin:title')}</small>
        </div>

        <nav className="nav" aria-label={t('admin:navigation')}>
          <Link
            to="/"
            onClick={() => setMenuOpen(false)}
            activeProps={{ className: 'active' }}
            activeOptions={{ exact: true }}
          >
            {t('admin:dashboard')}
          </Link>
          <Link
            to="/farms"
            onClick={() => setMenuOpen(false)}
            activeProps={{ className: 'active' }}
          >
            {t('admin:farms')}
          </Link>
          <Link
            to="/products"
            onClick={() => setMenuOpen(false)}
            activeProps={{ className: 'active' }}
          >
            {t('admin:products')}
          </Link>
          <Link
            to="/users"
            onClick={() => setMenuOpen(false)}
            activeProps={{ className: 'active' }}
          >
            {t('admin:users')}
          </Link>
          <Link
            to="/audit"
            onClick={() => setMenuOpen(false)}
            activeProps={{ className: 'active' }}
          >
            {t('admin:auditLog')}
          </Link>
          <Link
            to="/security"
            onClick={() => setMenuOpen(false)}
            activeProps={{ className: 'active' }}
          >
            {t('auth:security')}
          </Link>
        </nav>

        <div className="sidebar-foot">
          <AppPreferences />
          <LanguageToggle />
          <div onClick={() => setMenuOpen(false)}>
            <UserLink user={user} />
          </div>
          <button type="button" onClick={onSignOut}>
            {t('auth:signOut')}
          </button>
        </div>
      </aside>

      <main id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}

export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <h1>{title}</h1>
      {children}
    </div>
  );
}
