import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm";

const PAGE_SIZE = 20;
const COLSPAN = 9;
const AUTH_EMAIL = "daniel.rosado0205@gmail.com";
const AUTH_PASSWORD_SHA256 = "b84e3fe612374e7b57ed5d59d9e7e36b8e49aaccd61a13aad0d7be3e1ca4ccb1";
const AUTH_KEY = "good-traders-session";

const state = {
  client: null,
  rows: [],
  loading: true,
  error: "",
  search: "",
  network: "all",
  sortKey: "id",
  sortDir: "asc",
  page: 1,
  flashId: null,
  editingId: null,
  pendingDelete: null,
  saving: false,
  bound: false,
  selected: new Set(),
};

const $ = (id) => document.getElementById(id);

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

function boot() {
  $("login-form").addEventListener("submit", onLogin);
  $("sign-out").addEventListener("click", onSignOut);
  if (hasSession()) {
    showApp();
    init();
  } else {
    showLogin();
  }
}

function hasSession() {
  return localStorage.getItem(AUTH_KEY) === AUTH_EMAIL;
}

function showApp() {
  $("login").hidden = true;
  $("app").hidden = false;
  $("signed-in").textContent = AUTH_EMAIL;
  document.title = "Good traders";
}

function showLogin() {
  $("app").hidden = true;
  $("login").hidden = false;
  document.title = "Sign in · Good traders";
  $("login-email").focus();
}

async function onLogin(event) {
  event.preventDefault();
  if (state.saving) return;

  const email = $("login-email").value.trim().toLowerCase();
  const password = $("login-password").value;
  $("login-error").hidden = true;

  state.saving = true;
  $("login-submit").disabled = true;
  $("login-submit").textContent = "Signing in…";

  const digest = await sha256(password);
  const valid = email === AUTH_EMAIL && digest === AUTH_PASSWORD_SHA256;

  state.saving = false;
  $("login-submit").disabled = false;
  $("login-submit").textContent = "Sign in";

  if (!valid) {
    $("login-error").hidden = false;
    $("login-error").textContent = "Email or password is incorrect.";
    $("login-password").focus();
    return;
  }

  localStorage.setItem(AUTH_KEY, AUTH_EMAIL);
  $("login-password").value = "";
  showApp();
  await init();
}

