"use strict";
(() => {
  // src/lens/webview/main.ts
  var vscode = acquireVsCodeApi();
  var post = (message) => vscode.postMessage(message);
  function el(tag, className, ...children) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const child of children) {
      if (child === null || child === void 0 || child === false) continue;
      node.append(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }
  var SVG_NS = "http://www.w3.org/2000/svg";
  function mark(size = 18) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("aria-hidden", "true");
    const ring = (r, w, dash) => {
      const c = document.createElementNS(SVG_NS, "circle");
      c.setAttribute("cx", "12");
      c.setAttribute("cy", "12");
      c.setAttribute("r", String(r));
      c.setAttribute("fill", "none");
      c.setAttribute("stroke", "currentColor");
      c.setAttribute("stroke-width", String(w));
      if (dash) c.setAttribute("stroke-dasharray", dash);
      return c;
    };
    const core = document.createElementNS(SVG_NS, "circle");
    core.setAttribute("cx", "12");
    core.setAttribute("cy", "12");
    core.setAttribute("r", "2.2");
    core.setAttribute("fill", "currentColor");
    svg.append(ring(9, 1.4), ring(5.5, 1, "2 2"), core);
    return svg;
  }
  function relativeTime(iso) {
    const then = Date.parse(iso);
    if (Number.isNaN(then)) return "";
    const seconds = Math.max(0, Math.round((Date.now() - then) / 1e3));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }
  function agentOrb(agentId, role) {
    const orb = el("span", `orb orb-${agentId.split("-")[0]}`);
    orb.textContent = agentId.slice(0, 1).toUpperCase();
    orb.title = role ? `${agentId} \xB7 ${role}` : agentId;
    return orb;
  }
  var state = {
    snapshot: null,
    preview: null,
    previewError: null,
    routing: false,
    token: 0,
    expanded: null,
    detail: null,
    sheet: null,
    busy: null,
    ghostOn: null,
    repairing: false
  };
  var root = document.getElementById("root");
  var statusRow = el("header", "status");
  var intentInput = el("input", "intent-input");
  intentInput.type = "text";
  intentInput.placeholder = "Tell Jarvis what to do\u2026";
  intentInput.spellcheck = false;
  intentInput.setAttribute("aria-label", "Directive for Jarvis");
  var intentHint = el("kbd", "intent-hint", "\u23CE");
  var intentCapsule = el(
    "div",
    "intent-capsule",
    el("span", "intent-mark", mark(20)),
    intentInput,
    intentHint
  );
  var routeLine = el("div", "route");
  var suggestionRow = el("div", "suggestions");
  var intentSection = el("section", "intent", intentCapsule, routeLine, suggestionRow);
  var river = el("section", "river");
  var sheetHost = el("div", "sheet-host");
  var toastHost = el("div", "toasts");
  root.append(statusRow, intentSection, river, sheetHost, toastHost);
  var routeTimer;
  function requestRoute() {
    if (routeTimer) clearTimeout(routeTimer);
    const directive = intentInput.value;
    if (!directive.trim()) {
      state.preview = null;
      state.previewError = null;
      state.routing = false;
      renderRoute();
      return;
    }
    state.routing = true;
    renderRoute();
    routeTimer = setTimeout(() => {
      state.token += 1;
      post({ type: "route", token: state.token, directive });
    }, 220);
  }
  intentInput.addEventListener("input", requestRoute);
  intentInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const directive = intentInput.value.trim();
      if (!directive) return;
      post({ type: "engage", directive, planOnly: event.shiftKey });
      intentInput.value = "";
      state.preview = null;
      renderRoute();
    } else if (event.key === "Escape") {
      intentInput.value = "";
      requestRoute();
    }
  });
  intentCapsule.addEventListener("click", () => intentInput.focus());
  function renderRoute() {
    routeLine.replaceChildren();
    routeLine.classList.toggle("is-visible", state.routing || !!state.preview || !!state.previewError);
    if (state.previewError) {
      routeLine.append(el("p", "route-error", state.previewError));
      return;
    }
    if (!state.preview) {
      if (state.routing) routeLine.append(el("p", "route-thinking", "reading the route\u2026"));
      return;
    }
    const preview = state.preview;
    routeLine.append(el("p", "route-headline", preview.headline));
    const chips = el("div", "chips");
    for (const chip of preview.chips) {
      chips.append(
        el(
          "span",
          `chip chip-${chip.tone}`,
          el("i", "chip-label", chip.label),
          el("b", "chip-value", chip.value)
        )
      );
    }
    routeLine.append(chips);
  }
  function renderSuggestions(snapshot) {
    suggestionRow.replaceChildren();
    if (intentInput.value.trim() || snapshot.capsules.length > 0) return;
    for (const suggestion of snapshot.suggestions) {
      const pill = el("button", "suggestion", suggestion);
      pill.type = "button";
      pill.addEventListener("click", () => {
        intentInput.value = suggestion;
        intentInput.focus();
        requestRoute();
      });
      suggestionRow.append(pill);
    }
  }
  function renderStatus(snapshot) {
    statusRow.replaceChildren();
    const dotTone = !snapshot.online ? "offline" : snapshot.pendingApprovals > 0 ? "attention" : "ok";
    const heartbeat = el("span", `heartbeat heartbeat-${dotTone}`);
    const name = el(
      "span",
      "status-name",
      snapshot.projectName ?? (snapshot.online ? "no project here" : "daemon offline")
    );
    statusRow.append(el("div", "status-left", heartbeat, name));
    const right = el("div", "status-right");
    if (snapshot.online) {
      right.append(el("span", "status-metric", `${snapshot.agentsOnline} agents`));
      if (snapshot.sessionCostUsd !== null) {
        right.append(el("span", "status-metric", `$${snapshot.sessionCostUsd.toFixed(2)}`));
      }
    } else {
      const start = el("button", "status-action", snapshot.connecting ? "starting\u2026" : "start daemon");
      start.type = "button";
      start.disabled = snapshot.connecting;
      start.addEventListener("click", () => post({ type: "startDaemon" }));
      right.append(start);
    }
    statusRow.append(right);
  }
  function stageRail(capsule) {
    const rail = el("div", "rail");
    for (const stage of capsule.stages) {
      const seg = el("span", `seg seg-${stage.status}`);
      seg.title = `${stage.name} \xB7 ${stage.status}`;
      seg.append(el("i", "seg-fill"));
      rail.append(seg);
    }
    return rail;
  }
  function capsuleCard(capsule) {
    const expanded = state.expanded === capsule.id;
    const card = el("article", `capsule tone-${capsule.tone}${expanded ? " is-expanded" : ""}`);
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-expanded", String(expanded));
    const head = el(
      "div",
      "capsule-head",
      el("span", "capsule-title", capsule.title),
      el(
        "span",
        "capsule-state",
        capsule.stateLabel,
        el("i", "capsule-when", relativeTime(capsule.completedAt ?? capsule.createdAt))
      )
    );
    card.append(head, stageRail(capsule));
    const meta = el("div", "capsule-meta");
    const orbs = el("div", "orbs");
    if (capsule.implementer) orbs.append(agentOrb(capsule.implementer, "implementer"));
    if (capsule.reviewer && capsule.reviewer !== capsule.implementer) {
      orbs.append(agentOrb(capsule.reviewer, "reviewer"));
    }
    if (orbs.childElementCount > 0) meta.append(orbs);
    if (capsule.independent) meta.append(el("span", "badge badge-ok", "independent"));
    if (capsule.repairRounds > 0) {
      meta.append(el("span", "badge badge-warn", `repair ${capsule.repairRounds}`));
    }
    if (capsule.branch) meta.append(el("code", "branch", capsule.branch.replace(/^jarvis\//, "")));
    if (meta.childElementCount > 0) card.append(meta);
    if (capsule.failureReason && capsule.tone === "failed") {
      card.append(el("p", "failure", capsule.failureReason.split("\n")[0]));
    }
    if (expanded) card.append(detailBlock(capsule));
    const toggle = () => {
      state.expanded = expanded ? null : capsule.id;
      state.detail = null;
      post({ type: "expand", workflowId: state.expanded });
      renderRiver();
    };
    head.addEventListener("click", toggle);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle();
      } else if (event.key === "Escape" && expanded) {
        event.preventDefault();
        toggle();
      }
    });
    return card;
  }
  function detailBlock(capsule) {
    const block = el("div", "detail");
    const detail = state.detail?.workflowId === capsule.id ? state.detail : null;
    if (!detail || detail.loading) {
      block.append(el("p", "detail-loading", "reading the evidence\u2026"));
      return block;
    }
    block.append(el("p", "detail-line", detail.diffSummary));
    if (detail.files.length > 0) {
      const files = el("ul", "files");
      for (const file of detail.files.slice(0, 8)) {
        files.append(
          el(
            "li",
            `file file-${file.status}`,
            el("span", "file-path", file.path),
            el("span", "file-delta", `+${file.added} \u2212${file.removed}`)
          )
        );
      }
      block.append(files);
    }
    if (detail.chips.length > 0) {
      const chips = el("div", "chips");
      for (const chip of detail.chips) {
        const node = el(
          "span",
          `chip chip-${chip.outcome === "passed" ? "ok" : chip.outcome === "failed" ? "danger" : "neutral"}`,
          el("i", "chip-label", chip.label),
          el("b", "chip-value", chip.detail)
        );
        if (chip.hash) node.title = `sha256 ${chip.hash}\u2026`;
        chips.append(node);
      }
      block.append(chips);
    }
    if (detail.acceptance.length > 0) {
      const list = el("ul", "acceptance");
      for (const criterion of detail.acceptance) {
        list.append(
          el(
            "li",
            `acc acc-${criterion.status.toLowerCase()}`,
            el("span", "acc-text", criterion.criterion)
          )
        );
      }
      block.append(list);
    }
    const actions = el("div", "actions");
    actions.append(
      action("Open diff", "ghost", () => post({ type: "openDiff", workflowId: capsule.id })),
      action(state.ghostOn === capsule.id ? "Hide in editor" : "Show in editor", "ghost", () => {
        const on = state.ghostOn !== capsule.id;
        state.ghostOn = on ? capsule.id : null;
        post({ type: "ghost", workflowId: capsule.id, on });
        renderRiver();
      }),
      action("Evidence", "ghost", () => post({ type: "openEvidence", workflowId: capsule.id }))
    );
    if (capsule.needsDecision) {
      actions.append(
        action("Decide\u2026", "primary", () => {
          post({ type: "openSheet", workflowId: capsule.id });
        })
      );
    } else if (capsule.tone === "running") {
      actions.append(action("Cancel", "danger", () => post({ type: "cancel", workflowId: capsule.id })));
    } else if (capsule.tone === "done") {
      actions.append(
        action("Record", "ghost", () => post({ type: "openSheet", workflowId: capsule.id }))
      );
    }
    block.append(actions);
    if (detail.manifestHash) {
      block.append(el("p", "seal", `sealed ${detail.manifestHash.slice(0, 12)}\u2026`));
    }
    return block;
  }
  function action(label, kind, onClick) {
    const button = el("button", `act act-${kind}`, label);
    button.type = "button";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }
  function renderRiver() {
    river.replaceChildren();
    const snapshot = state.snapshot;
    if (!snapshot) return;
    if (!snapshot.online) {
      river.append(
        emptyState(
          "Jarvis is not listening",
          "The daemon is offline, so there is nothing to watch yet."
        )
      );
      return;
    }
    if (!snapshot.workspaceRegistered) {
      const empty = emptyState(
        "This folder is not a Jarvis project",
        "Register it and the river fills with its work."
      );
      empty.append(action("Register this workspace", "primary", () => post({ type: "register" })));
      river.append(empty);
      return;
    }
    if (snapshot.capsules.length === 0) {
      river.append(
        emptyState("The river is still", "Say what you want above and watch it flow.")
      );
      return;
    }
    for (const capsule of snapshot.capsules) river.append(capsuleCard(capsule));
  }
  function emptyState(title, body) {
    return el(
      "div",
      "empty",
      el("span", "empty-mark", mark(28)),
      el("h2", "empty-title", title),
      el("p", "empty-body", body)
    );
  }
  function renderSheet() {
    sheetHost.replaceChildren();
    const sheet = state.sheet;
    if (!sheet) {
      sheetHost.classList.remove("is-open");
      return;
    }
    sheetHost.classList.add("is-open");
    const panel = el("section", "sheet");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Decision");
    const close = el("button", "sheet-close", "\u2715");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", () => {
      state.sheet = null;
      state.repairing = false;
      post({ type: "openSheet", workflowId: null });
      renderSheet();
    });
    panel.append(
      el("div", "sheet-grip"),
      close,
      el(
        "header",
        "sheet-head",
        el("h2", "sheet-title", sheet.title),
        el("span", `badge badge-${sheet.risk.toLowerCase() === "high" ? "danger" : "neutral"}`, `${sheet.risk} risk`)
      ),
      el("p", "sheet-summary", sheet.summary)
    );
    const facts = el("div", "sheet-facts");
    facts.append(fact("change", sheet.diffSummary));
    facts.append(fact("est. cost", sheet.costLabel));
    if (sheet.branch) facts.append(fact("branch", sheet.branch.replace(/^jarvis\//, "")));
    panel.append(facts);
    const independence = el(
      "div",
      `independence ${sheet.independence.independent ? "is-independent" : "is-single"}`
    );
    if (sheet.independence.implementer) {
      independence.append(agentOrb(sheet.independence.implementer, "implementer"));
    }
    if (sheet.independence.reviewer) {
      independence.append(agentOrb(sheet.independence.reviewer, "reviewer"));
    }
    independence.append(
      el(
        "span",
        "independence-text",
        sheet.independence.independent ? `${sheet.independence.implementer} built \xB7 ${sheet.independence.reviewer} reviewed` : sheet.independence.implementer ? `${sheet.independence.implementer} built and reviewed \u2014 not independent` : "no agent attribution recorded"
      )
    );
    panel.append(independence);
    if (sheet.chips.length > 0) {
      const chips = el("div", "chips");
      for (const chip of sheet.chips) {
        const node = el(
          "span",
          `chip chip-${chip.outcome === "passed" ? "ok" : chip.outcome === "failed" ? "danger" : "neutral"}`,
          el("i", "chip-label", chip.label),
          el("b", "chip-value", chip.detail)
        );
        if (chip.hash) node.title = `sha256 ${chip.hash}\u2026`;
        chips.append(node);
      }
      panel.append(chips);
    }
    if (sheet.files.length > 0) {
      const files = el("ul", "files");
      for (const file of sheet.files.slice(0, 6)) {
        files.append(
          el(
            "li",
            `file file-${file.status}`,
            el("span", "file-path", file.path),
            el("span", "file-delta", `+${file.added} \u2212${file.removed}`)
          )
        );
      }
      panel.append(files);
    }
    const actions = el("div", "sheet-actions");
    if (sheet.resolved) {
      actions.append(el("p", "sheet-note", "Already resolved \u2014 this is the record."));
      actions.append(action("Open diff", "ghost", () => post({ type: "openDiff", workflowId: sheet.workflowId })));
    } else if (state.repairing) {
      const box = el("textarea", "repair-box");
      box.placeholder = "What should Jarvis do differently?";
      box.rows = 3;
      actions.append(box);
      const row = el("div", "sheet-row");
      row.append(
        action("Send repair", "primary", () => {
          const text = box.value.trim();
          if (!text) return;
          post({ type: "repair", workflowId: sheet.workflowId, approvalId: sheet.approvalId, text });
          state.repairing = false;
          renderSheet();
        }),
        action("Back", "ghost", () => {
          state.repairing = false;
          renderSheet();
        })
      );
      actions.append(row);
      setTimeout(() => box.focus(), 0);
    } else {
      actions.append(
        action("Approve", "primary", () => {
          if (sheet.approvalId) post({ type: "decide", approvalId: sheet.approvalId, approved: true });
        }),
        action("Ask for repair", "ghost", () => {
          state.repairing = true;
          renderSheet();
        }),
        action("Deny", "danger", () => {
          if (sheet.approvalId) post({ type: "decide", approvalId: sheet.approvalId, approved: false });
        }),
        action("Open diff", "ghost", () => post({ type: "openDiff", workflowId: sheet.workflowId }))
      );
    }
    panel.append(actions);
    if (sheet.manifestHash) {
      panel.append(el("p", "seal", `evidence sealed ${sheet.manifestHash.slice(0, 12)}\u2026`));
    }
    sheetHost.append(panel);
  }
  function fact(label, value) {
    return el("div", "fact", el("i", "fact-label", label), el("b", "fact-value", value));
  }
  function toast(tone, text) {
    const node = el("div", `toast toast-${tone}`, text);
    toastHost.append(node);
    setTimeout(() => node.classList.add("is-leaving"), 4200);
    setTimeout(() => node.remove(), 4600);
  }
  window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
      case "snapshot": {
        state.snapshot = message.snapshot;
        renderStatus(message.snapshot);
        renderSuggestions(message.snapshot);
        renderRiver();
        break;
      }
      case "route":
        if (message.token !== state.token) return;
        state.routing = false;
        state.preview = message.preview;
        state.previewError = message.error;
        renderRoute();
        break;
      case "detail":
        state.detail = message.detail;
        renderRiver();
        break;
      case "sheet":
        state.sheet = message.sheet;
        state.repairing = false;
        renderSheet();
        break;
      case "busy":
        state.busy = message.busy ? message.message ?? "working\u2026" : null;
        document.body.classList.toggle("is-busy", message.busy);
        break;
      case "seedIntent":
        intentInput.value = message.directive;
        intentInput.focus();
        intentInput.setSelectionRange(intentInput.value.length, intentInput.value.length);
        requestRoute();
        break;
      case "focusIntent":
        intentInput.focus();
        intentInput.select();
        break;
      case "toast":
        toast(message.tone, message.text);
        break;
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.sheet) {
      state.sheet = null;
      post({ type: "openSheet", workflowId: null });
      renderSheet();
    }
  });
  post({ type: "ready" });
})();
//# sourceMappingURL=lens.js.map
