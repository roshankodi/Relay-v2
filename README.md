<div align="center">

  <br />
  <img src="public/favicon.svg" alt="Relay Logo" width="84" height="84" />
  
  # Relay — Next-Gen Frame-Accurate Media Reviews

  <p align="center">
    <strong>Review video, audio, and image assets directly from Google Drive — zero downloads required.</strong>
  </p>

  <p align="center">
    <a href="https://relay-v2.onrender.com" target="_blank">
      <img src="https://img.shields.io/badge/🌐_Live_Production-https%3A%2F%2Frelay--v2.onrender.com-2E7D4F?style=for-the-badge&logo=render&logoColor=white" alt="Live Demo" />
    </a>
  </p>

  <p align="center">
    <img src="https://img.shields.io/badge/Node.js-v18+-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" />
    <img src="https://img.shields.io/badge/Dependencies-0-brightgreen?style=flat-square" alt="Zero Dependencies" />
    <img src="https://img.shields.io/badge/Supabase-Auth_%26_RLS-3ECF8E?style=flat-square&logo=supabase&logoColor=white" alt="Supabase" />
    <img src="https://img.shields.io/badge/Mobile-100%25_Responsive-4CAF6B?style=flat-square" alt="Mobile Responsive" />
  </p>

  <br />

</div>

---

## ⚡ Overview

**Relay** is a high-fidelity, zero-dependency media review platform engineered for creative teams, video editors, and agency clients. Reviewers leave timestamped comments, drag timeline range selections (`0:15–0:20`), and collaborate seamlessly on assets hosted directly in your public Google Drive.

> 🌐 **Live Production Link**: **[https://relay-v2.onrender.com](https://relay-v2.onrender.com)**

---

## ✨ Core Highlights

- ⏱ **Frame-Accurate Feedback**: Comment at exact timestamps or drag timeline handles for range feedback.
- 📂 **Stays in Google Drive**: Reads directly from public Drive folders. No file re-uploading or duplicate storage fees.
- 🔗 **Share Without Friction**: Share secure 128-bit review links. Reviewers add their name once and start commenting — no account required.
- 🎵 **Multi-Format Fallback Previews**: Type-specific preview canvases for video, audio, and image assets.
- ⚡ **Zero-Build Architecture**: Pure Node.js HTTP server and vanilla HTML/CSS/JS. Zero heavy bundler configurations or npm security vulnerabilities.
- 📱 **Mobile-First Responsive**: 100% fluid interface tailored for small phones, tablets, laptops, and large desktop screens.
- 🌓 **Flash-Free Theme Engine**: Instant, zero-flicker dark & light mode switching.

---

## 🛠 Tech Stack & Architecture

| Layer | Technology |
|---|---|
| **Runtime** | Pure Node.js (v18+) with native modules (`node:http`, `node:crypto`, `fetch`) |
| **Frontend** | Vanilla HTML5 / CSS3 (Minty Glass Design System) / ES Modules |
| **Authentication** | Supabase Auth (OAuth 2.0 Google Integration & Passwordless Sessions) |
| **Database** | PostgreSQL + Row Level Security (RLS) via PostgREST |
| **Storage Engine** | Google Drive v3 REST API |

```
relay/
├── server.js                # High-performance zero-dependency HTTP server
├── lib/
│   ├── supabase.js          # Direct Supabase Auth & PostgREST fetch client
│   ├── drive.js             # Google Drive v3 REST API integration
│   ├── session.js           # Secure cookie session management
│   ├── validate.js          # Server-side input validation engine
│   ├── cookies.js           # Cookie parsing & serialization
│   └── ratelimit.js         # Per-instance rate limiting
├── public/                  # Flash-free front-end application
│   ├── index.html           # Landing page & interactive hero demo
│   ├── app.html             # Workspace directory & stats dashboard
│   ├── workspace.html       # Media grid & Google Drive sync engine
│   ├── media.html           # Professional video/audio player & review stage
│   ├── login.html           # Glassmorphic auth portal
│   ├── styles.css           # Minty glass design system & mobile breakpoints
│   └── favicon.svg          # Custom vector brand icon
└── supabase/migrations/     # Database schema & Row Level Security (RLS)
```

---

## 🚀 Quick Start

### 1. Clone & Setup

```bash
git clone https://github.com/YOUR_USERNAME/relay.git
cd relay
cp .env.example .env
```

### 2. Environment Configuration

Configure your `.env` variables:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-supabase-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
GOOGLE_API_KEY=your-google-drive-api-key
PORT=3000
NODE_ENV=development
```

### 3. Launch Locally

```bash
npm run dev
```

Open **`http://localhost:3000`** in your browser.

---

## 🧪 Unit Tests

Run the built-in Node.js test suite:

```bash
npm test
```

---

## 🔒 Security Model

- **Row Level Security (RLS)**: Database queries are subject to PostgreSQL RLS policies matching the user's session token.
- **Guest Capabilities**: Anonymous guest reviewers receive a 128-bit token stored in `localStorage` to authorize editing/deleting their own comments.
- **Zero Service-Role Key**: No administrative service-role keys are exposed or used by the server.

---

<br />

<div align="center">
  <p align="center">
    Crafted with ❤️ by <strong>Roshan</strong> @ <strong>Deep Sauce Labs</strong>
  </p>
  <p align="center">
    <sub>© 2026 Deep Sauce Labs. All rights reserved.</sub>
  </p>
</div>