function onSignOut() {
  localStorage.removeItem(AUTH_KEY);
  if ($("editor").open) $("editor").close();
  if ($("confirm").open) $("confirm").close();
  $("login-password").value = "";
  $("login-error").hidden = true;
  $("login-error").textContent = "";
  showLogin();
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function init() {
  if (!state.bound) {
    const params = new URLSearchParams(location.search);
    state.search = params.get("q") ?? "";
    state.network = params.get("network") ?? "all";
    $("search").value = state.search;
    bind();
    state.bound = true;
  }

  try {
    const config = await loadConfig();
    state.client = createClient(config.url, config.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    $("project").textContent = new URL(config.url).host.replace(".supabase.co", "");
    await load();
  } catch (error) {
    state.loading = false;
    state.error = error.message || "Could not connect to Supabase.";
    $("sync").classList.add("is-error");
    $("sync-label").textContent = "Not connected";
    render();
  }
}

async function loadConfig() {
  const response = await fetch("./supabase.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load supabase.json.");
  const config = await response.json();
  if (!config.url || !config.anonKey) {
    throw new Error("supabase.json needs a url and an anonKey.");
  }
  return config;
}

function bind() {
  $("search").addEventListener("input", () => {
    state.search = $("search").value;
    state.page = 1;
    writeQuery();
    render();
  });

  $("chips").addEventListener("click", (event) => {
    const button = event.target.closest("[data-network]");
    if (!button) return;
    state.network = button.dataset.network;
    state.page = 1;
    writeQuery();
    render();
  });

  document.querySelectorAll("[data-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sort;
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = key;
        state.sortDir = key === "created_at" ? "desc" : "asc";
      }
      render();
    });
  });

  $("rows").addEventListener("click", onTableClick);
  $("select-all").addEventListener("change", onSelectPage);
  $("bulk-delete").addEventListener("click", () => {
    const rows = state.rows
      .filter((row) => state.selected.has(row.id))
      .sort((a, b) => displayNo(a) - displayNo(b));
    if (rows.length) openConfirm(rows);
  });
  $("bulk-clear").addEventListener("click", () => {
    state.selected.clear();
    render();
  });
  $("refresh").addEventListener("click", () => load());
  $("retry").addEventListener("click", () => load());
  $("add").addEventListener("click", () => openEditor(null));
  $("prev").addEventListener("click", () => {
    state.page -= 1;
    render();
  });
  $("next").addEventListener("click", () => {
    state.page += 1;
    render();
  });

  $("trader-form").addEventListener("submit", onSubmit);
  $("editor-cancel").addEventListener("click", () => $("editor").close());
  $("editor-close").addEventListener("click", () => $("editor").close());
  $("editor-delete").addEventListener("click", () => {
    const row = state.rows.find((item) => item.id === state.editingId);
    if (row) openConfirm(row);
  });
  $("editor").addEventListener("click", (event) => {
    if (event.target === $("editor")) $("editor").close();
  });
  $("editor").addEventListener("cancel", (event) => {
    if (state.saving) event.preventDefault();
  });

  for (const id of ["token", "wallet", "score", "network"]) {
    $(id).addEventListener("input", () => {
      $(`${id}-error`).textContent = "";
      $(id).removeAttribute("aria-invalid");
      $("form-error").hidden = true;
      updateDuplicateHint();
    });
  }

  $("confirm-cancel").addEventListener("click", () => $("confirm").close());
  $("confirm-delete").addEventListener("click", onDelete);
  $("confirm").addEventListener("click", (event) => {
    if (event.target === $("confirm")) $("confirm").close();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !event.target.closest("input, textarea, dialog")) {
      event.preventDefault();
      $("search").focus();
    }
  });
}

async function load() {
  const first = state.rows.length === 0;
  state.loading = true;
  state.error = "";
  $("sync").classList.remove("is-live", "is-error");
  $("sync-label").textContent = "Syncing…";
  $("refresh").disabled = true;
  if (first) render();

  let { data, error } = await state.client
    .from("good_traders")
    .select("id, token, wallet, risky_bad_good, network, created_at, viewed")
    .order("id", { ascending: true });

  if (error && /viewed/i.test(error.message || "")) {
    const fallback = await state.client
      .from("good_traders")
      .select("id, token, wallet, risky_bad_good, network, created_at")
      .order("id", { ascending: true });
    data = (fallback.data ?? []).map((row) => ({ ...row, viewed: false }));
    error = fallback.error;
    if (!error) {
      state.error = "Add a viewed column on good_traders before viewed status can be saved.";
    }
  }

  state.loading = false;
  $("refresh").disabled = false;

  if (error) {
    state.error = error.message;
    $("sync").classList.add("is-error");
    $("sync-label").textContent = "Sync failed";
  } else {
    state.rows = data ?? [];
    const when = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date());
    $("sync").classList.add("is-live");
    $("sync-label").textContent = `Synced ${when}`;
    document.title = `Good traders (${state.rows.length})`;
  }

  render();
}

function onTableClick(event) {
  const tr = event.target.closest("tr[data-id]");
  if (!tr) {
    const clear = event.target.closest("[data-clear]");
    if (clear) clearFilters();
    return;
  }

  const row = state.rows.find((item) => String(item.id) === tr.dataset.id);
  if (!row) return;

  if (event.target.closest(".check-cell")) {
    const input = event.target.closest("[data-select]");
    if (input) {
      if (input.checked) state.selected.add(row.id);
      else state.selected.delete(row.id);
      syncSelection();
    }
    return;
  }

  const walletLink = event.target.closest("a[data-view='wallet']");
  if (walletLink) {
    markViewed(row);
    return;
  }
  if (event.target.closest("a")) return;

  const copyButton = event.target.closest("[data-copy]");
  if (copyButton) {
    copyValue(row[copyButton.dataset.copy], copyButton);
    return;
  }

  const action = event.target.closest("[data-action]");
  if (action?.dataset.action === "edit") {
    openEditor(row);
    return;
  }
  if (action?.dataset.action === "delete") {
    openConfirm(row);
    return;
  }

  if (window.getSelection()?.toString()) return;
  openEditor(row);
}

