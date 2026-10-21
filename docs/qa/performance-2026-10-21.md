# TOKOLINK targeted performance pass — 2026-10-21

Status: local changes only. No deployment, GitHub publication, paid service changes, or live call claim.

## Changes and evidence

1. **Startup:** removed the unconditional 700 ms splash timeout after authentication resolves. Navigation still waits for authentication, preserves onboarding/login/chat destinations, and uses history replacement. Four component tests cover these paths and unmount during pending authentication. This removes 700 ms of deliberately added delay; it is not a measurement of total load time.
2. **Chat/business formatting:** lazily reuse three `Intl.DateTimeFormat` instances and one `Intl.NumberFormat` instance, rather than re-creating locale/time-zone formatters per message/amount. The cache is fixed-size, not keyed by messages. Output parity covers Jakarta midnight, invalid dates, relative-day changes, currency rounding and special numeric values. Tests pass in Jakarta and Los Angeles timezones.
3. **Call token preparation:** execute the two independent, authenticated participant/call reads concurrently. Both still precede the same authorization decision; profile read and token mint remain after approval. Middleware, filters and RLS context are unchanged. Eleven focused tests cover successful setup, denial paths, missing configuration and query rejection.

## Reproducible microbenchmarks

Run `./node_modules/.bin/vitest bench --run src/lib/mcm/__tests__/format.bench.ts`.

Observed container means, before vs cached implementation:

| Workload                          |    Before |    After |
| --------------------------------- | --------: | -------: |
| 1,000 historical chat date labels | 46.416 ms | 2.548 ms |
| 40 visible bubble timestamps      |  1.635 ms | 0.045 ms |
| 1,000 rupiah amounts              | 23.229 ms | 0.445 ms |

The captured output is in `performance-2026-10-21-benchmark.txt`. These isolate CPU formatting in Node, not a phone, browser frame rate or whole-screen latency. Results vary by hardware/runtime.

The deterministic call test uses 120 ms participant lookup, 200 ms call lookup and 80 ms profile lookup: serial baseline 400 ms vs concurrent 280 ms. This is a controlled test, not production network timing; actual benefit depends on database latency.

## Verification and limitations

- Offline complete suite: 730 passed, 62 skipped (84 test files: 83 passed, 1 skipped).
- Production build passed.
- Lint: 0 errors, 34 pre-existing warnings.
- TypeScript: checked with the installed compiler and unchanged project config.
- Live Supabase security checks were not validated. An initial default test run loaded project environment values and failed 39 network checks on DNS resolution; the subsequent complete offline run used empty Supabase URL/key variables so the existing non-strict live suites skip as designed. No gate or strict-mode checks were loosened.
- No authenticated browser E2E, real Android device, real call/media-quality or live database verification was performed. Existing E2E scripts require remote test-data writes and were not run.
- Aggregate gzip bundle remains above the existing budget: total 1,084.1 KiB (budget 950), JavaScript 1,046.2 KiB (budget 800), CSS 19.2 KiB (budget 40). Baseline total was 1,085.9 KiB and JS 1,048.0 KiB. This pass primarily reduces unnecessary delay/CPU work, not download size. No budget was increased and no feature was removed.

Offline suite command:

```sh
SUPABASE_URL= SUPABASE_PUBLISHABLE_KEY= VITE_SUPABASE_URL= VITE_SUPABASE_PUBLISHABLE_KEY= VITE_SUPABASE_ANON_KEY= LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN= ./node_modules/.bin/vitest run
```

Remaining work: browser/device performance tracing with safe test accounts, and a separately validated reduction of heavy PDF/call bundles. LiveKit and jsPDF remain major bundle contributors; arbitrary chunk splitting does not reduce the aggregate download budget.
