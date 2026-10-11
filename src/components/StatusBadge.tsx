type BadgeStatus = "online" | "success" | "warning" | "busy" | "error" | "offline";

interface StatusBadgeProps {
  status?: BadgeStatus;
  label: string;
  className?: string;
}

const dotColorMap: Record<BadgeStatus, string> = {
  online: "var(--accent-green)",
  success: "var(--accent-green)",
  warning: "var(--accent-amber)",
  busy: "var(--accent-amber)",
  error: "var(--accent-red)",
  offline: "var(--accent-red)",
};

export function StatusBadge({
  status = "online",
  label,
  className,
}: StatusBadgeProps) {
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        gap: "6px",
        alignItems: "center",
        padding: "3px 8px",
        fontFamily: "var(--font-mono)",
        fontSize: "11px",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        background: "var(--surface-sunken)",
        border: "1px solid var(--border-default)",
        color: "var(--text-primary)",
        lineHeight: 1.3,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: "6px",
          height: "6px",
          flexShrink: 0,
          background: dotColorMap[status],
          animation: "pixel-blink 1.2s steps(2) infinite",
        }}
      />
      {label}
    </span>
  );
}