function clearFilters() {
  state.search = "";
  state.network = "all";
  state.page = 1;
  $("search").value = "";
  writeQuery();
  render();
}

async function onSubmit(event) {
  event.preventDefault();
  if (state.saving) return;

  const fields = readForm();
  const errors = validate(fields);
  showFieldErrors(errors);
  if (Object.keys(errors).length) return;

  const payload = {
    token: fields.token,
    wallet: fields.wallet,
    risky_bad_good: fields.score || null,
    network: fields.network || null,
  };

  state.saving = true;
  setSaving(true);
  const wasNew = state.editingId == null;
  const query = wasNew
    ? state.client.from("good_traders").insert(payload).select("*").single()
    : state.client
        .from("good_traders")
        .update(payload)
        .eq("id", state.editingId)
        .select("*")
        .single();

  const { data, error } = await query;
  state.saving = false;
  setSaving(false);

  if (error) {
    showFormError(error.message);
    return;
  }

  $("editor").close();
  state.flashId = data.id;
  toast(wasNew ? "Trader added." : "Trader updated.");
  await load();
  if (!rowMatches(data)) {
    toast("Saved. Clear the search or network filter to show that row.");
  }
}

async function onDelete() {
  const rows = state.pendingDelete;
  if (!rows?.length || state.saving) return;

  state.saving = true;
  $("confirm-delete").disabled = true;
  const ids = rows.map((row) => row.id);
  const { error } = await state.client.from("good_traders").delete().in("id", ids);
  state.saving = false;
  $("confirm-delete").disabled = false;

  if (error) {
    $("confirm-error").hidden = false;
    $("confirm-error").textContent = error.message;
    return;
  }

  $("confirm").close();
  for (const id of ids) state.selected.delete(id);
  if ($("editor").open && ids.includes(state.editingId)) $("editor").close();
  toast(ids.length === 1 ? "Trader deleted." : `${ids.length} traders deleted.`);
  await load();
}

function openEditor(row) {
  state.editingId = row ? row.id : null;
  $("editor-kicker").textContent = row ? `No ${displayNo(row)}` : "New row";
  $("editor-title").textContent = row ? "Edit trader" : "New trader";
  $("editor-save").textContent = row ? "Save changes" : "Save trader";
  $("token").value = row?.token ?? "";
  $("wallet").value = row?.wallet ?? "";
  $("score").value = row?.risky_bad_good ?? "";
  $("network").value = row?.network ?? "";
  $("editor-meta").textContent = row
    ? `Created ${formatStamp(row.created_at)} · ${row.viewed ? "Viewed" : "Not viewed"}`
    : "Created time is assigned when you save.";
  $("editor-delete").hidden = !row;
  clearEditorErrors();
  updateDuplicateHint();
  fillNetworkList();
  if (!$("editor").open) $("editor").showModal();
  $("token").focus();
}

function openConfirm(rowOrRows) {
  const rows = (Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]).filter(Boolean);
  state.pendingDelete = rows;
  $("confirm-error").hidden = true;
  $("confirm-error").textContent = "";
  const many = rows.length > 1;
  $("confirm-title").textContent = many ? `Remove ${rows.length} traders?` : "Remove this trader?";
  $("confirm-delete").textContent = many ? `Delete ${rows.length}` : "Delete trader";
  $("confirm-hint").textContent = many
    ? "This permanently deletes the selected rows from good_traders."
    : "This permanently deletes the row from good_traders.";
  const body = $("confirm-body");
  body.replaceChildren();
  if (!many) {
    const row = rows[0];
    for (const [label, value] of [
      ["No", displayNo(row)],
      ["Token", row.token],
      ["Wallet", row.wallet],
      ["Score", row.risky_bad_good],
      ["Network", row.network],
      ["Created", formatStamp(row.created_at)],
      ["Viewed", row.viewed ? "Yes" : "No"],
    ]) {
      body.append(h("div", {}, [h("dt", { text: label }), h("dd", { text: value || "—" })]));
    }
  } else {
    const preview = rows.slice(0, 6);
    for (const row of preview) {
      body.append(h("div", {}, [h("dt", { text: `No ${displayNo(row)}` }), h("dd", { text: row.token || "—" })]));
    }
    if (rows.length > preview.length) {
      body.append(
        h("div", {}, [h("dt", { text: "More" }), h("dd", { text: `${rows.length - preview.length} other traders` })]),
      );
    }
  }
  if (!$("confirm").open) $("confirm").showModal();
}

