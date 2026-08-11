# Visual Identity System

<!-- impeccable:design-schema 1 -->

## Core Aesthetic

Sleek, modern media review dashboard featuring subtle glassmorphism surface cards, high-contrast dark sidebar chrome, ambient background gradient orbs, and distinct amber timeline/spatial annotation accents against dark/light themes.

## Color System

- **Brand Green**: `--color-brand` (`#1B5E3A` light / `#2E7D4F` dark)
- **Brand Accent**: `--color-brand-accent` (`#3E8E5A` light / `#4CAF6B` dark)
- **Annotation Marker**: `--marker` (`#E8A33D` light / `#F0B75A` dark) - used exclusively for timestamps, ranges, and image pin markers.
- **Surfaces**: `--color-surface` (`#FFFFFF` light / `#15181C` dark), `--color-surface-alt` (`#F6F7F5` / `#1D2127`)
- **Borders & Grid**: `--color-border` (`#ECEEF0` / `#262B31`), `--grid-line` (subtle grid backdrop pattern)
- **Text**: `--color-text-primary` (`#111827` / `#F3F4F6`), `--color-text-secondary` (`#8A8F98` / `#9AA1AC`)

## Typography

- **Font Family**: `'Inter', system-ui, -apple-system, sans-serif`
- **Scale**:
  - `text-xs`: 11px
  - `text-sm`: 12px
  - `text-base`: 13px
  - `text-md`: 15px
  - `text-lg`: 20px
  - `text-xl`: 28px

## Surface & Elevation

- **Spacing**: 4px base (`--space-1` 4px to `--space-8` 32px)
- **Radius**: `--radius-sm` (6px), `--radius-md` (10px), `--radius-lg` (16px), `--radius-xl` (20px), `--radius-pill` (9999px)
- **Glass Treatment**: Translucent cards (`--glass-bg`) with backdrop blur (`16px`), hairline border, subtle brand glow on hover.

## Components & Patterns

- **Glass Cards**: Translucent surface elevated with backdrop blur and hairline border.
- **Media Review Workspace**: Video/audio player timeline with interactive range markers, video frame pin markers, and comment feed.
- **Stat Cards**: Stat cards with mini visual sparklines and tabular figures.
