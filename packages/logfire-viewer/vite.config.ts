import { builtinModules } from 'node:module'
import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
])

const externalPrefixes = ['@opentelemetry', '@grpc', '@hono']
const externalExact = new Set(['better-sqlite3', 'hono', 'mri'])

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        cli: resolve(__dirname, 'src/cli.ts'),
      },
      formats: ['es', 'cjs'],
    },
    minify: false,
    target: 'node20',
    sourcemap: true,
    rollupOptions: {
      external: (id) =>
        nodeBuiltins.has(id) ||
        externalExact.has(id) ||
        externalPrefixes.some((p) => id.startsWith(p)),
      output: { exports: 'named' },
    },
  },
  define: {
    PACKAGE_VERSION: JSON.stringify(process.env.npm_package_version || '0.0.0'),
  },
  plugins: [
    dts({
      afterBuild: () => {
        if (existsSync('dist/index.d.ts')) {
          copyFileSync('dist/index.d.ts', 'dist/index.d.cts')
        }
      },
      compilerOptions: { skipLibCheck: true },
      rollupTypes: true,
      staticImport: true,
      include: ['src'],
      exclude: ['src/__tests__', 'web'],
      entryRoot: 'src',
    }),
  ],
})
