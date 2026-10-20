import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient, ApiError } from '../api/client';

export function ImpersonateUser({ userId }: { userId: string }) {
  const { t } = useTranslation(['admin', 'common']);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  return (
    <form
      className="card section"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        setLink(null);
        void apiClient
          .post<{ url: string }>(`/v1/admin/users/${userId}/impersonation`, { reason })
          .then((result) => setLink(result.url))
          .catch((error: unknown) =>
            setError(error instanceof ApiError ? error.message : t('common:errorRetry')),
          )
          .finally(() => setBusy(false));
      }}
    >
      <h2>{t('admin:impersonate')}</h2>
      <p>{t('admin:impersonateHint')}</p>
      <label>
        {t('admin:supportReason')}
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          minLength={3}
          maxLength={300}
          required
        />
      </label>
      {error ? (
        <p className="notice danger" role="alert">
          {error}
        </p>
      ) : null}
      <button className="primary" disabled={busy || reason.trim().length < 3}>
        {t('admin:startSupport')}
      </button>
      {link ? (
        <p>
          <a href={link} target="_blank" rel="noopener noreferrer" onClick={() => setLink(null)}>
            {t('admin:openSupport')}
          </a>
        </p>
      ) : null}
    </form>
  );
}
