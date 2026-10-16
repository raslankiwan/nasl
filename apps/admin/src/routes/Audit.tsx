import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDate, type Locale } from '@nasl/i18n';
import { apiClient } from '../api/client';
import { PageHead } from '../components/Layout';
import { Link } from '@tanstack/react-router';
import { UserLink, type UserSummary } from '../components/UserLink';

interface Entry {
  id: string;
  actor: UserSummary;
  action: string;
  targetType: string;
  targetId: string;
  targetName: string | null;
  reason: string | null;
  createdAt: string;
}

export function Audit() {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'ar') as Locale;

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: () => apiClient.get<{ entries: Entry[] }>('/v1/admin/audit'),
  });

  return (
    <>
      <PageHead title={t('admin:auditLog')} />

      <div className="table-wrap">
        {isLoading ? (
          <div className="loading">{t('common:loading')}</div>
        ) : data && data.entries.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>{t('admin:when')}</th>
                <th>{t('admin:actor')}</th>
                <th>{t('admin:action')}</th>
                <th>{t('admin:target')}</th>
                <th>{t('admin:reason')}</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((entry) => (
                <tr key={entry.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {formatDate(new Date(entry.createdAt), locale, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </td>
                  <td>
                    <UserLink user={entry.actor} />
                  </td>
                  <td>
                    <span className="mono">{entry.action}</span>
                  </td>
                  <td>
                    {entry.targetType === 'farm' ? (
                      <Link to="/farms/$farmId" params={{ farmId: entry.targetId }}>
                        {entry.targetName || entry.targetId}
                      </Link>
                    ) : entry.targetType === 'user' ? (
                      <UserLink user={{ id: entry.targetId, name: null }} />
                    ) : (
                      <span className="mono">{entry.targetId}</span>
                    )}
                  </td>
                  <td>{entry.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">{t('admin:noEntries')}</div>
        )}
      </div>
    </>
  );
}
