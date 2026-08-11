# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

static HTML/CSS/JS with zero-dependency Node.js HTTP server (`node:http`, fetch, no build step).

## Users

Video, audio, and image reviewers, creative directors, and feedback collaborators reviewing media from Google Drive folders.

## Product Purpose

Streamline media review with timestamped comments, timeline range markers, and click-to-annotate image markers shared with internal teams and guest reviewers.

## Positioning

Zero-dependency, buildless media review platform connecting Google Drive media directly to real-time feedback and Supabase persistence.

## Operating Context

Browser-based web application for reviewing media assets, adding contextual feedback, and sharing review links with teams or guests.

## Capabilities and Constraints

- Media playback and review for video, audio, and images.
- Precise comment anchors: timestamp, timeline range, or image spatial coordinates.
- Workspace member authentication & public guest sharing link.
- Plain HTML/CSS/JS frontend served without build tools; Node.js backend using native `fetch`.

## Brand Commitments

- Name: Relay — Drive media reviews

## Evidence on Hand

- Runnable Node.js app at `C:\Users\rosha\OneDrive\Desktop\relay-fidelity\relay`.
- `README.md` documenting architecture, database schema, and security model.

## Product Principles

1. High fidelity, fast load, zero build overhead.
2. Contextual clarity: every piece of feedback is tied precisely in time or space to the media.
3. Frictionless collaboration for internal members and guest reviewers alike.

## Accessibility & Inclusion

- Keyboard navigable media timelines and standard web accessibility for annotation inputs.
