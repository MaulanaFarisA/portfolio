import { type ReactNode } from "react";

interface WindowCardProps {
  title: string;
  children: ReactNode;
  className?: string;
  headerRight?: ReactNode;
}

const dotColors = [
  "var(--accent-red)",
  "var(--accent-amber)",
  "var(--accent-green)",
] as const;

export function WindowCard({ title, children, className, headerRight }: WindowCardProps) {
  return (
    <div
      className={className}
      style={{
        border: "1px solid var(--border-strong)",
        overflow: "hidden",
      }}
    >
      {/* Title bar — decorative */}
      <div
        aria-hidden="true"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          height: "32px",
          padding: "0 var(--space-3)",
          background: "var(--surface-sunken)",
          borderBottom: "1px solid var(--border-default)",
        }}
      >
        {dotColors.map((color) => (
          <span
            key={color}
            style={{
              width: "6px",
              height: "6px",
              background: color,
              flexShrink: 0,
            }}
          />
        ))}
        <span
          style={{
            marginLeft: "var(--space-2)",
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--text-secondary)",
            lineHeight: 1,
          }}
        >
          {title}
        </span>
        {headerRight && (
          <span style={{ marginLeft: "auto" }}>{headerRight}</span>
        )}
      </div>

      {/* Content canvas */}
      <div
        style={{
          background: "var(--surface-panel)",
          padding: "var(--space-4)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
