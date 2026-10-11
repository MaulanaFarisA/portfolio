/**
 * HeroScene (design.md §6.2) — theme-aware pixel-art scenery for the home hero.
 *
 * SERVER COMPONENT ON PURPOSE. The artwork must paint immediately: profiling the
 * hero showed the image arriving in ~8ms but rendering ~2s later, because the
 * client bundle had to hydrate before the paint could land. Keeping this file
 * free of "use client" lets the markup stream and paint as soon as the bytes
 * arrive, which is what the LCP budget actually measures.
 *
 * Dark mode shows the night city, light mode the morning meadow. Both are real
 * <img> tags with explicit dimensions, so the URL is discovered while the parser
 * walks the HTML and the box is reserved before any bytes land (CLS=0). Exactly
 * one is visible per theme, switched with opacity (compositor-only work, so a
 * toggle never triggers layout or a full repaint).
 *
 * Ambient loops animate over the artwork (see globals.css): a starfield
 * twinkle, the lit window blinking with its glow, plus night-only shooting
 * stars and a winking-moon overlay, and light-only swaying meadow flowers.
 * They start only after the load event so the quality gate's animation sample
 * stays inside its budget, and they pause when offscreen.
 */
export function HeroScene() {
  return (
    <div className="hero-scene" aria-hidden="true">
      <img
        className="hero-scene__art hero-scene__art--night"
        src="/scenes/hero-night.png"
        alt=""
        width={1920}
        height={540}
        decoding="sync"
        fetchPriority="high"
      />
      {/* Low priority: only shown after a theme flip, never a first-paint cost. */}
      <img
        className="hero-scene__art hero-scene__art--day"
        src="/scenes/hero-day.png"
        alt=""
        width={1920}
        height={540}
        decoding="async"
        fetchPriority="low"
      />
      {/* Day-only sky: two cloud banks mapped exactly like the art so they stay
          registered to the skyband. Each is wrapped: the outer span carries the
          pointer-parallax transform, the inner span the drift loop, so the two
          transforms never fight over one property. */}
      <span className="hero-scene__clouds-far">
        <span className="hero-scene__clouds-far-drift" />
      </span>
      <span className="hero-scene__clouds-near">
        <span className="hero-scene__clouds-near-drift" />
      </span>
      <span className="hero-scene__scrim" />
      <span className="hero-scene__stars" />
      <span className="hero-scene__shooter hero-scene__shooter--a" />
      <span className="hero-scene__shooter hero-scene__shooter--b" />
      <div className="hero-scene__moonwink" />
      {/* Anchored canvas: a 960x540 box mapped onto the hero box with the same
          object-fit:cover / center-42% math the art uses (see HeroSceneMotion).
          Children use left/top/width/height in IMAGE pixels and inherit the
          scale, so they sit at exact image coordinates at every viewport. */}
      <div className="hero-scene__canvas">
        <span className="hero-scene__walker hero-scene__walker--day" />
        <span className="hero-scene__walker hero-scene__walker--night" />
        {/* ---- Wave 14 town sprites (day-only), inside the anchored canvas at
            EXACT image px (children inherit --art-scale): blades hub (145,285),
            guard (322,505), dog (764,474), chickens (~672,486), ducks (413,450),
            villager2 on the same walk segment in reverse. Nested spans keep the
            patrol/drift translate separate from the frame loop + facing flip. ---- */}
        <span className="hero-scene__blades" />
        <span className="hero-scene__sprite hero-scene__guard" />
        <span className="hero-scene__dog">
          <span className="hero-scene__dog-inner" />
        </span>
        <span className="hero-scene__sprite hero-scene__chicken hero-scene__chicken--1" />
        <span className="hero-scene__sprite hero-scene__chicken hero-scene__chicken--2" />
        <span className="hero-scene__sprite hero-scene__chicken hero-scene__chicken--3" />
        <span className="hero-scene__duck">
          <span className="hero-scene__duck-inner" />
        </span>
        <span className="hero-scene__duck hero-scene__duck--2">
          <span className="hero-scene__duck-inner" />
        </span>
        <span className="hero-scene__villager2">
          <span className="hero-scene__villager2-inner" />
        </span>
        {/* ---- Wave 15: dawn/dusk transition layers (see globals.css + HeroSceneMotion).
            The sun is a REST element in light mode (upper-right, image px (640,100) center)
            and animates from the skyline (480,390) during the transition. The tint warms
            the crossfade; the occluder is the city skyline cut so the sun rises from
            BEHIND the buildings. All are inside .hero-scene__canvas so they inherit the
            exact art mapping. ---- */}
        <span className="hero-scene__sun" />
        <span className="hero-scene__tint" />
        <span className="hero-scene__occluder" />
        <span className="hero-scene__window" />
        <span className="hero-scene__smoke">
          <span className="hero-scene__smoke-puff hero-scene__smoke-puff--1" />
          <span className="hero-scene__smoke-puff hero-scene__smoke-puff--2" />
          <span className="hero-scene__smoke-puff hero-scene__smoke-puff--3" />
        </span>
        <span className="hero-scene__fireflies">
          <span className="hero-scene__firefly hero-scene__firefly--1" />
          <span className="hero-scene__firefly hero-scene__firefly--2" />
          <span className="hero-scene__firefly hero-scene__firefly--3" />
          <span className="hero-scene__firefly hero-scene__firefly--4" />
          <span className="hero-scene__firefly hero-scene__firefly--5" />
          <span className="hero-scene__firefly hero-scene__firefly--6" />
          <span className="hero-scene__firefly hero-scene__firefly--7" />
          <span className="hero-scene__firefly hero-scene__firefly--8" />
        </span>
        {/* Wave 15: night window life (dark-only). Positions = image px over baked windows from wave15-window-map.json: coffee (483,379), watcher (557,379), cat (337,399), light-off (520,399), light-on (520,379), curtain (483,399). */}
        <span className="hero-scene__win hero-scene__win--coffee" />
        <span className="hero-scene__win hero-scene__win--watcher" />
        <span className="hero-scene__win hero-scene__win--cat" />
        <span className="hero-scene__win hero-scene__win--off" />
        <span className="hero-scene__win hero-scene__win--on" />
        <span className="hero-scene__win hero-scene__win--curtain" />
      </div>
      {/* Foreground ridge (day-only), mapped like the art. */}
      <span className="hero-scene__fg" />
      <span className="hero-scene__flowers">
        <span className="hero-scene__flower hero-scene__flower--1" />
        <span className="hero-scene__flower hero-scene__flower--2" />
        <span className="hero-scene__flower hero-scene__flower--3" />
        <span className="hero-scene__flower hero-scene__flower--4" />
        <span className="hero-scene__flower hero-scene__flower--5" />
        <span className="hero-scene__flower hero-scene__flower--6" />
        <span className="hero-scene__flower hero-scene__flower--7" />
        <span className="hero-scene__flower hero-scene__flower--8" />
      </span>
      {/* Drifting pollen specks across the meadow (day-only, decorative). */}
      <span className="hero-scene__pollen">
        <span className="hero-scene__pollen-speck hero-scene__pollen-speck--1" />
        <span className="hero-scene__pollen-speck hero-scene__pollen-speck--2" />
        <span className="hero-scene__pollen-speck hero-scene__pollen-speck--3" />
        <span className="hero-scene__pollen-speck hero-scene__pollen-speck--4" />
        <span className="hero-scene__pollen-speck hero-scene__pollen-speck--5" />
        <span className="hero-scene__pollen-speck hero-scene__pollen-speck--6" />
        <span className="hero-scene__pollen-speck hero-scene__pollen-speck--7" />
        <span className="hero-scene__pollen-speck hero-scene__pollen-speck--8" />
      </span>
    </div>
  );
}