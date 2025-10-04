# FutureClarity Design System Documentation

This document provides a comprehensive breakdown of the design system used in the FutureClarity Automation website. Use this as a reference to recreate the UI/UX in a modern framework.

## 🎨 Color Palette

### Primary Colors
```css
--primary-color: #667eea;     /* Main brand blue */
--secondary-color: #764ba2;   /* Purple accent */
--accent-color: #f093fb;      /* Pink highlight */
--dark-color: #1a1a2e;        /* Dark navy */
--light-color: #ffffff;       /* Pure white */
```

### Text Colors
```css
--text-color: #333333;        /* Primary text - dark gray */
--text-light: #666666;        /* Secondary text - medium gray */
```

### Utility Colors
```css
--border-color: #e1e5e9;      /* Light gray borders */
--success-color: #28a745;     /* Green for success states */
--warning-color: #ffc107;     /* Yellow for warnings */
--error-color: #dc3545;       /* Red for errors */
```

## 🌈 Gradients

### Primary Gradient
```css
--gradient-primary: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
```
**Usage:** Buttons, icons, accent elements, hero animations

### Secondary Gradient
```css
--gradient-secondary: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
```
**Usage:** Special highlights, call-to-action elements

### Background Gradients
```css
/* Hero Section Background */
background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);

/* Chat Section Background */
background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);

/* Placeholder Background */
background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
```

## 🎯 Shadows & Effects

### Shadow System
```css
--shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.1);      /* Small shadow */
--shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1);      /* Medium shadow */
--shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1);    /* Large shadow */
```

### Special Effects
```css
/* Glassmorphism Navigation */
background: rgba(255, 255, 255, 0.8);
backdrop-filter: blur(10px);

/* Card Hover Shadow */
box-shadow: 0 10px 30px rgba(102, 126, 234, 0.3);

/* Dark Theme Notification */
background: rgba(17, 24, 39, 0.95);
backdrop-filter: blur(10px);
box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
```

## 📐 Layout & Spacing

### Container System
```css
.container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 20px;
}
```

### Border Radius
```css
--border-radius: 8px;         /* Standard border radius */
/* Card radius: 15px */
/* Button radius: 8px */
/* Avatar radius: 50% (circular) */
```

### Transitions
```css
--transition: all 0.3s ease;  /* Standard transition */
```

## 🔤 Typography

### Font Family
```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
```

### Font Weights
- **300:** Light
- **400:** Regular
- **500:** Medium
- **600:** Semi-bold
- **700:** Bold

### Typography Scale
```css
/* Hero Title */
font-size: 3.5rem;
font-weight: 700;
line-height: 1.2;

/* Section Headers */
font-size: 2.5rem;
font-weight: 700;

/* Card Titles */
font-size: 1.5rem;
font-weight: 600;

/* Body Text */
font-size: 1.1rem;
line-height: 1.6;

/* Small Text */
font-size: 0.9rem;
```

## 🎛️ Component Styles

### Buttons

#### Primary Button
```css
.btn-primary {
    background: var(--gradient-primary);
    color: var(--light-color);
    padding: 12px 30px;
    border-radius: var(--border-radius);
    font-weight: 500;
    box-shadow: var(--shadow-md);
    transition: var(--transition);
}

.btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-lg);
}
```

#### Outline Button
```css
.btn-outline {
    background: transparent;
    color: var(--primary-color);
    border: 2px solid var(--primary-color);
    padding: 12px 30px;
    border-radius: var(--border-radius);
}

.btn-outline:hover {
    background: var(--primary-color);
    color: var(--light-color);
}
```

### Cards

#### Service Card
```css
.service-card {
    background: var(--light-color);
    padding: 40px 30px;
    border-radius: 15px;
    box-shadow: var(--shadow-md);
    transition: var(--transition);
    text-align: center;
}

.service-card:hover {
    transform: translateY(-10px);
    box-shadow: var(--shadow-lg);
}

/* Featured Card */
.service-card.featured {
    border: 2px solid var(--primary-color);
    transform: scale(1.05);
}
```

#### Project Card
```css
.project-card {
    background: var(--light-color);
    border-radius: 15px;
    overflow: hidden;
    box-shadow: var(--shadow-md);
    transition: var(--transition);
    height: 500px;
    display: flex;
    flex-direction: column;
}

.project-card:hover {
    transform: translateY(-10px);
    box-shadow: var(--shadow-lg);
}
```

### Navigation

#### Navbar
```css
.navbar {
    position: fixed;
    top: 0;
    background: rgba(255, 255, 255, 0.8);
    backdrop-filter: blur(10px);
    box-shadow: var(--shadow-sm);
    z-index: 1000;
}

/* Navigation Links */
.nav-menu a {
    color: var(--text-color);
    font-weight: 500;
    transition: var(--transition);
    position: relative;
}

.nav-menu a:hover {
    color: var(--primary-color);
}

/* Animated Underline */
.nav-menu a::after {
    content: '';
    position: absolute;
    bottom: -5px;
    left: 0;
    width: 0;
    height: 2px;
    background: var(--gradient-primary);
    transition: width 0.3s ease;
}

.nav-menu a:hover::after {
    width: 100%;
}
```

### Forms

