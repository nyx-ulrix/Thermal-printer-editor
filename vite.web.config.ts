import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Browser build of the editor, served by kanban/server.mjs on the editor host
 * (docs/WEB.md). Same index.html as the Electron renderer, with two changes:
 * the entry becomes src/web/main.ts (installs the HTTP bridge first), and the
 * Electron meta CSP is dropped because the server sends the web CSP header
 * (a meta CSP would further restrict fonts and blob: images).
 */
function webIndexHtml(): Plugin {
  return {
    name: 'web-index-html',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const withoutCsp = html.replace(/\s*<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/i, '')
        const withEntry = withoutCsp.replace('src="/src/main.tsx"', 'src="/src/web/main.ts"')
        if (withEntry === withoutCsp) throw new Error('index.html entry script not found')
        return withEntry
      }
    }
  }
}

export default defineConfig({
  root: __dirname,
  base: '/',
  publicDir: false,
  plugins: [webIndexHtml(), react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  build: {
    outDir: resolve(__dirname, 'web-dist'),
    emptyOutDir: true,
    assetsDir: 'assets',
    // Keep fonts and images as files under /assets: CSP allows them either way,
    // but no inline anything keeps the HTML free of surprises.
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: resolve(__dirname, 'index.html')
    }
  }
})
