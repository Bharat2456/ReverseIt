# Third-party notices

## REA (morluto/rea) — MIT License

ReverseIt is built on the ideas and, in the localhost edition (V2), the code of **REA**
(https://github.com/morluto/rea). ReverseIt's own analysis core is a TypeScript implementation that follows
REA's evidence model (every result records its coverage and limitations, target text is marked untrusted).
The localhost edition additionally ships REA's source **unmodified** under `engine/rea/` and can call it.

```
MIT License

Copyright (c) 2026 morluto

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

REA's own third-party notices (for its bundled dependencies) are in `engine/rea/THIRD_PARTY_NOTICES.md` (V2 only).

## Runtime libraries bundled into the web UI

- React and React DOM — MIT License, Copyright (c) Meta Platforms, Inc. and affiliates.
- esbuild (build tool only, not shipped) — MIT License.

ReverseIt uses no web fonts and no external CDNs.
