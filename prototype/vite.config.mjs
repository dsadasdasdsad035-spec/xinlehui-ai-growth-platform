import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// 临时兼容本地 pnpm 链接中断；恢复依赖链接后可移除该别名。
export default {
  resolve: {
    alias: {
      'lucide-react': path.join(root, 'node_modules/.pnpm/lucide-react@1.28.0_react@19.2.8/node_modules/lucide-react')
    }
  }
};
