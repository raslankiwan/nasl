import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDate, formatNumber, type Locale } from '@nasl/i18n';
import { apiClient } from '../api/client';
import { PageHead } from '../components/Layout';
import { UserLink, type UserSummary } from '../components/UserLink';
import { Pagination, PAGE_SIZE } from '../components/Pagination';

interface UserRow extends UserSummary {
  ownedFarmCount: number;
  isPlatformAdmin: boolean;
  createdAt: string;
  lastSeenAt: string | null;
}

export function Users() {
  const { t, i18n } = useTranslation(['admin', 'common', 'auth']);
  const locale = (i18n.resolvedLanguage ?? 'ar') as Locale;
  const [q, setQ] = useState('');
  const [skip, setSkip] = useState(0);
  const { data, isPending, isError } = useQuery({
    queryKey: ['admin', 'users', q, skip],
    queryFn: () =>
      apiClient.get<{ users: UserRow[]; total: number }>(
        `/v1/admin/users?q=${encodeURIComponent(q)}&skip=${skip}&limit=${PAGE_SIZE}`,
      ),
  });
  return (
    <>
      <PageHead title={t('admin:users')}>
        <input
          className="directory-search"
          type="search"
          maxLength={80}
          value={q}
          aria-label={t('admin:searchUsers')}
          placeholder={t('admin:searchUsers')}
          onChange={(e) => {
            setQ(e.target.value);
            setSkip(0);
          }}
        />
      </PageHead>
      <div className="table-wrap">
        {isPending ? (
          <div className="loading">{t('common:loading')}</div>
        ) : isError ? (
          <div className="notice danger" role="alert">
            {t('common:errorRetry')}
          </div>
        ) : data.users.length === 0 ? (
          <div className="empty">{t('admin:noUsers')}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('admin:users')}</th>
                <th>{t('auth:phoneNumber')}</th>
                <th>{t('admin:accountType')}</th>
                <th>{t('admin:ownedFarms')}</th>
                <th>{t('admin:lastSignIn')}</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <UserLink user={user} />
                  </td>
                  <td>
                    <UserLink user={{ ...user, name: null }} />
                  </td>
                  <td>{t(user.isPlatformAdmin ? 'admin:platformStaff' : 'admin:regularUser')}</td>
                  <td>{formatNumber(user.ownedFarmCount, locale)}</td>
                  <td>
                    {user.lastSeenAt
                      ? formatDate(new Date(user.lastSeenAt), locale)
                      : t('admin:neverSignedIn')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Pagination skip={skip} total={data?.total ?? 0} onChange={setSkip} />
    </>
  );
}