function readForm() {
  return {
    token: squash($("token").value),
    wallet: squash($("wallet").value),
    score: $("score").value.trim(),
    network: $("network").value.trim(),
  };
}

function validate(fields) {
  const errors = {};
  if (!fields.token) errors.token = "Enter a token.";
  if (!fields.wallet) errors.wallet = "Enter a wallet.";
  return errors;
}

function showFieldErrors(errors) {
  for (const id of ["token", "wallet", "score", "network"]) {
    const message = errors[id] || "";
    $(`${id}-error`).textContent = message;
    if (message) $(id).setAttribute("aria-invalid", "true");
    else $(id).removeAttribute("aria-invalid");
  }
  if (errors.token) $("token").focus();
  else if (errors.wallet) $("wallet").focus();
}

function clearEditorErrors() {
  showFieldErrors({});
  $("form-error").hidden = true;
  $("form-error").textContent = "";
}

function showFormError(message) {
  $("form-error").hidden = false;
  $("form-error").textContent = message;
}

function setSaving(saving) {
  $("editor-save").disabled = saving;
  $("editor-save").textContent = saving
    ? "Saving…"
    : state.editingId == null
      ? "Save trader"
      : "Save changes";
  $("editor-cancel").disabled = saving;
  $("editor-close").disabled = saving;
}

function updateDuplicateHint() {
  const hint = $("duplicate-hint");
  const fields = readForm();
  const match = state.rows.find(
    (row) =>
      row.id !== state.editingId &&
      row.token === fields.token &&
      row.wallet === fields.wallet &&
      fields.token &&
      fields.wallet,
  );
  hint.hidden = !match;
  hint.textContent = match ? `No ${displayNo(match)} already uses this token and wallet.` : "";
}

function fillNetworkList() {
  const list = $("network-list");
  const names = new Set(["Solana", "Ethereum", "Base", "BSC", "Elysium"]);
  for (const row of state.rows) {
    if (row.network) names.add(row.network);
  }
  list.replaceChildren(...[...names].sort((a, b) => a.localeCompare(b)).map((name) => h("option", { value: name })));
}

function onSelectPage() {
  const pageRows = currentPageRows();
  if ($("select-all").checked) {
    for (const row of pageRows) state.selected.add(row.id);
  } else {
    for (const row of pageRows) state.selected.delete(row.id);
  }
  render();
}

function currentPageRows() {
  const rows = visibleRows();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(Math.max(state.page, 1), pages);
  const start = (page - 1) * PAGE_SIZE;
  return rows.slice(start, start + PAGE_SIZE);
}

function syncSelection() {
  const live = new Set(state.rows.map((row) => row.id));
  for (const id of [...state.selected]) {
    if (!live.has(id)) state.selected.delete(id);
  }
  const pageRows = currentPageRows();
  const selectedOnPage = pageRows.filter((row) => state.selected.has(row.id)).length;
  const box = $("select-all");
  box.disabled = pageRows.length === 0;
  box.checked = pageRows.length > 0 && selectedOnPage === pageRows.length;
  box.indeterminate = selectedOnPage > 0 && selectedOnPage < pageRows.length;
  const count = state.selected.size;
  $("bulk").hidden = count === 0;
  $("bulk-delete").textContent = count === 1 ? "Delete selected" : `Delete selected (${count})`;
}

