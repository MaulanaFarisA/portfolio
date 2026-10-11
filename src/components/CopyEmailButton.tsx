"use client";

import { useEffect, useRef, useState } from "react";

const CONTACT_EMAIL = "maulfawriz@gmail.com";

export function CopyEmailButton() {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
    } catch {
      // Fallback for non-secure contexts / browsers without async clipboard
      const textarea = document.createElement("textarea");
      textarea.value = CONTACT_EMAIL;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.top = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand("copy");
      } finally {
        document.body.removeChild(textarea);
      }
    }

    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copyEmail}
      aria-label={copied ? "Copied" : "Copy email address"}
      className="neo-pixel-btn neo-pixel-btn--sm"
    >
      {copied ? "COPIED" : "COPY EMAIL"}
    </button>
  );
}
