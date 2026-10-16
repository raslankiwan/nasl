import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AccountStatus } from '@nasl/shared';
import { apiClient, ApiError } from '../api/client';

export function AccountReview({
  userId,
  status,
  isPlatformAdmin,
  userName,
  hasFarm,
}: {
  userId: string;
  status: AccountStatus;
  isPlatformAdmin: boolean;
  userName: string;
  hasFarm: boolean;
}) {
  const { t } = useTranslation(['admin', 'common', 'animals']);
  const id = useId();
  const [createFarm, setCreateFarm] = useState(!hasFarm);
  const [farmName, setFarmName] = useState(() =>
    t('admin:approvalFarmName', { name: userName }).slice(0, 120),
  );
  const [species, setSpecies] = useState('sheep');
  const queries = useQueryClient();
  const review = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') =>
      apiClient.patch<{ farm?: { id: string; name: string } }>(
        `/v1/admin/users/${userId}/approval`,
        {
          status: decision,
          expectedStatus: status,
          ...(decision === 'approved' && createFarm && !hasFarm
            ? {
                farm: {
                  name: farmName.trim(),
                  species: species === 'both' ? ['sheep', 'goat'] : [species],
                },
              }
            : {}),
        },
      ),
    onSuccess: () => queries.invalidateQueries({ queryKey: ['admin'] }),
  });
  return (
    <>
      {review.isSuccess ? (
        <div className="notice" role="status">
          {review.data?.farm
            ? t('admin:approvalFarmSaved', { name: review.data.farm.name })
            : t('admin:approvalSaved')}
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
        <form
          className="card section"
          aria-label={t('admin:accountStatus')}
          onSubmit={(event) => {
            event.preventDefault();
            if (!review.isPending) review.mutate('approved');
          }}
        >
          <p>{t('admin:approvalHint')}</p>
          <fieldset disabled={review.isPending}>
            {hasFarm ? (
              <p className="hint">{t('admin:approvalExistingFarm')}</p>
            ) : (
              <>
                <label className="check-field" htmlFor={`${id}-create`}>
                  <input
                    id={`${id}-create`}
                    type="checkbox"
                    checked={createFarm}
                    onChange={(event) => setCreateFarm(event.target.checked)}
                  />
                  <span>{t('admin:createFarmOnApproval')}</span>
                </label>
                {createFarm ? (
                  <>
                    <p className="hint">{t('admin:approvalFarmHint')}</p>
                    <div className="form-grid">
                      <div className="field">
                        <label htmlFor={`${id}-name`}>{t('animals:farmName')}</label>
                        <input
                          id={`${id}-name`}
                          value={farmName}
                          onChange={(event) => setFarmName(event.target.value)}
                          maxLength={120}
                          required
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`${id}-species`}>{t('animals:species')}</label>
                        <select
                          id={`${id}-species`}
                          value={species}
                          onChange={(event) => setSpecies(event.target.value)}
                        >
                          <option value="sheep">{t('animals:speciesValues.sheep')}</option>
                          <option value="goat">{t('animals:speciesValues.goat')}</option>
                          <option value="both">{t('admin:sheepAndGoats')}</option>
                        </select>
                      </div>
                    </div>
                    <p className="hint">{t('admin:farmDefaults')}</p>
                  </>
                ) : null}
              </>
            )}
          </fieldset>
          <div className="page-actions">
            <button
              className="primary"
              type="submit"
              disabled={review.isPending || (createFarm && !hasFarm && !farmName.trim())}
            >
              {t(createFarm && !hasFarm ? 'admin:approveWithFarm' : 'admin:approveAccount')}
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
        </form>
      ) : null}
    </>
  );
}
