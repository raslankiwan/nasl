import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatNumber, type Locale } from '@nasl/i18n';
import { apiClient, ApiError } from '../api/client';
import { PageHead } from '../components/Layout';

interface Product {
  _id: string;
  nameAr: string;
  nameEn: string;
  kind: string;
  activeIngredient: string | null;
  withdrawalMeatDays: number;
  withdrawalMilkDays: number;
  manufacturer: string | null;
  source: string | null;
}

const KINDS = ['vaccine', 'antibiotic', 'anthelmintic', 'analgesic', 'mineral', 'other'] as const;

const BLANK = {
  nameAr: '',
  nameEn: '',
  kind: 'antibiotic',
  activeIngredient: '',
  withdrawalMeatDays: 0,
  withdrawalMilkDays: 0,
  manufacturer: '',
  source: '',
};

export function Products() {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'ar') as Locale;
  const queryClient = useQueryClient();

  const [form, setForm] = useState({ ...BLANK });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'products'],
    queryFn: () => apiClient.get<{ products: Product[] }>('/v1/admin/products'),
  });

  const create = useMutation({
    mutationFn: () =>
      apiClient.post('/v1/admin/products', {
        ...form,
        activeIngredient: form.activeIngredient || undefined,
        manufacturer: form.manufacturer || undefined,
        withdrawalMeatDays: Number(form.withdrawalMeatDays),
        withdrawalMilkDays: Number(form.withdrawalMilkDays),
      }),
    onSuccess: async () => {
      setForm({ ...BLANK });
      setOpen(false);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'products'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t('common:errorRetry')),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  const set = (key: keyof typeof BLANK) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <>
      <PageHead title={t('admin:products')}>
        <button className="primary" type="button" onClick={() => setOpen((v) => !v)}>
          {t('admin:addProduct')}
        </button>
      </PageHead>

      {/* This warning is the whole reason farm users cannot edit these numbers. */}
      <div className="notice danger">{t('admin:withdrawalWarning')}</div>

      {open ? (
        <form className="card" style={{ marginBlockEnd: 20 }} onSubmit={onSubmit}>
          {error ? <div className="notice danger">{error}</div> : null}
          <div className="form-grid">
            <div className="field">
              <label htmlFor="nameAr">{t('admin:productNameAr')}</label>
              <input
                id="nameAr"
                dir="rtl"
                value={form.nameAr}
                onChange={(e) => set('nameAr')(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="nameEn">{t('admin:productNameEn')}</label>
              <input
                id="nameEn"
                dir="ltr"
                value={form.nameEn}
                onChange={(e) => set('nameEn')(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="kind">{t('admin:kind')}</label>
              <select id="kind" value={form.kind} onChange={(e) => set('kind')(e.target.value)}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ingredient">{t('admin:activeIngredient')}</label>
              <input
                id="ingredient"
                dir="ltr"
                value={form.activeIngredient}
                onChange={(e) => set('activeIngredient')(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="meat">{t('admin:withdrawalMeat')}</label>
              <input
                id="meat"
                type="number"
                min={0}
                max={365}
                dir="ltr"
                value={form.withdrawalMeatDays}
                onChange={(e) => set('withdrawalMeatDays')(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="milk">{t('admin:withdrawalMilk')}</label>
              <input
                id="milk"
                type="number"
                min={0}
                max={365}
                dir="ltr"
                value={form.withdrawalMilkDays}
                onChange={(e) => set('withdrawalMilkDays')(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="manufacturer">{t('admin:manufacturer')}</label>
              <input
                id="manufacturer"
                value={form.manufacturer}
                onChange={(e) => set('manufacturer')(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="source">{t('admin:source')}</label>
              <input
                id="source"
                value={form.source}
                onChange={(e) => set('source')(e.target.value)}
                required
              />
              <span className="hint">{t('admin:sourceHint')}</span>
            </div>
          </div>
          <button className="primary" type="submit" disabled={create.isPending}>
            {t('common:save')}
          </button>
        </form>
      ) : null}

      <div className="table-wrap">
        {isLoading ? (
          <div className="loading">{t('common:loading')}</div>
        ) : data && data.products.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>{t('admin:productNameAr')}</th>
                <th>{t('admin:kind')}</th>
                <th>{t('admin:withdrawalMeat')}</th>
                <th>{t('admin:withdrawalMilk')}</th>
                <th>{t('admin:source')}</th>
              </tr>
            </thead>
            <tbody>
              {data.products.map((p) => (
                <tr key={p._id}>
                  <td>
                    {p.nameAr}
                    <div className="mono" style={{ color: 'var(--muted)' }}>
                      {p.nameEn}
                    </div>
                  </td>
                  <td>
                    <span className="pill">{p.kind}</span>
                  </td>
                  <td className="num">{formatNumber(p.withdrawalMeatDays, locale)}</td>
                  <td className="num">{formatNumber(p.withdrawalMilkDays, locale)}</td>
                  <td style={{ color: 'var(--muted)', fontSize: '0.84rem' }}>{p.source ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">{t('common:empty')}</div>
        )}
      </div>
    </>
  );
}
