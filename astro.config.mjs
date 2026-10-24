// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  // Drives <link rel="canonical">, og:url, og:image and any generated sitemap.
  // This MUST be the custom domain: pointing it at the pages.dev hostname told
  // Google the pages.dev copy was canonical, which is why searches for the
  // company name surfaced *.pages.dev instead of this domain.
  site: 'https://futureclaritytechnologies.com',
  // Astro 7 defaults to JSX whitespace rules, which drop the space between text
  // and a link that starts on the next line ("Our<a>Privacy Policy</a>"). Keep
  // the lossless compression every page here was written for.
  compressHTML: true,
  integrations: [sitemap()],
  // The stylesheet is small (about 7 KB compressed): inlining it removes the
  // one render-blocking request, so the first screen paints sooner on phones.
  build: { inlineStylesheets: 'always' },
  vite: {
    plugins: [tailwindcss()],
    // Vite 8 targets 2023+ browsers by default and rewrites media queries as
    // (width>=901px), which iPhones before iOS 16.4 ignore. Keep the targets
    // this site was built for before the Astro 7 upgrade.
    build: {
      target: ['chrome87', 'edge88', 'firefox78', 'safari14'],
      cssTarget: ['chrome87', 'edge88', 'firefox78', 'safari14'],
    },
  },
});
