import type { BrowseTrace, BrowseTraceLogEntry, BrowseTraceRequest } from "@sideform/browser-agent/agent/session";
import { LinkSimpleIcon } from "@/components/icons";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { keepInView } from "./keepInView";
import { EmptyState } from "@/components/ui/empty-state";
import { CopyButton } from "./CopyButton";
import { useCopy } from "./useCopy";
import { BAR_ROW, Count, EmptyNote, OutcomeBadge, RowButton, SectionHeading, Segmented, ToneIcon } from "./parts";
import {
  NO_LOG_FILTER,
  batchProgress,
  describeCheck,
  describeOutcome,
  droppedRequests,
  filterLogEntries,
  filteredCount,
  formatBytes,
  formatDuration,
  formatOffset,
  parseNetworkEntry,
  prettyJson,
  prettyText,
  requestFailed,
  requestText,
  requestWaterfall,
  shortUrl,
  stepActions,
  stepDuration,
  stepLinkUrl,
  toolLabel,
  traceRequests,
  type LogFilter,
} from "./traceModel";

/** One table style for console and network rows: 11px mono data, a fixed time column, 16px text edge (rows bleed 8px). */
const ROW_GRID = "grid items-baseline gap-x-2 px-2 py-1.5 font-mono text-[11px]/relaxed";
const TIME_CELL = "tabular-nums text-text-muted";

function Empty({ title, hint }: { title: string; hint?: string }) {
  return <EmptyState size="panel" title={title} description={hint} className="mx-auto px-1 py-4" />;
}

/** Scope switch and text search above a log; `shown` of `total` entries. */
function LogToolbar({
  kind,
  filter,
  onChange,
  canScope,
  shown,
  total,
  children,
}: {
  kind: "console" | "requests";
  filter: LogFilter;
  onChange(filter: LogFilter): void;
  /** A step is selected, so "This step" means something. */
  canScope: boolean;
  shown: number;
  total: number;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="sticky top-0 z-10 -mx-2 mb-1 flex flex-wrap items-center gap-2 bg-surface-panel px-2 py-1.5">
      <Segmented
        label={t(kind === "console" ? "trace.log.consoleScope" : "trace.log.requestsScope")}
        value={filter.scope}
        disabled={!canScope}
        options={[
          { value: "all", label: t("trace.log.all") },
          { value: "step", label: t("trace.log.thisStep") },
        ]}
        onChange={(scope) => onChange({ ...filter, scope })}
      />
      {children}
      <Input
        type="search"
        aria-label={t(kind === "console" ? "trace.log.filterConsole" : "trace.log.filterRequests")}
        placeholder={t("trace.log.filterPlaceholder")}
        value={filter.query}
        onChange={(e) => onChange({ ...filter, query: e.target.value })}
        className="w-40 min-w-0 flex-1 sm:flex-none"
      />
      <span data-testid={`${kind}-count`} className="ms-auto text-[11px] tabular-nums text-text-muted">
        {filteredCount(shown, total)}
      </span>
    </div>
  );
}

interface LogProps {
  trace: BrowseTrace;
  entries: BrowseTraceLogEntry[];
  droppedCount: number | undefined;
  selectedStep: number | null;
  kind: "console" | "network";
  filter: LogFilter;
  onFilter(filter: LogFilter): void;
  onSelectStep(index: number): void;
}

const stepOf = (trace: BrowseTrace, index: number | null) => trace.steps.find((s) => s.index === index);

