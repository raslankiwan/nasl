import { useTranslation } from 'react-i18next';

export const PAGE_SIZE = 25;

export function Pagination({
  skip,
  total,
  onChange,
}: {
  skip: number;
  total: number;
  onChange: (skip: number) => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  if (total <= PAGE_SIZE) return null;
  return (
    <nav className="page-actions pagination" aria-label={t('admin:pagination')}>
      <button
        type="button"
        disabled={skip === 0}
        onClick={() => onChange(Math.max(0, skip - PAGE_SIZE))}
      >
        {t('common:back')}
      </button>
      <span>
        {t('admin:pageOf', {
          page: Math.floor(skip / PAGE_SIZE) + 1,
          pages: Math.ceil(total / PAGE_SIZE),
        })}
      </span>
      <button
        type="button"
        disabled={skip + PAGE_SIZE >= total}
        onClick={() => onChange(skip + PAGE_SIZE)}
      >
        {t('common:next')}
      </button>
    </nav>
  );
}
