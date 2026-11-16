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

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  getComputedStyle: 'readonly',
  console: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  FormData: 'readonly',
  CustomEvent: 'readonly',
  Event: 'readonly',
  Node: 'readonly',
  MutationObserver: 'readonly',
  IntersectionObserver: 'readonly',
  ResizeObserver: 'readonly',
  structuredClone: 'readonly',
  performance: 'readonly',
  queueMicrotask: 'readonly',
}

export default defineConfig([
  {
    // src/client、src/server 是共享作用域的片段，不是独立 Program，不能按文件解析；
    // lib/client.js 与 lib/index.js 是拼接产物，对产物做 lint 才能拿到跨片段的 no-undef。
    ignores: ['node_modules/**', 'docs/**', 'coverage/**', '*.tgz', 'src/client/**', 'src/server/**'],
  },
  {
    files: ['lib/*.js', 'scripts/**/*.mjs', 'tests/**/*.mjs', 'eslint.config.js'],
    ignores: ['lib/client.js'],
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
    // 客户端产物：浏览器脚本，不是 ESM；React 由 ModuleLoader 注入。
    files: ['lib/client.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: browserGlobals,
    },
    rules: {
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-redeclare': 'error',
      'no-dupe-args': 'error',
      'no-const-assign': 'error',
      'no-func-assign': 'error',
      'no-self-assign': 'error',
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
