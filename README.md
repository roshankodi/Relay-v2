# Relay

> **Next-Gen Frame-Accurate Media Reviews Directly from Google Drive**

[![Vercel Deployment](https://img.shields.io/badge/Vercel-Live_Deployment-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://relay-dsl.vercel.app/)
[![Node.js](https://img.shields.io/badge/Node.js-v18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-Auth_%26_PostgreSQL-3ECF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com/)

---

## Executive Summary

**Relay** is an enterprise-grade media review platform engineered for creative teams, video editors, and agency clients. It enables reviewers to leave frame-accurate timestamped comments, drag timeline range selections (`0:15–0:20`), and collaborate on video, audio, and visual assets stored directly within Google Drive — eliminating file downloads, duplication, and extra storage costs.

- **Production Live Link**: **[https://relay-dsl.vercel.app](https://relay-dsl.vercel.app/)**
- **Architecture**: Zero-dependency Serverless Node.js Engine (`@vercel/node`) + Vanilla HTML5/CSS3/ES Modules.

---

## Key Capabilities

- **Frame-Accurate Feedback**: Anchor comments to exact video timestamps or multi-second range selections (`0:15–0:20`).
- **Native Google Drive Streaming**: Reads directly from public Drive folders via Google REST APIs. Assets stay in Drive; no re-uploading or cloud duplication.
- **Frictionless Share Links**: Share secure 128-bit review links. External reviewers enter a display name once and collaborate without creating an account.
- **Multi-Format Previews**: Type-specific preview canvases for video, audio, and image assets with WebKit fallback rendering.
- **Zero-Dependency Architecture**: Built without heavy bundlers or external framework bloat. Plain Node.js runtime ensuring zero vulnerability surface area.
- **Mobile-First Responsive**: Fully responsive across mobile (320px–480px), tablet (481px–1024px), and desktop (1025px+) viewports.
- **Flash-Free Theme Initialization**: Instant, zero-flicker dark/light mode switching executing synchronously before initial paint.

---

## Technical Architecture & Stack

| Component | Specification |
|---|---|
| **Runtime & Hosting** | Node.js (v18+) Serverless Runtime deployed on **Vercel** (`@vercel/node`) |
| **Frontend Shell** | Vanilla HTML5 / CSS3 (Minty Glass Token System) / Native ES Modules |
| **Authentication** | Supabase Auth (OAuth 2.0 Google Integration & Passwordless Sessions) |
| **Database & Security** | PostgreSQL + Row Level Security (RLS) via PostgREST |
| **Cloud Media API** | Google Drive v3 REST API |

```text
relay/
├── vercel.json              # Vercel serverless deployment specification
├── server.js                # High-performance Node.js HTTP router & API controller
├── lib/
│   ├── supabase.js          # Direct Supabase Auth & PostgREST fetch client
│   ├── drive.js             # Google Drive v3 REST API integration
│   ├── session.js           # Secure cookie session management
│   ├── validate.js          # Server-side input validation engine
│   ├── cookies.js           # Cookie parsing & serialization
│   └── ratelimit.js         # Per-instance rate limiting
├── public/                  # Static frontend application
│   ├── index.html           # Landing page & interactive hero preview
│   ├── app.html             # Workspace directory & stats dashboard
│   ├── workspace.html       # Media grid & Google Drive sync engine
│   ├── media.html           # Video/audio player & review stage
│   ├── login.html           # Glassmorphic auth portal
│   ├── styles.css           # Minty glass design system & mobile breakpoints
│   └── favicon.svg          # Custom vector brand icon
└── supabase/migrations/     # PostgreSQL schema & RLS security policies
```

---

## Getting Started

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **Supabase Account**: Project URL and Anon Key
- **Google Drive API Key**: Scoped for Google Drive v3 REST API

### Local Development

1. **Clone Repository**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/relay.git
   cd relay
   ```

2. **Configure Environment Variables**:
   Create a `.env` file in the root directory:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-supabase-id.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
   GOOGLE_API_KEY=your-google-drive-api-key
   PORT=3000
   NODE_ENV=development
   ```

3. **Start Development Server**:
   ```bash
   npm run dev
   ```
   Navigate to `http://localhost:3000`.

4. **Execute Test Suite**:
   ```bash
   npm test
   ```

---

## Security Model

- **Row Level Security (RLS)**: Access control is strictly enforced at the PostgreSQL layer matching the authenticated user's session token.
- **Capability Tokens**: Anonymous guest reviewers are issued 128-bit random tokens persisted in `localStorage` to authorize editing/deleting their own comments.
- **Zero Superuser Exposure**: Server requests execute under user-scoped tokens without exposing administrative service-role keys.

---

## Author & Credits

Designed & Developed by **Roshan** at **Deep Sauce Labs**. 

© 2026 Deep Sauce Labs. All rights reserved. 
