import { defineConfig } from 'eslint/config'

const nodeGlobals = {
  process: 'readonly',
  Buffer: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  queueMicrotask: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  AbortSignal: 'readonly',
  AbortController: 'readonly',
  structuredClone: 'readonly',
  performance: 'readonly',
  fetch: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  FormData: 'readonly',
  ReadableStream: 'readonly',
  crypto: 'readonly',
}

export default defineConfig([
  {
    // lib/client.js 是单文件拼接产物（自带 eslint-disable 头），src/client 是共享作用域的片段，
    // 二者都不适合单独按模块解析；等前端拆成真正 ESM 后再纳入。
    ignores: ['node_modules/**', 'docs/**', 'coverage/**', '*.tgz', 'lib/client.js', 'src/client/**', 'src/server/**'],
  },
  {
    files: ['lib/*.js', 'scripts/**/*.mjs', 'tests/**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules: {
      'no-undef': 'error',
      'no-redeclare': 'error',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['tests/**/*.mjs'],
    languageOptions: {
      globals: { ...nodeGlobals, window: 'readonly', document: 'readonly', navigator: 'readonly' },
    },
  },
])