function LogPanel({ trace, entries: all, droppedCount, selectedStep, kind, filter, onFilter, onSelectStep }: LogProps) {
  const t = useT();
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    // Playback moves the selected step; keep its first entry in view.
    keepInView(listRef.current?.querySelector<HTMLElement>('[aria-current="step"]'));
  }, [selectedStep]);
  const entries = filterLogEntries(all, filter, stepOf(trace, selectedStep), (e) => e.text);
  if (all.length === 0) {
    return kind === "console" ? (
      <Empty title={t("trace.log.noConsoleErrors")} hint={t("trace.log.noConsoleErrorsHint")} />
    ) : (
      <Empty title={t("trace.log.noFailedRequests")} hint={t("trace.log.noFailedRequestsHint")} />
    );
  }
  return (
    <>
      <LogToolbar kind={kind === "network" ? "requests" : kind} filter={filter} onChange={onFilter} canScope={selectedStep !== null} shown={entries.length} total={all.length} />
      {entries.length === 0 && <Empty title={t("trace.log.noMatch")} hint={t("trace.log.noMatchHint")} />}
      <ul ref={listRef} className="-mx-2 space-y-0.5">
        {entries.map((entry, i) => {
          const net = kind === "network" ? parseNetworkEntry(entry.text) : null;
          const linked = entry.stepIndex !== undefined;
          const current = linked && entry.stepIndex === selectedStep;
          return (
            <li key={`${entry.at}-${i}`}>
              <RowButton
                active={current}
                disabled={!linked}
                onClick={() => entry.stepIndex !== undefined && onSelectStep(entry.stepIndex)}
                className={cn(ROW_GRID, "grid-cols-[3.5rem_minmax(0,1fr)_auto]")}
              >
                <span className={TIME_CELL}>{formatOffset(entry.at - trace.startedAt)}</span>
                {net ? (
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="min-w-12 shrink-0 font-semibold text-text-secondary">{net.method}</span>
                    <span title={String(net.status)} className={cn("max-w-[12rem] min-w-10 shrink-0 truncate font-semibold tabular-nums", net.failed ? "text-destructive" : "text-text-secondary")}>{net.status}</span>
                    <span className="min-w-0 break-all text-text-muted">{net.url}</span>
                  </span>
                ) : (
                  <span className="min-w-0 break-words whitespace-pre-wrap text-text-secondary">{entry.text}</span>
                )}
                <span className="text-end text-text-muted">{linked ? t("trace.step.number", { n: entry.stepIndex! + 1 }) : ""}</span>
              </RowButton>
            </li>
          );
        })}
      </ul>
      {droppedCount ? <p className="mt-3 text-xs text-text-muted">{t("trace.log.notRecorded", { count: droppedCount })}</p> : null}
    </>
  );
}

