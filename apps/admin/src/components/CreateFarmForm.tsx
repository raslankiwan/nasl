import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient, ApiError } from '../api/client';

interface Props {
  onCreated: (farmId: string) => void;
  onCancel: () => void;
}

export function CreateFarmForm({ onCreated, onCancel }: Props) {
  const { t } = useTranslation(['admin', 'animals', 'common']);
  const [name, setName] = useState('');
  const [ownerIdentifier, setOwnerIdentifier] = useState('');
  const [species, setSpecies] = useState('sheep');
  const [reason, setReason] = useState('');

  const create = useMutation({
    mutationFn: () =>
      apiClient.post<{ id: string }>('/v1/admin/farms', {
        name: name.trim(),
        ownerIdentifier: ownerIdentifier.trim(),
        species: species === 'both' ? ['sheep', 'goat'] : [species],
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: (farm) => onCreated(farm.id),
  });

  const error = create.error;
  const errorMessage =
    error instanceof ApiError && error.status === 400
      ? t('admin:checkFarmDetails')
      : t('common:errorRetry');

  return (
    <form
      id="create-farm"
      className="card"
      style={{ marginBlockEnd: 20 }}
      aria-label={t('animals:createFarm')}
      onSubmit={(event) => {
        event.preventDefault();
        if (!create.isPending) create.mutate();
      }}
    >
      <h2 style={{ marginBlockStart: 0, fontSize: '1rem' }}>{t('animals:createFarm')}</h2>
      {error ? (
        <div className="notice danger" role="alert">
          {errorMessage}
        </div>
      ) : null}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="farm-name">{t('animals:farmName')}</label>
          <input
            id="farm-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="owner-account">{t('admin:ownerAccount')}</label>
          <input
            id="owner-account"
            type="text"
            dir="ltr"
            autoComplete="off"
            autoCapitalize="none"
            value={ownerIdentifier}
            onChange={(event) => setOwnerIdentifier(event.target.value)}
            minLength={3}
            maxLength={254}
            aria-describedby="owner-account-hint"
            required
          />
          <span id="owner-account-hint" className="hint">
            {t('admin:ownerAccountHint')}
          </span>
        </div>
        <div className="field">
          <label htmlFor="farm-species">{t('animals:species')}</label>
          <select
            id="farm-species"
            value={species}
            onChange={(event) => setSpecies(event.target.value)}
          >
            <option value="sheep">{t('animals:speciesValues.sheep')}</option>
            <option value="goat">{t('animals:speciesValues.goat')}</option>
            <option value="both">{t('admin:sheepAndGoats')}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="farm-reason">{t('admin:reasonOptional')}</label>
          <input
            id="farm-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={300}
          />
          <span className="hint">{t('admin:reasonHint')}</span>
        </div>
      </div>
      <p className="hint">{t('admin:farmDefaults')}</p>
      <div className="page-actions">
        <button
          className="primary"
          type="submit"
          disabled={create.isPending || !name.trim() || !ownerIdentifier.trim()}
        >
          {create.isPending ? t('common:loading') : t('common:save')}
        </button>
        <button type="button" disabled={create.isPending} onClick={onCancel}>
          {t('common:cancel')}
        </button>
      </div>
    </form>
  );
}
