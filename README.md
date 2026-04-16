# BOJ memory

BOJ 서비스 종료 이전까지의 자신의 정보를 요약해서 볼 수 있는 서비스입니다.

## 로컬 실행

```sh
npm run dev
```

로컬 서버는 `http://localhost:5173`에서 실행됩니다.

## GitHub Pages 배포

이 저장소에는 `public/` 디렉터리를 GitHub Pages로 배포하는 GitHub Actions workflow가 포함되어 있습니다.

1. 저장소에 push합니다.
2. GitHub 저장소의 `Settings > Pages`로 이동합니다.
3. `Source`를 `GitHub Actions`로 설정합니다.
4. `Deploy GitHub Pages` workflow가 끝날 때까지 기다립니다.

GitHub Pages는 정적 호스팅이라 `server.js`를 실행할 수 없습니다. 검색 기능은 `/api/memory`, 이미지 저장은 `/api/image`가 필요하므로 전체 기능을 Pages에서 사용하려면 Node 서버를 별도로 배포해야 합니다.

별도 서버를 배포한 뒤 `public/config.js`의 값을 서버 주소로 바꾸면 됩니다.

```js
window.BOJ_MEMORY_API_BASE_URL = "https://your-backend.example.com";
```
