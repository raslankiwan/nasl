import type * as ClientModule from '../api/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { initI18n } from '../i18n';
import { apiClient } from '../api/client';
import { Dashboard } from './Dashboard';
import { Products } from './Products';
import { Audit } from './Audit';
vi.mock('../api/client', async (original) => ({
  ...(await original<typeof ClientModule>()),
  apiClient: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
beforeEach(async () => {
  await initI18n('en');
});
afterEach(() => {
  vi.clearAllMocks();
});
for (const [name, Component, response] of [
  ['dashboard', Dashboard, { farms: 12, users: 4, activeAnimals: 56, plans: {} }],
  ['products', Products, { products: [] }],
  ['audit', Audit, { entries: [] }],
] as const)
  test(`${name} reports an outage and can retry instead of claiming an empty result`, async () => {
    vi.mocked(apiClient.get)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(response);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Component />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Check your connection');
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });
