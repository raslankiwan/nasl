import type { ReactNode } from 'react';
import { Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LanguageToggle } from './LanguageToggle';
import type { StaffUser } from '../auth/useAuth';

interface Props {
  user: StaffUser;
  onSignOut: () => void;
}

export function Layout({ user, onSignOut }: Props) {
  const { t } = useTranslation(['admin', 'common', 'auth']);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span>نَسْل</span> Nasl
          <small>{t('admin:title')}</small>
        </div>

        <nav className="nav">
          <Link to="/" activeProps={{ className: 'active' }} activeOptions={{ exact: true }}>
            {t('admin:dashboard')}
          </Link>
          <Link to="/farms" activeProps={{ className: 'active' }}>
            {t('admin:farms')}
          </Link>
          <Link to="/products" activeProps={{ className: 'active' }}>
            {t('admin:products')}
          </Link>
          <Link to="/audit" activeProps={{ className: 'active' }}>
            {t('admin:auditLog')}
          </Link>
        </nav>

        <div className="sidebar-foot">
          <LanguageToggle />
          <span>{user.name ?? t('common:unknown')}</span>
          <button type="button" onClick={onSignOut}>
            {t('auth:signOut')}
          </button>
        </div>
      </aside>

      <main>
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
