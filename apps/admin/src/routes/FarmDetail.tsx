import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDate, formatNumber, type Locale } from '@nasl/i18n';
import { apiClient, ApiError } from '../api/client';
import { PageHead } from '../components/Layout';
import { UserLink, type UserSummary } from '../components/UserLink';
import { AssignOwnerForm } from '../components/AssignOwnerForm';

interface FarmDetailBody {
  id: string;
  name: string;
  ownerUserId: string;
  owner: UserSummary | null;
  country: string;
  currency: string;
  timezone: string;
  species: string[];
  calendarPreference: string;
  plan: string;
  headCount: number;
  lastActivityAt: string | null;
  createdAt: string;
  members: Array<{
    userId: string;
    name: string | null;
    phone: string | null;
    role: string;
    status: string;
    expiresAt: string | null;
  }>;
}

const PLANS = ['free', 'standard', 'commercial'] as const;

export function FarmDetail() {
  const { farmId } = useParams({ from: '/farms/$farmId' });
  const { t, i18n } = useTranslation(['admin', 'common', 'roles']);
  const locale = (i18n.resolvedLanguage ?? 'ar') as Locale;
  const queryClient = useQueryClient();

  const [plan, setPlan] = useState<string>('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [changingOwner, setChangingOwner] = useState(false);
  const [ownerSaved, setOwnerSaved] = useState(false);

  const {
    data,
    isLoading,
    error: loadError,
  } = useQuery({
    queryKey: ['admin', 'farm', farmId],
    queryFn: () => apiClient.get<FarmDetailBody>(`/v1/admin/farms/${farmId}`),
  });

  const changePlan = useMutation({
    mutationFn: () => apiClient.patch(`/v1/admin/farms/${farmId}/plan`, { plan, reason }),
    onSuccess: async () => {
      setReason('');
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'farm', farmId] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t('common:errorRetry')),
  });

  if (isLoading) return <div className="loading">{t('common:loading')}</div>;
  if (!data || loadError)
    return (
      <div className="notice danger" role="alert">
        {loadError instanceof ApiError && loadError.status === 404
          ? t('admin:recordNotFound')
          : t('common:errorRetry')}
      </div>
    );

  return (
    <>
      <Link to="/farms">{t('admin:farms')}</Link>
      <PageHead title={data.name}>
        <button
          type="button"
          className="primary"
          aria-expanded={changingOwner}
          onClick={() => {
            setChangingOwner(!changingOwner);
            setOwnerSaved(false);
          }}
        >
          {t('admin:changeOwner')}
        </button>
      </PageHead>
      <p>
        {t('admin:owner')}: {data.owner ? <UserLink user={data.owner} /> : t('common:unknown')}
      </p>
      {ownerSaved ? (
        <div className="notice" role="status">
          {t('admin:ownerSaved')}
        </div>
      ) : null}
      {changingOwner ? (
        <AssignOwnerForm
          key={farmId}
          farm={data}
          onCancel={() => setChangingOwner(false)}
          onDone={() => {
            setChangingOwner(false);
            setOwnerSaved(true);
          }}
        />
      ) : null}

      <div className="stat-row">
        <div className="card stat">
          <div className="v">{formatNumber(data.headCount, locale)}</div>
          <div className="l">{t('admin:headCount')}</div>
        </div>
        <div className="card stat">
          <div className="v" style={{ fontSize: '1.2rem' }}>
            {data.plan}
          </div>
          <div className="l">{t('admin:plan')}</div>
        </div>
        <div className="card stat">
          <div className="v" style={{ fontSize: '1.05rem' }}>
            {data.lastActivityAt
              ? formatDate(new Date(data.lastActivityAt), locale)
              : t('common:none')}
          </div>
          <div className="l">{t('admin:lastActivity')}</div>
        </div>
      </div>

      <div className="card" style={{ marginBlockEnd: 20 }}>
        <h2 style={{ marginBlockStart: 0, fontSize: '1rem' }}>{t('admin:changePlan')}</h2>
        {error ? <div className="notice danger">{error}</div> : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            changePlan.mutate();
          }}
        >
          <div className="form-grid">
            <div className="field">
              <label htmlFor="plan">{t('admin:plan')}</label>
              <select id="plan" value={plan} onChange={(e) => setPlan(e.target.value)} required>
                <option value="">—</option>
                {PLANS.filter((p) => p !== data.plan).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="reason">{t('admin:reason')}</label>
              <input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                minLength={3}
                required
              />
              <span className="hint">{t('admin:reasonHint')}</span>
            </div>
          </div>
          <button
            className="primary"
            type="submit"
            disabled={changePlan.isPending || !plan || reason.trim().length < 3}
          >
            {t('common:save')}
          </button>
        </form>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('admin:members')}</th>
              <th>{t('admin:role')}</th>
              <th>{t('admin:memberStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {data.members.map((m) => (
              <tr key={m.userId}>
                <td>
                  <UserLink user={{ id: m.userId, name: m.name, phone: m.phone }} />
                </td>
                <td>{t(`roles:${m.role}` as 'roles:owner')}</td>
                <td>
                  <span className={`pill${m.status === 'active' ? ' good' : ''}`}>
                    {t(
                      `admin:membershipStates.${m.expiresAt && new Date(m.expiresAt).getTime() < Date.now() && m.status === 'active' ? 'expired' : m.status}` as 'admin:membershipStates.active',
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
