# Contributing to DrDoc

Thanks for helping! Bug reports, fixes and new tools are all welcome.

## Setup

```bash
npm install
npm run dev     # app at http://localhost:5173
npm test        # engine tests
npm run build   # type-check and production build
```

Node.js 20 or newer is required (`.nvmrc` pins 22).

## Adding a tool

Most tools are one entry in [`src/tools/registry.ts`](src/tools/registry.ts):

```ts
{
  id: "my-tool",
  name: "My tool",
  desc: "One sentence that says what it does.",
  cat: "Organize",
  icon: Scissors,               // from lucide-react
  accept: ["pdf"],
  multiple: true,
  options: [{ name: "pages", label: "Pages", type: "text", placeholder: "1-3" }],
  run: each(async (file, opts) => out(`${stem(file.name)}-done.pdf`, await pdf.someOperation(await bytesOf(file), opts))),
}
```

The home page, search, drop zone, options form, progress bar and download buttons come for free.

- PDF logic goes in `src/engine/pdf/core.ts`; expose it in `host.ts`. It runs in the worker, and in Node for tests.
- Format converters that need the DOM or canvas go in `src/engine/convert/`.
- Add a test in `tests/engine.test.ts` for engine changes. Check output **content**, not just that something was produced.

## Style

- TypeScript, React function components, plain CSS with the design tokens in `src/styles/app.css`.
- UI copy is short, plain and friendly. Error messages say what happened and what to do next.
- Keep everything client-side: no network calls with user data, ever.

## Pull requests

1. Branch from `main`.
2. `npm run build && npm test` must pass (CI runs both).
3. Describe what changed and how you tested it. Include screenshots for UI changes.
