# FutureClarity Technologies

A beautiful, modern website for FutureClarity Technologies built with Astro and Tailwind CSS. Features mobile and desktop perfection with custom designs for each screen size.

## 🚀 Features

- **Mobile-First Design**: Custom-designed for mobile with perfect touch targets and spacing
- **Desktop Optimization**: Generous spacing and layouts designed specifically for large screens
- **Modern Stack**: Built with Astro (static-first) and Tailwind CSS
- **Contact Form**: Working contact form with API endpoint
- **Portfolio Showcase**: Beautiful project grid with hover effects
- **Performance**: Fast loading with minimal JavaScript
- **Accessibility**: Built with accessibility in mind

## 📱 Mobile & Desktop Perfection

This site is designed to feel native to each device:

- **Mobile**: Custom mobile layouts, proper touch targets (48px+), safe area handling for iOS
- **Desktop**: Generous spacing, balanced typography, comfortable line lengths
- **Responsive**: Smooth transitions between breakpoints

## 🛠️ Tech Stack

- **Framework**: Astro 5.x
- **Styling**: Tailwind CSS 4.x
- **Deployment**: Cloudflare Pages
- **Fonts**: Inter (Google Fonts)

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:4321](http://localhost:4321) in your browser

### Building for Production

```bash
npm run build
```

The built files will be in the `dist/` directory.

## 🌐 Deployment

### Cloudflare Pages

1. Connect your GitHub repository to Cloudflare Pages
2. Set the build command: `npm run build`
3. Set the build output directory: `dist`
4. Deploy!

The site will be available at `https://your-project-name.pages.dev`

### Other Platforms

This is a static site and can be deployed to any static hosting platform:
- Vercel
- Netlify
- GitHub Pages
- AWS S3 + CloudFront

## 📁 Project Structure

```
src/
├── components/          # Reusable components
│   ├── Header.astro    # Navigation header
│   └── Footer.astro    # Site footer
├── layouts/            # Page layouts
│   └── Layout.astro    # Main layout wrapper
├── pages/              # Pages and API routes
│   ├── index.astro     # Landing page
│   ├── portfolio.astro # Portfolio page
│   └── api/            # API endpoints
│       └── contact.ts  # Contact form handler
└── styles/             # Global styles
    └── global.css      # Tailwind + custom CSS
```

## 🎨 Design System

The site uses a custom design system inspired by the original FutureClarity brand:

- **Primary Colors**: Blue (#667eea) to Purple (#764ba2) gradients
- **Accent Colors**: Pink (#f093fb) highlights
- **Typography**: Inter font family
- **Spacing**: Consistent spacing scale
- **Components**: Reusable button, card, and form styles

## 📧 Contact Form

The contact form posts to `/api/contact` and includes:
- Email validation
- Basic spam protection
- Error handling
- Success feedback

In production, you'll want to:
- Add email sending functionality
- Store submissions in a database
- Add reCAPTCHA for spam protection

## 🔧 Customization

### Colors
Update the CSS variables in `src/styles/global.css`:

```css
:root {
  --primary-color: #667eea;
  --secondary-color: #764ba2;
  --accent-color: #f093fb;
  /* ... */
}
```

### Content
- Update company information in components
- Modify portfolio projects in `src/pages/portfolio.astro`
- Change contact information in the footer

### Styling
- Modify Tailwind classes in components
- Add custom CSS in `src/styles/global.css`
- Update responsive breakpoints as needed

## 📱 Mobile Optimizations

- Touch targets minimum 48px
- Safe area handling for iOS devices
- Optimized font sizes for mobile reading
- Proper viewport meta tag
- Fast loading with minimal JavaScript

## 🖥️ Desktop Optimizations

- Generous spacing and comfortable line lengths
- Hover effects and micro-interactions
- Large, readable typography
- Balanced grid layouts
- Professional color scheme

## 🚀 Performance

- Static site generation for fast loading
- Minimal JavaScript (only for form handling)
- Optimized images and assets
- CSS purging with Tailwind
- Fast Cloudflare CDN delivery

## 📄 License

This project is proprietary to FutureClarity Technologies.

## 🤝 Support

For questions or support, contact hello@futureclarity.com