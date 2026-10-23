# Deploying DrDoc

DrDoc is a static site: `npm run build` produces a `dist/` folder of HTML, JavaScript, WebAssembly and fonts. There is no backend, so any static host works. Netlify is configured out of the box.

## Netlify (recommended)

### From GitHub (automatic deploys)

1. Create a GitHub repository and push this project:
   ```bash
   git init
   git add .
   git commit -m "DrDoc"
   git branch -M main
   git remote add origin https://github.com/<you>/drdoc.git
   git push -u origin main
   ```
2. In the Netlify dashboard choose **Add new site → Import an existing project → GitHub** and pick the repository.
3. Leave the settings as detected. They come from `netlify.toml`:

   | Setting | Value |
   |---|---|
   | Build command | `npm run build` |
   | Publish directory | `dist` |
   | Node version | 22 |

4. Click **Deploy**. Every push to `main` redeploys; pull requests get preview URLs.

### With the Netlify CLI

```bash
npm install -g netlify-cli
netlify login
npm run build
netlify deploy            # draft URL to check
netlify deploy --prod     # publish
```

### Drag and drop

Run `npm run build`, then drag the `dist/` folder onto <https://app.netlify.com/drop>.

## What `netlify.toml` sets up

- **Caching**: `/assets/*`, `/fonts/*` and `.wasm` files are content-hashed or versioned, so they're cached for a year.
- **Security headers**: a Content-Security-Policy that only allows the site's own scripts (plus WebAssembly), `X-Frame-Options: DENY`, `nosniff`, no referrer, and camera access limited to this site (for the scanner).
- **SPA fallback**: every path serves `index.html`. DrDoc uses `#/` routes, so this is only a safety net.

## Custom domain and HTTPS

Add a domain under **Domain management**. Netlify provisions HTTPS automatically. HTTPS is required for the service worker (offline use) and recommended for camera access on phones.

## Other hosts

Any static host works: Vercel, Cloudflare Pages, GitHub Pages, S3. Things to replicate:

- Serve `.wasm` as `application/wasm`.
- If you add a Content-Security-Policy, allow `'wasm-unsafe-eval'` in `script-src` (MuPDF) and `blob:` in `worker-src` (HEIC decoding).
- Serve from the domain root, because icons and fonts use absolute paths (`/fonts/…`).

## Size

The first visit downloads about 5 MB compressed, mostly the MuPDF WebAssembly engine (4.8 MB). After that the service worker caches the whole app (about 7 MB) for offline use; the large editor fonts are cached the first time the editor needs them.
