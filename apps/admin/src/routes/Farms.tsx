import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDate, formatNumber, type Locale } from '@nasl/i18n';
import { apiClient } from '../api/client';
import { PageHead } from '../components/Layout';

interface FarmRow {
  id: string;
  name: string;
  country: string;
  currency: string;
  plan: string;
  headCount: number;
  owner: { id: string; name: string | null } | null;
  createdAt: string;
}

export function Farms() {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'ar') as Locale;
  const [q, setQ] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'farms', q],
    queryFn: () =>
      apiClient.get<{ farms: FarmRow[]; total: number }>(
        `/v1/admin/farms${q ? `?q=${encodeURIComponent(q)}` : ''}`,
      ),
  });

  return (
    <>
      <PageHead title={t('admin:farms')}>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('admin:searchFarms')}
          aria-label={t('admin:searchFarms')}
          style={{ maxWidth: 260 }}
        />
      </PageHead>

      <div className="table-wrap">
        {isLoading ? (
          <div className="loading">{t('common:loading')}</div>
        ) : data && data.farms.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>{t('common:none') === '' ? '' : t('admin:farms')}</th>
                <th>{t('admin:owner')}</th>
                <th>{t('admin:headCount')}</th>
                <th>{t('admin:plan')}</th>
                <th>{t('admin:created')}</th>
              </tr>
            </thead>
            <tbody>
              {data.farms.map((farm) => (
                <tr key={farm.id}>
                  <td>
                    <Link to="/farms/$farmId" params={{ farmId: farm.id }}>
                      {farm.name}
                    </Link>
                  </td>
                  <td>{farm.owner?.name ?? t('common:unknown')}</td>
                  <td className="num">{formatNumber(farm.headCount, locale)}</td>
                  <td>
                    <span className={`pill${farm.plan === 'free' ? '' : ' accent'}`}>
                      {farm.plan}
                    </span>
                  </td>
                  <td>{formatDate(new Date(farm.createdAt), locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">{t('admin:noFarms')}</div>
        )}
      </div>
    </>
  );
}
