# GOR 

Charge at the right repos. At the right time.

GOR is a single-file, browser-based tool for finding AI/ML open-source repositories with strong contribution potential. It scans GitHub repositories, scores them by opportunity signals, and highlights where first-time contributor PRs are getting merged.

## What it does

- Searches AI/ML repositories on GitHub
- Highlights repos with recent first-time contributor PR activity
- Scores results using signals like merge history, issue labels, recency, and star count
- Supports category filters, modes, keyword search, and result sorting
- Runs entirely in the browser with no backend

## How to use

1. Open `index.html` in your browser.
2. Add a GitHub Personal Access Token for better rate limits.
3. Choose a category, mode, or keyword.
4. Use filters to narrow results.
5. Review the cards, open the repo, and look at the merged PRs and issues.

## Token safety

- Your token stays in browser memory only
- It is never sent anywhere except `api.github.com`
- It is not stored in `localStorage` or `sessionStorage`
- Clear the token anytime from the UI

## Best for

Developers who want to find open-source AI/ML projects worth contributing to for learning, visibility, and LinkedIn/GitHub profile growth.

## Project structure

- `index.html` — full app, styles, and logic in one file
- `README.md` — quick overview and usage guide

## Notes

- Works best with a GitHub token
- Designed for a clean, dark GitHub-style experience

## License

MIT
