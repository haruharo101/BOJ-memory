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
5. 배포 후 `https://boj-memory.vercel.app`로 접속합니다.

프론트엔드는 같은 도메인의 `/api/memory`, `/api/image`를 사용합니다. 별도 API 서버 주소를 공개하지 않으며, API는 `https://boj-memory.vercel.app`에서 온 브라우저 요청만 허용합니다.
