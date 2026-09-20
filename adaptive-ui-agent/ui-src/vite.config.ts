import path from 'node:path';

const __dirname = import.meta.dirname;
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 확장 프로그램 자체 페이지 3개(사이드패널·팝업·새 탭)를 한 번에 빌드해 저장소 루트의 pages/ 로 내보낸다.
// React·shadcn 코드는 공용 청크로 묶여 세 페이지가 함께 쓴다. Chrome 에는 지금처럼 저장소 루트 폴더를 그대로 로드하면 된다.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './', // chrome-extension:// 에서 상대 경로로 자산을 찾도록
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: {
    outDir: path.resolve(__dirname, '../pages'),
    emptyOutDir: true,
    sourcemap: false,
    modulePreload: { polyfill: false }, // MV3 CSP(script-src 'self')에서 불필요한 코드 제거
    rollupOptions: {
      input: {
        sidepanel: path.resolve(__dirname, 'sidepanel.html'),
        popup: path.resolve(__dirname, 'popup.html'),
        newtab: path.resolve(__dirname, 'newtab.html'),
      },
    },
  },
});