function render() {
  rebuildNumbers();
  renderStats();
  renderChips();
  renderSort();
  renderBanner();

  const rows = visibleRows();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  if (state.page > pages) state.page = pages;
  if (state.page < 1) state.page = 1;

  if (state.flashId != null) {
    const index = rows.findIndex((row) => String(row.id) === String(state.flashId));
    if (index >= 0) state.page = Math.floor(index / PAGE_SIZE) + 1;
  }

  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);
  const body = $("rows");
  body.replaceChildren();

  if (!pageRows.length) {
    body.append(renderEmpty());
  } else {
    for (const row of pageRows) body.append(renderRow(row));
  }

  const flashId = state.flashId;
  if (flashId != null) {
    document.querySelector(`tr[data-id="${CSS.escape(String(flashId))}"]`)?.classList.add("flash");
    state.flashId = null;
  }

  const from = rows.length ? start + 1 : 0;
  const to = start + pageRows.length;
  if (state.loading && state.rows.length === 0) {
    $("range").textContent = "Loading traders…";
  } else if (!state.rows.length && !state.error) {
    $("range").textContent = "No traders yet";
  } else if (!rows.length) {
    $("range").textContent = "No matching traders";
  } else {
    $("range").textContent = `Showing ${from}–${to} of ${rows.length}`;
  }

  $("prev").hidden = pages < 2;
  $("next").hidden = pages < 2;
  $("prev").disabled = state.page <= 1;
  $("next").disabled = state.page >= pages;
  syncSelection();
}

function renderEmpty() {
  const cell = h("td", { colspan: String(COLSPAN) });
  if (state.loading && state.rows.length === 0) {
    cell.textContent = "Loading traders…";
  } else if (state.error && state.rows.length === 0) {
    cell.textContent = "The table could not be loaded.";
  } else if (state.rows.length === 0) {
    cell.textContent = "No traders yet. Use New trader to add the first row.";
  } else {
    cell.append(
      h("div", { text: "No traders match this search." }),
      h("button", { class: "btn ghost", type: "button", "data-clear": "true", text: "Clear filters" }),
    );
  }
  return h("tr", { class: "empty-row" }, [cell]);
}

function renderRow(row) {
  const when = formatParts(row.created_at);
  const tr = h("tr", { "data-id": row.id, class: state.selected.has(row.id) ? "is-selected" : "" }, [
    h("td", { class: "check-cell" }, [
      h("label", { class: "check" }, [
        h("input", {
          type: "checkbox",
          "data-select": "row",
          checked: state.selected.has(row.id),
          "aria-label": `Select No ${displayNo(row)}`,
        }),
      ]),
    ]),
    h("td", { class: "num", "data-label": "No", text: String(displayNo(row)) }),
    addressCell(row.token, "token", "Token", row.network),
    addressCell(row.wallet, "wallet", "Wallet", row.network),
    h("td", { "data-label": "Score" }, [scoreNode(row.risky_bad_good)]),
    h("td", { "data-label": "Network" }, [networkNode(row.network)]),
    h("td", { "data-label": "Created" }, [
      h("div", { class: "when", title: row.created_at || "" }, [
        document.createTextNode(when.date),
        h("small", { text: when.time }),
      ]),
    ]),
    h("td", { "data-label": "Viewed" }, [viewedNode(row.viewed)]),
    h("td", { class: "actions-cell" }, [
      h("div", { class: "actions" }, [
        h("button", {
          class: "icon-btn",
          type: "button",
          "data-action": "edit",
          "aria-label": "Edit",
          title: "Edit",
        }, [icon("edit")]),
        h("button", {
          class: "icon-btn danger",
          type: "button",
          "data-action": "delete",
          "aria-label": "Delete",
          title: "Delete",
        }, [icon("trash")]),
      ]),
    ]),
  ]);
  return tr;
}

