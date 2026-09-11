import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatNumber, type Locale } from '@nasl/i18n';
import { apiClient } from '../api/client';
import { PageHead } from '../components/Layout';

interface Stats {
  farms: number;
  users: number;
  activeAnimals: number;
  plans: Record<string, number>;
}

export function Dashboard() {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'ar') as Locale;

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => apiClient.get<Stats>('/v1/admin/stats'),
  });

  const n = (value: number) => formatNumber(value, locale);

  return (
    <>
      <PageHead title={t('admin:dashboard')} />

      {isLoading ? (
        <div className="loading">{t('common:loading')}</div>
      ) : (
        <>
          <div className="stat-row">
            <div className="card stat">
              <div className="v">{n(data?.farms ?? 0)}</div>
              <div className="l">{t('admin:totalFarms')}</div>
            </div>
            <div className="card stat">
              <div className="v">{n(data?.users ?? 0)}</div>
              <div className="l">{t('admin:totalUsers')}</div>
            </div>
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
