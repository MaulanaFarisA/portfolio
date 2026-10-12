# Portfolio

Personal portfolio site for Maulana Faris (maulana.app) — work, about, stack, and contact.

## Stack

- **Next.js 15** (App Router)
- **React 19**
- **TypeScript**
- **Tailwind CSS**

## Local development

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm run start    # serve the production build
```

Routes: `/`, `/work`, `/work/[slug]`, `/about`, `/stack`, `/contact`. Static assets (images, CVs, resume PDFs) live in `public/`.

## Deployment

Deployment is automatic on push:

- Push to `main` → **production** deploy on Vercel.
- Push to any other branch → **preview** deploy on Vercel.

Vercel project: **portfolio** (team `fewezs-projects`), connected to `https://github.com/MaulanaFarisA/portfolio` (public, `main` branch).

## Domain & DNS

- Primary host is the apex domain **maulana.app**.
- **www.maulana.app** 308-redirects to the apex.
- DNS records are managed at **Name.com** (external DNS records): an A record points to Vercel (`216.198.79.1`), and a CNAME for `www` points to Vercel (`8d7ec5dce7c9fd8f.vercel-dns-017.com`).
- The Google Search Console TXT verification record lives in the Name.com DNS zone.

## Rollback

To roll back a bad release:

1. Open the Vercel dashboard and go to the **portfolio** project.
2. Open **Deployments**.
3. Select a previous known-healthy deployment.
4. Click **Promote to Production**.

This is instant and does **not** trigger a rebuild.

## CV files

Static assets in `public/`:

| File | Purpose |
| --- | --- |
| `cv.html` | 2-page CV |
| `cv-full.html` | Long-form archive |
| `cv-ats.html` | ATS-plain variant |
| `resume.pdf` | Generated PDF served to recruiters |
| `resume-ats.pdf` | Generated ATS-friendly PDF |

The `/contact` page links to `/resume.pdf`.
