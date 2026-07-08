// Employee clock-in page logic.
(function () {
  let pin = '';
  let current = null; // { id, name, clockedIn, since, missed }

  const $ = (id) => document.getElementById(id);
  const dotsEl = $('dots');
  const keypadEl = $('keypad');
  const pinMsg = $('pinMsg');
  const pinView = $('pinView');
  const actionView = $('actionView');
  const missedView = $('missedView');
  const empName = $('empName');
  const empStatus = $('empStatus');
  const actionBtn = $('actionBtn');
  const actionMsg = $('actionMsg');
  const workWrap = $('workWrap');
  const workDone = $('workDone');
  const cotNow = $('cotNow');
  const cotOther = $('cotOther');
  const cotNowLabel = $('cotNowLabel');
  const cotOtherLabel = $('cotOtherLabel');
  const customOut = $('customOut');

  // datetime-local value (local time) reflecting "now", used for defaults/max.
  function localNowInput() {
    const d = new Date();
    return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  // Toggle the custom time picker + highlight the selected big button.
  function syncCotUI() {
    cotNowLabel.classList.toggle('active', cotNow.checked);
    cotOtherLabel.classList.toggle('active', cotOther.checked);
    if (cotOther.checked) {
      customOut.style.display = 'block';
      if (!customOut.value) customOut.value = localNowInput();
    } else {
      customOut.style.display = 'none';
    }
  }
  cotNow.addEventListener('change', syncCotUI);
  cotOther.addEventListener('change', syncCotUI);

  // Live clock in the header.
  function tick() {
    const now = new Date();
    $('clock').textContent = now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    $('date').textContent = now.toLocaleDateString([], {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }
  tick();
  setInterval(tick, 1000);

  function renderDots() {
    dotsEl.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const d = document.createElement('div');
      d.className = 'pin-dot' + (i < pin.length ? ' filled' : '');
      dotsEl.appendChild(d);
    }
  }

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];
  keys.forEach((k) => {
    const b = document.createElement('div');
    b.className = 'key';
    b.textContent = k;
    b.addEventListener('click', () => press(k));
    keypadEl.appendChild(b);
  });

  function press(k) {
    pinMsg.textContent = '';
    if (k === 'C') pin = '';
    else if (k === '⌫') pin = pin.slice(0, -1);
    else if (pin.length < 4) pin += k;
    renderDots();
    if (pin.length === 4) lookup();
  }

  document.addEventListener('keydown', (e) => {
    if (pinView.style.display === 'none') return;
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('⌫');
  });

  async function api(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  const fmtTime = (iso) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const fmtDay = (iso) =>
    new Date(iso).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  async function lookup() {
    try {
      current = await api('/api/status', { pin });
      if (current.missed) showMissed();
      else showAction();
    } catch (err) {
      pinMsg.className = 'msg err';
      pinMsg.textContent = err.message;
      pin = '';
      renderDots();
    }
  }

  function hideAll() {
    pinView.style.display = 'none';
    actionView.style.display = 'none';
    missedView.style.display = 'none';
  }

  // ---- Normal clock in/out ----
  function showAction() {
    hideAll();
    actionView.style.display = 'block';
    actionMsg.textContent = '';
    empName.textContent = current.name;
    actionBtn.disabled = false;
    if (current.clockedIn) {
      empStatus.textContent = `Clocked in since ${fmtTime(current.since)}`;
      actionBtn.textContent = 'Clock Out';
      actionBtn.className = 'btn out';
      workWrap.style.display = 'block';
      workDone.value = '';
      // Reset the clock-out time control to "Now".
      cotNow.checked = true;
      customOut.value = localNowInput();
      customOut.max = localNowInput(); // cannot pick a future time
      customOut.min = current.since ? current.since.slice(0, 16) : '';
      $('nowLabel').textContent = fmtTime(new Date());
      syncCotUI();
    } else {
      empStatus.textContent = 'You are clocked out';
      actionBtn.textContent = 'Clock In';
      actionBtn.className = 'btn in';
      workWrap.style.display = 'none';
    }
  }

  function showActionErr(m) {
    actionMsg.className = 'msg err';
    actionMsg.textContent = m;
  }

  actionBtn.addEventListener('click', async () => {
    actionMsg.textContent = '';
    let clockOut; // undefined = server uses now
    if (current.clockedIn) {
      if (!workDone.value.trim()) return showActionErr('Please enter what you worked on today.');
      if (cotOther.checked) {
        if (!customOut.value) return showActionErr('Pick a clock-out time.');
        const co = new Date(customOut.value);
        if (isNaN(co)) return showActionErr('That clock-out time is invalid.');
        if (co.getTime() > Date.now() + 60000)
          return showActionErr("Clock-out time can't be in the future.");
        if (co < new Date(current.since))
          return showActionErr('Clock-out must be after your clock-in.');
        clockOut = co.toISOString();
      }
    }
    actionBtn.disabled = true;
    try {
      if (current.clockedIn) {
        const r = await api('/api/clock-out', { pin, workDone: workDone.value, clockOut });
        actionMsg.className = 'msg ok';
        actionMsg.textContent = `Clocked out at ${fmtTime(r.until)}. Have a good one!`;
      } else {
        const r = await api('/api/clock-in', { pin });
        actionMsg.className = 'msg ok';
        actionMsg.textContent = `Clocked in at ${fmtTime(r.since)}. Let's go!`;
      }
      setTimeout(reset, 2400);
    } catch (err) {
      actionMsg.className = 'msg err';
      actionMsg.textContent = err.message;
      actionBtn.disabled = false;
    }
  });

  // ---- Missed clock-out ----
  function showMissed() {
    hideAll();
    missedView.style.display = 'block';
    $('missedMsg').textContent = '';
    $('missedIntro').textContent =
      `Hi ${current.name} — you clocked in ${fmtDay(current.missed.clockIn)} ` +
      `at ${fmtTime(current.missed.clockIn)} but never clocked out. ` +
      `Please fix it before starting today.`;
    // Default the finish time to 5pm on the missed day.
    $('missedOut').value = current.missed.day + 'T17:00';
    $('missedWork').value = '';
    $('missedReason').value = '';
  }

  $('missedBtn').addEventListener('click', async () => {
    const msg = $('missedMsg');
    msg.textContent = '';
    const out = $('missedOut').value;
    if (!out) return fail('Enter the time you finished.');
    if (!$('missedWork').value.trim()) return fail('Enter what you did that day.');
    if (!$('missedReason').value.trim()) return fail("Enter why you didn't clock out.");
    $('missedBtn').disabled = true;
    try {
      await api('/api/resolve-missed', {
        pin,
        punchId: current.missed.punchId,
        clockOut: new Date(out).toISOString(),
        workDone: $('missedWork').value,
        reason: $('missedReason').value,
      });
      // Re-check status so they can now clock in for today.
      current = await api('/api/status', { pin });
      msg.className = 'msg ok';
      msg.textContent = 'Thanks — that day is fixed.';
      setTimeout(() => (current.missed ? showMissed() : showAction()), 1400);
    } catch (err) {
      fail(err.message);
    } finally {
      $('missedBtn').disabled = false;
    }
    function fail(m) {
      msg.className = 'msg err';
      msg.textContent = m;
    }
  });

  $('doneBtn').addEventListener('click', reset);
  $('missedCancel').addEventListener('click', reset);

  function reset() {
    pin = '';
    current = null;
    renderDots();
    pinMsg.textContent = '';
    hideAll();
    pinView.style.display = 'block';
  }

  renderDots();
})();
