# Third-party notices

## Rust backend dependencies

The [Rust backend dependency ledger](docs/development/rust-backend-notices.md)
records exact published versions, archive hashes, licenses, and full upstream
license/NOTICE texts for the shared runtime's resolved dependency graph. Sources
are unmodified. Keep applicable notices with copies of the compiled backend or
desktop runtime.

## Archify diagram viewer

- Source: [Archify](https://github.com/tt-a1i/archify), installed package version
  `2.16.0-dev.0` (skill version `2.16`).
- License: MIT, reproduced below, including the original Cocoon AI attribution.
- Distribution: `docs/architecture/application-flow.html` embeds the generated
  SVG, styles, and viewer code. Keep this notice with copies of the HTML.
- Modifications: original Agentica diagram content and layout; generated viewer
  output is unmodified.
- Exact generated artifact SHA-256:
  `87049ee04de0e005ed31a37f36e1631b0e8d2e87cc036f34f2846ec7aad1a666`.

The viewer optionally loads JetBrains Mono through Google Fonts. Font files are
not bundled; system fonts provide the offline fallback.

```text
MIT License

Copyright (c) 2026 tt-a1i (Archify)
Copyright (c) 2025 Cocoon AI (original "architecture-diagram-generator")

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
