import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDate, type Locale } from '@nasl/i18n';
import { apiClient, ApiError } from '../api/client';

interface Invitation {
  id: string;
  email: string;
  state: string;
  expiresAt: string;
}
export function AdminInvitations() {
  const { t, i18n } = useTranslation(['admin', 'auth', 'common']);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const queries = useQueryClient();
  const list = useQuery({
    queryKey: ['admin', 'invitations'],
    queryFn: () =>
      apiClient.get<{ emailConfigured: boolean; invitations: Invitation[] }>(
        '/v1/admin/invitations',
      ),
    enabled: open,
  });
  const send = useMutation({
    mutationFn: () =>
      apiClient.post('/v1/admin/invitations', {
        email: email.trim(),
        locale: i18n.resolvedLanguage === 'en' ? 'en' : 'ar',
      }),
    onSuccess: async () => {
      setEmail('');
      await queries.invalidateQueries({ queryKey: ['admin', 'invitations'] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiClient.post(`/v1/admin/invitations/${id}/revoke`),
    onSuccess: () => queries.invalidateQueries({ queryKey: ['admin', 'invitations'] }),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!send.isPending) send.mutate();
  };
  const error = send.error ?? revoke.error;
  return (
    <section className="card section">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t('admin:adminInvitations')}
      </button>
      {open ? (
        <>
          <p>{t('admin:adminInviteHint')}</p>
          {list.isPending ? (
            <p>{t('common:loading')}</p>
          ) : list.isError ? (
            <div className="notice danger" role="alert">
              {t('common:errorRetry')}
            </div>
          ) : (
            <>
              {!list.data.emailConfigured ? (
                <div className="notice" role="status">
                  {t('admin:emailSenderMissing')}
                </div>
              ) : null}
              <form onSubmit={submit}>
                <div className="field">
                  <label htmlFor="admin-invite-email">{t('auth:email')}</label>
                  <input
                    id="admin-invite-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    maxLength={254}
                    dir="ltr"
                    required
                  />
                </div>
                <button
                  className="primary"
                  type="submit"
                  disabled={!list.data.emailConfigured || send.isPending}
                >
                  {t(send.isPending ? 'common:loading' : 'admin:sendAdminInvite')}
                </button>
              </form>
              {send.isSuccess ? (
                <div className="notice" role="status">
                  {t('admin:inviteSent')}
                </div>
              ) : null}
              {error ? (
                <div className="notice danger" role="alert">
                  {t(
                    error instanceof ApiError && error.code === 'conflict'
                      ? 'admin:inviteConflict'
                      : `auth:errors.${error instanceof ApiError ? error.code : 'internal'}`,
                    { defaultValue: t('common:errorRetry') },
                  )}
                </div>
              ) : null}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t('auth:email')}</th>
                      <th>{t('admin:accountStatus')}</th>
                      <th>{t('admin:inviteExpires')}</th>
                      <th>{t('admin:inviteAction')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.invitations.map((invite) => (
                      <tr key={invite.id}>
                        <td dir="ltr">{invite.email}</td>
                        <td>{t(`admin:inviteStates.${invite.state}`)}</td>
                        <td>
                          {formatDate(
                            new Date(invite.expiresAt),
                            (i18n.resolvedLanguage ?? 'ar') as Locale,
                          )}
                        </td>
                        <td>
                          {['pending', 'sent'].includes(invite.state) ? (
                            <button
                              type="button"
                              disabled={revoke.isPending}
                              onClick={() => revoke.mutate(invite.id)}
                            >
                              {t('admin:revokeInvite')}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      ) : null}
    </section>
  );
}
