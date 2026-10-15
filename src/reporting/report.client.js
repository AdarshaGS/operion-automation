(function () {
  var R = JSON.parse(document.getElementById("report-data").textContent);
  var app = document.getElementById("app");
  var sanityTests = R.tests.filter(function (t) { return t.layer === "sanity"; });
  var state = { tab: sanityTests.length ? "sanity" : "failures", q: "", status: "all", layer: "all", module: "all" };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function badge(status) { return '<span class="badge ' + esc(status) + '">' + esc(status) + "</span>"; }
  function ms(n) { return n >= 1000 ? (n / 1000).toFixed(1) + " s" : Math.round(n) + " ms"; }
  function json(v) { return v === undefined ? "" : esc(typeof v === "string" ? v : JSON.stringify(v, null, 2)); }
  function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }
  function matches(text) { return !state.q || text.toLowerCase().indexOf(state.q.toLowerCase()) !== -1; }

  var failedTests = R.tests.filter(function (t) { return t.outcome === "failed"; });
  var failedEndpoints = R.endpoints.filter(function (e) { return e.status === "failed"; });
  var failedComponents = R.components.filter(function (c) { return c.status === "failed"; });
  var modules = R.modules.map(function (m) { return m.module; });

  function journeyStats(t) {
    var steps = t.journey || [];
    return { total: steps.length, passed: steps.filter(function (x) { return x.status === "passed"; }).length, failed: steps.filter(function (x) { return x.status === "failed"; })[0] };
  }

  function viewSanity() {
    if (!sanityTests.length) return '<div class="empty">No sanity journey ran. Run <span class="mono">npx playwright test --project=sanity</span>.</div>';
    return sanityTests.map(function (t) {
      var st = journeyStats(t), phase = null, rows = "";
      (t.journey || []).forEach(function (step, i) {
        if (step.phase !== phase) { phase = step.phase; rows += '<div class="row" style="background:var(--surface-2)"><b>' + esc(phase) + "</b></div>"; }
        var label = step.status === "notrun" ? "not run" : step.status;
        rows += '<div class="row">' + '<span class="badge ' + (step.status === "notrun" ? "skipped" : step.status) + '">' + label + '</span><span class="muted small" style="min-width:22px">' + (i + 1) + '.</span><div class="grow">' + esc(step.name) +
          (step.error ? "<pre>" + esc(step.error) + "</pre>" : "") + '</div><span class="muted small">' + (step.status === "notrun" ? "" : ms(step.durationMs)) + "</span></div>";
      });
      var verdict = t.outcome === "passed" ? '<span class="badge passed">PASSED</span>' : '<span class="badge failed">FAILED</span>';
      var head = st.failed ? "Stopped at step: <b>" + esc(st.failed.title) + "</b>" : (t.outcome === "passed" ? "Every step passed." : "All steps passed but the test failed - see error below.");
      return '<div class="card" style="overflow:visible"><div class="body"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' + verdict + "<h2>" + esc(t.title) + '</h2><span class="muted small">' + st.passed + " / " + st.total + " steps passed · " + ms(t.durationMs) + '</span></div><div class="small muted" style="margin:6px 0 10px">' + head + '</div><div class="bar"><span style="width:' + pct(st.passed, st.total) + '%;background:' + (t.outcome === "passed" ? "var(--pass)" : "var(--fail)") + '"></span></div></div>' + rows +
        (t.calls.length ? '<div class="body"><details><summary>API calls made during this journey (' + t.calls.length + ")</summary>" + callsTable(t) + "</details></div>" : "") +
        (t.screenshot ? '<div class="body"><a href="' + esc(t.screenshot) + '" target="_blank"><img class="shot" src="' + esc(t.screenshot) + '" alt="Screenshot at failure"></a></div>' : "") + "</div>";
    }).join("");
  }

  function tiles() {
    var t = R.totals, a = R.byLayer.api, u = R.byLayer.ui, c = R.coverage;
    function tile(n, l, cls) { return '<div class="tile ' + (cls || "") + '"><div class="n">' + n + '</div><div class="l">' + l + "</div></div>"; }
    var sanityTile = "";
    if (sanityTests.length) {
      var okAll = sanityTests.every(function (x) { return x.outcome === "passed"; });
      var st0 = journeyStats(sanityTests[0]);
      sanityTile = tile(okAll ? "PASS" : "FAIL", "sanity journey (" + st0.passed + "/" + st0.total + " steps)", okAll ? "good" : "bad");
    }
    return '<div class="tiles">' + sanityTile +
      tile(t.tests, "tests run") +
      tile(t.passed + t.flaky, "passed", "good") +
      tile(t.failed, "failed", t.failed ? "bad" : "good") +
      tile(failedEndpoints.length + " / " + R.endpoints.length, "API endpoints failing", failedEndpoints.length ? "bad" : "good") +
      tile(failedComponents.length + " / " + R.components.length, "UI components failing", failedComponents.length ? "bad" : "good") +
      tile(c.available ? pct(c.coveredOperations, c.totalOperations) + "%" : "n/a", c.available ? "backend endpoints touched (" + c.coveredOperations + "/" + c.totalOperations + ")" : "endpoint coverage") +
      "</div>";
  }

  function callsTable(t) {
    if (!t.calls.length) return "";
    var rows = t.calls.map(function (c, i) {
      var hit = (t.blamedCall && t.blamedCall.index === i) || c.verdict === "fail";
      return '<tr class="' + (hit ? "hit" : "") + '"><td class="mono">' + esc(c.method) + " " + esc(c.template) + "</td><td>" + c.status + "</td><td>" + esc(c.actor) + "</td><td>" + esc(c.verdict) + "</td><td>" + ms(c.durationMs) + "</td></tr>";
    }).join("");
    var blamed = t.blamedCall && t.calls[t.blamedCall.index];
    var detail = blamed ? "<details><summary>Request / response of the failing call</summary><pre>" + esc(blamed.method + " " + blamed.url) + "\n\nrequest:\n" + json(blamed.requestBody) + "\n\nresponse (" + blamed.status + "):\n" + json(blamed.responseBody) + "</pre></details>" : "";
    return '<table><thead><tr><th>Call</th><th>Status</th><th>As</th><th>Verdict</th><th>Time</th></tr></thead><tbody>' + rows + "</tbody></table>" + detail;
  }

  function actionsList(t) {
    if (!t.actions.length) return "";
    return '<div style="margin-top:8px">' + t.actions.map(function (a) {
      return '<div class="small"><span class="badge ' + a.status + '">' + a.status + '</span> <span class="mono">' + esc(a.component + "." + a.action) + "</span>" + (a.error ? ' <span class="muted">- ' + esc(a.error) + "</span>" : "") + "</div>";
    }).join("") + "</div>";
  }

  function testCard(t, open) {
    var head = t.layer === "api" && t.blamedCall
      ? '<span class="method">' + esc(t.blamedCall.method) + '</span><span class="mono">' + esc(t.blamedCall.template) + "</span>"
      : "";
    var body = "";
    if (t.error) body += "<pre>" + esc(t.error.message.split("\n").slice(0, 14).join("\n")) + "</pre>";
    if (t.blamedCall) body += '<div class="small muted">Blamed: <span class="pill">' + esc(t.blamedCall.method + " " + t.blamedCall.template) + "</span> returned " + t.blamedCall.status + " - " + esc(t.blamedCall.reason) + "</div>";
    body += callsTable(t) + actionsList(t);
    if (t.uiFailedRequests.length) body += '<div class="small" style="margin-top:8px"><b>Failed backend calls during this UI flow</b><pre>' + esc(t.uiFailedRequests.join("\n")) + "</pre></div>";
    if (t.uiConsoleErrors.length) body += '<div class="small"><b>Browser console errors</b><pre>' + esc(t.uiConsoleErrors.join("\n")) + "</pre></div>";
    if (t.screenshot) body += '<a href="' + esc(t.screenshot) + '" target="_blank"><img class="shot" src="' + esc(t.screenshot) + '" alt="Screenshot at failure"></a>';
    if (t.trace) body += '<div class="small muted" style="margin-top:8px">Trace: <span class="mono">npx playwright show-trace ' + esc(t.trace) + "</span></div>";
    return '<details class="card"' + (open ? " open" : "") + "><summary>" + badge(t.outcome) + '<span class="badge unverified">' + esc(t.layer.toUpperCase()) + "</span>" + head +
      '<span class="grow">' + esc(t.title) + '</span><span class="muted small">' + esc(t.module) + " · " + ms(t.durationMs) + "</span></summary>" +
      '<div class="body"><div class="small muted">' + esc(t.file) + (t.group ? " › " + esc(t.group) : "") + "</div>" + body + "</div></details>";
  }

  function viewFailures() {
    var list = failedTests.filter(function (t) { return (state.layer === "all" || t.layer === state.layer) && (state.module === "all" || t.module === state.module) && matches(t.title + t.file + (t.error ? t.error.message : "")); });
    var flaky = R.tests.filter(function (t) { return t.outcome === "flaky"; });
    var out = "";
    if (!failedTests.length) out += '<div class="ok-banner">No failing tests in this run.</div>';
    ["sanity", "api", "ui"].forEach(function (layer) {
      var items = list.filter(function (t) { return t.layer === layer; });
      if (!items.length) return;
      out += "<h2 style=\"margin:14px 0 8px\">" + (layer === "api" ? "API failures" : layer === "ui" ? "UI failures" : "Sanity journey failures") + " (" + items.length + ")</h2>" + items.map(function (t) { return testCard(t, items.length <= 3); }).join("");
    });
    if (flaky.length) out += '<h2 style="margin:14px 0 8px">Flaky (passed on retry)</h2>' + flaky.map(function (t) { return testCard(t, false); }).join("");
    return out;
  }

  function groupBy(items, key) { var m = {}; items.forEach(function (i) { (m[i[key]] = m[i[key]] || []).push(i); }); return m; }

  function viewEndpoints() {
    var items = R.endpoints.filter(function (e) { return (state.status === "all" || e.status === state.status) && (state.module === "all" || e.module === state.module) && matches(e.method + " " + e.path); });
    if (!items.length) return '<div class="empty">No endpoints match.</div>';
    var groups = groupBy(items, "module");
    return Object.keys(groups).sort().map(function (m) {
      var g = groups[m], bad = g.filter(function (e) { return e.status === "failed"; }).length;
      var rows = g.map(function (e) {
        var fails = e.failures.length ? "<details class=\"small\" style=\"margin-top:4px\"><summary>" + e.failures.length + " failing check(s)</summary>" + e.failures.map(function (f) { return '<div class="small"><span class="pill">' + f.status + "</span> " + esc(f.testTitle) + '<div class="muted">' + esc(f.reason) + "</div></div>"; }).join("") + "</details>" : "";
        return '<div class="row">' + badge(e.status) + '<span class="method">' + esc(e.method) + '</span><div class="grow"><span class="mono">' + esc(e.path) + "</span>" + fails + '</div><span class="muted small">' + e.calls + " calls · seen " + e.statusesSeen.join(", ") + " · " + e.passedChecks + " ok / " + e.failedChecks + " failed</span></div>";
      }).join("");
      return '<details class="group" ' + (bad ? "open" : "") + "><summary><span class=\"grow\">" + esc(m) + '</span><span class="muted small">' + g.length + " endpoints</span>" + (bad ? '<span class="badge failed">' + bad + " failing</span>" : '<span class="badge passed">all ok</span>') + '</summary><div class="inner">' + rows + "</div></details>";
    }).join("");
  }

  function viewComponents() {
    var items = R.components.filter(function (c) { return (state.status === "all" || c.status === state.status) && (state.module === "all" || c.module === state.module) && matches(c.name + c.module); });
    if (!R.components.length) return '<div class="empty">No page-object actions were recorded. UI specs must use the page fixtures from <span class="mono">src/ui/fixtures.ts</span> so each action is reported.</div>';
    if (!items.length) return '<div class="empty">No components match.</div>';
    var groups = groupBy(items, "module");
    return Object.keys(groups).sort().map(function (m) {
      var g = groups[m], bad = g.filter(function (c) { return c.status === "failed"; }).length;
      var rows = g.map(function (c) {
        var acts = c.actions.map(function (a) { return '<span class="badge ' + a.status + '" title="' + a.runs + " run(s), " + a.failures + ' failure(s)">' + esc(a.action) + "</span>"; }).join(" ");
        var fails = c.failures.length ? "<details class=\"small\" style=\"margin-top:4px\"><summary>" + c.failures.length + " failure(s)</summary>" + c.failures.map(function (f) { return '<div class="small"><span class="pill">' + esc(f.action) + "</span> " + esc(f.testTitle) + '<div class="muted">' + esc(f.error) + "</div></div>"; }).join("") + "</details>" : "";
        return '<div class="row">' + badge(c.status) + '<div class="grow"><b>' + esc(c.name) + '</b><div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">' + acts + "</div>" + fails + "</div></div>";
      }).join("");
      return '<details class="group" open><summary><span class="grow">' + esc(m) + '</span><span class="muted small">' + g.length + (g.length === 1 ? " component" : " components") + "</span>" + (bad ? '<span class="badge failed">' + bad + " failing</span>" : '<span class="badge passed">all ok</span>') + '</summary><div class="inner">' + rows + "</div></details>";
    }).join("");
  }

  function viewTests() {
    var items = R.tests.filter(function (t) { return (state.status === "all" || t.outcome === state.status) && (state.layer === "all" || t.layer === state.layer) && (state.module === "all" || t.module === state.module) && matches(t.title + t.file + t.group); });
    if (!items.length) return '<div class="empty">No tests match.</div>';
    return '<div class="card"><table><thead><tr><th>Result</th><th>Layer</th><th>Module</th><th>Test</th><th>Time</th></tr></thead><tbody>' + items.map(function (t) {
      return "<tr><td>" + badge(t.outcome) + "</td><td>" + esc(t.layer) + "</td><td>" + esc(t.module) + "</td><td>" + esc(t.group ? t.group + " › " : "") + esc(t.title) + "</td><td>" + ms(t.durationMs) + "</td></tr>";
    }).join("") + "</tbody></table></div>";
  }

  function viewCoverage() {
    var c = R.coverage;
    var summary = '<div class="card"><div class="body"><h2>Per module</h2><table><thead><tr><th>Module</th><th>API tests</th><th>UI tests</th><th>Endpoints exercised</th><th>Endpoints failing</th><th>UI components</th><th>Components failing</th></tr></thead><tbody>' +
      R.modules.map(function (m) {
        return "<tr><td>" + esc(m.module) + "</td><td>" + m.api.passed + "/" + m.api.total + "</td><td>" + m.ui.passed + "/" + m.ui.total + "</td><td>" + m.endpoints.total + "</td><td>" + (m.endpoints.failed ? '<span class="badge failed">' + m.endpoints.failed + "</span>" : "0") + "</td><td>" + m.components.total + "</td><td>" + (m.components.failed ? '<span class="badge failed">' + m.components.failed + "</span>" : "0") + "</td></tr>";
      }).join("") + "</tbody></table></div></div>";
    if (!c.available) return summary + '<div class="empty">' + esc(c.note || "Endpoint inventory unavailable.") + "</div>";
    var gaps = c.gaps.filter(function (g) { return (state.module === "all" || g.module === state.module) && matches(g.method + " " + g.path); });
    var groups = groupBy(gaps, "module");
    var list = Object.keys(groups).sort().map(function (m) {
      return '<details class="group"><summary><span class="grow">' + esc(m) + '</span><span class="badge unverified">' + groups[m].length + " untouched</span></summary><div class=\"inner\">" +
        groups[m].map(function (g) { return '<div class="row"><span class="method">' + esc(g.method) + '</span><span class="mono grow">' + esc(g.path) + "</span></div>"; }).join("") + "</div></details>";
    }).join("");
    return summary + '<div class="card"><div class="body"><h2>Backend coverage</h2><div class="bar"><span style="width:' + pct(c.coveredOperations, c.totalOperations) + '%"></span></div><div class="small muted">' + c.coveredOperations + " of " + c.totalOperations + " operations in the live OpenAPI document were called by at least one test. Untouched endpoints are listed below.</div></div></div>" + (list || '<div class="empty">No untouched endpoints match.</div>');
  }

  var TABS = [
    { id: "sanity", label: "Sanity journey", count: sanityTests.length, badCount: sanityTests.filter(function (t) { return t.outcome !== "passed"; }).length, view: viewSanity, filters: [] },
    { id: "failures", label: "Failures", count: failedTests.length, bad: true, view: viewFailures, filters: ["layer", "module"] },
    { id: "endpoints", label: "API endpoints", count: R.endpoints.length, badCount: failedEndpoints.length, view: viewEndpoints, filters: ["status", "module"] },
    { id: "components", label: "UI components", count: R.components.length, badCount: failedComponents.length, view: viewComponents, filters: ["status", "module"] },
    { id: "tests", label: "All tests", count: R.tests.length, view: viewTests, filters: ["status", "layer", "module"] },
    { id: "coverage", label: "Coverage", view: viewCoverage, filters: ["module"] }
  ];

  function toolbar(tab) {
    var out = '<div class="toolbar"><input id="q" type="search" placeholder="Filter..." value="' + esc(state.q) + '">';
    if (tab.filters.indexOf("status") !== -1) {
      var opts = tab.id === "tests" ? ["all", "passed", "failed", "flaky", "skipped"] : tab.id === "endpoints" ? ["all", "failed", "passed", "unverified"] : ["all", "failed", "affected", "passed"];
      out += '<select id="status">' + opts.map(function (o) { return '<option value="' + o + '"' + (state.status === o ? " selected" : "") + ">" + (o === "all" ? "All statuses" : o) + "</option>"; }).join("") + "</select>";
    }
    if (tab.filters.indexOf("layer") !== -1) out += '<select id="layer">' + ["all", "sanity", "api", "ui"].map(function (o) { return '<option value="' + o + '"' + (state.layer === o ? " selected" : "") + ">" + (o === "all" ? "All layers" : o.toUpperCase()) + "</option>"; }).join("") + "</select>";
    if (tab.filters.indexOf("module") !== -1) out += '<select id="module"><option value="all">All modules</option>' + modules.map(function (m) { return '<option value="' + esc(m) + '"' + (state.module === m ? " selected" : "") + ">" + esc(m) + "</option>"; }).join("") + "</select>";
    return out + "</div>";
  }

  function render() {
    var tab = TABS.filter(function (t) { return t.id === state.tab; })[0];
    var dt = new Date(R.generatedAt);
    app.innerHTML =
      '<div class="top"><div><h1>Operion automation report</h1><div class="sub">' + esc(dt.toLocaleString()) + " · " + ms(R.durationMs) + " · API " + esc(R.targets.api) + " · UI " + esc(R.targets.ui) + '</div></div><button class="btn" id="theme">Toggle theme</button></div>' +
      tiles() +
      '<div class="tabs" role="tablist">' + TABS.map(function (t) {
        var bad = t.bad ? t.count : t.badCount;
        return '<button class="tab" role="tab" data-tab="' + t.id + '" aria-selected="' + (t.id === state.tab) + '">' + t.label + (t.count != null ? '<span class="count' + (bad ? " bad" : "") + '">' + (t.bad ? t.count : (bad ? bad + " / " : "") + t.count) + "</span>" : "") + "</button>";
      }).join("") + "</div>" +
      toolbar(tab) + "<div id='view'>" + tab.view() + "</div>";

    Array.prototype.forEach.call(app.querySelectorAll(".tab"), function (b) { b.onclick = function () { state.tab = b.getAttribute("data-tab"); state.status = "all"; render(); }; });
    var q = document.getElementById("q");
    q.oninput = function () { state.q = q.value; document.getElementById("view").innerHTML = tab.view(); };
    ["status", "layer", "module"].forEach(function (k) { var el = document.getElementById(k); if (el) el.onchange = function () { state[k] = el.value; render(); }; });
    document.getElementById("theme").onclick = function () {
      var root = document.documentElement, dark = getComputedStyle(root).getPropertyValue("--bg").trim() === "#14171b";
      root.setAttribute("data-theme", dark ? "light" : "dark");
    };
  }
  render();
})();
