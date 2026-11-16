import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { XIcon } from "@/components/icons";
import { useT, type MessageKey } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/lib/apiBase";
import {
  addByokModel,
  BYOK_PRESETS,
  clearByokConfig,
  getByokConfig,
  isHeaderSafe,
  normalizeByokBaseUrl,
  normalizeByokModels,
  removeByokModel,
  setByokConnection,
  subscribeByok,
  type ByokModel,
} from "@/lib/byokProvider";

import { SettingsGroup } from "../SettingsSection";

const LOAD_TIMEOUT_MS = 20_000;

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; messageKey: MessageKey }
  | { kind: "loaded"; models: ByokModel[] };

const REASON_KEYS: Record<string, MessageKey> = {
  invalid_key: "settings.model.error.invalidKey",
  no_model_list: "settings.model.error.noModelList",
  upstream_error: "settings.model.error.upstream",
};

function presetForUrl(baseUrl: string): string {
  const match = BYOK_PRESETS.find((p) => p.baseUrl !== "" && p.baseUrl === baseUrl.trim());
  return match?.id ?? "custom";
}

/**
 * Settings group for the user's own OpenAI-compatible provider. All storage
 * goes through src/lib/byokProvider.ts; the key rides only as a header on the
 * "Load models" call (and later on `byok/` chat turns).
 */
