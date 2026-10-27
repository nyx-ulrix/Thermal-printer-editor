import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Browser build of the editor, served by kanban/server.mjs on the editor host
 * (docs/WEB.md). Same index.html as the Electron renderer, with two changes:
 * the entry becomes src/web/main.ts (installs the HTTP bridge first), and the
 * Electron meta CSP is dropped because the server sends the web CSP header
 * (a meta CSP would further restrict fonts and blob: images). The PWA head tags
 * (manifest, theme colour, icons) are added here, not in index.html, so the
 * Electron renderer never sees them; their files live in web-public/.
 */
// Theme colours match the first-paint ground in index.html (--surface-canvas).
const PWA_HEAD = [
  '<link rel="manifest" href="/manifest.webmanifest" />',
  '<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />',
  '<meta name="theme-color" content="#121212" media="(prefers-color-scheme: dark)" />',
  '<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />',
  '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />'
]
  .map((tag) => `    ${tag}`)
  .join('\n')

function webIndexHtml(): Plugin {
  return {
    name: 'web-index-html',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const withoutCsp = html.replace(/\s*<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/i, '')
        const withEntry = withoutCsp.replace('src="/src/main.tsx"', 'src="/src/web/main.ts"')
        if (withEntry === withoutCsp) throw new Error('index.html entry script not found')
        const withPwa = withEntry.replace(/\n([ \t]*)<\/head>/, (_m, indent: string) => `\n${PWA_HEAD}\n${indent}</head>`)
        if (withPwa === withEntry) throw new Error('index.html </head> not found')
        return withPwa
      }
    }
  }
}

export default defineConfig({
  root: __dirname,
  base: '/',
  // Copied as-is to the root of web-dist/: manifest.webmanifest, sw.js, icons/.
  // Web-only; the Electron build does not use this folder.
  publicDir: resolve(__dirname, 'web-public'),
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
