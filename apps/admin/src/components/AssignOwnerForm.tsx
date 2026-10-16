import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient, ApiError } from '../api/client';
import { UserLink, type UserSummary } from './UserLink';
import { Pagination, PAGE_SIZE } from './Pagination';

export interface OwnershipFarm {
  id: string;
  name: string;
  ownerUserId: string;
  owner: UserSummary | null;
}

/** Used from either side of the relationship: pick an owner for a farm, or a farm for a user. */
export function AssignOwnerForm({
  farm: fixedFarm,
  user: fixedUser,
  onDone,
  onCancel,
}: {
  farm?: OwnershipFarm;
  user?: UserSummary;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [skip, setSkip] = useState(0);
  const [selectedFarm, setSelectedFarm] = useState<OwnershipFarm | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserSummary | null>(null);
  const [reason, setReason] = useState('');
  const farm = fixedFarm ?? selectedFarm;
  const owner = fixedUser ?? selectedUser;
  const searchingFarms = Boolean(fixedUser);
  const path = searchingFarms ? 'farms' : 'users';
  const { data, isPending, isError } = useQuery({
    queryKey: ['admin', 'owner-picker', path, q, skip],
    queryFn: () =>
      apiClient.get<{ farms?: OwnershipFarm[]; users?: UserSummary[]; total: number }>(
        `/v1/admin/${path}?q=${encodeURIComponent(q)}&skip=${skip}&limit=${PAGE_SIZE}${searchingFarms ? '' : '&status=approved'}`,
      ),
  });
  const change = useMutation({
    mutationFn: () =>
      apiClient.patch(`/v1/admin/farms/${farm!.id}/owner`, {
        expectedOwnerUserId: farm!.ownerUserId,
        ownerUserId: owner!.id,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      onDone();
    },
  });
  const conflict = change.error instanceof ApiError && change.error.status === 409;
  const errorMessage = conflict
    ? t('admin:ownerChangedConflict')
    : change.error instanceof ApiError && change.error.status === 400
      ? t('admin:checkOwnerDetails')
      : change.error instanceof ApiError && change.error.status === 404
        ? t('admin:recordNotFound')
        : t('common:errorRetry');
  const valid = farm && owner && owner.id !== farm.ownerUserId;

  return (
    <form
      className="card section"
      aria-label={t(fixedUser ? 'admin:linkFarm' : 'admin:changeOwner')}
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !change.isPending && !conflict) change.mutate();
      }}
    >
      <h2>{t(fixedUser ? 'admin:linkFarm' : 'admin:changeOwner')}</h2>
      {change.error ? (
        <div className="notice danger" role="alert">
          {errorMessage}
        </div>
      ) : null}
      <fieldset disabled={change.isPending || conflict}>
        <div className="field">
          <label htmlFor="assignment-search">
            {t(searchingFarms ? 'admin:searchFarms' : 'admin:searchUsers')}
          </label>
          <input
            id="assignment-search"
            type="search"
            value={q}
            maxLength={80}
            onChange={(e) => {
              setQ(e.target.value);
              setSkip(0);
            }}
          />
        </div>
        {isPending ? (
          <p>{t('common:loading')}</p>
        ) : isError ? (
          <div role="alert">{t('common:errorRetry')}</div>
        ) : (
          <>
            <div className="picker-options">
              {searchingFarms
                ? data?.farms?.map((item) => (
                    <label key={item.id} className="picker-option">
                      <input
                        type="radio"
                        name="assignment-farm"
                        checked={farm?.id === item.id}
                        disabled={item.ownerUserId === fixedUser?.id}
                        onChange={() => setSelectedFarm(item)}
                      />
                      <span>
                        {item.name}
                        {item.ownerUserId === fixedUser?.id ? ` — ${t('admin:alreadyOwner')}` : ''}
                      </span>
                    </label>
                  ))
                : data?.users?.map((item) => (
                    <label key={item.id} className="picker-option">
                      <input
                        type="radio"
                        name="assignment-user"
                        checked={owner?.id === item.id}
                        disabled={item.id === fixedFarm?.ownerUserId}
                        onChange={() => setSelectedUser(item)}
                      />
                      <span>
                        <bdi>{item.name || item.username}</bdi>
                        {item.name ? (
                          <>
                            {' '}
                            · <bdi>{item.username}</bdi>
                          </>
                        ) : null}
                      </span>
                    </label>
                  ))}
              {data?.total === 0 ? (
                <p>{t(searchingFarms ? 'admin:noFarms' : 'admin:noUsers')}</p>
              ) : null}
            </div>
            <Pagination skip={skip} total={data?.total ?? 0} onChange={setSkip} />
          </>
        )}
        {farm ? (
          <p>
            {t('admin:farms')}: <strong>{farm.name}</strong> · {t('admin:currentOwner')}:{' '}
            {farm.owner ? <UserLink user={farm.owner} /> : t('common:unknown')}
          </p>
        ) : null}
        {owner ? (
          <p>
            {t('admin:newOwner')}: <UserLink user={owner} />
          </p>
        ) : null}
        <div className="notice">{t('admin:ownershipEffect')}</div>
        <div className="field">
          <label htmlFor="ownership-reason">{t('admin:reasonOptional')}</label>
          <input
            id="ownership-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
          />
          <span className="hint">{t('admin:reasonHint')}</span>
        </div>
        <button className="primary" type="submit" disabled={!valid || change.isPending}>
          {change.isPending ? t('common:loading') : t('admin:saveOwner')}
        </button>
      </fieldset>
      <button
        type="button"
        className="cancel-action"
        disabled={change.isPending}
        onClick={onCancel}
      >
        {t('common:cancel')}
      </button>
    </form>
  );
}