export function CustomProviderGroup() {
  const t = useT();
  const presetLabel = (preset: { id: string; label: string } | undefined) =>
    preset === undefined || preset.id === "custom" ? t("settings.model.preset.custom") : preset.label;
  const config = useSyncExternalStore(subscribeByok, getByokConfig, getByokConfig);
  const [presetId, setPresetId] = useState(() => presetForUrl(config.baseUrl));
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [load, setLoad] = useState<LoadState>({ kind: "idle" });
  const [filter, setFilter] = useState("");
  const [manualId, setManualId] = useState("");
  // Blocks a second concurrent request; a ref reads synchronously, unlike state.
  const loadingRef = useRef(false);
  // Each request gets a number; a response for an older one is dropped.
  const requestRef = useRef(0);
  // The in-flight "Load models" request, so a changed input, Remove or unmount can cancel it.
  const abortRef = useRef<AbortController | null>(null);
  // Shown instead of the saved/unsaved status after Add was refused (typed connection differs from the stored one).
  const [saveFirst, setSaveFirst] = useState(false);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );

  // Another tab (or Remove) changed the stored connection: show the stored
  // values instead of stale inputs. Adjusting state during render, per React's
  // "adjusting state when a prop changes" pattern. A local Save lands here too,
  // but then the inputs already match and the loaded list is left alone.
  const [seenConfig, setSeenConfig] = useState(config);
  if (config.baseUrl !== seenConfig.baseUrl || config.apiKey !== seenConfig.apiKey) {
    setSeenConfig(config);
    if (config.baseUrl !== baseUrl.trim() || config.apiKey !== apiKey.trim()) {
      setBaseUrl(config.baseUrl);
      setApiKey(config.apiKey);
      setPresetId(presetForUrl(config.baseUrl));
      setLoad({ kind: "idle" });
      setFilter("");
    }
  }

  const isLocal = BYOK_PRESETS.some((p) => p.local && p.id === presetId);
  const url = baseUrl.trim();
  const key = apiKey.trim();
  const normalizedUrl = url === "" ? null : normalizeByokBaseUrl(url);
  const keyOk = key !== "" && isHeaderSafe(key);
  const urlError = url !== "" && normalizedUrl === null ? t("settings.model.error.baseUrl") : null;
  const keyError = key !== "" && !keyOk ? t("settings.model.error.key") : null;
  // The validated pair, or null: every action that needs a connection reads it.
  const connection = normalizedUrl !== null && keyOk ? { url: normalizedUrl, key } : null;
  const canLoad = connection !== null && load.kind !== "loading";
  const hasAnything = config.baseUrl !== "" || config.apiKey !== "" || config.models.length > 0;
  const configured = config.baseUrl !== "" && config.apiKey !== "";
  const matchesStored = (normalizedUrl ?? url) === config.baseUrl && key === config.apiKey;
  const statusText = saveFirst
    ? t("settings.model.saveFirst")
    : matchesStored
      ? configured
        ? t("settings.model.saved")
        : ""
      : t("settings.model.unsaved");
  const added = useMemo(() => new Set(config.models.map((m) => m.id)), [config.models]);

  // Whatever the loaded list described no longer applies once URL or key change.
  const invalidateLoad = () => {
    requestRef.current += 1;
    loadingRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
    setSaveFirst(false);
    setLoad({ kind: "idle" });
    setFilter("");
  };

  // Models can only run once the connection is stored. With nothing stored yet, adding one saves what is
  // typed. With a connection already stored, typed values that differ are NOT saved silently (that would
  // wipe the previous provider's models): the user is asked to Save first. Returns false when nothing was added.
  const ensureConnectionSaved = (): boolean => {
    if (!connection) return false;
    const hasStored = config.baseUrl !== "" || config.apiKey !== "";
    if (hasStored && (connection.url !== config.baseUrl || connection.key !== config.apiKey)) {
      setSaveFirst(true);
      return false;
    }
    if (baseUrl.trim() !== connection.url) setBaseUrl(connection.url);
    if (connection.url !== config.baseUrl || connection.key !== config.apiKey) {
      setByokConnection(connection.url, connection.key);
    }
    return true;
  };

  const handleSave = () => {
    if (!connection) return;
    setSaveFirst(false);
    setBaseUrl(connection.url);
    setPresetId(presetForUrl(connection.url));
    setByokConnection(connection.url, connection.key);
  };

  const handleRemove = () => {
    invalidateLoad();
    clearByokConfig();
    setBaseUrl("");
    setApiKey("");
    setPresetId("custom");
    setManualId("");
  };

  const handlePreset = (next: string | null) => {
    if (!next) return;
    setPresetId(next);
    const preset = BYOK_PRESETS.find((p) => p.id === next);
    if (preset && preset.baseUrl) {
      setBaseUrl(preset.baseUrl);
      invalidateLoad();
    }
  };

  const handleLoad = async () => {
    if (!connection || !canLoad || loadingRef.current) return;
    loadingRef.current = true;
    const requestId = ++requestRef.current;
    setLoad({ kind: "loading" });
    setFilter("");
    setSaveFirst(false);
    const controller = new AbortController();
    abortRef.current = controller;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let signal: AbortSignal = controller.signal;
    if (typeof AbortSignal.any === "function" && typeof AbortSignal.timeout === "function") {
      signal = AbortSignal.any([controller.signal, AbortSignal.timeout(LOAD_TIMEOUT_MS)]);
    } else {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, LOAD_TIMEOUT_MS);
    }
    const settle = (next: LoadState) => {
      if (requestRef.current === requestId) setLoad(next);
    };
    try {
      const res = await apiFetch("/api/byok/models", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-BYOK-Base-URL": connection.url,
          "X-BYOK-Key": connection.key,
        },
        body: JSON.stringify({}),
        signal,
      });
      const data = (await res.json().catch(() => undefined)) as
        | { ok?: boolean; reason?: string; models?: unknown; code?: string }
        | undefined;
      if (res.status === 429) {
        settle({ kind: "error", messageKey: "settings.model.error.rateLimit" });
      } else if (data?.code === "byok_base_url_invalid") {
        settle({ kind: "error", messageKey: "settings.model.error.baseUrl" });
      } else if (data?.ok === true) {
        settle({ kind: "loaded", models: normalizeByokModels(data.models) });
      } else {
        settle({ kind: "error", messageKey: REASON_KEYS[data?.reason ?? ""] ?? REASON_KEYS.upstream_error });
      }
    } catch {
      // A cancelled load (input changed, Remove, unmount) is not an error; a timeout is.
      if (!controller.signal.aborted || timedOut) {
        settle({ kind: "error", messageKey: REASON_KEYS.upstream_error });
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abortRef.current === controller) abortRef.current = null;
      if (requestRef.current === requestId) loadingRef.current = false;
    }
  };

  const handleAdd = (model: ByokModel): boolean => {
    if (!ensureConnectionSaved()) return false;
    addByokModel(model);
    return true;
  };

  const manualTrimmed = manualId.trim();
  const manualDisabled = connection === null || manualTrimmed === "" || added.has(manualTrimmed);
  const handleManualAdd = () => {
    if (manualDisabled) return;
    if (handleAdd({ id: manualTrimmed })) setManualId("");
  };

  const needle = filter.trim().toLowerCase();
  const visibleModels =
    load.kind === "loaded" ? load.models.filter((m) => m.id.toLowerCase().includes(needle)) : [];

  return (
    <SettingsGroup
      title={t("settings.model.provider.title")}
      description={t("settings.model.provider.description")}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span id="byok-preset-label" className="text-xs text-text-muted">
            {t("settings.model.provider.label")}
          </span>
          <Select value={presetId} onValueChange={handlePreset}>
            <SelectTrigger aria-labelledby="byok-preset-label" className="w-52">
              <SelectValue>{presetLabel(BYOK_PRESETS.find((p) => p.id === presetId))}</SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} align="start" className="w-52">
              {BYOK_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {presetLabel(preset)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-muted">{t("settings.model.baseUrl")}</span>
          <Input
            type="url"
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              setPresetId(presetForUrl(e.target.value));
              invalidateLoad();
            }}
            placeholder="https://api.example.com/v1"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-muted">{t("settings.model.apiKey")}</span>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              invalidateLoad();
            }}
            placeholder={isLocal ? "ollama" : "sk-…"}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {isLocal && <span className="text-xs text-text-muted">{t("settings.model.keyHintLocal")}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="accent" onClick={handleSave} disabled={connection === null}>
            {t("settings.model.save")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void handleLoad()} disabled={!canLoad}>
            {load.kind === "loading" ? t("settings.model.loading") : t("settings.model.loadModels")}
          </Button>
          {hasAnything && (
            <Button size="sm" variant="destructive" onClick={handleRemove}>
              {t("settings.model.remove")}
            </Button>
          )}
        </div>

        <p role="status" className="text-xs text-text-muted empty:hidden">
          {statusText}
        </p>
        {(urlError ?? keyError) && (
          <p role="alert" className="text-xs text-destructive">
            {urlError ?? keyError}
          </p>
        )}
        {load.kind === "error" && (
          <p role="alert" className="text-xs text-destructive">
            {t(load.messageKey)}
          </p>
        )}

        {load.kind === "loaded" && (
          <div className="flex flex-col gap-2">
            <Input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("settings.model.filter")}
              aria-label={t("settings.model.filter")}
              autoComplete="off"
            />
            {visibleModels.length === 0 ? (
              <p className="text-xs text-text-muted">
                {load.models.length === 0 ? t("settings.model.noneReturned") : t("settings.model.noMatch")}
              </p>
            ) : (
              <ul
                aria-label={t("settings.model.available")}
                className="max-h-48 overflow-y-auto rounded-control border border-border-default"
              >
                {visibleModels.map((model) => {
                  const isAdded = added.has(model.id);
                  return (
                    <li
                      key={model.id}
                      className="flex items-center justify-between gap-2 border-b border-border-default px-2 py-1 last:border-b-0"
                    >
                      <span className="min-w-0 truncate text-xs text-text-default">{model.id}</span>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={isAdded || connection === null}
                        aria-label={t(isAdded ? "settings.model.addedNamed" : "settings.model.addNamed", { id: model.id })}
                        onClick={() => handleAdd(model)}
                      >
                        {isAdded ? t("settings.model.added") : t("settings.model.add")}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <div className="flex items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs text-text-muted">{t("settings.model.modelId")}</span>
            <Input
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleManualAdd();
                }
              }}
              placeholder="gpt-4.1"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <Button size="sm" variant="outline" onClick={handleManualAdd} disabled={manualDisabled}>
            {t("settings.model.add")}
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-medium text-text-primary">{t("settings.model.yourModels")}</h4>
          {config.models.length === 0 ? (
            <p className="text-xs text-text-muted">{t("settings.model.noModels")}</p>
          ) : (
            <ul aria-label={t("settings.model.yourModels")} className="rounded-control border border-border-default">
              {config.models.map((model) => (
                <li
                  key={model.id}
                  className="flex items-center justify-between gap-2 border-b border-border-default px-2 py-1 last:border-b-0"
                >
                  <span className="min-w-0 truncate text-xs text-text-default">{model.id}</span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={t("settings.model.removeNamed", { id: model.id })}
                    onClick={() => removeByokModel(model.id)}
                  >
                    <XIcon size={12} weight="light" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SettingsGroup>
  );
}
