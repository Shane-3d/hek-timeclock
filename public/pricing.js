// Pricing calculator (admin "Pricing" tab). Auto-calculates an estimate from an
// editable rate book, then hands the line items straight to the quote builder.
// Fully self-contained: it renders its own UI into <section id="tab-pricing">
// and wires its own events, so it doesn't depend on admin.js internals.
(function () {
  const section = document.getElementById('tab-pricing');
  if (!section) return; // not on a page with the Pricing tab

  // HEK's services with starting rates (CAD). These are editable defaults —
  // the user tunes them in the rate book and they're saved on the device.
  const SERVICES = [
    { key: 'board', label: 'Board farm fence', unit: 'linear ft', price: 32 },
    { key: 'woven', label: 'Woven wire farm fence', unit: 'linear ft', price: 14 },
    { key: 'tensile', label: 'High tensile wire fence', unit: 'linear ft', price: 9 },
    { key: 'ranch', label: 'Vinyl ranch fence', unit: 'linear ft', price: 28 },
    { key: 'flex', label: 'Flex fence', unit: 'linear ft', price: 12 },
    { key: 'wood', label: 'Wood privacy fence', unit: 'linear ft', price: 45 },
    { key: 'vinylp', label: 'Vinyl privacy fence', unit: 'linear ft', price: 55 },
    { key: 'steel', label: 'Corrugated steel privacy fence', unit: 'linear ft', price: 60 },
    { key: 'hybrid', label: 'Hybrid privacy fence', unit: 'linear ft', price: 50 },
    { key: 'clblack', label: 'Chain-link, black — 9ga+', unit: 'linear ft', price: 28 },
    { key: 'clgalv', label: 'Chain-link, galvanized — 9ga+', unit: 'linear ft', price: 22 },
    { key: 'ornam', label: 'Ornamental wrought-iron fence', unit: 'linear ft', price: 65 },
    { key: 'gate', label: 'Gate', unit: 'each', price: 350 },
    { key: 'postpound', label: 'Post pounding', unit: 'each', price: 35 },
    { key: 'posthole', label: 'Post hole drilling', unit: 'each', price: 45 },
    { key: 'repair', label: 'Fence repair', unit: 'hour', price: 85 },
    { key: 'tearout', label: 'Remove & haul away old fence', unit: 'linear ft', price: 6 },
    { key: 'labor', label: 'Labor', unit: 'hour', price: 65 },
  ];
  const byKey = Object.fromEntries(SERVICES.map((s) => [s.key, s]));

  const RATE_KEY = 'hek-rate-book';
  function loadRates() {
    const rates = {};
    SERVICES.forEach((s) => (rates[s.key] = s.price));
    try {
      Object.assign(rates, JSON.parse(localStorage.getItem(RATE_KEY) || '{}'));
    } catch (e) {}
    return rates;
  }
  function saveRates(rates) {
    try { localStorage.setItem(RATE_KEY, JSON.stringify(rates)); } catch (e) {}
  }
  let rates = loadRates();

  // ---- formatting ----
  const money = (n) =>
    '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (id) => document.getElementById(id);

  const optionsHtml =
    '<option value="">— choose —</option>' +
    SERVICES.map((s) => `<option value="${s.key}">${esc(s.label)}</option>`).join('');

  // ---- render the whole tab ----
  section.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px">
      <h2 style="margin:0">Pricing calculator</h2>
      <button class="btn ghost sm" id="pcRatesBtn">Edit rates</button>
    </div>
    <p class="calc-hint">Pick a fence type and enter the length or quantity — the price fills in
      automatically from your rate book. When it looks right, send it straight to a new quote.</p>

    <div class="card" id="pcRateCard" style="display:none;margin-bottom:16px">
      <h3 style="margin-top:0">Rate book <span class="rate-note">— your prices, saved on this device</span></h3>
      <div class="rate-list" id="pcRateList"></div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div style="overflow-x:auto">
        <table class="calc-table">
          <thead><tr>
            <th style="min-width:200px">Fence type / service</th>
            <th style="width:90px">Qty</th>
            <th style="width:90px">Unit</th>
            <th style="width:130px">Rate</th>
            <th style="width:120px">Line total</th>
            <th style="width:36px"></th>
          </tr></thead>
          <tbody id="pcRows"></tbody>
        </table>
      </div>
      <button class="btn ghost sm" id="pcAdd" style="margin-top:12px">+ Add line</button>
    </div>

    <div class="row" style="align-items:stretch">
      <div class="card" style="flex:1 1 240px">
        <div class="totals-line"><span>Subtotal</span><span id="pcSub">$0.00</span></div>
        <div class="totals-line"><span>Tax <input id="pcTax" class="tax-input" inputmode="decimal" value="13" /> %</span><span id="pcTaxAmt">$0.00</span></div>
        <div class="totals-line grand"><span>Estimated total</span><span id="pcTotal">$0.00</span></div>
      </div>
      <div class="card" style="flex:1 1 240px;display:flex;flex-direction:column;justify-content:center;gap:10px">
        <button class="btn gold sm" id="pcToQuote">Create quote from this →</button>
        <button class="btn ghost sm" id="pcReset">Clear</button>
        <div class="msg" id="pcMsg"></div>
      </div>
    </div>`;

  // ---- rate book ----
  function renderRates() {
    $('pcRateList').innerHTML = SERVICES.map(
      (s) => `<label>${esc(s.label)} <span class="pill">per ${esc(s.unit)}</span></label>
        <input class="rate-in" data-key="${s.key}" inputmode="decimal" value="${rates[s.key]}" />`
    ).join('');
  }
  renderRates();

  $('pcRatesBtn').addEventListener('click', () => {
    const card = $('pcRateCard');
    card.style.display = card.style.display === 'none' ? 'block' : 'none';
  });

  $('pcRateList').addEventListener('input', (e) => {
    const inp = e.target.closest('.rate-in');
    if (!inp) return;
    const key = inp.dataset.key;
    rates[key] = parseFloat(inp.value) || 0;
    saveRates(rates);
    // Refresh any estimate rows that use this service (and weren't overridden).
    [...$('pcRows').querySelectorAll('tr')].forEach((tr) => {
      const sel = tr.querySelector('.p-svc');
      if (sel.value === key && tr.dataset.override !== '1') {
        tr.querySelector('.p-rate').value = rates[key];
      }
    });
    compute();
  });

  // ---- estimate rows ----
  function addRow(preset) {
    preset = preset || {};
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td><select class="p-svc">${optionsHtml}</select></td>` +
      `<td><input class="p-qty" inputmode="decimal" value="${preset.qty != null ? preset.qty : ''}" /></td>` +
      `<td class="p-unit">${preset.unit ? esc(preset.unit) : '—'}</td>` +
      `<td><input class="p-rate" inputmode="decimal" value="${preset.rate != null ? preset.rate : ''}" /></td>` +
      `<td class="p-total">$0.00</td>` +
      `<td><button class="link-btn danger p-del" title="Remove">✕</button></td>`;
    $('pcRows').appendChild(tr);
    if (preset.key) tr.querySelector('.p-svc').value = preset.key;
    compute();
  }

  function compute() {
    let subtotal = 0;
    [...$('pcRows').querySelectorAll('tr')].forEach((tr) => {
      const qty = parseFloat(tr.querySelector('.p-qty').value) || 0;
      const rate = parseFloat(tr.querySelector('.p-rate').value) || 0;
      const line = qty * rate;
      subtotal += line;
      tr.querySelector('.p-total').textContent = money(line);
    });
    const taxRate = parseFloat($('pcTax').value) || 0;
    const tax = (subtotal * taxRate) / 100;
    $('pcSub').textContent = money(subtotal);
    $('pcTaxAmt').textContent = money(tax);
    $('pcTotal').textContent = money(subtotal + tax);
  }

  $('pcRows').addEventListener('change', (e) => {
    const sel = e.target.closest('.p-svc');
    if (!sel) return;
    const tr = sel.closest('tr');
    const svc = byKey[sel.value];
    tr.dataset.override = '0';
    tr.querySelector('.p-unit').textContent = svc ? svc.unit : '—';
    tr.querySelector('.p-rate').value = svc ? rates[svc.key] : '';
    compute();
  });
  $('pcRows').addEventListener('input', (e) => {
    if (e.target.classList.contains('p-rate')) e.target.closest('tr').dataset.override = '1';
    compute();
  });
  $('pcRows').addEventListener('click', (e) => {
    const del = e.target.closest('.p-del');
    if (del) { del.closest('tr').remove(); compute(); }
  });
  $('pcTax').addEventListener('input', compute);
  $('pcAdd').addEventListener('click', () => addRow());

  $('pcReset').addEventListener('click', () => {
    $('pcRows').innerHTML = '';
    $('pcMsg').textContent = '';
    addRow();
  });

  // ---- hand the estimate to the quote builder ----
  $('pcToQuote').addEventListener('click', () => {
    const items = [];
    [...$('pcRows').querySelectorAll('tr')].forEach((tr) => {
      const svc = byKey[tr.querySelector('.p-svc').value];
      const qty = parseFloat(tr.querySelector('.p-qty').value) || 0;
      const rate = parseFloat(tr.querySelector('.p-rate').value) || 0;
      if (!svc || (!qty && !rate)) return;
      items.push({ description: svc.label + ' — supply & install', qty, unit: svc.unit, unit_price: rate });
    });
    $('pcMsg').className = 'msg err';
    if (!items.length) {
      $('pcMsg').textContent = 'Add at least one fence type with a quantity first.';
      return;
    }
    if (window.Quotes && window.Quotes.prefill) {
      window.Quotes.prefill(items, { tax: parseFloat($('pcTax').value) || 0 });
      $('pcMsg').textContent = '';
    } else {
      $('pcMsg').textContent = 'Open the Quotes tab to use this estimate.';
    }
  });

  addRow(); // start with one empty line
  window.Pricing = { load: compute };
})();
