# Frontend full test report

**Result:** PASS
**Frontend:** `/home/fofka/Рабочий стол/XAKATON/HACKTON/frontend`

PASS: 10 | FAIL: 0 | WARN: 0 | SKIP: 1

## Checks

### PASS — Preflight
- Time: 0.00s

```text
Node project detected; scripts: build, dev, format:check, preview, test, test:browser, typecheck
```

### PASS — node version
- Time: 0.00s
- Command: `node --version`

**stdout**
```text
v26.8.2

```

### PASS — npm version
- Time: 0.05s
- Command: `npm --version`

**stdout**
```text
12.0.2

```

### PASS — Dependencies
- Time: 0.00s

```text
node_modules exists.
```

### PASS — Static source scan
- Time: 0.07s

```text
No obvious secret/danger patterns found.
```

### SKIP — Lint
- Time: 0.00s

```text
No npm script "lint".
```

### PASS — TypeScript typecheck
- Time: 0.21s
- Command: `npm run typecheck`

**stderr**
```text
npm notice run nx-campaign-intelligence@1.0.0 typecheck
npm notice run tsc --noEmit --noUnusedLocals --noUnusedParameters

```

### PASS — Unit / integration tests
- Time: 0.18s
- Command: `npm run test`

**stdout**
```text
✔ missing metrics remain unavailable instead of becoming zero (1.219266ms)
✔ explicitly empty collections remain distinct from missing collections (0.571471ms)
✔ unsupported schemas, null roots and unknown states are rejected (0.798494ms)
✔ invalid numeric data cannot enter visualizations (0.251025ms)
✔ invalid timestamps and malformed collections are rejected (0.16804ms)
✔ CSV header-only import never invents a completed run or campaign (0.330889ms)
✔ CSV parser preserves quoted commas, quotes and newlines (0.232197ms)
✔ malformed CSV and missing required headers are rejected (0.260689ms)
✔ remaining resources require sufficient source evidence (0.187371ms)
✔ data sources permit HTTP(S) only and reject embedded credentials (0.326083ms)
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 78.572674

```

**stderr**
```text
npm notice run nx-campaign-intelligence@1.0.0 test
npm notice run node --test src/services/data.test.ts

```

### PASS — Production build
- Time: 0.42s
- Command: `npm run build`

**stdout**
```text
vite v8.3.0 building client environment for production...
transforming...
✓ 1892 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                              0.66 kB │ gzip:  0.40 kB
dist/assets/manrope-vietnamese-wght-normal-usUDDRr7.woff2    8.52 kB
dist/assets/manrope-greek-wght-normal-DL7QRZyv.woff2         9.44 kB
dist/assets/manrope-cyrillic-wght-normal-Dvxsihut.woff2     14.50 kB
dist/assets/manrope-latin-ext-wght-normal-Ch3YOpNY.woff2    15.12 kB
dist/assets/manrope-latin-wght-normal-DHIcAJRg.woff2        24.83 kB
dist/assets/index-Bl7fc7LY.css                              54.22 kB │ gzip: 14.89 kB
dist/assets/index-DGWxxd9o.js                              297.04 kB │ gzip: 91.44 kB

✓ built in 121ms

```

**stderr**
```text
npm notice run nx-campaign-intelligence@1.0.0 build
npm notice run tsc --noEmit && vite build

```

### PASS — Dev server
- Time: 0.00s
- Command: `npm run dev -- --port 5175`

```text
http://127.0.0.1:5175
```

### PASS — Browser/E2E (test:browser)
- Time: 8.61s
- Command: `npm run test:browser`

**stdout**
```text
{
  "runtimeErrors": [],
  "accessibilityViolations": [],
  "screenshots": [
    1920,
    2560,
    1366,
    1024,
    390
  ]
}
PASS: routes, layouts, empty states, invalid source, import errors, preserved data, mobile navigation, dialogs and agent state rendering.

```

**stderr**
```text
npm notice run nx-campaign-intelligence@1.0.0 test:browser
npm notice run node scripts/check-ui.mjs

```