function addressCell(value, field, label, network) {
  if (!value) {
    return h("td", { "data-label": label }, [h("span", { class: "muted", text: "—" })]);
  }
  return h("td", { "data-label": label }, [
    h("div", { class: "addr" }, [
      h("a", {
        class: "addr-value",
        href: gmgnHref(field, value, network),
        target: "_blank",
        rel: "noopener noreferrer",
        title: `Open this ${label.toLowerCase()} on GMGN`,
        "data-view": field === "wallet" ? "wallet" : null,
        text: value,
      }),
      h("button", {
        class: "icon-btn",
        type: "button",
        "data-copy": field,
        "aria-label": `Copy ${label.toLowerCase()}`,
        title: `Copy ${label.toLowerCase()}`,
      }, [icon("copy")]),
    ]),
  ]);
}

function viewedNode(viewed) {
  if (!viewed) return h("span", { class: "muted", text: "—" });
  return h("span", { class: "viewed" }, [icon("check"), document.createTextNode("Yes")]);
}

function markViewed(row) {
  if (row.viewed) return;
  row.viewed = true;
  const cell = document.querySelector(`tr[data-id="${CSS.escape(String(row.id))}"] [data-label="Viewed"]`);
  if (cell) cell.replaceChildren(viewedNode(true));
  persistViewed(row);
}

async function persistViewed(row) {
  const { error } = await state.client.from("good_traders").update({ viewed: true }).eq("id", row.id);
  if (error) {
    row.viewed = false;
    render();
    toast("Could not save viewed.", "error");
  }
}

function networkNode(network) {
  if (!network) return h("span", { class: "muted", text: "—" });
  const kind = networkKind(network);
  const kids = [];
  if (kind) kids.push(networkIcon(kind));
  kids.push(document.createTextNode(network));
  return h("span", { class: kind ? `network is-${kind}` : "network" }, kids);
}

function networkKind(network) {
  const key = (network || "").trim().toLowerCase();
  if (key === "solana" || key === "sol") return "solana";
  if (key === "bsc" || key === "bnb" || key === "binance smart chain") return "bsc";
  if (key === "elysium" || key === "esylium") return "elysium";
  return "";
}

let networkIconSeq = 0;

function networkIcon(kind) {
  networkIconSeq += 1;
  const id = `net-${kind}-${networkIconSeq}`;
  const svg = svgEl("svg", { viewBox: "0 0 24 24", class: "network-icon", "aria-hidden": "true" });
  if (kind === "solana") {
    const gradient = svgEl("linearGradient", { id, x1: "0", y1: "1", x2: "1", y2: "0" });
    gradient.append(
      svgEl("stop", { offset: "0", "stop-color": "#9945FF" }),
      svgEl("stop", { offset: "1", "stop-color": "#14F195" }),
    );
    svg.append(svgEl("defs", {}, [gradient]));
    for (const d of [
      "M4.7 16.35c.14-.14.33-.22.53-.22h14.55c.46 0 .69.56.36.88l-2.35 2.35c-.14.14-.33.22-.53.22H2.71c-.46 0-.69-.56-.36-.88l2.35-2.35z",
      "M4.7 4.42c.14-.14.34-.22.54-.22h14.55c.46 0 .69.56.36.88L17.8 7.43c-.14.14-.33.22-.53.22H2.71c-.46 0-.69-.56-.36-.88L4.7 4.42z",
      "M19.3 10.22c-.14-.14-.33-.22-.53-.22H4.22c-.46 0-.69.56-.36.88l2.35 2.35c.14.14.33.22.53.22h14.55c.46 0 .69-.56.36-.88l-2.35-2.35z",
    ]) {
      svg.append(svgEl("path", { fill: `url(#${id})`, d }));
    }
  } else if (kind === "bsc") {
    svg.append(
      svgEl("path", {
        fill: "#F3BA2F",
        d: "M12 2.2 14.3 4.5 12 6.8 9.7 4.5 12 2.2zM12 17.2l2.3 2.3L12 21.8l-2.3-2.3L12 17.2zM4.5 9.7 6.8 12 4.5 14.3 2.2 12 4.5 9.7zM19.5 9.7 21.8 12l-2.3 2.3L17.2 12l2.3-2.3zM12 9.7l2.3 2.3L12 14.3 9.7 12 12 9.7z",
      }),
    );
  } else {
    svg.append(
      svgEl("circle", { cx: "12", cy: "12", r: "9.2", fill: "#140E2A", stroke: "#8B7CFF", "stroke-width": "1.4" }),
      svgEl("path", { fill: "#3DDC97", d: "M12 4.8 16.6 12.2H7.4L12 4.8z" }),
      svgEl("path", { fill: "#8B7CFF", d: "M7.8 13.1h8.4L12 19.2 7.8 13.1z" }),
    );
  }
  return svg;
}

