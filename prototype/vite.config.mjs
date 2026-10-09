import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default {
  // 依赖改为 npm 直装（node_modules 为实体目录），原先为兼容 pnpm 断链的
  // lucide-react 别名已不再需要，故移除。
  build: {
    outDir: 'dist',
    emptyOutDir: false
  }
};