function QaPanel({ trace }: { trace: BrowseTrace }) {
  const t = useT();
  const qa = trace.qa;
  if (!qa) return <Empty title={t("trace.qa.notQaTitle")} hint={t("trace.qa.notQaHint")} />;
  const outcome = describeOutcome(trace);
  const judge = qa.judge;
  return (
    <div className="space-y-4">
      <section className="space-y-1.5">
        <OutcomeBadge tone={outcome.tone} label={outcome.label} />
        {qa.reason ? <p className="text-pretty text-sm text-text-primary">{qa.reason}</p> : <EmptyNote title={t("trace.qa.noReason")} />}
      </section>

      <section className="space-y-2">
        <SectionHeading count={qa.checks?.length ?? 0}>{t("trace.qa.checks")}</SectionHeading>
        {qa.checks && qa.checks.length > 0 ? (
          <ul className="space-y-1">
            {qa.checks.map((check, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg bg-surface-elevated px-3 py-2 text-xs/relaxed">
                <ToneIcon tone={check.passed ? "success" : "danger"} label={check.passed ? t("trace.qa.passed") : t("trace.qa.failed")} className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium break-words text-text-primary">{describeCheck(check.check)}</p>
                  {(check.actual || check.error) && <p className="break-words text-text-muted">{check.error ?? check.actual}</p>}
                  <p className="text-[11px] text-text-disabled">{check.source === "final" ? t("trace.qa.finalCheck") : t("trace.qa.agentCheck")}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyNote title={t("trace.qa.noChecks")} />
        )}
      </section>

      {judge && (
        <section className="space-y-1.5">
          <SectionHeading>{t("trace.qa.judge")}</SectionHeading>
          {"error" in judge ? (
            <p className="rounded-lg bg-destructive/8 px-3 py-2 text-xs/relaxed break-words text-destructive">{t("trace.qa.judgeError", { error: judge.error })}</p>
          ) : (
            <div className="space-y-1.5 rounded-lg bg-surface-elevated px-3 py-2">
              <OutcomeBadge size="sm" tone={judge.verdict === "pass" ? "success" : judge.verdict === "fail" ? "danger" : "warning"} label={judge.verdict} />
              <p className="text-pretty text-xs/relaxed text-text-secondary">{judge.reason}</p>
            </div>
          )}
        </section>
      )}
      {qa.stepsDropped ? <p className="text-xs text-text-muted">{t("trace.qa.stepsDropped", { count: qa.stepsDropped })}</p> : null}
    </div>
  );
}

function Block({ title, text, copyLabel, empty }: { title: string; text: string; copyLabel: string; empty: string }) {
  return (
    <section className="min-w-0 space-y-1.5">
      <div className="flex items-center justify-between">
        <SectionHeading>{title}</SectionHeading>
        {text && <CopyButton text={text} label={copyLabel} />}
      </div>
      {text ? (
        <pre className="max-h-48 overflow-auto rounded-lg bg-surface-elevated p-2 font-mono text-[11px]/relaxed break-words whitespace-pre-wrap text-text-secondary">{text}</pre>
      ) : (
        <EmptyNote title={empty} />
      )}
    </section>
  );
}

function StepPanel({ trace, selectedStep, canLink }: { trace: BrowseTrace; selectedStep: number | null; canLink: boolean }) {
  const t = useT();
  const [linkCopied, copy] = useCopy();
  const step = stepOf(trace, selectedStep);
  if (!step) return <Empty title={t("trace.stepPanel.noStepTitle")} hint={t("trace.stepPanel.noStepHint")} />;
  const actions = stepActions(step);
  const batch = batchProgress(step);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 className="text-sm font-medium text-text-primary">
          <span className="tabular-nums text-text-muted">{step.index + 1}</span> {toolLabel(step.tool)}
        </h3>
        <OutcomeBadge size="sm" tone={step.ok ? "success" : "danger"} label={step.ok ? t("trace.stepPanel.ok") : t("trace.stepPanel.failed")} />
        <span className="text-xs tabular-nums text-text-muted">
          {t("trace.stepPanel.timing", { duration: formatDuration(stepDuration(step)), offset: formatOffset(step.startedAt - trace.startedAt) })}
        </span>
        {canLink && (
          <IconButton
            variant="ghost"
            size="icon-xs"
            className="ms-auto"
            tooltip={linkCopied ? t("trace.stepPanel.linkCopied") : t("trace.stepPanel.copyLink")}
            aria-label={t("trace.stepPanel.copyLink")}
            onClick={() => copy(stepLinkUrl(window.location, step.index))}
          >
            <LinkSimpleIcon weight="light" />
          </IconButton>
        )}
        {canLink && (
          <span aria-live="polite" className="sr-only">
            {linkCopied ? t("trace.stepPanel.linkCopied") : ""}
          </span>
        )}
      </div>

      {!step.ok && step.error && (
        <p role="alert" className="rounded-lg bg-destructive/8 px-3 py-2 text-xs/relaxed break-words whitespace-pre-wrap text-destructive">
          {step.error}
        </p>
      )}

      {actions && (
        <section className="space-y-1.5">
          <SectionHeading count={actions.length}>{t("trace.stepPanel.actions")}</SectionHeading>
          <ol className="space-y-1">
            {actions.map((action, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg bg-surface-elevated px-3 py-2 text-xs/relaxed">
                <ToneIcon tone={action.ok ? "success" : "danger"} label={action.ok ? t("trace.stepPanel.passed") : t("trace.stepPanel.actionFailed")} className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0">
                  <span className="font-medium break-words text-text-primary">{action.action}</span>
                  {action.error && <span className="block break-words text-destructive">{action.error}</span>}
                </span>
              </li>
            ))}
          </ol>
          {batch && batch.notRun > 0 && <p className="text-xs text-text-muted">{t("trace.stepPanel.notRun", { count: batch.notRun })}</p>}
        </section>
      )}

      <div className="grid gap-4 min-[1100px]:grid-cols-2">
        <Block title={t("trace.stepPanel.arguments")} text={prettyJson(step.args)} copyLabel={t("trace.stepPanel.copyArguments")} empty={t("trace.stepPanel.noArguments")} />
        <Block title={t("trace.stepPanel.output")} text={prettyText(step.output)} copyLabel={t("trace.stepPanel.copyOutput")} empty={t("trace.stepPanel.noOutput")} />
      </div>
    </div>
  );
}

function HeaderTable({ title, headers }: { title: string; headers: Record<string, string> | undefined }) {
  const entries = Object.entries(headers ?? {});
  if (entries.length === 0) return null;
  return (
    <section className="space-y-1">
      <SectionHeading count={entries.length}>{title}</SectionHeading>
      <dl className="grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-3 gap-y-0.5 font-mono text-[11px]/relaxed">
        {entries.map(([name, value]) => (
          <div key={name} className="contents">
            <dt className="break-all text-text-muted">{name}</dt>
            <dd className="break-all text-text-secondary">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function RequestRow({ trace, request, open, onToggle, onSelectStep }: { trace: BrowseTrace; request: BrowseTraceRequest; open: boolean; onToggle(): void; onSelectStep(index: number): void }) {
  const t = useT();
  const failed = requestFailed(request);
  const bar = requestWaterfall(trace, request);
  const body = prettyText(request.responseBody);
  return (
    <li className="rounded-md">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="grid w-full grid-cols-[3.5rem_2.5rem_minmax(0,1fr)_4rem] items-baseline gap-x-2 rounded-md px-2 py-1.5 text-start font-mono text-[11px]/relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring enabled:hover:bg-secondary min-[900px]:grid-cols-[3.5rem_2.5rem_minmax(0,1fr)_4rem_3.5rem_4rem_8rem]"
      >
        <span className="font-semibold text-text-secondary">{request.method}</span>
        <span className={cn("font-semibold tabular-nums", failed ? "text-destructive" : "text-text-secondary")}>{request.error ? "ERR" : (request.status ?? "…")}</span>
        <span className="min-w-0 truncate text-text-muted" title={request.url}>
          {shortUrl(request.url)}
        </span>
        <span className="truncate text-text-muted">{request.type ?? ""}</span>
        <span className="hidden text-end tabular-nums text-text-muted min-[900px]:block">{request.size !== undefined ? formatBytes(request.size) : ""}</span>
        <span className="hidden text-end tabular-nums text-text-muted min-[900px]:block">{request.durationMs !== undefined ? formatDuration(request.durationMs) : ""}</span>
        <span aria-hidden className="relative hidden h-1.5 rounded-full bg-surface-elevated min-[900px]:block">
          <span
            data-testid="request-bar"
            className={cn("absolute inset-y-0 rounded-full", failed ? "bg-destructive" : "bg-accent-primary")}
            style={{ left: `${bar.startPct}%`, width: `${bar.widthPct}%` }}
          />
        </span>
      </button>
      {open && (
        <div className="mx-2 mb-1.5 space-y-3 rounded-lg bg-surface-elevated px-3 py-2">
          <p className="font-mono text-[11px]/relaxed break-all text-text-secondary">{request.url}</p>
          {request.error && <p className="text-xs break-words text-destructive">{request.error}</p>}
          <p className="text-[11px] text-text-muted">
            {formatOffset(request.at - trace.startedAt)}
            {request.mimeType && ` · ${request.mimeType}`}
            {request.stepIndex !== undefined && (
              <>
                {" · "}
                <button type="button" className="underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onSelectStep(request.stepIndex!)}>
                  {t("trace.step.number", { n: request.stepIndex + 1 })}
                </button>
              </>
            )}
          </p>
          <HeaderTable title={t("trace.log.requestHeaders")} headers={request.requestHeaders} />
          <HeaderTable title={t("trace.log.responseHeaders")} headers={request.responseHeaders} />
          {body ? (
            <section className="space-y-1">
              <SectionHeading>{t("trace.log.responseBody")}</SectionHeading>
              <pre className="max-h-48 overflow-auto rounded-md bg-surface-panel p-2 font-mono text-[11px]/relaxed break-words whitespace-pre-wrap text-text-secondary">{body}</pre>
              {request.bodyTruncated && <p className="text-[11px] text-text-muted">{t("trace.log.bodyTruncated")}</p>}
            </section>
          ) : null}
        </div>
      )}
    </li>
  );
}

interface RequestsProps {
  trace: BrowseTrace;
  requests: BrowseTraceRequest[];
  selectedStep: number | null;
  filter: LogFilter;
  onFilter(filter: LogFilter): void;
  failedOnly: boolean;
  onFailedOnly(on: boolean): void;
  onSelectStep(index: number): void;
}

/** Every request of the run, with a waterfall and details. */
function RequestsPanel({ trace, requests: all, selectedStep, filter, onFilter, failedOnly, onFailedOnly, onSelectStep }: RequestsProps) {
  const t = useT();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const scoped = filterLogEntries(all, filter, stepOf(trace, selectedStep), requestText);
  const requests = failedOnly ? scoped.filter(requestFailed) : scoped;
  const dropped = droppedRequests(trace);
  const keys = new Map(all.map((request, i) => [request, `${request.at}-${i}`]));
  return (
    <>
      <LogToolbar kind="requests" filter={filter} onChange={onFilter} canScope={selectedStep !== null} shown={requests.length} total={all.length}>
        <Button variant="secondary" size="sm" aria-pressed={failedOnly} onClick={() => onFailedOnly(!failedOnly)} className={cn(failedOnly && "bg-accent-selection")}>
          {t("trace.log.failedOnly")}
        </Button>
      </LogToolbar>
      {requests.length === 0 ? (
        <Empty title={t("trace.log.noMatch")} hint={t("trace.log.noMatchHint")} />
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {requests.map((request) => {
            const key = keys.get(request)!;
            return <RequestRow key={key} trace={trace} request={request} open={openKey === key} onToggle={() => setOpenKey(openKey === key ? null : key)} onSelectStep={onSelectStep} />;
          })}
        </ul>
      )}
      {dropped ? <p className="mt-3 text-xs text-text-muted">{t("trace.log.notRecorded", { count: dropped })}</p> : null}
    </>
  );
}

interface Props {
  trace: BrowseTrace;
  selectedStep: number | null;
  onSelectStep(index: number): void;
  /** Whether "Copy link to this step" makes sense (the page address names the trace). */
  canLink?: boolean;
}

export const Inspector = memo(function Inspector({ trace, selectedStep, onSelectStep, canLink = true }: Props) {
  const t = useT();
  const failedChecks = trace.qa?.checks?.filter((c) => !c.passed).length ?? 0;
  const requests = traceRequests(trace);
  const failedRequests = requests.filter(requestFailed).length;
  // Filters live here: a tab's panel unmounts when another tab opens.
  const [consoleFilter, setConsoleFilter] = useState<LogFilter>(NO_LOG_FILTER);
  const [networkFilter, setNetworkFilter] = useState<LogFilter>(NO_LOG_FILTER);
  const [failedOnly, setFailedOnly] = useState(false);
  return (
    <Tabs defaultValue="step" className="min-h-0 flex-1 gap-0 bg-surface-panel">
      <div className={cn(BAR_ROW, "shrink-0")}>
        <TabsList aria-label={t("trace.inspector.label")}>
          <TabsTrigger value="step">{t("trace.inspector.step")}</TabsTrigger>
          <TabsTrigger value="console">
            {t("trace.inspector.console")} <Count n={trace.console.length} />
          </TabsTrigger>
          <TabsTrigger value="network">
            {t("trace.inspector.network")} <Count n={requests.length > 0 ? requests.length : trace.network.length} />
            {failedRequests > 0 && <span className="tabular-nums text-destructive">{t("trace.inspector.failedCount", { count: failedRequests })}</span>}
          </TabsTrigger>
          <TabsTrigger value="qa">
            {t("trace.inspector.qa")} {failedChecks > 0 && <Count n={failedChecks} />}
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="step" className="min-h-0 overflow-y-auto px-4 pb-3">
        <StepPanel key={selectedStep} trace={trace} selectedStep={selectedStep} canLink={canLink} />
      </TabsContent>
      <TabsContent value="console" className="min-h-0 overflow-y-auto px-4 pb-3">
        <LogPanel trace={trace} entries={trace.console} droppedCount={trace.dropped?.console} selectedStep={selectedStep} kind="console" filter={consoleFilter} onFilter={setConsoleFilter} onSelectStep={onSelectStep} />
      </TabsContent>
      <TabsContent value="network" className="min-h-0 overflow-y-auto px-4 pb-3">
        {requests.length > 0 ? (
          <RequestsPanel trace={trace} requests={requests} selectedStep={selectedStep} filter={networkFilter} onFilter={setNetworkFilter} failedOnly={failedOnly} onFailedOnly={setFailedOnly} onSelectStep={onSelectStep} />
        ) : (
          <LogPanel trace={trace} entries={trace.network} droppedCount={trace.dropped?.network} selectedStep={selectedStep} kind="network" filter={networkFilter} onFilter={setNetworkFilter} onSelectStep={onSelectStep} />
        )}
      </TabsContent>
      <TabsContent value="qa" className="min-h-0 overflow-y-auto px-4 pb-3">
        <QaPanel trace={trace} />
      </TabsContent>
    </Tabs>
  );
});
