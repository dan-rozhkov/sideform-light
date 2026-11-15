import { useLayoutEffect, useRef, useState } from "react";

import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";

// Layout shared by the schedule confirmation cards (ScheduleConfirmCard, ScheduleActionCard).

/** The task text, clamped to 4 lines with Show more / Show less. */
export function ScheduleTaskField({ prompt }: { prompt: string }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const taskRef = useRef<HTMLElement>(null);

  // Detect real overflow (wrapped long lines included) so "Show more" is always offered when text is cut
  // off. Measured only while clamped; once expanded the last result stays.
  useLayoutEffect(() => {
    const el = taskRef.current;
    if (!el || expanded) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded, prompt]);

  return (
    <div>
      <dt className="text-text-muted">{t("schedules.field.task")}</dt>
      <dd ref={taskRef} className={`whitespace-pre-wrap break-words text-text-primary ${expanded ? "" : "line-clamp-4"}`}>
        {prompt}
      </dd>
      {(overflows || expanded || prompt.length > 240 || prompt.split("\n").length > 4) && (
        <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={() => setExpanded((v) => !v)}>
          {expanded ? t("schedules.card.showLess") : t("schedules.card.showMore")}
        </Button>
      )}
    </div>
  );
}
