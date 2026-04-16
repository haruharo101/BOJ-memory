# BOJ memory

BOJ 서비스 종료 이전까지의 자신의 정보를 요약해서 볼 수 있는 서비스입니다.

## 로컬 실행

```sh
npm run dev
```

로컬 서버는 `http://localhost:5173`에서 실행됩니다.

## Vercel 배포

Vercel에서는 `public/` 정적 파일과 `api/` 서버리스 함수를 함께 배포합니다.

1. Vercel에서 이 저장소를 Import합니다.
2. Framework Preset은 `Other`로 둡니다.
3. Build Command는 비워두거나 기본값을 사용합니다.
4. Output Directory도 비워둡니다.
5. 배포 후 `https://boj-memory.vercel.app` 또는 Vercel에서 발급된 도메인으로 접속합니다.

Vercel로 접속하면 프론트엔드는 같은 도메인의 `/api/memory`, `/api/image`를 사용합니다. GitHub Pages에서 접속하는 경우에는 `public/config.js`에 설정된 Vercel API 주소를 사용합니다.

## GitHub Pages 배포

이 저장소에는 `public/` 디렉터리를 GitHub Pages로 배포하는 GitHub Actions workflow가 포함되어 있습니다.

1. 저장소에 push합니다.
2. GitHub 저장소의 `Settings > Pages`로 이동합니다.
3. `Source`를 `GitHub Actions`로 설정합니다.
4. `Deploy GitHub Pages` workflow가 끝날 때까지 기다립니다.

GitHub Pages는 정적 호스팅이라 `server.js`를 실행할 수 없습니다. 검색 기능은 `/api/memory`, 이미지 저장은 `/api/image`가 필요하므로 전체 기능을 Pages에서 사용하려면 API를 Vercel에 배포해야 합니다.

Vercel 프로젝트 도메인이 `https://boj-memory.vercel.app`이 아니라면 `public/config.js`의 값을 실제 Vercel 주소로 바꾸면 됩니다.

```js
window.BOJ_MEMORY_API_BASE_URL = window.location.hostname.endsWith("github.io") ? "https://your-vercel-app.vercel.app" : "";
```
