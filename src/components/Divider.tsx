type DividerVariant = "dither" | "solid";

interface DividerProps {
  variant?: DividerVariant;
  className?: string;
}

export function Divider({ variant = "dither", className }: DividerProps) {
  if (variant === "solid") {
    return (
      <hr
        className={className}
        style={{
          height: "1px",
          border: "none",
          background: "var(--border-default)",
        }}
      />
    );
  }

  return (
    <hr
      className={`pixel-divider ${className ?? ""}`}
      style={{ border: "none" }}
    />
  );
}
