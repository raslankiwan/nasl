import { useCallback } from 'react';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Layout } from './components/Layout';
import { useAuth, type StaffUser } from './auth/useAuth';
import { SignIn } from './routes/SignIn';
import { NotStaff } from './routes/NotStaff';
import { Dashboard } from './routes/Dashboard';
import { Farms } from './routes/Farms';
import { FarmDetail } from './routes/FarmDetail';
import { Products } from './routes/Products';
import { Audit } from './routes/Audit';
import { Users } from './routes/Users';
import { UserDetail } from './routes/UserDetail';

interface RouterContext {
  user: StaffUser;
  signOut: () => void;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: function Root() {
    const { user, signOut } = rootRoute.useRouteContext();
    return <Layout user={user} onSignOut={signOut} />;
  },
});

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: Dashboard }),
  createRoute({ getParentRoute: () => rootRoute, path: '/farms', component: Farms }),
  createRoute({ getParentRoute: () => rootRoute, path: '/farms/$farmId', component: FarmDetail }),
  createRoute({ getParentRoute: () => rootRoute, path: '/users', component: Users }),
  createRoute({ getParentRoute: () => rootRoute, path: '/users/$userId', component: UserDetail }),
  createRoute({ getParentRoute: () => rootRoute, path: '/products', component: Products }),
  createRoute({ getParentRoute: () => rootRoute, path: '/audit', component: Audit }),
]);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
});

/**
 * The router is created once, at module scope.
 *
 * Building it inside a component means any unstable dependency — an inline arrow handler is
 * enough — recreates the router on every render, and a router that is replaced mid-render never
 * settles on a match and quietly renders nothing. The context that *does* change is passed
 * through RouterProvider instead.
 */
const router = createRouter({
  routeTree,
  context: undefined as unknown as RouterContext,
});

/** The console proper. Rendered only once we know the caller is staff. */
function Console({ user, onSignOut }: { user: StaffUser; onSignOut: () => void }) {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} context={{ user, signOut: onSignOut }} />
    </QueryClientProvider>
  );
}

export function App() {
  const { t } = useTranslation(['common', 'auth']);
  const { state, requestCode, verifyCode, signOut, reload } = useAuth();

  // Stable across renders, so nothing downstream treats it as a changed dependency.
  const handleSignOut = useCallback(() => void signOut(), [signOut]);

  switch (state.status) {
    case 'loading':
      return <div className="loading">{t('loading')}</div>;
    case 'signedOut':
      return <SignIn requestCode={requestCode} verifyCode={verifyCode} />;
    case 'unavailable':
      return (
        <div className="signin">
          <div className="card">
            <p role="alert">{t('auth:sessionUnavailable')}</p>
            <button className="primary" type="button" onClick={() => void reload()}>
              {t('common:retry')}
            </button>
          </div>
        </div>
      );
    // Signed in, but not staff. Say so plainly rather than rendering an empty console.
    case 'notStaff':
      return <NotStaff onSignOut={handleSignOut} />;
    case 'signedIn':
      return <Console user={state.user} onSignOut={handleSignOut} />;
  }
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter<typeof routeTree>>;
  }
}
