import { cleanup, configure } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

afterEach(cleanup);

// `findBy*` waits one second by default, and that one second is a bet on this machine rather than
// on the code. The shelf's search pauses 250ms before it asks (a real `setTimeout`, not a fake
// clock), so one second has to cover the debounce, the render, and however long jsdom takes here
// while four other packages' suites are running in the same gate. It lost that bet on the run that
// tried to tag v0.17.0: the state arrived, just after the wait gave up, and the release stopped.
// The suite's own ceiling is already 15s for the same reason (`vitest.config.ts`), so the async
// utilities get the same headroom. What a test asserts stays "the shelf reaches this state"; the
// wall clock stops being the thing under test.
configure({ asyncUtilTimeout: 5_000 });
