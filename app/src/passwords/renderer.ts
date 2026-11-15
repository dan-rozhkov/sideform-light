// Plain script (no import/export): it runs from a CSP'd <script src>, like
// src/tabbar/renderer.ts. Wrapped in a function so its names do not collide
// with the other scripts' globals when they are compiled in one program.
// Pure helpers (host names, search, dates) live in helpers.ts, loaded first.
// Text goes in through textContent only. No password ever reaches this file:
// the list has origin, username, label and the last-used time; a password only
// travels the other way, from a form input to main, and is cleared with the form.
(function passwordsRenderer() {
  interface Entry {
    id: string;
    origin: string;
    username: string;
    label: string;
    lastUsedAt?: number;
    /** Cached site icon: a data: URL of an allowed image type, shown through <img> only. */
    icon?: string;
  }
  interface ListResult {
    entries: Entry[];
    never: string[];
    encryptionAvailable: boolean;
  }
  type ActionResult = { ok: true } | { ok: false; error: string };
  type SaveResult = { ok: true; id: string } | { ok: false; error: string; exists?: true; id?: string };
  interface PenPasswordsApi {
    isMac: boolean;
    list(): Promise<ListResult>;
    add(payload: { site: string; username: string; password: string; label?: string; replace?: boolean }): Promise<SaveResult>;
    update(payload: { id: string; username: string; password?: string; label?: string }): Promise<SaveResult>;
    remove(id: string): Promise<ActionResult>;
    removeNever(host: string): Promise<ActionResult>;
    onChanged(cb: () => void): void;
    onTheme(cb: (payload: { theme: "light" | "dark" }) => void): void;
    onI18n(cb: (payload: { lang: string; strings: Record<string, string> }) => void): void;
  }
  type Section = "all" | "never";
  type Mode = "view" | "add" | "edit";

  const api = (window as unknown as { penPasswords: PenPasswordsApi }).penPasswords;
  const helpers = penPasswordsHelpers;
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

  api.onTheme(({ theme }) => {
    document.documentElement.dataset.theme = theme;
  });
  const paintStorageNote = (): void => {
    $("storage-note").textContent = api.isMac
      ? penI18n.tr("passwords.storageNoteMac", "Encrypted with a key in your macOS Keychain")
      : penI18n.tr("passwords.storageNote", "Encrypted on this device");
  };
  paintStorageNote();

  /**
   * Text of the main process's own English errors (passwordsApi.ts), in the interface language. An unknown message (an
   * Error text from the store) is shown as it is.
   */
  const MAIN_ERROR_KEYS: Record<string, string> = {
    "Enter a valid site address.": "passwords.err.siteInvalid",
    "Encryption is not available on this system.": "passwords.err.noEncryption",
    "The username or label is not valid.": "passwords.err.invalidName",
    "That login no longer exists.": "passwords.err.gone",
    "That site is not on the list.": "passwords.err.siteNotListed",
    "Malformed request.": "passwords.err.malformed",
    "A login for that username already exists on this site.": "passwords.err.exists",
    "Enter a username.": "passwords.enterUsername",
    "Enter a password.": "passwords.enterPassword",
    "Could not save the login.": "passwords.saveFailed",
  };
  const mainError = (text: string): string => {
    const key = Object.prototype.hasOwnProperty.call(MAIN_ERROR_KEYS, text) ? MAIN_ERROR_KEYS[text] : undefined;
    return key === undefined ? text : penI18n.tr(key, text);
  };

  const neverLink = $<HTMLButtonElement>("never-link");
  const neverHead = $("never-head");
  const neverBack = $<HTMLButtonElement>("never-back");
  const searchEl = $<HTMLInputElement>("search");
  const addBtn = $<HTMLButtonElement>("add-btn");
  const unavailableEl = $("unavailable");
  const statusEl = $("status");
  const listEl = $("list");
  const listEmptyEl = $("list-empty");
  const listEmptyIcon = $("list-empty-icon");
  const listEmptyTitle = $("list-empty-title");
  const listEmptyText = $("list-empty-text");
  const detailEl = $("detail");

  let data: ListResult = { entries: [], never: [], encryptionAvailable: true };
  let section: Section = "all";
  let query = "";
  let selectedId: string | null = null;
  let mode: Mode = "view";
  let confirmDelete = false;
  /** Set by the open Add/Edit form: true when it holds changes. */
  let formDirty: (() => boolean) | null = null;
  let pendingNav: (() => void) | null = null;
  /** Identity of the Add/Edit form on screen; null when none is. A save reply for another token is stale. */
  let activeFormToken: number | null = null;
  let formTokenSeq = 0;

  // ---- small DOM helpers ----

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Pen-set icons (glyphs.ts, loaded first). Static ones in passwords.html are data-pen-slot spans.
  function icon(name: string, weight: "regular" | "fill" = "regular"): SVGSVGElement {
    return penIcon(name, "icon", weight);
  }
  penMountSlots();

  function button(label: string, cls: string, onClick: () => void, iconId?: string): HTMLButtonElement {
    const b = el("button", cls);
    b.type = "button";
    if (iconId) b.appendChild(icon(iconId));
    b.appendChild(document.createTextNode(label));
    b.addEventListener("click", onClick);
    return b;
  }

  // Site icon: the cached favicon through <img> (never inlined, even an SVG;
  // accepted only as an allowed image data: URL, which main checks too and the
  // CSP allows), else the pen-set globe, always the
  // outline weight (selected too, like SettingsNav). Used by the list rows and the hero tile.
  function siteIcon(iconUrl?: string, imgClass = "row-icon"): Element {
    const globe = () => icon("Globe");
    if (iconUrl && helpers.isIconDataUrl(iconUrl)) {
      const img = el("img", imgClass);
      img.alt = "";
      img.draggable = false;
      img.addEventListener("error", () => img.replaceWith(globe()), { once: true });
      img.src = iconUrl;
      return img;
    }
    return globe();
  }

  // ---- derived state ----

  function visibleEntries(): Entry[] {
    return data.entries.filter((e) => helpers.matchesQuery(e, query));
  }
  function visibleNever(): string[] {
    return data.never.filter((h) => helpers.matchesQuery({ origin: h, username: "", label: "" }, query));
  }
  function selectedEntry(): Entry | undefined {
    return data.entries.find((e) => e.id === selectedId);
  }
  /** Keeps `selectedId` pointing at something visible (the first row by default). */
  function normalizeSelection(): void {
    if (section !== "all") return;
    const visible = visibleEntries();
    if (!visible.some((e) => e.id === selectedId)) selectedId = visible.length > 0 ? visible[0].id : null;
  }

  // ---- render: chrome + list ----

  function renderChrome(): void {
    const n = data.never.length;
    neverLink.hidden = section !== "all" || n === 0;
    neverLink.textContent = penI18n.tn("passwords.neverLink", n, "{n} site never asks to save", "{n} sites never ask to save");
    neverHead.hidden = section !== "never";
    unavailableEl.hidden = data.encryptionAvailable;
  }

  function entryRow(e: Entry, suffix: string): HTMLElement {
    const host = helpers.displayHost(e.origin);
    const row = el("button", "row");
    row.type = "button";
    row.setAttribute("role", "option");
    const selected = e.id === selectedId && mode !== "add";
    row.setAttribute("aria-selected", String(selected));
    row.dataset.id = e.id;
    row.setAttribute("aria-label", [host, e.username, e.label].filter(Boolean).join(", "));
    row.append(siteIcon(e.icon), el("span", "row-title", host));
    // Same site name on two or more logins: show a suffix so they differ.
    if (suffix) row.appendChild(el("span", "row-sub", "· " + suffix));
    row.addEventListener("click", () => guardNav(() => selectEntry(e.id)));
    return row;
  }

  function neverRow(host: string): HTMLElement {
    const row = el("div", "row row-static");
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", "false");
    const remove = button(penI18n.tr("passwords.remove", "Remove"), "btn btn-ghost btn-sm", () => {
      void runAndRefresh(api.removeNever(host), "passwords.removeSiteFailed", "Could not remove the site.");
    });
    remove.setAttribute("aria-label", penI18n.tr("passwords.removeNeverAria", "Remove {host} from the never list", { host }));
    row.append(icon("Globe"), el("span", "row-title", host), remove);
    return row;
  }

  function renderList(): void {
    const isAll = section === "all";
    const suffixes = isAll ? helpers.rowSuffixes(data.entries) : null;
    const rows = suffixes ? visibleEntries().map((e) => entryRow(e, suffixes.get(e.id) || "")) : visibleNever().map(neverRow);
    listEl.replaceChildren(...rows);
    listEl.setAttribute(
      "aria-label",
      isAll ? penI18n.tr("passwords.savedAria", "Saved logins") : penI18n.tr("passwords.neverAria", "Never saved sites"),
    );
    const total = isAll ? data.entries.length : data.never.length;
    listEl.hidden = rows.length === 0;
    listEmptyEl.hidden = rows.length > 0;
    if (rows.length === 0) {
      // Like the canvas panels: an icon for a truly empty list, none for "no search results".
      listEmptyIcon.replaceChildren(...(total > 0 ? [] : [icon(isAll ? "Key" : "Globe")]));
      if (total > 0) {
        listEmptyTitle.textContent = penI18n.tr("passwords.noResults", "No results");
        listEmptyText.textContent = penI18n.tr("passwords.noMatch", "Nothing matches “{query}”.", { query: query.trim() });
      } else if (isAll) {
        listEmptyTitle.textContent = penI18n.tr("passwords.emptyTitle", "No saved logins yet");
        listEmptyText.textContent = penI18n.tr("passwords.emptyText", "Save one when the browser asks, or add one with the + button.");
      } else {
        listEmptyTitle.textContent = penI18n.tr("passwords.neverEmptyTitle", "No sites on the list");
        listEmptyText.textContent = penI18n.tr("passwords.neverEmptyText", "Sites you choose “Never for This Site” on appear here.");
      }
    }
  }

  // ---- render: detail pane ----

  function field(label: string, value: string): HTMLElement {
    const f = el("div", "field");
    const v = el("span", "field-value", value);
    v.title = value; // the value is cut with an ellipsis when long
    f.append(el("span", "field-label", label), v);
    return f;
  }

  function renderEmptyDetail(): void {
    const wrap = el("div", "detail-empty");
    const box = el("div", "empty-state");
    const glyph = el("span", "empty-icon");
    glyph.setAttribute("aria-hidden", "true");
    glyph.appendChild(icon("Key"));
    box.appendChild(glyph);
    wrap.appendChild(box);
    if (section === "never") {
      box.append(
        el("p", "empty-title", penI18n.tr("passwords.neverDetailTitle", "Never saved")),
        el("p", "empty-text", penI18n.tr("passwords.neverDetailText", "No prompt to save a password appears on these sites.")),
      );
    } else if (data.entries.length === 0) {
      box.append(
        el("p", "empty-title", penI18n.tr("passwords.heroTitle", "Your logins live here")),
        el("p", "empty-text", penI18n.tr("passwords.heroText", "The agent can sign in for you without ever seeing a password.")),
      );
      box.appendChild(button(penI18n.tr("passwords.add", "Add login"), "btn btn-accent", startAdd, "Plus"));
    }
    detailEl.replaceChildren(wrap);
  }

  function renderView(entry: Entry): void {
    const host = helpers.displayHost(entry.origin);
    const actions = el("div", "actions");
    if (confirmDelete) {
      actions.append(
        el("span", "confirm-text", penI18n.tr("passwords.deleteConfirm", "Delete this login?")),
        button(penI18n.tr("passwords.cancel", "Cancel"), "btn btn-outline", () => {
          confirmDelete = false;
          renderDetail();
        }),
      );
      const del = button(penI18n.tr("passwords.delete", "Delete"), "btn btn-destructive", () => {
        void runAndRefresh(api.remove(entry.id), "passwords.deleteFailed", "Could not delete the login.", () => {
          confirmDelete = false;
        });
      }, "Trash");
      actions.appendChild(del);
      requestAnimationFrame(() => del.focus());
    } else {
      actions.append(
        button(penI18n.tr("passwords.edit", "Edit"), "btn btn-outline", () => startEdit(entry), "PencilSimple"),
        button(penI18n.tr("passwords.delete", "Delete"), "btn btn-outline", () => {
          confirmDelete = true;
          renderDetail();
        }, "Trash"),
      );
    }

    const tile = el("div", "hero-tile");
    tile.setAttribute("aria-hidden", "true");
    tile.appendChild(siteIcon(entry.icon, "hero-tile-img"));
    const hero = el("div", "hero");
    hero.append(tile, el("h1", "hero-title", host), actions);

    const body = el("div", "detail-body");
    body.append(
      hero,
      field(penI18n.tr("passwords.fieldUsername", "Username"), entry.username),
      field(penI18n.tr("passwords.fieldWebsite", "Website"), entry.origin),
      ...(entry.label ? [field(penI18n.tr("passwords.fieldLabel", "Label"), entry.label)] : []),
      field(penI18n.tr("passwords.fieldLastUsed", "Last used"), helpers.formatLastUsed(entry.lastUsedAt, Date.now(), penI18n)),
    );
    detailEl.replaceChildren(body);
  }

  function formField(
    label: string,
    attrs: { type: string; value?: string; placeholder?: string; autocomplete?: string; disabled?: boolean; required?: boolean },
  ): { wrap: HTMLElement; input: HTMLInputElement } {
    const wrap = el("label", "form-field");
    wrap.appendChild(el("span", "field-label", label));
    const input = el("input");
    input.type = attrs.type;
    input.value = attrs.value ?? "";
    input.spellcheck = false;
    input.autocomplete = (attrs.autocomplete ?? "off") as AutoFill;
    if (attrs.placeholder) input.placeholder = attrs.placeholder;
    if (attrs.disabled) input.disabled = true;
    if (attrs.required) input.required = true;
    wrap.appendChild(input);
    return { wrap, input };
  }

  function renderForm(existing: Entry | null): void {
    const adding = existing === null;
    pendingNav = null;
    const token = ++formTokenSeq;
    activeFormToken = token;

    const form = el("form", "detail-body form");
    form.autocomplete = "off";
    form.noValidate = true;
    const site = formField(penI18n.tr("passwords.fieldWebsite", "Website"), {
      type: "text",
      value: existing ? existing.origin : "",
      placeholder: penI18n.tr("passwords.sitePlaceholder", "example.com or http://localhost:3000"),
      disabled: !adding,
    });
    const username = formField(penI18n.tr("passwords.fieldUsername", "Username"), { type: "text", value: existing ? existing.username : "" });
    const password = formField(penI18n.tr("passwords.fieldPassword", "Password"), {
      type: "password",
      placeholder: adding ? "" : penI18n.tr("passwords.keepPasswordPlaceholder", "Leave blank to keep the current password"),
      autocomplete: "new-password",
    });
    const label = formField(penI18n.tr("passwords.fieldLabelOptional", "Label (optional)"), {
      type: "text",
      value: existing ? existing.label : "",
      placeholder: penI18n.tr("passwords.labelPlaceholder", "admin, test user"),
    });
    username.input.setAttribute("aria-label", penI18n.tr("passwords.fieldUsername", "Username"));
    site.input.setAttribute("aria-label", penI18n.tr("passwords.fieldWebsite", "Website"));
    password.input.setAttribute("aria-label", penI18n.tr("passwords.fieldPassword", "Password"));
    label.input.setAttribute("aria-label", penI18n.tr("passwords.fieldLabel", "Label"));

    const warning = el("p", "form-warning");
    warning.setAttribute("role", "alert");
    warning.hidden = true;
    /** Set after main answered "exists": the next Save replaces the stored password. */
    let confirmReplace = false;
    const error = el("p", "form-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    const showError = (text: string): void => {
      error.textContent = text;
      error.hidden = text === "";
    };

    const save = el("button", "btn btn-accent");
    save.type = "submit";
    save.textContent = penI18n.tr("passwords.save", "Save");
    let busy = false;
    const clearReplace = (): void => {
      if (!confirmReplace) return;
      confirmReplace = false;
      warning.hidden = true;
      save.textContent = penI18n.tr("passwords.save", "Save");
    };
    site.input.addEventListener("input", clearReplace);
    username.input.addEventListener("input", clearReplace);
    // Encryption is only needed when a password is written: label-only and
    // username-only edits go through without it.
    const updateSaveState = (): void => {
      const needsEncryption = adding || password.input.value !== "";
      save.disabled = busy || (needsEncryption && !data.encryptionAvailable);
    };
    updateSaveState();
    password.input.addEventListener("input", updateSaveState);
    formDirty = () =>
      adding
        ? site.input.value !== "" || username.input.value !== "" || password.input.value !== "" || label.input.value !== ""
        : username.input.value !== existing.username || label.input.value !== existing.label || password.input.value !== "";
    const cancel = button(penI18n.tr("passwords.cancel", "Cancel"), "btn btn-outline", cancelForm);
    // Save and Cancel stay under the fields, next to the warning and error they cause, and last in tab order.
    const row = el("div", "form-actions");
    row.append(cancel, save);
    const hero = el("div", "hero");
    hero.appendChild(el("h1", "hero-title", adding ? penI18n.tr("passwords.newLogin", "New login") : penI18n.tr("passwords.editLogin", "Edit login")));

    form.append(hero, site.wrap, username.wrap, password.wrap, label.wrap, warning, error, row);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (save.disabled) return;
      if (adding && site.input.value.trim() === "") return showError(penI18n.tr("passwords.enterWebsite", "Enter a website."));
      if (username.input.value.trim() === "") return showError(penI18n.tr("passwords.enterUsername", "Enter a username."));
      if (adding && password.input.value === "") return showError(penI18n.tr("passwords.enterPassword", "Enter a password."));
      showError("");
      busy = true;
      updateSaveState();
      const labelText = label.input.value.trim();
      const request = adding
        ? api.add({
            site: site.input.value,
            username: username.input.value,
            password: password.input.value,
            ...(labelText ? { label: labelText } : {}),
            ...(confirmReplace ? { replace: true } : {}),
          })
        : api.update({
            id: existing.id,
            username: username.input.value,
            label: labelText,
            ...(password.input.value !== "" ? { password: password.input.value } : {}),
          });
      void request
        .then(async (result) => {
          if (activeFormToken !== token) {
            // The form was discarded or replaced while the save ran: only the list data may change.
            await reloadList().catch(() => undefined);
            return;
          }
          if (!result.ok && result.exists) {
            // Same site + username already saved: ask before replacing its password.
            const found = result.id === undefined ? undefined : data.entries.find((e) => e.id === result.id);
            const where = found ? helpers.displayHost(found.origin) : site.input.value.trim();
            warning.textContent = penI18n.tr("passwords.replaceWarning", "A login for {username} on {site} exists. Saving replaces its password.", {
              username: username.input.value.trim(),
              site: where,
            });
            warning.hidden = false;
            confirmReplace = true;
            save.textContent = penI18n.tr("passwords.replace", "Replace");
            busy = false;
            updateSaveState();
            return;
          }
          if (!result.ok) {
            showError(mainError(result.error));
            busy = false;
            updateSaveState();
            return;
          }
          mode = "view";
          formDirty = null;
          await refresh();
          const match = data.entries.find((e) => e.id === result.id);
          if (match) {
            // Make sure the saved row is visible even under a filter.
            if (!helpers.matchesQuery(match, query)) {
              query = "";
              searchEl.value = "";
            }
            selectedId = match.id;
            renderAll();
          }
        })
        .catch(() => {
          if (activeFormToken !== token) return;
          showError(penI18n.tr("passwords.saveFailed", "Could not save the login."));
          busy = false;
          updateSaveState();
        });
    });

    detailEl.replaceChildren(form);
    (adding ? site.input : username.input).focus();
  }

  function renderDetail(): void {
    pendingNav = null;
    activeFormToken = null; // renderForm sets it again for the form it builds
    if (mode === "view") formDirty = null;
    if (section === "never") return renderEmptyDetail();
    if (mode === "add") return renderForm(null);
    const entry = selectedEntry();
    if (mode === "edit" && entry) return renderForm(entry);
    if (entry && visibleEntries().some((e) => e.id === entry.id)) return renderView(entry);
    renderEmptyDetail();
  }

  function renderAll(): void {
    renderChrome();
    renderList();
    renderDetail();
  }

  // ---- actions ----

  function selectEntry(id: string): void {
    showStatus("");
    selectedId = id;
    mode = "view";
    confirmDelete = false;
    renderAll();
  }
  function setSection(next: Section): void {
    showStatus("");
    section = next;
    mode = "view";
    confirmDelete = false;
    normalizeSelection();
    renderAll();
  }
  function startAdd(): void {
    section = "all";
    mode = "add";
    confirmDelete = false;
    renderAll();
  }
  function startEdit(entry: Entry): void {
    selectedId = entry.id;
    mode = "edit";
    confirmDelete = false;
    renderAll();
  }
  function cancelForm(): void {
    mode = "view";
    formDirty = null;
    normalizeSelection();
    renderAll();
  }

  /** Runs `go` now, or after the user confirms discarding a dirty Add/Edit form. */
  function guardNav(go: () => void): void {
    if (mode === "view" || formDirty === null || !formDirty()) return go();
    pendingNav = go;
    showDiscardBar();
  }

  function keepEditing(): void {
    pendingNav = null;
    detailEl.querySelector(".discard-bar")?.remove();
    detailEl.querySelector<HTMLElement>("form input:not(:disabled)")?.focus();
  }

  function showDiscardBar(): void {
    detailEl.querySelector(".discard-bar")?.remove();
    const bar = el("div", "discard-bar");
    bar.setAttribute("role", "alertdialog");
    bar.setAttribute("aria-label", penI18n.tr("passwords.discardQuestion", "Discard changes?"));
    const keep = button(penI18n.tr("passwords.keepEditing", "Keep editing"), "btn btn-outline", keepEditing);
    bar.append(
      el("span", "confirm-text", penI18n.tr("passwords.discardQuestion", "Discard changes?")),
      button(penI18n.tr("passwords.discard", "Discard"), "btn btn-destructive", () => {
        const go = pendingNav;
        pendingNav = null;
        formDirty = null;
        mode = "view";
        if (go) go();
      }),
      keep,
    );
    detailEl.prepend(bar);
    requestAnimationFrame(() => keep.focus());
  }

  function showStatus(text: string): void {
    statusEl.textContent = text;
    statusEl.hidden = text === "";
  }

  /** Runs a remove call, shows a fixed error on failure (also on an IPC rejection), refreshes the list. `failKey` is the dictionary key of `failText`. */
  async function runAndRefresh(request: Promise<ActionResult>, failKey: string, failText: string, onOk?: () => void): Promise<void> {
    try {
      const result = await request;
      if (!result.ok) {
        confirmDelete = false;
        showStatus(mainError(result.error));
        await refresh().catch(() => undefined);
        return;
      }
      showStatus("");
      onOk?.();
      await refresh();
    } catch {
      confirmDelete = false;
      showStatus(penI18n.tr(failKey, failText));
      renderDetail();
    }
  }

  /**
   * Re-reads the list without touching an open form: chrome and rows always,
   * the detail pane only in view mode. Used for a late save reply and for
   * `passwords:changed` (an icon arrived).
   */
  async function reloadList(): Promise<void> {
    data = await api.list();
    if (mode === "view") normalizeSelection();
    renderChrome();
    renderList();
    if (mode === "view") renderDetail();
  }

  async function refresh(): Promise<void> {
    data = await api.list();
    normalizeSelection();
    renderAll();
  }

  // ---- wiring ----

  // Each control hides itself, so focus moves to the control that undoes it.
  neverLink.addEventListener("click", () =>
    guardNav(() => {
      setSection("never");
      neverBack.focus();
    }),
  );
  function leaveNever(): void {
    setSection("all");
    (neverLink.hidden ? searchEl : neverLink).focus();
  }
  neverBack.addEventListener("click", leaveNever);
  addBtn.addEventListener("click", () => guardNav(startAdd));
  addBtn.disabled = false;
  searchEl.addEventListener("input", () => {
    query = searchEl.value;
    if (mode === "view") normalizeSelection();
    renderChrome();
    renderList();
    if (mode === "view") renderDetail();
  });

  function moveSelection(delta: number): void {
    if (section !== "all") return;
    const visible = visibleEntries();
    if (visible.length === 0) return;
    const current = visible.findIndex((e) => e.id === selectedId && mode !== "add");
    const next = current === -1 ? (delta > 0 ? 0 : visible.length - 1) : Math.max(0, Math.min(visible.length - 1, current + delta));
    const hadRowFocus = document.activeElement instanceof HTMLElement && document.activeElement.classList.contains("row");
    selectEntry(visible[next].id);
    const row = listEl.querySelector<HTMLElement>('.row[aria-selected="true"]');
    if (row) {
      if (hadRowFocus) row.focus();
      row.scrollIntoView({ block: "nearest" });
    }
  }

  document.addEventListener("keydown", (event) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === "f") {
      event.preventDefault();
      searchEl.focus();
      searchEl.select();
      return;
    }
    if (event.key === "Escape") {
      if (mode !== "view") {
        event.preventDefault();
        // Escape with the discard bar up means "Keep editing"; a dirty form asks first, a clean one cancels at once.
        if (detailEl.querySelector(".discard-bar")) keepEditing();
        else guardNav(cancelForm);
      } else if (confirmDelete) {
        event.preventDefault();
        confirmDelete = false;
        renderDetail();
      } else if (document.activeElement === searchEl && searchEl.value !== "") {
        event.preventDefault();
        searchEl.value = "";
        query = "";
        normalizeSelection();
        renderAll();
      } else if (section === "never") {
        event.preventDefault();
        leaveNever();
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const target = event.target as HTMLElement | null;
      const inForm = target !== null && target.closest("form") !== null;
      if (inForm || mod || event.altKey) return;
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      guardNav(() => moveSelection(delta));
    }
  });

  api.onChanged(() => void reloadList().catch(() => undefined));

  // The page's strings (`shell:i18n`, on load and on every language change): the markup carries `data-i18n` keys; the
  // rendered list and chrome are painted again. An open Add/Edit form (and its discard bar) keeps what the person is
  // typing: it is not rebuilt, so it stays in the old language until it closes.
  api.onI18n((payload) => penI18n.set(payload));
  penI18n.onChange(() => {
    paintStorageNote();
    renderChrome();
    renderList();
    if (mode === "view") renderDetail();
  });
  renderAll();
  void refresh();
})();
