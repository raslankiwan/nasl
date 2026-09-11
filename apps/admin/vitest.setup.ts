import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// jsdom has no layout engine, so it throws on scrollTo. TanStack Router's scroll restoration
// calls it on every navigation; the noise is not a failure.
window.scrollTo = vi.fn();
