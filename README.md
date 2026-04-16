# BOJ memory

BOJ memory is a visual memory page for solved.ac and BOJ profile data.

BOJ 서비스 종료 이전까지의 자신의 정보를 요약해서 볼 수 있는 서비스입니다.

## Local development

```sh
npm run dev
```

The local server runs at `http://localhost:5173`.

## GitHub Pages

This project includes a GitHub Actions workflow that deploys the `public/` directory to GitHub Pages.

1. Push this repository to GitHub.
2. Open `Settings > Pages`.
3. Set `Source` to `GitHub Actions`.
4. Wait for the `Deploy GitHub Pages` workflow to finish.

GitHub Pages is static hosting, so it cannot run `server.js`. The UI calls `/api/memory` and `/api/image`, which need the Node server. For the full app to work on GitHub Pages, deploy `server.js` separately and set `window.BOJ_MEMORY_API_BASE_URL` in `public/config.js` to that backend URL.
