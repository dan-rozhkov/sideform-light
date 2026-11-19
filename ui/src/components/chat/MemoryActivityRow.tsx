import { useState } from "react";

import { BrainIcon, CaretDownIcon } from "@/components/icons";
import { CHEVRON_WEIGHT } from "@/components/ui/chevron";
import { useT } from "@/i18n";
import { formatChange, type ChangeDetail } from "@/lib/memoryActivity";

/**
 * "The agent changed its memory" row, shared by the in-turn `memory` tool success and the background-review notes.
 * Collapsed by default; the details say WHAT changed. Without details there is nothing to expand, so no chevron.
 */
export function MemoryActivityRow({ changes }: { changes?: ChangeDetail[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const label = (
    <>
      <BrainIcon size={14} className="shrink-0" />
      <span className="truncate">{t("memory.updated")}</span>
    </>
  );

  if (!changes || changes.length === 0) {
    return <div className="my-0.5 flex items-center gap-1.5 py-0.5 text-[13px] leading-relaxed text-text-muted">{label}</div>;
  }

  return (
    <div className="my-0.5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 py-0.5 text-[13px] leading-relaxed text-text-muted hover:text-text-secondary"
      >
        {label}
        <CaretDownIcon
          size={10}
          className={`shrink-0 transition-transform duration-250 ease-smooth-out ${open ? "" : "-rotate-90"}`}
          weight={CHEVRON_WEIGHT}
        />
      </button>
      {open && (
        <ul className="mt-1 mb-1.5 min-w-0 space-y-1 rounded bg-surface-elevated p-2 text-[13px] leading-relaxed text-text-muted">
          {changes.map((c, i) => (
            <li key={i} className="break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
              {formatChange(c)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
