import { defineConfig } from 'tsup'

export default defineConfig({
    entry: {
        index: 'src/index.ts',
        middleware: 'src/middleware.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    minify: false,
    target: 'es2022',
    external: ['next', 'next/server', 'next/headers', '@ipregistry/client'],
})
