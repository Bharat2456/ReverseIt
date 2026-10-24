# ReverseIt — Web edition (V3)

Open-source web platform that **reads websites, apps and programs, shows how they are built, and helps you
rebuild your own original version.** A public landing site, full documentation, a builder page, and a dashboard
with a left navigation bar. No accounts, no database: every visitor brings their own AI API key.

```
public/        static site + dashboard (prebuilt, no build step needed)
api/           stateless serverless functions (prebuilt Node.js, no dependencies)
source/        full source code (React + TypeScript) and the build script
vercel.json    routing, 60 s function limit, security headers (CSP)
```

## Deploy in 3 steps (GitHub → Vercel)

1. Create a new GitHub repository and upload **the contents of this folder** (the folder that contains `vercel.json`).
2. On <https://vercel.com/new> import that repository. Leave every setting at its default: no build command, no output
   directory, no environment variables.
3. Press **Deploy**. Open the URL. The landing page is `/`, the platform is behind the **Dashboard** button (`/app`).

Nothing else is required. There is no login and nothing is stored on the server.

## How it works

| Part | Where it runs | What it does |
|---|---|---|
| Analysis of uploaded files (exe, apk, asar, zip, wasm, js, har…) | the visitor's browser | files never leave the device |
| `POST /api/site/analyze` | Vercel function | reads a public website (page, scripts, styles, source maps) and streams progress |
| `POST /api/ai/detect · models · test · chat` | Vercel function | forwards a request to **any** AI provider using the visitor's key; the key is never stored or logged |
| Investigations | the visitor's browser (IndexedDB) | private to that browser |

AI providers: format-driven, so anything speaking the OpenAI, Anthropic or Gemini API works (OpenAI, Anthropic, Google,
OpenRouter, Groq, Mistral, DeepSeek, xAI, Together, Fireworks, Perplexity, Cerebras, SambaNova, NVIDIA, Cohere,
Hugging Face, GitHub Models, Moonshot, Zhipu, Qwen, SiliconFlow, and any custom base URL).
**Keys are only sent to a vendor whose key format matches** unless the visitor explicitly chooses "try every provider".

## Limits you should know

- Vercel's free plan caps function time (this project asks for 60 s). Very large sites may be only partly read.
- The server **cannot** reach private networks or `localhost` (blocked on purpose), so **local models (Ollama, LM Studio)
  only work in the localhost edition (V2)**.
- Native programs get a structural read (layout, imports, strings). Decompiling needs Ghidra/IDA/Hopper (see V2 + REA).
- The site analyzer reads what is public and does not run JavaScript, so client-rendered content and anything behind login is invisible.
- The site analyzer and AI proxy are open to anyone who visits your deployment (no auth, by design). Per-IP rate limiting is
  best-effort on serverless. If you see abuse, enable Vercel Firewall rate limits. Your own AI keys are never used.
- This package was tested with a local simulation of Vercel (static files, function routing, headers/CSP, request bodies),
  real browser runs, and mock AI providers. It was **not** deployed to a live Vercel account from the build environment.
  Real provider calls and real website fetches over the internet were not possible in that environment.

## Rebuild from source (optional)

```bash
cd source
npm install
npm run build      # writes ../public/app.js, ../public/app.css and ../api/*.js
```

## Add your screenshots / motion

The landing page loads `public/assets/shots/*.png` and `public/assets/tour.webm|mp4`. Replace them any time (same names).

## Licence

MIT (see `LICENSE`). Built on the ideas of REA by morluto (MIT) — see `THIRD_PARTY_NOTICES.md`.
Use ReverseIt only on things you own or may study; do not use it to bypass licences or copy protection, or to copy protected code or assets.
