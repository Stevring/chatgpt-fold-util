# ChatGPT Fold

A Tampermonkey userscript that adds collapsible sections to ChatGPT assistant responses.

## Features

- Runs on `chatgpt.com` and `chat.openai.com`.
- Folds only assistant responses.
- Uses rendered Markdown headings (`h1`-`h6`) as fold boundaries.
- Leaves responses without headings unchanged.
- Adds in-page controls for collapsing or expanding all processed sections.
- Does not persist state after refresh.

## Development

```bash
npm install
npm run typecheck
npm run build
```

The publishable userscript is generated at:

```text
dist/chatgpt-fold.user.js
```

## Local Tampermonkey Install

1. Run `npm run build`.
2. Open Tampermonkey in Chrome.
3. Create a new script.
4. Paste the contents of `dist/chatgpt-fold.user.js`.
5. Save the script.
6. Open or refresh ChatGPT.

## Publish with GitHub Raw

1. Commit this repository to GitHub.
2. Make sure `dist/chatgpt-fold.user.js` is committed.
3. Open the file on GitHub.
4. Click `Raw`.
5. Use the raw URL as the install URL.

For automatic update checks in Tampermonkey, add these metadata lines to `scripts/build-userscript.mjs` after your GitHub repository URL is final:

```js
// @updateURL    https://raw.githubusercontent.com/<owner>/<repo>/main/dist/chatgpt-fold.user.js
// @downloadURL  https://raw.githubusercontent.com/<owner>/<repo>/main/dist/chatgpt-fold.user.js
```

Then run `npm run build` again and commit the regenerated userscript.
