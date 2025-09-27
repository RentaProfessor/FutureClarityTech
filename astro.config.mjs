// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  site: 'https://futureclarity.pages.dev',
  vite: {
    plugins: [
      tailwindcss({
        // Ensure Tailwind processes all content files
        content: [
          './src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}',
          './public/**/*.html',
        ]
      })
    ]
  }
});