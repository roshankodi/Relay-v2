<div align="center">

  <br />
  <img src="public/favicon.svg" alt="Relay Logo" width="80" height="80" />
  
  # Relay — Next-Gen Frame-Accurate Media Reviews

  <p align="center">
    <strong>Review video, audio, and image assets straight from your Google Drive — zero downloads required.</strong>
  </p>

  <p align="center">
    <a href="https://relay-v2.onrender.com" target="_blank">
      <img src="https://img.shields.io/badge/🌐_Live_Demo-https%3A%2F%2Frelay--v2.onrender.com-2E7D4F?style=for-the-badge&logo=render&logoColor=white" alt="Live Demo" />
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

**Relay** is a high-fidelity, zero-dependency media review platform built for creative teams, video editors, and agency clients. Reviewers drop timestamped comments, drag timeline range selections, and leave visual annotations directly on media files stored in your public Google Drive.

> 🚀 **Live Production Link**: **[https://relay-v2.onrender.com](https://relay-v2.onrender.com)**

---

## ✨ Key Features

- ⏱ **Frame-Accurate Feedback**: Comment at exact video timestamps or drag to select range markers (`0:15–0:20`).
- 📂 **Stays in Google Drive**: Relay reads directly from public Drive folders. No file re-uploading, duplicating, or storage costs.
- 🔗 **Share Without Friction**: Share a 128-bit secure review link. Reviewers enter their name once and start commenting — no signup required.
- 🎵 **Multi-Format Previews**: Native video stage, audio waveform player, and image review with fallback canvases.
- ⚡ **Zero-Build Architecture**: Pure Node.js HTTP server and vanilla HTML/CSS/JS. Zero heavy bundlers, zero npm dependency vulnerabilities.
- 📱 **Mobile-First Responsive**: 100% fluid mobile, tablet, and desktop interface with touch-friendly 44px tap targets.
- 🌓 **Flash-Free Theme Engine**: Instant, zero-flicker dark & light mode switching.

---

## 🛠 Project Architecture

```
relay/
├── server.js                # High-performance zero-dependency HTTP server
├── lib/
│   ├── supabase.js          # Direct Supabase Auth & PostgREST fetch client
│   ├── drive.js             # Google Drive REST API integration
│   ├── session.js           # Secure cookie session management
│   ├── validate.js          # Strict server-side input validation
│   ├── cookies.js           # Cookie parsing utility
│   └── ratelimit.js         # In-memory rate limiting engine
├── public/                  # Flash-free front-end application
│   ├── index.html           # Landing page & interactive hero preview
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

### 1. Clone & Setup Environment

```bash
git clone https://github.com/YOUR_USERNAME/relay.git
cd relay
cp .env.example .env
```

### 2. Configure Environment Variables

Edit `.env` with your credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-supabase-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
GOOGLE_API_KEY=your-google-drive-api-key
PORT=3000
NODE_ENV=development
```

### 3. Run Locally

```bash
npm run dev
```

Visit **`http://localhost:3000`** in your browser.

---

## 🧪 Unit Tests

Run the dependency-free Node.js unit test suite:

```bash
npm test
```

---

## 🔒 Security & Capability Model

- **Row Level Security (RLS)**: Database access is strictly governed by Supabase RLS policies.
- **Guest Capabilities**: Anonymous guest comments use 128-bit capability tokens stored locally in the reviewer's browser, preventing unauthorized comment tampering.
- **Zero Service-Role Leaks**: Database queries run with the user's own session token.

---

<div align="center">
  <br />
  <sub>Built with ❤️ for creative teams. Powered by Node.js & Supabase.</sub>
</div>
