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
5. 배포 후 Vercel에서 발급된 도메인으로 접속합니다.

프론트엔드는 같은 도메인의 `/api/memory`, `/api/image`를 사용합니다. 별도 API 서버 주소를 공개하지 않으며, API는 요청이 들어온 도메인과 같은 출처의 브라우저 요청을 허용합니다.

커스텀 도메인이나 별도 프론트 도메인을 추가로 허용해야 한다면 Vercel 환경 변수 `BOJ_MEMORY_FRONTEND_ORIGINS`에 쉼표로 구분해 입력합니다.

```txt
BOJ_MEMORY_FRONTEND_ORIGINS=https://example.com,https://www.example.com
```