function svgEl(tag, attrs, kids = []) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  for (const kid of kids) node.append(kid);
  return node;
}

function gmgnHref(field, address, network) {
  const kind = field === "wallet" ? "address" : "token";
  return `https://gmgn.ai/${gmgnChain(network)}/${kind}/${encodeURIComponent(address)}`;
}

function gmgnChain(network) {
  const key = (network || "").trim().toLowerCase();
  const chains = {
    solana: "sol",
    sol: "sol",
    ethereum: "eth",
    eth: "eth",
    base: "base",
    bsc: "bsc",
    bnb: "bsc",
    "binance smart chain": "bsc",
    tron: "tron",
    trx: "tron",
    monad: "monad",
  };
  return chains[key] || "sol";
}

function scoreNode(value) {
  if (!value) return h("span", { class: "muted", text: "—" });
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(value);
  let tone = "";
  if (match) tone = Number(match[1]) > 0 ? " is-flagged" : " is-clean";
  return h("span", { class: `score${tone}`, text: value });
}

function renderStats() {
  const tokens = new Set(state.rows.map((row) => row.token).filter(Boolean));
  const wallets = new Set(state.rows.map((row) => row.wallet).filter(Boolean));
  const networks = [...new Set(state.rows.map((row) => row.network).filter(Boolean))];
  const cards = [
    [String(state.rows.length), state.rows.length === 1 ? "Trader" : "Traders"],
    [String(tokens.size), tokens.size === 1 ? "Token" : "Tokens"],
    [String(wallets.size), wallets.size === 1 ? "Wallet" : "Wallets"],
    networks.length === 1 ? [networks[0], "Network"] : [String(networks.length), "Networks"],
  ];
  $("stats").replaceChildren(
    ...cards.map(([value, label]) => h("div", { class: "stat" }, [h("b", { text: value }), h("span", { text: label })])),
  );
}

function renderChips() {
  const names = new Set(state.rows.map((row) => row.network).filter(Boolean));
  if (state.network !== "all") names.add(state.network);
  const chips = [["all", "All"], ...[...names].sort((a, b) => a.localeCompare(b)).map((name) => [name, name])];
  $("chips").replaceChildren(
    ...chips.map(([value, label]) =>
      h("button", {
        class: "chip",
        type: "button",
        "data-network": value,
        "aria-pressed": String(state.network === value),
        text: label,
      }),
    ),
  );
}

function renderSort() {
  document.querySelectorAll("[data-sort]").forEach((button) => {
    const key = button.dataset.sort;
    const active = key === state.sortKey;
    const th = button.closest("th");
    th.setAttribute("aria-sort", active ? (state.sortDir === "asc" ? "ascending" : "descending") : "none");
    button.classList.toggle("is-active", active);
    button.querySelector(".cue").textContent = active ? (state.sortDir === "asc" ? "↑" : "↓") : "";
  });
}

function renderBanner() {
  $("banner").hidden = !state.error;
  $("banner-text").textContent = state.error;
}

function visibleRows() {
  return state.rows.filter(rowMatches).sort(compareRows);
}

function rowMatches(row) {
  if (state.network !== "all" && (row.network || "") !== state.network) return false;
  const query = state.search.trim().toLowerCase();
  if (!query) return true;
  return [displayNo(row), row.token, row.wallet, row.risky_bad_good, row.network, row.viewed ? "viewed" : ""]
    .map((value) => (value ?? "").toString().toLowerCase())
    .join(" ")
    .includes(query);
}

