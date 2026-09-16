(function () {
  "use strict";

  const MAX_RESULTS = 150;

  const state = {
    discount: null,  // string, e.g. "40" or "50-10" (chained trade discount), or null
    mult: null,      // number 0-1, or null
    quote: [],       // {recordId, qty, value} — value is a single string: "40", "50-10", or "0.425"
  };

  const $ = (sel) => document.querySelector(sel);
  const $all = (sel) => Array.from(document.querySelectorAll(sel));
  const fmt = (n) => (n == null || isNaN(n)) ? "—" : "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ---------- header / meta ----------
  $("#sourceLine").innerHTML =
    `<b>${CAMDEN_META.record_count.toLocaleString()}</b> line items from <b>${CAMDEN_META.source_xls}</b> ("${CAMDEN_META.source_xls_sheet}") · page citations cross-referenced against <b>${CAMDEN_META.source_pdf}</b> (${CAMDEN_META.pdf_pages} pages) · generated ${CAMDEN_META.generated}`;
  $("#footSource").textContent = `${CAMDEN_META.source_xls} and ${CAMDEN_META.source_pdf}.`;

  // ---------- tabs ----------
  $all(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      $all(".tab-btn").forEach(b => b.classList.remove("active"));
      $all(".panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      $("#" + btn.dataset.panel).classList.add("active");
    });
  });

  // ---------- default discount controls ----------
  const discountInput = $("#customPctInput");
  const multInput = $("#customMultInput");

  // Applies the top default discount/multiplier to every existing quote line, not just new ones.
  function applyDefaultToAllRows() {
    const v = currentDefaultValue();
    if (v == null || state.quote.length === 0) return;
    state.quote.forEach(line => { line.value = v; });
    renderQuote();
  }

  discountInput.addEventListener("input", () => {
    const v = discountInput.value.trim();
    if (v !== "") {
      state.discount = v;
      state.mult = null;
      multInput.value = "";
    } else {
      state.discount = null;
    }
    runSearch();
    applyDefaultToAllRows();
  });

  multInput.addEventListener("input", () => {
    const v = parseFloat(multInput.value);
    if (!isNaN(v) && v >= 0 && v <= 1) {
      state.mult = v;
      state.discount = null;
      discountInput.value = "";
    } else {
      state.mult = null;
    }
    runSearch();
    applyDefaultToAllRows();
  });

  // ---------- pricing helpers ----------
  // Chained trade discount: "50-10" = 50% off, then another 10% off the remainder
  // (a compound 55% discount, multiplier 0.9 * 0.5 = 0.45). A plain "40" is just 40% off.
  function chainMultiplier(discount) {
    if (discount == null) return null;
    const parts = String(discount).split("-").map(s => s.trim()).filter(s => s !== "");
    if (!parts.length) return null;
    let mult = 1;
    for (const p of parts) {
      const n = parseFloat(p);
      if (isNaN(n) || n < 0 || n > 100) return null;
      mult *= (1 - n / 100);
    }
    return mult;
  }

  // Accepts either a chained/plain discount ("40", "50-10") or a straight net multiplier ("0.425")
  // in one field: a value that parses to (0, 1] is treated as a multiplier, anything else
  // (has a dash, or is a whole percentage like "40") is treated as a discount.
  function valueToMultiplier(value) {
    if (value == null) return null;
    const s = String(value).trim();
    if (s === "") return null;
    if (s.includes("-")) return chainMultiplier(s);
    const n = parseFloat(s);
    if (isNaN(n)) return null;
    if (n > 0 && n <= 1) return n;
    return chainMultiplier(s);
  }

  function netFor(list, value) {
    const m = valueToMultiplier(value);
    return m != null ? Math.round(list * m * 100) / 100 : null;
  }

  function currentDefaultValue() {
    if (state.mult != null) return String(state.mult);
    if (state.discount != null) return state.discount;
    return null;
  }

  function pageHintHTML(record) {
    const pageBadge = record.page != null ? `<span class="page-hint found">Catalog p.${record.page}</span>` : "";
    const pdfBadge = record.pdfSourced ? `<span class="page-hint missing">Price from R6 PDF — not in R2.xls</span>` : "";
    return pageBadge + pdfBadge;
  }

  // ---------- search ----------
  const searchInput = $("#searchInput");
  searchInput.addEventListener("input", runSearch);

  // strip everything but letters/digits so "CX-33", "cx33", and "cx 33" all normalize the same way
  const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  CAMDEN_DATA.forEach(r => { r.partNorm = normalize(r.part); });

  function matches(record, q) {
    if (!q) return true;
    return record.partNorm.includes(normalize(q));
  }

  function runSearch() {
    const q = searchInput.value.trim().toLowerCase();
    let list = CAMDEN_DATA;
    if (q) list = list.filter(r => matches(r, q));

    const meta = $("#resultsMeta");
    const results = $("#results");

    if (!q) {
      meta.textContent = `Type a part number or partial part number to search ${CAMDEN_DATA.length.toLocaleString()} line items.`;
      results.innerHTML = "";
      return;
    }

    const total = list.length;
    const shown = list.slice(0, MAX_RESULTS);
    meta.textContent = total > MAX_RESULTS
      ? `Showing first ${MAX_RESULTS} of ${total.toLocaleString()} matches — refine your search.`
      : `${total.toLocaleString()} match${total === 1 ? "" : "es"}.`;

    results.innerHTML = shown.map(r => cardHTML(r)).join("");

    $all(".add-to-quote-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = parseInt(btn.dataset.id, 10);
        const qtyInput = document.querySelector(`.qty-input[data-id="${id}"]`);
        const qty = Math.max(1, parseInt(qtyInput.value, 10) || 1);
        addToQuote(id, qty);
      });
    });
  }

  function cardHTML(r) {
    const net = netFor(r.list, currentDefaultValue());
    const netLabel = state.mult != null ? `Net (×${state.mult})` : (state.discount != null ? `Net (${state.discount} off)` : "Net");
    return `
    <div class="card">
      <div class="card-head">
        <span class="part-no">${escapeHTML(r.part)}</span>
        ${r.upc ? `<span class="section-pill">UPC ${escapeHTML(r.upc)}</span>` : ""}
      </div>
      <div class="card-body">
        <div class="desc">
          ${escapeHTML(r.desc || "(no description)")}
        </div>
        <div class="price-grid">
          <div class="price-col">
            <div class="plabel">List</div>
            <div class="pval">${fmt(r.list)}</div>
          </div>
          <div class="price-col net">
            <div class="plabel">${netLabel}</div>
            <div class="pval">${net != null ? fmt(net) : "—"}</div>
          </div>
        </div>
        <div class="add-controls">
          ${pageHintHTML(r)}
          <input type="number" class="qty-input" data-id="${r.id}" value="1" min="1">
          <button class="btn small add-to-quote-btn" data-id="${r.id}">Add to Quote</button>
        </div>
      </div>
    </div>`;
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- quote ----------
  function addToQuote(recordId, qty) {
    state.quote.push({ recordId, qty, value: currentDefaultValue() });
    renderQuote();
    showToast("Added to quote");
    $all(".tab-btn").forEach(b => b.classList.remove("active"));
    $all(".panel").forEach(p => p.classList.remove("active"));
    document.querySelector('.tab-btn[data-panel="panel-quote"]').classList.add("active");
    $("#panel-quote").classList.add("active");
  }

  function discountControlsHTML(line, idx) {
    const val = line.value != null ? escapeHTML(line.value) : "";
    return `<input type="text" class="qb-value-input" data-idx="${idx}" value="${val}" placeholder="40, 50-10, or .45" style="width:110px;">`;
  }

  function renderQuote() {
    const body = $("#quoteBody");
    const empty = $("#quoteEmpty");
    const wrap = $("#quoteTableWrap");

    if (state.quote.length === 0) {
      empty.style.display = "block";
      wrap.style.display = "none";
      updateTotals();
      return;
    }
    empty.style.display = "none";
    wrap.style.display = "block";

    body.innerHTML = state.quote.map((line, idx) => {
      const r = CAMDEN_DATA[line.recordId];
      const net = netFor(r.list, line.value);
      const ext = net != null ? net * line.qty : null;
      return `<tr data-row="${idx}">
        <td>${idx + 1}</td>
        <td><input type="number" class="qb-qty" data-idx="${idx}" value="${line.qty}" min="1"></td>
        <td class="part-no">${escapeHTML(r.part)}${r.pdfSourced ? ' <span class="page-hint missing" title="Price from R6 PDF — not in R2.xls">PDF</span>' : ""}</td>
        <td>${escapeHTML(r.desc)}</td>
        <td class="num">${fmt(r.list)}</td>
        <td>${discountControlsHTML(line, idx)}</td>
        <td class="num qb-net-cell">${net != null ? fmt(net) : "—"}</td>
        <td class="num qb-ext-cell">${ext != null ? fmt(ext) : "—"}</td>
        <td><button class="btn danger small qb-remove" data-idx="${idx}">✕</button></td>
      </tr>`;
    }).join("");

    $all(".qb-qty").forEach(inp => inp.addEventListener("input", (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      state.quote[idx].qty = Math.max(1, parseInt(e.target.value, 10) || 1);
      updateRowCells(idx);
    }));
    $all(".qb-value-input").forEach(inp => inp.addEventListener("input", (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      state.quote[idx].value = e.target.value;
      updateRowCells(idx);
    }));
    $all(".qb-remove").forEach(btn => btn.addEventListener("click", (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      state.quote.splice(idx, 1);
      renderQuote();
    }));

    updateTotals();
  }

  function updateRowCells(idx) {
    const line = state.quote[idx];
    const r = CAMDEN_DATA[line.recordId];
    const net = netFor(r.list, line.value);
    const ext = net != null ? net * line.qty : null;
    const row = document.querySelector(`tr[data-row="${idx}"]`);
    if (row) {
      row.querySelector(".qb-net-cell").textContent = net != null ? fmt(net) : "—";
      row.querySelector(".qb-ext-cell").textContent = ext != null ? fmt(ext) : "—";
    }
    updateTotals();
  }

  function updateTotals() {
    let listTot = 0, netTot = 0;
    state.quote.forEach(line => {
      const r = CAMDEN_DATA[line.recordId];
      const net = netFor(r.list, line.value);
      listTot += r.list * line.qty;
      netTot += (net != null ? net : r.list) * line.qty;
    });
    $("#totListVal").textContent = fmt(listTot);
    $("#totNetVal").textContent = fmt(netTot);
  }

  $("#clearQuoteBtn").addEventListener("click", () => {
    if (state.quote.length && !confirm("Clear all quote lines?")) return;
    state.quote = [];
    renderQuote();
  });

  $("#printQuoteBtn").addEventListener("click", () => window.print());

  $("#xlsxQuoteBtn").addEventListener("click", () => {
    const rows = [["Qty", "Part", "Description", "List", "Discount", "Net Unit", "Ext. Net"]];
    state.quote.forEach(line => {
      const r = CAMDEN_DATA[line.recordId];
      const net = netFor(r.list, line.value);
      const discLabel = line.value || "List";
      rows.push([line.qty, r.part, r.desc, r.list, discLabel, net != null ? net : "", net != null ? net * line.qty : ""]);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 6 }, { wch: 18 }, { wch: 45 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Quote");
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `camden-quote-${stamp}.xlsx`);
    showToast("Quote downloaded as Excel");
  });

  function showToast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 1800);
  }

  // ---------- cross reference (generic: strikes, mag locks, ...) ----------
  const partToId = {};
  CAMDEN_DATA.forEach(r => { partToId[r.part] = r.id; });

  function xrefFieldHasValue(v) {
    return v && v !== "N/A";
  }

  function initXrefModule(cfg) {
    // cfg: { data, brands, hasNotes, idPrefix }
    const searchInput = $(`#${cfg.idPrefix}SearchInput`);
    const resultsMeta = $(`#${cfg.idPrefix}ResultsMeta`);
    const results = $(`#${cfg.idPrefix}Results`);
    const tableBody = $(`#${cfg.idPrefix}TableBody`);

    function rowMatches(row, nq) {
      if (!nq) return true;
      if (row.camden.some(c => normalize(c).includes(nq))) return true;
      return cfg.brands.some(b => xrefFieldHasValue(row[b.key]) && normalize(row[b.key]).includes(nq));
    }

    function camdenListHTML(row) {
      return row.camden.map(part => {
        const id = partToId[part];
        if (id == null) return `<div class="xref-camden-item"><span class="part-no">${escapeHTML(part)}</span></div>`;
        const rec = CAMDEN_DATA[id];
        return `<div class="xref-camden-item">
          <span class="part-no">${escapeHTML(part)}</span>
          <span class="pval" style="font-family:var(--mono);font-size:0.85rem;">${fmt(rec.list)}</span>
          <button class="btn small add-to-quote-btn" data-id="${id}">Add to Quote</button>
        </div>`;
      }).join("");
    }

    function gridHTML(row, nq) {
      return cfg.brands.map(b => {
        const v = row[b.key];
        const has = xrefFieldHasValue(v);
        const matched = nq && has && normalize(v).includes(nq);
        return `<div class="xg-item${matched ? " matched" : ""}">
          <div class="xg-label">${b.label}</div>
          <div class="xg-val${has ? "" : " na"}">${escapeHTML(v || "N/A")}</div>
        </div>`;
      }).join("");
    }

    function cardHTML(row, nq) {
      return `
      <div class="xref-card">
        <div class="xref-head">
          <span class="xref-desc">${escapeHTML(row.description)}</span>
        </div>
        <div class="xref-camden-list">${camdenListHTML(row)}</div>
        <div class="xref-grid">${gridHTML(row, nq)}</div>
        ${cfg.hasNotes ? `<div class="xref-notes">${escapeHTML(row.notes)}</div>` : ""}
      </div>`;
    }

    function runSearch() {
      const q = searchInput.value.trim();
      const nq = normalize(q);

      if (!q) {
        resultsMeta.textContent = `Type a competitor or Camden part number to search ${cfg.data.length} cross-reference entries.`;
        results.innerHTML = "";
        return;
      }

      const matches = cfg.data.filter(row => rowMatches(row, nq));
      resultsMeta.textContent = `${matches.length} match${matches.length === 1 ? "" : "es"}.`;
      results.innerHTML = matches.map(row => cardHTML(row, nq)).join("");

      $all(`#${cfg.idPrefix}Results .add-to-quote-btn`).forEach(btn => {
        btn.addEventListener("click", () => addToQuote(parseInt(btn.dataset.id, 10), 1));
      });
    }

    searchInput.addEventListener("input", runSearch);

    function tableRowHTML(row) {
      const cell = (v) => xrefFieldHasValue(v) ? `<td class="mono">${escapeHTML(v)}</td>` : `<td class="na">N/A</td>`;
      return `<tr>
        <td>${escapeHTML(row.description)}</td>
        <td class="mono">${row.camden.map(escapeHTML).join("<br>")}</td>
        ${cfg.brands.map(b => cell(row[b.key])).join("")}
        ${cfg.hasNotes ? `<td>${escapeHTML(row.notes)}</td>` : ""}
      </tr>`;
    }

    tableBody.innerHTML = cfg.data.map(tableRowHTML).join("");
  }

  initXrefModule({
    idPrefix: "xref",
    data: CAMDEN_XREF,
    hasNotes: true,
    brands: [
      { key: "rci", label: "RCI (dormakaba)" },
      { key: "hes", label: "H.E.S." },
      { key: "adamsRite", label: "Adams Rite" },
      { key: "trine", label: "Trine" },
      { key: "vonDuprin", label: "Von Duprin" },
      { key: "locknetics", label: "Locknetics" },
    ],
  });

  initXrefModule({
    idPrefix: "maglockXref",
    data: CAMDEN_MAGLOCK_XREF,
    hasNotes: false,
    brands: [
      { key: "rci", label: "RCI" },
      { key: "securitron", label: "Securitron" },
      { key: "schlage", label: "Schlage" },
      { key: "sdc", label: "SDC" },
      { key: "dynalock", label: "Dynalock" },
      { key: "rofu", label: "Rofu" },
      { key: "alarmControls", label: "Alarm Controls" },
    ],
  });

  // ---------- column switch comparison (feature/spec tables, not a part-number lookup) ----------
  function colswitchSectionHTML(section) {
    const rows = section.rows.map(row => `
      <tr>
        <td>${escapeHTML(row[0])}</td>
        <td class="camden-col">${escapeHTML(row[1])}</td>
        ${row.slice(2).map(v => `<td>${escapeHTML(v)}</td>`).join("")}
      </tr>`).join("");
    return `
    <h3 class="xref-table-title">${escapeHTML(section.title)}</h3>
    ${section.intro ? `<div class="xref-intro">${escapeHTML(section.intro)}</div>` : ""}
    <div style="overflow-x:auto;">
      <table class="xref-table">
        <thead><tr>${section.columns.map(c => `<th>${escapeHTML(c)}</th>`).join("")}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${section.note ? `<div class="xref-notes" style="margin:10px 0 4px;">${escapeHTML(section.note)}</div>` : ""}`;
  }

  const colswitchNotesHTML = `
    <h3 class="xref-table-title">Notes for Quoting</h3>
    <ul class="colswitch-notes">
      ${CAMDEN_COLSWITCH_NOTES.map(n => `<li>${escapeHTML(n)}</li>`).join("")}
    </ul>`;

  $("#colswitchSections").innerHTML = CAMDEN_COLSWITCH_SECTIONS.map(colswitchSectionHTML).join("") + colswitchNotesHTML;

  // initial
  renderQuote();
})();
