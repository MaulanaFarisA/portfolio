import geometry from "@/lib/logo-geometry.json";

type PixelLogoSize = 24 | 48 | 72 | 96;

interface PixelLogoProps {
  label: string;
  size?: PixelLogoSize;
  className?: string;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  fill: string;
}

const palette = geometry.palette as Record<string, string>;

function buildRects(): Rect[] {
  const rects: Rect[] = [];
  for (let y = 0; y < geometry.rows.length; y++) {
    const row = geometry.rows[y];
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === ".") {
        x++;
        continue;
      }
      const fill = palette[ch];
      if (!fill) {
        x++;
        continue;
      }
      let runEnd = x + 1;
      while (runEnd < row.length && row[runEnd] === ch) {
        runEnd++;
      }
      rects.push({ x, y, width: runEnd - x, fill });
      x = runEnd;
    }
  }
  return rects;
}

const mergedRects = buildRects();

export function PixelLogo({
  label,
  // §4.1 anti-mixels: a 24px grid may only display at integer multiples
  // (1x/2x/3x/4x -> 24/48/72/96). 32 would be a 4/3 scale (mixel) and is
  // deliberately excluded from PixelLogoSize, so the default is 2x = 48.
  size = 48,
  className,
}: PixelLogoProps) {
  return (
    <span role="img" aria-label={label} className={className}>
      <svg
        viewBox={`0 0 ${geometry.size} ${geometry.size}`}
        width={size}
        height={size}
        shapeRendering="crispEdges"
        aria-hidden="true"
        focusable="false"
        xmlns="http://www.w3.org/2000/svg"
      >
        {mergedRects.map((r, i) => (
          <rect
            key={i}
            x={r.x}
            y={r.y}
            width={r.width}
            height={1}
            fill={r.fill}
          />
        ))}
      </svg>
    </span>
  );
}
