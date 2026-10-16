import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDate, formatNumber, type Locale } from '@nasl/i18n';
import { apiClient } from '../api/client';
import { PageHead } from '../components/Layout';
import { CreateFarmForm } from '../components/CreateFarmForm';
import { UserLink, type UserSummary } from '../components/UserLink';
import { Pagination, PAGE_SIZE } from '../components/Pagination';

interface FarmRow {
  id: string;
  name: string;
  country: string;
  currency: string;
  plan: string;
  headCount: number;
  owner: UserSummary | null;
  createdAt: string;
}

export function Farms() {
  const { t, i18n } = useTranslation(['admin', 'common', 'animals']);
  const locale = (i18n.resolvedLanguage ?? 'ar') as Locale;
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [skip, setSkip] = useState(0);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'farms', q, skip],
    queryFn: () =>
      apiClient.get<{ farms: FarmRow[]; total: number }>(
        `/v1/admin/farms?q=${encodeURIComponent(q)}&skip=${skip}&limit=${PAGE_SIZE}`,
      ),
  });

  return (
    <>
      <PageHead title={t('admin:farms')}>
        <div className="page-actions">
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSkip(0);
            }}
            maxLength={80}
            placeholder={t('admin:searchFarms')}
            aria-label={t('admin:searchFarms')}
            style={{ width: 260, maxWidth: '100%' }}
          />
          <button
            className="primary"
            type="button"
            aria-expanded={creating}
            aria-controls="create-farm"
            onClick={() => setCreating((value) => !value)}
          >
            {t('animals:createFarm')}
          </button>
        </div>
      </PageHead>

      {creating ? (
        <CreateFarmForm
          onCancel={() => setCreating(false)}
          onCreated={(farmId) => {
            setCreating(false);
            void queryClient.invalidateQueries({ queryKey: ['admin'] });
            void navigate({ to: '/farms/$farmId', params: { farmId } });
          }}
        />
      ) : null}

      <div className="table-wrap">
        {isLoading ? (
          <div className="loading">{t('common:loading')}</div>
        ) : isError ? (
          <div className="notice danger" role="alert">
            {t('common:errorRetry')}
          </div>
        ) : data && data.farms.length > 0 ? (
          <table className="responsive-table" role="table">
            <thead>
              <tr>
                <th>{t('admin:farms')}</th>
                <th>{t('admin:owner')}</th>
                <th>{t('admin:headCount')}</th>
                <th>{t('admin:plan')}</th>
                <th>{t('admin:created')}</th>
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
                  <td data-label={t('admin:headCount')} className="num">
                    {formatNumber(farm.headCount, locale)}
                  </td>
                  <td data-label={t('admin:plan')}>
                    <span className={`pill${farm.plan === 'free' ? '' : ' accent'}`}>
                      {farm.plan}
                    </span>
                  </td>
                  <td data-label={t('admin:created')}>
                    {formatDate(new Date(farm.createdAt), locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">{t('admin:noFarms')}</div>
        )}
      </div>
      <Pagination skip={skip} total={data?.total ?? 0} onChange={setSkip} />
    </>
  );
}
