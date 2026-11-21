# Very Simple Dígalo

A tiny movie picker for "Dígalo con mímica" (charades) with friends. It gives one player a random movie title. That player acts it out without a word, and the team guesses.

It is made for phones first. No build step and no dependencies: plain HTML, CSS and JavaScript.

## Features

- Big "Sacar película" button pinned to the bottom of the screen, within thumb reach.
- The title comes out covered. A tap on the card shows it, and a second tap hides it, so only the actor sees it. The card also covers itself when the phone locks.
- No repeats: a movie that came out does not come out again until **Nuevo juego**.
- Difficulty (**Dificultad**): Fácil (movies everybody knows), Media, Difícil (cult, classic and niche movies) or Todas. A change of level keeps the movies that already came out.
- Clock (**Tiempo**): 30, 60, 90 or 120 seconds for each turn, or no clock. It ticks during the last 5 seconds, then a buzzer plays and the phone vibrates, where the browser supports it.
- Sound effects are made in the browser with Web Audio (no audio files) and follow **Sonido** on/off.
- Shows the last five movies that came out.
- Keeps the game after a page reload (saved in the browser's `localStorage`), and keeps open tabs in sync.
- Keeps the screen on during a game, where the browser supports it.
- Works offline after the first visit, and installs to the Home Screen with its own icon.
- Press <kbd>Space</kbd> to draw a movie.

The interface text is in Spanish (Argentina).

## Files

| File                   | Purpose                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `index.html`           | Page markup and meta tags.                                              |
| `styles.css`           | All styles. Phone layout first.                                         |
| `app.js`               | Game logic, clock, wake lock, tab sync and service worker registration. |
| `movies.json`          | The movie titles, in one list for each difficulty level.                |
| `analytics.js`         | Google Analytics: off until `GA_MEASUREMENT_ID` is set.                 |
| `sw.js`                | Service worker: network first, with the cache as the offline fallback.  |
| `manifest.webmanifest` | Home Screen app name, colors and icons.                                 |
| `icons/`               | `icon.svg` (source and favicon) and the PNG sizes made from it.         |
| `.nojekyll`            | Tells GitHub Pages to serve the files as they are, without Jekyll.      |
| `CNAME`                | The custom domain of the GitHub Pages site (`digalo.gtfunes.com`).      |
| `.github/`             | `check.mjs` and the GitHub Action that runs it on each push (see [Deploy](#deploy)). |

## Movies

The titles are a hand-written list in `movies.json`. They do not come from IMDb or another service: the site is static and must work offline. The titles are the ones used in Argentina and Latin America ("Mi pobre angelito", not "Home Alone").

```json
{
  "levels": [
    { "id": "easy", "name": "Fácil", "movies": ["Titanic", "El padrino"] },
    { "id": "medium", "name": "Media", "movies": ["Casablanca"] },
    { "id": "hard", "name": "Difícil", "movies": ["El séptimo sello"] }
  ]
}
```

- `id`: a short name that does not change. The app saves it to remember the picked level.
- `name`: the text in the **Dificultad** picker. The app adds «Todas» after the levels.
- `movies`: the titles of the level. A title must be in one level only.
- To add, move or remove a movie, edit the file. To add a level, add an object: the picker shows it with no code change.
- The saved game keeps the titles that came out, so an edit of the list does not break a game in progress.

## Run locally

```bash
python3 -m http.server 5173
```

Then open <http://localhost:5173>.

- The service worker (offline support) is off on `localhost`, so it never caches other local dev servers. To test it, open <http://digalo.localhost:5173> instead.
- The security `<meta>` tags in `index.html` apply on the local server too.

## Deploy

The site is made for GitHub Pages, served from the `main` branch. There is no build step: each push to `main` publishes the site in about a minute.

The setup, done once:

1. **Settings → Pages**: source **Deploy from a branch**, branch `main`, folder `/ (root)`.
2. Custom domain `digalo.gtfunes.com`. GitHub keeps it in the `CNAME` file, so do not delete that file.
3. At the DNS provider of `gtfunes.com`: a `CNAME` record with the name `digalo` and the value `gtfunes.github.io`.
4. When GitHub has issued the certificate, turn on **Enforce HTTPS** in **Settings → Pages**.

- To use another address, change `CNAME` and the `canonical` and `og:` URLs in `index.html`.
- Pages caches each file for 10 minutes (`max-age=600`), so a phone can show the old version for up to 10 minutes after a deploy.
- Each push to `main` also runs a check (`.github/workflows/check.yml`): the scripts parse, the JSON files are valid, nothing inline would be blocked by the CSP, and every file that `index.html` and the `ASSETS` list in `sw.js` name exists. Run it locally with `node .github/check.mjs`.

## Analytics

Google Analytics 4 is wired in, but it stays off until the site has a measurement ID:

1. In Google Analytics, add a web data stream for the site and copy its measurement ID (`G-…`).
2. Paste it into `GA_MEASUREMENT_ID` at the top of `analytics.js`, then push to `main`.

- It never runs on `localhost`, `*.localhost` or LAN addresses, and it is skipped when the browser sends Do Not Track or Global Privacy Control.
- Besides the page views, it sends one event: `game_start` (the first movie of a game, with the clock seconds and the level).
- `analytics.js` is the same file in the other very-simple game repositories. Only the ID line differs.

## Security

The site is static: no backend and no accounts. The only third-party script is Google Analytics, and only once it has an ID. Saved state goes into the page as text, never as HTML.

GitHub Pages cannot send custom headers, so `index.html` sets a strict Content Security Policy and `referrer: no-referrer` with `<meta>` tags.

## Notes

- If you add a file the app needs, add it to `ASSETS` in `sw.js`, so it works offline.
- To regenerate the PNG icons after you edit `icons/icon.svg`, install `librsvg` (`brew install librsvg`) and run:

```bash
for s in 180 192 512; do rsvg-convert -w $s -h $s icons/icon.svg -o icons/icon-$s.png; done
```

## License

[MIT](LICENSE)
