import { browseTraceToPlaywrightSpec, type BrowseTrace } from "@sideform/browser-agent/agent/session";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { exportBrowseTrace, traceFileName } from "@/lib/browseTraceFile";
import { saveBlob } from "@/lib/downloadFile";

/**
 * "Download trace": the run as one portable JSON file, frames inlined. The menu closes on the click, so the
 * progress is a loading toast (inlining a cloud trace's frames can take seconds); it turns into the error on a failure.
 */
export function useDownloadTrace(trace: BrowseTrace) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    const progress = toast.loading(t("trace.actions.preparing"));
    try {
      const { blob, notInlined } = await exportBrowseTrace(trace);
      saveBlob(blob, traceFileName(trace));
      toast.dismiss(progress);
      if (notInlined > 0) toast(t("trace.actions.notInlined", { count: notInlined }));
    } catch (e) {
      console.error("Trace download failed", e);
      toast.error(t("trace.actions.downloadFailed"), { id: progress });
    } finally {
      setBusy(false);
    }
  };
  return { busy, download };
}

/** "Download Playwright test": the run as a `.spec.ts` file. `available` is false for a trace recorded without `repro`. */
export function usePlaywrightSpec(trace: BrowseTrace) {
  const spec = useMemo(() => browseTraceToPlaywrightSpec(trace), [trace]);
  if (!spec.ok) return { available: false as const };
  return {
    available: true as const,
    download: () => saveBlob(new Blob([spec.code], { type: "text/plain" }), spec.fileName),
  };
}
