# Relay Design System Master Prompt & Token Package

> **A Complete AI Prompt, CSS Tokens, Contrast Standards, Typography, and Glassmorphism Guide**

Use this document to copy and paste the design system into any new project or AI assistant (ChatGPT, Claude, Cursor, Antigravity).

---

## 📋 AI Master Prompt (Copy & Paste to Any AI Assistant)

```markdown
Act as a Senior UI/UX & Frontend Engineer. Apply the "Minty Glass & High-Contrast Obsidian" design system to this codebase. Re-style all layouts, cards, buttons, modals, navigation bars, grids, and typography to strictly match these design guidelines and CSS variables:

### 1. Typography & Contrast Rules
- **Primary Font Family**: 'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, sans-serif.
- **Font Sizes**: Body: 14px–15px (line-height: 1.5). Headings: 24px–34px (font-weight: 750–800, letter-spacing: -0.02em). Captions: 12px–13px (font-weight: 600).
- **High Contrast**: Primary text must be high-contrast against background (`#F2F4F3` in Dark, `#102619` in Light). Muted text uses `--color-text-secondary`.

### 2. Color Palette & Dual-Mode Tokens

#### Dark Mode Palette (Default Obsidian Mint)
- Page Background: `#0B0E0C` gradient to `#0E1210`
- Glass Cards & Containers: `background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.09); backdrop-filter: blur(24px);`
- Brand Emerald Accent: `#4CAF6B`
- Primary Hover Glow: `box-shadow: 0 0 32px rgba(76, 175, 107, 0.14);`
- Text Colors: Primary `#F2F4F3`, Secondary `#8E9690`

#### Light Mode Palette (Fresh Minty Glass)
- Page Background: `#EBF7F0` gradient to `#DFF3E7`
- Glass Cards & Containers: `background: rgba(223, 243, 231, 0.75); border: 1px solid rgba(35, 110, 60, 0.22); backdrop-filter: blur(24px);`
- Brand Emerald Accent: `#288E4F`
- Text Colors: Primary `#102619`, Secondary `#2E503B`

### 3. Glassmorphic Cards & Grid Layouts
- **Card Design**: Frosted glass panels with rounded corners (`border-radius: 20px` or `28px`). Specular top highlight sheen: `box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15), var(--shadow-sm);`.
- **Card Hover Effect**: Soft vertical lift `transform: translateY(-2px);` with emerald border transition and glow shadow.
- **Grid Layout**: 3-column auto-fit grid (`grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px;`). On mobile viewports (`max-width: 640px`), collapse to `grid-template-columns: 1fr;`.
- **Background Grid Pattern**: Subtle ambient background grid with soft radial gradient ambient blur orbs in the background.

### 4. Interactive Components & Buttons
- **Primary CTA Buttons**: Fully rounded pill shape (`border-radius: 9999px`), Emerald background (`--color-brand-accent`), white text, bold font-weight (650), padding: `10px 22px`.
- **Active Card Outline**: Active/selected items MUST use INSET border highlights (`box-shadow: inset 0 0 0 1.5px var(--color-brand-accent);`) so outline rings never overlap or collide with right-side scrollbars.
- **Action Pills**: Frosted pill capsules for secondary actions (`Reply`, `Edit`, `Delete`) with subtle vector SVG icons.

Please generate `tokens.css` and update the project's CSS components accordingly.
```

---

## 🎨 Design Tokens File (`tokens.css`)

```css
/*
 * Minty Glass & High-Contrast Design System Tokens
 */
:root {
  /* Color — Minty High-Fidelity Light Mode */
  --color-brand: #227C44;
  --color-brand-accent: #288E4F;
  --color-success: #388E3C;
  --color-danger: #D9483B;
  --color-bg-gradient-start: #EBF7F0;
  --color-bg-gradient-end: #DFF3E7;
  --color-surface: rgba(223, 243, 231, 0.85);
  --color-surface-alt: rgba(205, 236, 216, 0.90);
  --color-sidebar-bg: #141715;
  --color-sidebar-text: #969C97;
  --color-sidebar-text-active: #FFFFFF;
  --color-text-primary: #102619;
  --color-text-secondary: #2E503B;
  --color-border: rgba(35, 110, 60, 0.20);
  --color-on-accent: #FFFFFF;
  --color-focus-ring: 0 0 0 3px rgba(34, 124, 68, 0.3);

  /* Glass & Atmosphere — Light Theme */
  --glass-bg: rgba(223, 243, 231, 0.75);
  --glass-border: rgba(35, 110, 60, 0.22);
  --glass-blur: 24px;
  --glow-brand: 0 10px 32px rgba(34, 124, 68, 0.16);
  --orb-1: rgba(40, 142, 79, 0.18);
  --orb-2: rgba(25, 95, 50, 0.12);
  --grid-line: rgba(30, 100, 55, 0.04);

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;

  /* Radius */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-xl: 20px;
  --radius-2xl: 28px;
  --radius-3xl: 34px;
  --radius-pill: 9999px;

  /* Shadows */
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.03);
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 8px 24px rgba(15, 23, 19, 0.06);
  --shadow-lg: 0 16px 44px rgba(15, 23, 19, 0.08);

  /* Typography */
  --font-family: 'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, sans-serif;
  --text-xs: 13px;
  --text-sm: 14px;
  --text-base: 15px;
  --text-md: 17px;
  --text-lg: 24px;
  --text-xl: 34px;
}