function compareRows(a, b) {
  const dir = state.sortDir === "asc" ? 1 : -1;
  const key = state.sortKey;
  let av = a[key];
  let bv = b[key];
  if (key === "id") {
    av = Number(av);
    bv = Number(bv);
  } else if (key === "created_at") {
    av = new Date(av).getTime() || 0;
    bv = new Date(bv).getTime() || 0;
  } else if (key === "viewed") {
    av = av ? 1 : 0;
    bv = bv ? 1 : 0;
  } else {
    av = (av ?? "").toString().toLowerCase();
    bv = (bv ?? "").toString().toLowerCase();
  }
  if (av < bv) return -1 * dir;
  if (av > bv) return 1 * dir;
  return 0;
}

function writeQuery() {
  const params = new URLSearchParams();
  if (state.search) params.set("q", state.search);
  if (state.network !== "all") params.set("network", state.network);
  const qs = params.toString();
  history.replaceState(null, "", qs ? `${location.pathname}?${qs}` : location.pathname);
}

function formatParts(iso) {
  if (!iso) return { date: "—", time: "" };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { date: iso, time: "" };
  return {
    date: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date),
    time: new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date),
  };
}

function formatStamp(iso) {
  const parts = formatParts(iso);
  return parts.time ? `${parts.date}, ${parts.time}` : parts.date;
}

async function copyValue(value, button) {
  try {
    await navigator.clipboard.writeText(value);
    const previousLabel = button.getAttribute("aria-label");
    button.replaceChildren(icon("check"));
    button.classList.add("is-copied");
    button.setAttribute("aria-label", "Copied");
    button.title = "Copied";
    setTimeout(() => {
      if (!button.isConnected) return;
      button.replaceChildren(icon("copy"));
      button.classList.remove("is-copied");
      button.setAttribute("aria-label", previousLabel);
      button.title = previousLabel;
    }, 1200);
  } catch {
    toast("Could not copy that value.", "error");
  }
}

function toast(message, tone = "ok") {
  const node = h("p", { class: tone === "error" ? "toast error" : "toast", text: message });
  $("toasts").append(node);
  setTimeout(() => node.remove(), 3200);
}

function squash(value) {
  return value.replace(/\s+/g, "");
}

let numberById = new Map();

function rebuildNumbers() {
  const ordered = [...state.rows].sort((a, b) => Number(a.id) - Number(b.id));
  numberById = new Map(ordered.map((row, index) => [row.id, index + 1]));
}

function displayNo(row) {
  if (!numberById.has(row.id)) rebuildNumbers();
  return numberById.get(row.id) ?? "";
}

const ICONS = {
  copy: [
    ["rect", { x: "8.5", y: "8.5", width: "11", height: "11", rx: "1.5" }],
    ["path", { d: "M15.5 8.5V5.2A1.2 1.2 0 0 0 14.3 4H5.2A1.2 1.2 0 0 0 4 5.2v9.1A1.2 1.2 0 0 0 5.2 15.5H8.5" }],
  ],
  edit: [
    ["path", { d: "M12.6 5.2a1.8 1.8 0 0 1 2.5 0l3.7 3.7a1.8 1.8 0 0 1 0 2.5L9.2 21H4v-5.2L12.6 5.2z" }],
    ["path", { d: "M11 7l6 6" }],
  ],
  trash: [
    ["path", { d: "M4.5 7h15" }],
    ["path", { d: "M9 7V4.8h6V7" }],
    ["path", { d: "M7.2 7l.8 13h8l.8-13" }],
    ["path", { d: "M10 10.5v6M14 10.5v6" }],
  ],
  check: [["path", { d: "M5 12.5l4.2 4.2L19 7" }]],
};

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of ICONS[name]) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    el.setAttribute("fill", "none");
    el.setAttribute("stroke", "currentColor");
    el.setAttribute("stroke-width", "1.8");
    el.setAttribute("stroke-linecap", "round");
    el.setAttribute("stroke-linejoin", "round");
    svg.append(el);
  }
  return svg;
}

function h(tag, props = {}, kids = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = String(value);
    else if (key === "title") node.title = String(value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const kid of kids) {
    if (kid == null) continue;
    node.append(kid);
  }
  return node;
}
