import type { AccountStatus } from '@nasl/shared';
import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDate, type Locale } from '@nasl/i18n';
import { apiClient, ApiError } from '../api/client';
import { AccountReview } from '../components/AccountReview';
import { PageHead } from '../components/Layout';
import { UserLink, type UserSummary } from '../components/UserLink';
import { AssignOwnerForm, type OwnershipFarm } from '../components/AssignOwnerForm';

interface UserDetails extends UserSummary {
  email: string;
  username: string;
  emailVerificationRequired?: boolean;
  emailVerifiedAt?: string | null;
  status: AccountStatus;
  locale: string;
  isPlatformAdmin: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  farms: Array<
    OwnershipFarm & { role: string | null; status: string | null; expiresAt: string | null }
  >;
}

export function UserDetail() {
  const { userId } = useParams({ from: '/users/$userId' });
  const { t, i18n } = useTranslation(['admin', 'auth', 'common', 'roles']);
  const locale = (i18n.resolvedLanguage ?? 'ar') as Locale;
  const [linking, setLinking] = useState(false);
  const [saved, setSaved] = useState(false);
  const { data, isPending, error } = useQuery({
    queryKey: ['admin', 'user', userId],
    queryFn: () => apiClient.get<UserDetails>(`/v1/admin/users/${userId}`),
  });
  if (isPending) return <div className="loading">{t('common:loading')}</div>;
  if (!data || error)
    return (
      <div className="notice danger" role="alert">
        {error instanceof ApiError && error.status === 404
          ? t('admin:recordNotFound')
          : t('common:errorRetry')}
      </div>
    );
  return (
    <>
      <Link to="/users">{t('admin:users')}</Link>
      <PageHead title={data.name || data.username}>
        <button
          className="primary"
          type="button"
          onClick={() => {
            setLinking(!linking);
            setSaved(false);
          }}
          aria-expanded={linking}
          disabled={data.status !== 'approved'}
        >
          {t('admin:linkFarm')}
        </button>
      </PageHead>
      {saved ? (
        <div className="notice" role="status">
          {t('admin:ownerSaved')}
        </div>
      ) : null}
      <AccountReview
        key={userId}
        userId={userId}
        status={data.status}
        emailUnverified={data.emailVerificationRequired === true && !data.emailVerifiedAt}
        isPlatformAdmin={data.isPlatformAdmin}
        userName={data.name || data.username}
        hasFarm={data.farms.some(
          (farm) =>
            farm.ownerUserId === userId ||
            (farm.status === 'active' &&
              (!farm.expiresAt || new Date(farm.expiresAt).getTime() > Date.now())),
        )}
      />
      <p className="notice">
        {t(
          data.emailVerifiedAt
            ? 'auth:emailVerified'
            : data.emailVerificationRequired
              ? 'auth:emailUnverified'
              : 'auth:emailLegacy',
        )}
      </p>
      <dl className="card detail-grid section">
        <div>
          <dt>{t('auth:username')}</dt>
          <dd>
            <bdi>{data.username}</bdi>
          </dd>
        </div>
        <div>
          <dt>{t('admin:accountStatus')}</dt>
          <dd>{t(`admin:accountStates.${data.status}`)}</dd>
        </div>
        <div>
          <dt>{t('auth:email')}</dt>
          <dd>
            <a href={`mailto:${data.email}`}>
              <bdi>{data.email}</bdi>
            </a>
          </dd>
        </div>
        <div>
          <dt>{t('admin:accountType')}</dt>
          <dd>{t(data.isPlatformAdmin ? 'admin:platformStaff' : 'admin:regularUser')}</dd>
        </div>
        <div>
          <dt>{t('common:language')}</dt>
          <dd>{data.locale === 'ar' ? 'العربية' : 'English'}</dd>
        </div>
        <div>
          <dt>{t('admin:created')}</dt>
          <dd>{formatDate(new Date(data.createdAt), locale)}</dd>
        </div>
        <div>
          <dt>{t('admin:lastSignIn')}</dt>
          <dd>
            {data.lastSeenAt
              ? formatDate(new Date(data.lastSeenAt), locale)
              : t('admin:neverSignedIn')}
          </dd>
        </div>
      </dl>
      {linking ? (
        <AssignOwnerForm
          key={userId}
          user={data}
          onCancel={() => setLinking(false)}
          onDone={() => {
            setLinking(false);
            setSaved(true);
          }}
        />
      ) : null}
      <h2>{t('admin:relatedFarms')}</h2>
      <div className="table-wrap">
        {data.farms.length === 0 ? (
          <div className="empty">{t('admin:noRelatedFarms')}</div>
        ) : (
          <table className="responsive-table" role="table">
            <thead>
              <tr>
                <th>{t('admin:farms')}</th>
                <th>{t('admin:owner')}</th>
                <th>{t('admin:role')}</th>
                <th>{t('admin:memberStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {data.farms.map((farm) => (
                <tr key={farm.id}>
                  <td data-label={t('admin:farms')}>
                    <Link to="/farms/$farmId" params={{ farmId: farm.id }}>
                      {farm.name}
                    </Link>
                  </td>
                  <td data-label={t('admin:owner')}>
                    {farm.owner ? <UserLink user={farm.owner} /> : t('common:unknown')}
                  </td>
                  <td data-label={t('admin:role')}>
                    {farm.role ? t(`roles:${farm.role}` as 'roles:owner') : t('common:none')}
                  </td>
                  <td data-label={t('admin:memberStatus')}>
                    {farm.status
                      ? t(
                          `admin:membershipStates.${farm.expiresAt && new Date(farm.expiresAt).getTime() < Date.now() && farm.status === 'active' ? 'expired' : farm.status}` as 'admin:membershipStates.active',
                        )
                      : t('common:none')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