#### Form Inputs
```css
.form-group input,
.form-group textarea {
    width: 100%;
    padding: 12px 15px;
    border: 2px solid var(--border-color);
    border-radius: 8px;
    font-size: 1rem;
    transition: all 0.3s ease;
    background: var(--light-color);
}

.form-group input:focus,
.form-group textarea:focus {
    outline: none;
    border-color: var(--primary-color);
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}
```

### Icons

#### Service Icons
```css
.service-icon {
    width: 80px;
    height: 80px;
    background: var(--gradient-primary);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2rem;
    color: var(--light-color);
    margin: 0 auto 20px;
}
```

## 🎭 Animations

### Keyframe Animations
```css
@keyframes fadeInUp {
    from {
        opacity: 0;
        transform: translateY(30px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@keyframes fadeInRight {
    from {
        opacity: 0;
        transform: translateX(30px);
    }
    to {
        opacity: 1;
        transform: translateX(0);
    }
}

@keyframes pulse {
    0% { transform: scale(1); }
    50% { transform: scale(1.05); }
    100% { transform: scale(1); }
}

@keyframes orbit {
    0% {
        transform: rotate(0deg) translateX(150px) rotate(0deg);
    }
    100% {
        transform: rotate(360deg) translateX(150px) rotate(-360deg);
    }
}
```

### Hover Effects
```css
/* Card Hover */
transform: translateY(-10px);

/* Button Hover */
transform: translateY(-2px);

/* Icon Hover */
transform: scale(1.1);
```

## 🏗️ Layout Patterns

### Grid Systems

#### Services Grid
```css
.services-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
    gap: 30px;
}
```

#### Portfolio Grid
```css
.projects-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 40px;
    align-items: start;
}
```

#### Hero Layout
```css
.hero-container {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 60px;
    align-items: center;
}
```

### Flexbox Patterns
```css
/* Button Groups */
.hero-buttons {
    display: flex;
    gap: 20px;
}

/* Stats Display */
.hero-stats {
    display: flex;
    gap: 40px;
    justify-content: center;
}

/* Feature Items */
.feature-item {
    display: flex;
    align-items: flex-start;
    gap: 20px;
}
```

## 📱 Responsive Design

### Breakpoints
```css
/* Tablet */
@media (max-width: 1024px) and (min-width: 769px)

/* Mobile */
@media (max-width: 768px)

/* Small Mobile */
@media (max-width: 480px)
```

### Mobile Adaptations
```css
/* Mobile Navigation */
.nav-menu {
    position: fixed;
    top: 70px;
    left: -100%;
    width: 100%;
    height: calc(100vh - 70px);
    background: var(--light-color);
    flex-direction: column;
    transition: var(--transition);
}

/* Mobile Grid */
.hero-container {
    grid-template-columns: 1fr;
    text-align: center;
}

/* Mobile Typography */
.hero-title {
    font-size: 2.5rem; /* Reduced from 3.5rem */
}
```

## 🎨 Special Effects

### Gradient Text
```css
.gradient-text {
    background: var(--gradient-primary);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}
```

### Glassmorphism
```css
background: rgba(255, 255, 255, 0.8);
backdrop-filter: blur(10px);
```

### Loading States
```css
/* Loading Spinner */
@keyframes iframe-spin {
    0% { transform: translate(-50%, -50%) rotate(0deg); }
    100% { transform: translate(-50%, -50%) rotate(360deg); }
}

/* Loading Indicator */
.iframe-container::before {
    content: '';
    width: 40px;
    height: 40px;
    border: 3px solid #e3e3e3;
    border-top: 3px solid var(--primary-color);
    border-radius: 50%;
    animation: iframe-spin 1s linear infinite;
}
```

## 🎯 Interactive Elements

### Overlay Effects
```css
.project-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(102, 126, 234, 0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: var(--transition);
}

.project-card:hover .project-overlay {
    opacity: 1;
}
```

### Progress Bar
```css
.scroll-progress {
    position: fixed;
    top: 0;
    left: 0;
    width: 0%;
    height: 3px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    z-index: 9999;
    transition: width 0.1s ease;
}
```

## 🔧 JavaScript Interactions

### Key Features
- Smooth scrolling navigation
- Intersection Observer animations
- Mobile menu toggle
- Form validation and submission
- Typing effect for hero text
- Scroll progress indicator
- Notification system
- Iframe lazy loading

### Animation Triggers
```javascript
// Fade in on scroll
const observer = new IntersectionObserver(function(entries) {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
});
```

## 🎨 Design Principles

### Visual Hierarchy
1. **Primary:** Hero title with gradient text
2. **Secondary:** Section headers with underline accent
3. **Tertiary:** Card titles and navigation
4. **Body:** Descriptive text and labels

### Spacing System
- **Small:** 10px, 15px, 20px
- **Medium:** 30px, 40px, 60px
- **Large:** 80px, 100px, 120px

### Color Usage
- **Primary Blue (#667eea):** Main brand elements, links, icons
- **Secondary Purple (#764ba2):** Gradients, accents
- **Pink (#f093fb):** Special highlights, animations
- **Dark Navy (#1a1a2e):** Footer, dark sections
- **Grays:** Text hierarchy and borders

This design system creates a modern, professional, and cohesive user experience with smooth animations, clear visual hierarchy, and responsive design patterns.
