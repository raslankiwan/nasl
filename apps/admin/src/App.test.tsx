import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { App } from './App';
import { initI18n } from './i18n';
import userEvent from '@testing-library/user-event';

/**
 * A smoke test for the shell.
 *
 * It exists because the console once rendered a completely blank page: the router was built
 * inside a component with an inline handler in its dependencies, so it was replaced on every
 * render and never settled on a match. Nothing threw and nothing was logged — only looking at
 * the page revealed it. This test looks at the page.
 */

const ME_STAFF = {
  id: 'u1',
  name: 'Ops',
  locale: 'ar',
  isPlatformAdmin: true,
  farms: [],
};
const ME_FARMER = { ...ME_STAFF, isPlatformAdmin: false };

function mockApi(me: object) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = url.includes('/v1/auth/me')
        ? me
        : url.includes('/v1/admin/stats')
          ? { farms: 3, users: 4, activeAnimals: 120, plans: { free: 3 } }
          : {};
      return new Response(JSON.stringify(json), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

beforeEach(async () => {
  window.localStorage.clear();
  window.localStorage.setItem('nasl.admin.accessToken', 'test-token');
  window.localStorage.setItem('nasl.admin.refreshToken', 'test-refresh');
  window.history.pushState({}, '', '/');
  await initI18n('ar');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the console shell', () => {
  test('a startup outage offers retry without losing the stored session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('جلسة دخولك محفوظة');
    expect(screen.queryByLabelText('رقم الجوال')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('nasl.admin.refreshToken')).toBe('test-refresh');
    mockApi(ME_STAFF);
    await userEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'المزارع' })).toBeInTheDocument());
  });

  test('renders its navigation for platform staff', async () => {
    mockApi(ME_STAFF);
    render(<App />);

    // If the router fails to settle, none of these appear and the root stays empty.
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'المزارع' })).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'لوحة المعلومات' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'المستحضرات البيطرية' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'سجل التدقيق' })).toBeInTheDocument();
  });

  test('renders the dashboard figures it was given', async () => {
    mockApi(ME_STAFF);
    render(<App />);
    await waitFor(() => expect(screen.getByText('120')).toBeInTheDocument());
  });

  test('a signed-in farm user is told the console is not for them', async () => {
    mockApi(ME_FARMER);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('هذه اللوحة مخصصة لفريق المنصة.')).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: 'المزارع' })).not.toBeInTheDocument();
  });

  test('an anonymous visitor gets the sign-in form', async () => {
    window.localStorage.clear();
    mockApi(ME_STAFF);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByLabelText('رقم الجوال')).toBeInTheDocument();
    });
  });

  test('the language toggle is reachable before signing in', async () => {
    window.localStorage.clear();
    mockApi(ME_STAFF);
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /تغيير اللغة/ })).toBeInTheDocument(),
    );
  });
});
