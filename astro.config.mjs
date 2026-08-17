// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  // Drives <link rel="canonical">, og:url, og:image and any generated sitemap.
  // This MUST be the custom domain: pointing it at the pages.dev hostname told
  // Google the pages.dev copy was canonical, which is why searches for the
  // company name surfaced *.pages.dev instead of this domain.
  site: 'https://futureclaritytechnologies.com',
  vite: {
    plugins: [tailwindcss()],
  },
});
