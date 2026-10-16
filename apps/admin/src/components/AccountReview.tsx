import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AccountStatus } from '@nasl/shared';
import { apiClient, ApiError } from '../api/client';

export function AccountReview({
  userId,
  status,
  isPlatformAdmin,
}: {
  userId: string;
  status: AccountStatus;
  isPlatformAdmin: boolean;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const queries = useQueryClient();
  const review = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') =>
      apiClient.patch(`/v1/admin/users/${userId}/approval`, {
        status: decision,
        expectedStatus: status,
      }),
    onSuccess: () => queries.invalidateQueries({ queryKey: ['admin'] }),
  });
  return (
    <>
      {review.isSuccess ? (
        <div className="notice" role="status">
          {t('admin:approvalSaved')}
        </div>
      ) : null}
      {review.isError ? (
        <div className="notice danger" role="alert">
          {t(
            review.error instanceof ApiError && review.error.status === 409
              ? 'admin:approvalConflict'
              : 'common:errorRetry',
          )}
        </div>
      ) : null}
      {!isPlatformAdmin && status !== 'approved' ? (
        <section className="card section" aria-label={t('admin:accountStatus')}>
          <p>{t('admin:approvalHint')}</p>
          <div className="page-actions">
            <button
              className="primary"
              type="button"
              disabled={review.isPending}
              onClick={() => review.mutate('approved')}
            >
              {t('admin:approveAccount')}
            </button>
            {status === 'pending' ? (
              <button
                type="button"
                disabled={review.isPending}
                onClick={() => review.mutate('rejected')}
              >
                {t('admin:rejectAccount')}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
    </>
  );
}
