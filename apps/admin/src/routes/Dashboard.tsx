import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatNumber, type Locale } from '@nasl/i18n';
import { apiClient } from '../api/client';
import { PageHead } from '../components/Layout';
import { Link } from '@tanstack/react-router';

interface Stats {
  farms: number;
  users: number;
  activeAnimals: number;
  plans: Record<string, number>;
}

export function Dashboard() {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'ar') as Locale;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => apiClient.get<Stats>('/v1/admin/stats'),
  });

  const n = (value: number) => formatNumber(value, locale);

  return (
    <>
      <PageHead title={t('admin:dashboard')} />

      {isLoading ? (
        <div className="loading">{t('common:loading')}</div>
      ) : isError ? (
        <div className="notice danger" role="alert">
          {t('common:errorRetry')}{' '}
          <button type="button" onClick={() => void refetch()}>
            {t('common:retry')}
          </button>
        </div>
      ) : (
        <>
          <div className="stat-row">
            <Link to="/farms" className="card stat stat-link">
              <div className="v">{n(data?.farms ?? 0)}</div>
              <div className="l">{t('admin:totalFarms')}</div>
            </Link>
            <Link to="/users" className="card stat stat-link">
              <div className="v">{n(data?.users ?? 0)}</div>
              <div className="l">{t('admin:totalUsers')}</div>
            </Link>
            <div className="card stat">
              <div className="v">{n(data?.activeAnimals ?? 0)}</div>
              <div className="l">{t('admin:activeAnimals')}</div>
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginBlockStart: 0, fontSize: '1rem' }}>{t('admin:plan')}</h2>
            {Object.entries(data?.plans ?? {}).length === 0 ? (
              <div className="empty">{t('common:empty')}</div>
            ) : (
              <ul style={{ margin: 0, paddingInlineStart: '1.1rem' }}>
                {Object.entries(data?.plans ?? {}).map(([plan, count]) => (
                  <li key={plan}>
                    {plan} — <span className="num">{n(count)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </>
  );
}
