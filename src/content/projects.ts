/**
 * Project content model.
 *
 * Human text is stored directly on each project.
 */

export interface Project {
  /** URL segment: /work/<slug> */
  slug: string;
  /** Project title - also the card link accessible name. */
  title: string;
  role: string;
  year: string;
  /** One technology per entry. */
  stack: string[];
  /** Live or repo URL, `""` when none. */
  link: string;
  /** Thumbnail source, `""` renders the placeholder tile. */
  image: string;
  overview: string;
  problem: string;
  /** Optional (§6.4 #3). */
  constraints: string;
  decision: string;
  solution: string;
  /** Required; no outcome, no publish (§6.4). */
  outcome: string;
  /** Optional (§6.4 #8). */
  reflection: string;
  /** Short one-line description shown on the card (§6.3). */
  description: string;
  /** Tags shown in the card tag row (§6.3). */
  tags: string[];
  /** Featured projects lead the home page and the work index (§5.4). */
  featured: boolean;
}

export const projects: Project[] = [
  {
    slug: "apecx-2026",
    title: "APECX 2026 Web Platform",
    role: "IT Developer",
    year: "2026",
    stack: ["Next.js", "TypeScript", "Docker", "Git"],
    link: "https://github.com/apecxugm/apecx2026",
    image: "/work/apecx-cover.png",
    overview:
      "Core sections of the official web platform for APECX 2026, an Asia-Pacific competition organized by SPE UGM Student Chapter with 490+ registered teams. I built the About Us section, the responsive navbar, the sponsor CTA, and the competition archive gallery.",
    problem:
      "A competition platform has to present a lot of information (categories, timelines, sponsors, archives) without overwhelming first-time visitors, on any device, while the organizing team keeps shipping other sections in parallel.",
    constraints: "",
    decision:
      "Structured each section as a self-contained, responsive component so parallel PRs from the team couldn't collide: the navbar, About Us, sponsor CTA, and gallery could each ship and be reviewed on their own.",
    solution:
      "Next.js + TypeScript with a Docker-based local workflow and peer-reviewed PRs. I shipped the About Us section, the responsive navbar, the sponsor CTA, and the competition archive gallery, and resolved cross-branch merge conflicts during release crunch.",
    outcome:
      "The platform supported APECX 2026 through its run with 490+ registered teams across the Asia-Pacific. The repo remains public at github.com/apecxugm/apecx2026.",
    reflection: "",
    description:
      "Core sections of the APECX 2026 competition platform: About Us, navbar, sponsor CTA, and archive gallery, in a Next.js codebase.",
    tags: ["Next.js", "TypeScript", "Docker"],
    featured: true,
  },
  {
    slug: "malpres-2025",
    title: "MALPRES 2025 Web Platform",
    role: "IT Developer",
    year: "2025",
    stack: ["Next.js", "React", "Tailwind CSS", "Vercel"],
    link: "https://malpres2025.vercel.app",
    image: "/work/malpres.jpg",
    overview:
      "MALPRES 2025 (Malam Apresiasi MIPA) is the Faculty of Mathematics and Natural Sciences UGM's annual appreciation night. The web platform handles ticketing, nominations and voting, the event gallery, and day-by-day activity rundowns for a faculty-wide audience across all MIPA study programs.",
    problem:
      "A faculty event with 10 nomination categories and 349 nominees needs one place where every study program can follow the rundown, vote, and revisit the night afterwards. Static posts scattered across Instagram cannot carry voting windows or a gallery that stays browsable.",
    constraints:
      "Built with the IT committee team; the voting window ran 27 October to 4 November 2025 ahead of the event on 18-19 November at Gelanggang Inovasi dan Kreativitas UGM; the audience is the whole faculty, most of them on phones.",
    decision:
      "Split the platform into focused pages so each job gets a dedicated surface: /kegiatan for the event rundown and day-by-day activities, /galeri for the moments, and separate flows for tickets and nominations. Keeping gallery and activity content on their own routes meant they could ship and be updated independently during the event week.",
    solution:
      "I built the /kegiatan activity pages and the /galeri gallery experience: the section layout, responsive grid, and the components that surface the night's moments and rundown. The platform runs on Next.js with the rest of the committee's modules (ticketing, nominations, voting).",
    outcome:
      "Live at malpres2025.vercel.app through the voting window and the event itself; the faculty community used it to follow the rundown, vote across 10 categories, and browse the gallery afterwards. Estimated 500-1000 attendees across the two nights.",
    reflection:
      "Working inside a committee's codebase taught me to keep my pages self-contained: the gallery and activity pages had to stay stable while other modules changed daily during the voting window.",
    description:
      "Activity rundown and gallery pages for MALPRES 2025, FMIPA UGM's faculty appreciation night, live through voting and event week.",
    tags: ["Next.js", "React", "Tailwind CSS"],
    featured: true,
  },
  {
    slug: "buku-tahu",
    title: "Buku Tahu",
    role: "Web Developer, Bakti BCA Endurance Team",
    year: "2026",
    stack: ["Next.js", "TypeScript", "Tailwind CSS", "Supabase", "PWA", "Vitest"],
    link: "https://umkm-tahu.vercel.app",
    image: "/work/buku-tahu.jpg",
    overview:
      "Buku Tahu is a bookkeeping web app for tofu SMEs in Yogyakarta, built as part of the Bakti BCA 2026 scholarship's Endurance Team community project. It tracks daily income, expenses, and unpaid receivables, and installs as a PWA so a shop owner can run it from a phone.",
    problem:
      "Tofu producers in Wirobrajan ran their books on paper and memory. The original Endurance Team prototype was a spreadsheet; the SMEs needed something they could actually operate daily from a phone, in Indonesian, without training.",
    constraints:
      "Built alongside a full course load within the scholarship timeline (May-June 2026); one developer; the domain model had to match how tofu is actually sold: boards, packs, and per-piece pricing (1 board = 169 pieces, 1 pack = 10 pieces).",
    decision:
      "Modeled the ledger around the tofu trade's real units (board/pack/piece) instead of generic inventory fields, and shipped it as an installable PWA with email auth rather than a native app: zero install friction, one codebase.",
    solution:
      "Next.js App Router + TypeScript with a Supabase (Postgres + Auth) backend. Screens: daily dashboard (revenue/expenses/profit), sales entry, expense entry, receivables, and business settings. Vitest covers the bookkeeping math; deployed on Vercel.",
    outcome:
      "Live in production at umkm-tahu.vercel.app and used by the tofu SME it was built for; the Endurance Team's broader community project was covered by UGM's official news.",
    reflection:
      "Shipping for one real business, not a rubric, changed how I scoped: the unit model and the simplest possible entry flow mattered more than features. Next I'd invest in offline write support so the app works even when the signal drops.",
    description:
      "A bookkeeping PWA for tofu SMEs: daily income, expenses, and receivables from a phone.",
    tags: ["Next.js", "TypeScript", "Supabase"],
    featured: true,
  },
  {
    slug: "astar",
    title: "A Star Shop",
    role: "Web Developer",
    year: "2026",
    stack: ["Next.js", "React", "Tailwind CSS", "Supabase", "Vercel"],
    link: "https://web-astar.vercel.app/",
    image: "/work/astar.jpg",
    overview:
      "A Star Shop is a clothing storefront, live at web-astar.vercel.app. It presents an A*Star Collection of eight products across four categories (hoodies, tees, jackets, and pants) with IDR pricing, a cart, stock badges, and a product-detail modal, and it gates ordering behind a customer account.",
    problem:
      "The storefront needs a browsable catalog with real stock states, and ordering needs to be tied to customer accounts.",
    constraints: "",
    decision:
      "Keep browsing on a single-page catalog with a product-detail modal instead of separate product routes, and gate ordering behind an account: an out-of-stock card cannot be opened, and placing an order prompts sign-up or sign-in.",
    solution:
      "A Next.js + React storefront styled with Tailwind CSS and backed by Supabase auth. The A*Star Collection grid shows category, IDR price, and stock badges (one product renders OUT OF STOCK); the product-detail modal shows the image, price, and available count. Registering captures name, phone, and address, and the cart tracks the shopper's picks.",
    outcome:
      "Live at web-astar.vercel.app. Eight products across four categories (hoodies, tees, jackets, pants) with IDR pricing, cart, stock badges, and an account-gated order flow on Next.js + Supabase.",
    reflection: "",
    description:
      "An 8-product clothing storefront with cart, stock states, and account-gated ordering on Next.js + Supabase.",
    tags: ["Next.js", "E-commerce", "Vercel"],
    featured: false,
  },
];

/** Site-level copy used by the empty work state (§5.4, §11.2). */
export const EMPTY_WORK_MESSAGE = "No published work yet. New projects land here soon.";

export function getProjectBySlug(slug: string): Project | undefined {
  return projects.find((project) => project.slug === slug);
}

/** §6.4: a case study with no Outcome section must not be published. */
export function isPublishable(project: Project | undefined): project is Project {
  return !!project && project.outcome.trim().length > 0;
}