.dark {
  --color-brand: #2E7D4F;
  --color-brand-accent: #4CAF6B;
  --color-success: #4CAF50;
  --color-danger: #E8756A;
  --color-bg-gradient-start: #0B0E0C;
  --color-bg-gradient-end: #0E1210;
  --color-surface: rgba(255, 255, 255, 0.05);
  --color-surface-alt: rgba(255, 255, 255, 0.08);
  --color-sidebar-bg: #121614;
  --color-sidebar-text: #8E9690;
  --color-sidebar-text-active: #FFFFFF;
  --color-text-primary: #F2F4F3;
  --color-text-secondary: #8E9690;
  --color-border: rgba(255, 255, 255, 0.09);
  --color-on-accent: #FFFFFF;
  --color-focus-ring: 0 0 0 3px rgba(76, 175, 107, 0.35);

  /* Glass & Atmosphere — Dark Theme */
  --glass-bg: rgba(255, 255, 255, 0.04);
  --glass-border: rgba(255, 255, 255, 0.09);
  --glass-blur: 20px;
  --glow-brand: 0 0 32px rgba(76, 175, 107, 0.14);
  --orb-1: rgba(76, 175, 107, 0.12);
  --orb-2: rgba(46, 125, 79, 0.08);
  --grid-line: rgba(255, 255, 255, 0.04);

  --shadow-md: 0 12px 32px rgba(0, 0, 0, 0.45);
  --shadow-lg: 0 16px 64px rgba(0, 0, 0, 0.60);
}
```

---

## ⚡ Core Component CSS Snippets

### 1. Page Background & Ambient Grid Mesh
```css
body {
  font-family: var(--font-family);
  background: radial-gradient(circle at 50% 0%, var(--color-bg-gradient-start), var(--color-bg-gradient-end));
  color: var(--color-text-primary);
  min-height: 100vh;
}

body::before {
  content: '';
  position: fixed;
  inset: 0;
  background-image: 
    linear-gradient(to right, var(--grid-line) 1px, transparent 1px),
    linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px);
  background-size: 32px 32px;
  pointer-events: none;
  z-index: 0;
}
```

### 2. Glassmorphic Card Panel
```css
.card-glass {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border-radius: var(--radius-2xl);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15), var(--shadow-sm);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.card-glass:hover {
  transform: translateY(-2px);
  border-color: var(--color-brand-accent);
  box-shadow: var(--shadow-md), var(--glow-brand);
}
```

### 3. Primary CTA Button
```css
.btn-primary {
  background: var(--color-brand-accent);
  color: #FFFFFF;
  font-family: var(--font-family);
  font-weight: 650;
  font-size: 14px;
  letter-spacing: -0.2px;
  padding: 10px 22px;
  border-radius: var(--radius-pill);
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: var(--glow-brand);
  cursor: pointer;
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.btn-primary:hover {
  transform: translateY(-1px);
  filter: brightness(1.08);
}
```

### 4. Active Inset Highlight Ring
```css
.card-glass.active {
  border-color: var(--color-brand-accent) !important;
  background: color-mix(in srgb, var(--color-brand-accent) 14%, var(--glass-bg)) !important;
  box-shadow: inset 0 0 0 1.5px var(--color-brand-accent), var(--shadow-md), var(--glow-brand) !important;
}
```

### 5. Flash-Free Synchronous Theme Initialization
Place this inline script in `<head>` before stylesheets load:
```html
<script>
  (function() {
    try {
      var saved = localStorage.getItem('theme');
      var dark = saved ? saved === 'dark' : true;
      if (dark) document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
    } catch (e) {}
  })();
</script>
```
