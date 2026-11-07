/* ===========================================================
   MotoLog — app: auth, event, aksi, ekspor/impor, PWA
   Data utama: Supabase. Aplikasi versi online (butuh internet
   untuk memuat dan menyimpan data).
   =========================================================== */
'use strict';

(function () {
  const ML = window.ML;
  const S = ML.state;
  const Cloud = window.MLCloud;

  const authEl = document.getElementById('auth');
  const appEl = document.getElementById('app');
  const bootEl = document.getElementById('boot');

  let deferredPrompt = null;
  let authMode = 'signin';
  let authBusy = false;
  let starting = false;

  /* ---------------- navigasi ---------------- */
  function navigate(to) {
    if (ML.currentRoute() === to && !ML.isStandalone()) {
      window.scrollTo(0, 0);
      return;
    }
    location.hash = '#/' + to;
  }

  /* ---------------- tema ---------------- */
  function resolveTheme() {
    const t = S.settings.theme;
    if (t === 'light' || t === 'dark') return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme() {
    const r = resolveTheme();
    const root = document.documentElement;
    root.dataset.theme = r;
    root.style.colorScheme = r;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      m.removeAttribute('media');
      m.setAttribute('content', r === 'dark' ? '#090d12' : '#f2f5f9');
    });
  }

  function setTheme(v) {
    S.settings.theme = v;
    ML.persist();
    applyTheme();
    ML.render();
    ML.toast('Tema diubah');
  }

  /* ---------------- unduh / ekspor ---------------- */
  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 1200);
  }

  async function saveFile(filename, content, opts) {
    opts = opts || {};
    const mime = opts.mime || 'text/plain;charset=utf-8';
    const blob = new Blob([content], { type: mime });

    if (window.showSaveFilePicker && window.isSecureContext) {
      try {
        const ext = '.' + filename.split('.').pop();
        const baseMime = mime.split(';')[0];
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: opts.label || 'File MotoLog',
            accept: { [baseMime]: [ext] }
          }]
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return 'saved';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancelled';
        // Jika picker gagal, jatuh ke unduhan biasa.
      }
    }

    downloadBlob(filename, blob);
    return 'downloaded';
  }

  function buildPayload() {
    return {
      app: 'MotoLog',
      version: ML.APP_VERSION,
      exportedAt: new Date().toISOString(),
      data: S
    };
  }

  async function exportJSON() {
    const payload = buildPayload();
    const result = await saveFile(
      'motolog-backup-' + ML.todayISO() + '.json',
      JSON.stringify(payload, null, 2),
      { mime: 'application/json', label: 'Backup MotoLog (.json)' }
    );
    if (result === 'cancelled') return;
    ML.toast(result === 'saved' ? 'Backup disimpan ke file' : 'Backup diunduh ke folder Download', 'good');
  }

  async function exportCSV() {
    const rows = [[
      'Tanggal', 'Motor', 'Jenis', 'Keterangan', 'Odometer (km)', 'Biaya (Rp)',
      'Liter', 'Harga/liter', 'Bengkel', 'Kategori', 'Catatan'
    ]];
    ML.sortedRecords(S.records).forEach((r) => {
      const bike = ML.bikeById(r.bikeId);
      rows.push([
        r.date,
        bike ? bike.name : '',
        ML.TYPE_META[r.type] ? ML.TYPE_META[r.type].label : r.type,
        ML.recordTitle(r),
        r.odo == null ? '' : Math.round(r.odo),
        Math.round(ML.recordAmount(r)),
        r.liters == null ? '' : r.liters,
        r.price == null ? '' : Math.round(r.price),
        r.shop || '',
        r.category || '',
        r.note || ''
      ]);
    });
    const csv = rows.map((row) => row.map((cell) => {
      const s = String(cell == null ? '' : cell);
      return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(';')).join('\r\n');
    const result = await saveFile(
      'motolog-catatan-' + ML.todayISO() + '.csv',
      '\ufeff' + csv,
      { mime: 'text/csv;charset=utf-8', label: 'Data MotoLog (.csv)' }
    );
    if (result === 'cancelled') return;
    ML.toast(result === 'saved' ? 'CSV disimpan ke file' : 'CSV diunduh ke folder Download', 'good');
  }

  /* ---------------- auth ---------------- */
  function setAuthMode(mode) {
    authMode = mode === 'signup' ? 'signup' : 'signin';
    const title = document.getElementById('auth-title');
    const sub = document.getElementById('auth-sub');
    const submit = document.getElementById('auth-submit');
    const switcher = document.getElementById('auth-switch');
    const pass = document.querySelector('#auth-form input[name="password"]');

    if (title) title.textContent = authMode === 'signup' ? 'Buat akun baru' : 'Masuk ke akun kamu';
    if (sub) {
      sub.textContent = authMode === 'signup'
        ? 'Cukup email dan password. Data motormu akan tersimpan aman di akun ini.'
        : 'Data motor dan catatan tersimpan di akun, bisa dibuka dari HP atau laptop lain.';
    }
    if (submit) {
      submit.textContent = authMode === 'signup' ? 'Buat akun' : 'Masuk';
      submit.disabled = authBusy || !CloudSafe('configured');
    }
    if (switcher) {
      switcher.textContent = authMode === 'signup' ? 'Sudah punya akun? Masuk' : 'Belum punya akun? Buat akun';
    }
    if (pass) pass.setAttribute('autocomplete', authMode === 'signup' ? 'new-password' : 'current-password');
    hideAuthError();
  }

  function showAuthError(msg, kind) {
    const el = document.getElementById('auth-error');
    if (!el) return;
    el.textContent = msg;
    el.className = 'auth-error' + (kind === 'info' ? ' info' : '');
    el.hidden = false;
  }

  function hideAuthError() {
    const el = document.getElementById('auth-error');
    if (el) el.hidden = true;
  }

  function translateAuthError(err) {
    const m = String((err && err.message) || err || '').toLowerCase();
    if (m.indexOf('invalid login') >= 0 || m.indexOf('invalid credentials') >= 0) return 'Email atau password salah.';
    if (m.indexOf('already registered') >= 0 || m.indexOf('user already exists') >= 0) return 'Email ini sudah terdaftar. Silakan masuk.';
    if (m.indexOf('password should be at least') >= 0 || m.indexOf('password is too short') >= 0) return 'Password minimal 6 karakter.';
    if (m.indexOf('email not confirmed') >= 0) return 'Email belum dikonfirmasi. Cek kotak masuk email kamu.';
    if (m.indexOf('rate limit') >= 0 || m.indexOf('too many') >= 0) return 'Terlalu banyak percobaan. Coba lagi beberapa saat lagi.';
    if (m.indexOf('unable to validate email') >= 0 || m.indexOf('invalid email') >= 0) return 'Format email tidak valid.';
    if (m.indexOf('network') >= 0 || m.indexOf('failed to fetch') >= 0 || m.indexOf('fetch') >= 0) {
      return 'Tidak bisa menghubungi server. Periksa koneksi internet.';
    }
    return (err && err.message) || 'Terjadi kesalahan. Coba lagi.';
  }

  function CloudSafe(key) {
    if (!Cloud) return false;
    try { return typeof Cloud[key] === 'function' ? !!Cloud[key]() : !!Cloud[key]; } catch (e) { return false; }
  }

  function showBoot(msg) {
    if (!bootEl) return;
    bootEl.hidden = false;
    if (authEl) authEl.hidden = true;
    if (appEl) appEl.hidden = true;
    const p = document.getElementById('boot-msg');
    if (p) p.textContent = msg || 'Memuat…';
    const retry = bootEl.querySelector('[data-act="retry-boot"]');
    if (retry) retry.hidden = true;
  }

  function showBootError(msg) {
    if (!bootEl) return;
    bootEl.hidden = false;
    if (authEl) authEl.hidden = true;
    if (appEl) appEl.hidden = true;
    const p = document.getElementById('boot-msg');
    if (p) p.textContent = msg;
    const retry = bootEl.querySelector('[data-act="retry-boot"]');
    if (retry) retry.hidden = false;
  }

  function showAuth() {
    if (bootEl) bootEl.hidden = true;
    if (appEl) appEl.hidden = true;
    if (!authEl) return;
    authEl.hidden = false;
    setAuthMode(authMode);

    if (!Cloud || !CloudSafe('configured')) {
      const msg = Cloud ? Cloud.configError() : 'Modul cloud gagal dimuat. Muat ulang halaman.';
      showAuthError(msg);
      const submit = document.getElementById('auth-submit');
      if (submit) submit.disabled = true;
    }
    const email = document.querySelector('#auth-form input[name="email"]');
    if (email && !isStandaloneSmall()) {
      // Fokus hanya di desktop agar keyboard HP tidak langsung terbuka.
      setTimeout(() => { try { email.focus({ preventScroll: true }); } catch (e) { /* diabaikan */ } }, 120);
    }
  }

  function isStandaloneSmall() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
  }

  async function handleAuthSubmit(form) {
    if (authBusy || starting) return;
    const email = String(form.elements.email.value || '').trim();
    const password = String(form.elements.password.value || '');
    const submit = document.getElementById('auth-submit');

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showAuthError('Masukkan alamat email yang valid.');
      return;
    }
    if (password.length < 6) {
      showAuthError('Password minimal 6 karakter.');
      return;
    }

    authBusy = true;
    if (submit) { submit.disabled = true; submit.textContent = 'Memproses…'; }
    hideAuthError();

    try {
      if (authMode === 'signup') {
        const data = await Cloud.signUp(email, password);
        if (data && data.session) {
          await startApp(data.session);
        } else {
          setAuthMode('signin');
          const f = document.getElementById('auth-form');
          if (f) f.elements.email.value = email;
          showAuthError('Akun dibuat. Cek email untuk konfirmasi, lalu masuk.', 'info');
        }
      } else {
        const data = await Cloud.signIn(email, password);
        await startApp(data.session);
      }
    } catch (e) {
      showAuthError(translateAuthError(e));
    } finally {
      authBusy = false;
      if (appEl && appEl.hidden) {
        if (submit) submit.disabled = !CloudSafe('configured');
        if (submit && document.getElementById('auth-error') && !document.getElementById('auth-error').hidden) {
          submit.textContent = authMode === 'signup' ? 'Buat akun' : 'Masuk';
        } else if (submit) {
          submit.textContent = authMode === 'signup' ? 'Buat akun' : 'Masuk';
        }
      }
    }
  }

  /* ---------------- boot / start ---------------- */
  async function startApp(session) {
    if (!session || !session.user || starting) return;
    starting = true;
    showBoot('Memuat data akun…');
    try {
      Cloud.setUser(session.user);
      const res = await Cloud.loadAll();
      ML.replaceState(res.state);
      Cloud.markClean(ML.state);
      applyTheme();
      if (bootEl) bootEl.hidden = true;
      if (authEl) authEl.hidden = true;
      if (appEl) appEl.hidden = false;
      ML.render();
      if (!location.hash) location.hash = '#/dash';
      const topbar = document.getElementById('topbar');
      if (topbar && window.scrollY > 4) topbar.classList.add('scrolled');
    } catch (e) {
      const detail = (e && e.message) ? e.message : '';
      const net = navigator.onLine === false || /fetch|network|load failed/i.test(detail);
      showBootError(net
        ? 'Tidak bisa memuat data. Versi online butuh koneksi internet. Periksa koneksi lalu coba lagi.'
        : 'Gagal memuat data akun' + (detail ? ': ' + detail : '.'));
    } finally {
      starting = false;
    }
  }

  async function boot() {
    applyTheme();
    if (!Cloud) {
      showBootError('Modul cloud gagal dimuat. Muat ulang halaman.');
      return;
    }
    if (!CloudSafe('configured')) {
      showAuth();
      return;
    }
    showBoot('Menghubungkan…');
    try {
      const session = await Cloud.getSession();
      if (session) {
        await startApp(session);
      } else {
        showAuth();
      }
    } catch (e) {
      showBootError('Tidak bisa menghubungi server. Periksa koneksi internet lalu coba lagi.');
    }
  }

  async function logout() {
    const ok = await ML.askConfirm({
      title: 'Keluar dari akun?',
      message: 'Data tetap tersimpan di akun kamu. Kamu bisa masuk lagi kapan saja.',
      okText: 'Keluar',
      danger: false
    });
    if (!ok) return;
    try {
      await Cloud.signOut();
    } catch (e) { /* sesi lokal tetap dibersihkan */ }
    location.reload();
  }

  /* ---------------- impor / hapus ---------------- */
  async function replaceCloudData(next, successMsg) {
    const data = ML.normalize(next);
    ML.toast('Mengimpor data…');
    try {
      await Cloud.importAll(data);
      ML.replaceState(data);
      applyTheme();
      ML.render();
      ML.toast(successMsg, 'good');
      return true;
    } catch (e) {
      const detail = translateAuthError(e);
      ML.toast('Gagal mengimpor: ' + detail, 'bad');
      return false;
    }
  }

  function localDataSummary(data) {
    return (data.bikes || []).length + ' motor, ' + (data.records || []).length + ' catatan, ' +
      (data.reminders || []).length + ' pengingat';
  }

  async function importLocalData() {
    const local = ML.readLocalState();
    if (!local) {
      ML.toast('Tidak ada data lokal di HP ini', 'bad');
      return;
    }
    if (!local.bikes.length && !local.records.length && !local.reminders.length) {
      ML.toast('Data lokal kosong', 'bad');
      return;
    }

    const ok = await ML.askConfirm({
      title: 'Impor data lokal?',
      message: 'Data lokal di HP ini (' + localDataSummary(local) + ') akan MENGGANTI seluruh data di akun ini.',
      okText: 'Impor',
      danger: false
    });
    if (!ok) return;

    const done = await replaceCloudData(local, 'Data lokal berhasil diimpor ke akun');
    if (done) {
      try { localStorage.removeItem('motolog.state.v1'); } catch (e) { /* diabaikan */ }
      ML.render();
    }
  }

  async function importFile(file) {
    if (!file) return;
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (e) {
      ML.toast('File backup tidak valid', 'bad');
      return;
    }
    const raw = parsed && parsed.data ? parsed.data : parsed;
    if (!raw || !Array.isArray(raw.bikes) || !Array.isArray(raw.records)) {
      ML.toast('Struktur backup tidak dikenali', 'bad');
      return;
    }

    const data = ML.remapIds(raw);
    const ok = await ML.askConfirm({
      title: 'Impor backup?',
      message: `Data akun saat ini (${S.bikes.length} motor, ${S.records.length} catatan) akan diganti dengan isi file backup (${localDataSummary(data)}).`,
      okText: 'Impor',
      danger: false
    });
    if (!ok) return;

    await replaceCloudData(data, 'Backup berhasil dipulihkan ke akun');
  }

  async function resetAll() {
    const ok = await ML.askConfirm({
      title: 'Hapus semua data?',
      message: 'Semua motor, catatan, dan pengingat di akun ini akan dihapus permanen. Sebaiknya ekspor backup terlebih dahulu.',
      okText: 'Hapus semua'
    });
    if (!ok) return;
    try {
      await Cloud.clearAll();
      ML.replaceState(ML.defaultState());
      applyTheme();
      ML.render();
      ML.toast('Semua data akun dihapus');
    } catch (e) {
      ML.toast('Gagal menghapus: ' + translateAuthError(e), 'bad');
    }
  }

  /* ---------------- motor ---------------- */
  function setBike(id) {
    const bike = ML.bikeById(id);
    if (!bike) return;
    S.settings.activeBike = id;
    ML.persist();
    ML.closeSheet();
    ML.render();
    ML.toast(bike.name + ' dijadikan motor aktif');
  }

  async function deleteBike(id) {
    const bike = ML.bikeById(id);
    if (!bike) return;
    const count = S.records.filter((r) => r.bikeId === id).length;
    const ok = await ML.askConfirm({
      title: 'Hapus motor?',
      message: `"${bike.name}" beserta ${count} catatan dan seluruh pengingatnya akan dihapus permanen.`,
      okText: 'Hapus motor'
    });
    if (!ok) return;

    S.bikes = S.bikes.filter((b) => b.id !== id);
    S.records = S.records.filter((r) => r.bikeId !== id);
    S.reminders = S.reminders.filter((r) => r.bikeId !== id);
    if (S.settings.activeBike === id) S.settings.activeBike = S.bikes[0] ? S.bikes[0].id : null;

    ML.persist();
    ML.render();
    ML.toast('Motor dihapus');
  }

  /* ---------------- catatan & pengingat ---------------- */
  function deleteRecord(id) {
    const rec = S.records.find((r) => r.id === id);
    if (!rec) return;
    if (!window.confirm('Hapus catatan "' + ML.recordTitle(rec) + '"? Tindakan ini tidak bisa dibatalkan.')) return;
    S.records = S.records.filter((r) => r.id !== id);
    ML.persist();
    ML.closeSheet();
    ML.render();
    ML.toast('Catatan dihapus');
  }

  function toggleReminder(id) {
    const r = S.reminders.find((x) => x.id === id);
    if (!r) return;
    r.done = !r.done;
    ML.persist();
    ML.render();
    ML.toast(r.done ? 'Pengingat diselesaikan' : 'Pengingat diaktifkan kembali');
  }

  function deleteReminder(id) {
    const r = S.reminders.find((x) => x.id === id);
    if (!r) return;
    if (!window.confirm('Hapus pengingat "' + r.title + '"?')) return;
    S.reminders = S.reminders.filter((x) => x.id !== id);
    ML.persist();
    ML.closeSheet();
    ML.render();
    ML.toast('Pengingat dihapus');
  }

  /* ---------------- install ---------------- */
  function doInstall() {
    if (ML.isStandalone()) {
      ML.toast('MotoLog sudah terpasang di HP ini');
      return;
    }
    if (deferredPrompt) {
      const prompt = deferredPrompt;
      deferredPrompt = null;
      prompt.prompt();
      prompt.userChoice.then((choice) => {
        if (choice && choice.outcome === 'accepted') ML.toast('MotoLog dipasang. Cek layar utama HP kamu.', 'good');
      }).catch(() => { /* ignore */ });
      return;
    }
    showInstallHelp();
  }

  function showInstallHelp() {
    const ua = navigator.userAgent || '';
    const samsung = /SamsungBrowser/i.test(ua);
    const chrome = /Chrome/i.test(ua) && !/Edg|OPR|SamsungBrowser/i.test(ua);
    let steps;
    if (samsung) {
      steps = ['Buka menu ⋮ di kanan bawah browser.', 'Pilih “Tambahkan halaman ke” lalu “Layar utama”.', 'Ketuk “Tambah”, lalu buka MotoLog dari layar utama.'];
    } else if (chrome) {
      steps = ['Ketuk menu ⋮ di kanan atas browser.', 'Pilih “Instal aplikasi” atau “Tambahkan ke layar utama”.', 'Ketuk “Instal” dan buka MotoLog dari layar utama.'];
    } else {
      steps = ['Buka menu browser (⋮ atau tombol bagikan).', 'Pilih “Instal aplikasi” atau “Tambahkan ke layar utama”.', 'Konfirmasi, lalu buka MotoLog dari layar utama.'];
    }

    ML.showSheet({
      title: 'Instal MotoLog',
      body: `<p class="confirm-msg">Supaya bisa dibuka cepat seperti aplikasi:</p>
        <ol class="steps">${steps.map((s) => `<li>${ML.esc(s)}</li>`).join('')}</ol>
        <p class="field hint">Aplikasi harus dibuka lewat alamat HTTPS. Data tetap tersimpan di akun kamu.</p>`,
      foot: `<button class="btn primary block" type="button" data-act="close-sheet">Mengerti</button>`
    });
  }

  /* ---------------- foto ---------------- */
  async function handlePhoto(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      ML.toast('Pilih file gambar (JPG/PNG)', 'bad');
      input.value = '';
      return;
    }
    try {
      const data = await ML.compressImage(file);
      const form = input.closest('form');
      if (!form) return;
      form.elements.photo.value = data;
      const prev = form.querySelector('#photo-prev');
      if (prev) prev.innerHTML = `<img src="${data}" alt="">`;
      ML.toast('Foto siap disimpan', 'good');
    } catch (e) {
      ML.toast('Gagal memproses foto', 'bad');
    }
    input.value = '';
  }

  /* ---------------- event klik ---------------- */
  document.addEventListener('click', function (e) {
    const cover = e.target.closest ? e.target.closest('.sheet-cover') : null;
    if (cover && !e.target.closest('.sheet')) {
      ML.closeSheet();
      return;
    }

    const el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el) return;

    const act = el.dataset.act;
    switch (act) {
      case 'go':
        ML.closeSheet();
        navigate(el.dataset.to || 'dash');
        break;
      case 'add':
        ML.openRecordSheet({ type: el.dataset.type || 'oil' });
        break;
      case 'add-bike':
        ML.openBikeSheet();
        break;
      case 'edit-bike':
        ML.openBikeSheet(el.dataset.id);
        break;
      case 'del-bike':
        deleteBike(el.dataset.id);
        break;
      case 'set-bike':
        setBike(el.dataset.id);
        break;
      case 'bike-switch':
        ML.openBikeSwitcher();
        break;
      case 'update-odo':
        ML.openOdoSheet();
        break;
      case 'open-record':
        ML.openRecordSheet({ id: el.dataset.id });
        break;
      case 'del-record':
        deleteRecord(el.dataset.id);
        break;
      case 'add-reminder':
        ML.openReminderSheet();
        break;
      case 'edit-reminder':
        ML.openReminderSheet(el.dataset.id);
        break;
      case 'del-reminder':
        deleteReminder(el.dataset.id);
        break;
      case 'toggle-reminder':
        toggleReminder(el.dataset.id);
        break;
      case 'pick-type': {
        const form = el.closest('form');
        if (form) {
          form.dataset.type = el.dataset.type;
          ML.applyTypeUI(form);
        }
        break;
      }
      case 'close-sheet':
        ML.closeSheet();
        break;
      case 'filter-history':
        ML.ui.historyFilter = el.dataset.filter;
        ML.render();
        break;
      case 'period':
        ML.ui.statsPeriod = el.dataset.value;
        ML.render();
        break;
      case 'theme':
        setTheme(el.dataset.value);
        break;
      case 'install':
        doInstall();
        break;
      case 'dismiss-install':
        S.settings.installDismissed = true;
        ML.persist();
        ML.render();
        break;
      case 'export-json':
        exportJSON();
        break;
      case 'export-csv':
        exportCSV();
        break;
      case 'import-json': {
        const input = document.getElementById('import-file');
        if (input) input.click();
        break;
      }
      case 'import-local':
        importLocalData();
        break;
      case 'reset':
        resetAll();
        break;
      case 'logout':
        logout();
        break;
      case 'auth-mode':
        setAuthMode(authMode === 'signin' ? 'signup' : 'signin');
        break;
      case 'retry-boot':
        boot();
        break;
      case 'pick-photo': {
        const form = el.closest('form');
        if (form) {
          const input = form.querySelector('#bike-photo-input');
          if (input) input.click();
        }
        break;
      }
      case 'clear-photo': {
        const form = el.closest('form');
        if (!form) break;
        form.elements.photo.value = '';
        const prev = form.querySelector('#photo-prev');
        if (prev) prev.innerHTML = ML.icon('camera');
        break;
      }
    }
  });

  /* ---------------- submit ---------------- */
  document.addEventListener('submit', function (e) {
    const form = e.target.closest ? e.target.closest('form[data-form]') : null;
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.form;
    if (kind === 'auth') handleAuthSubmit(form);
    else if (kind === 'record') ML.saveRecord(form);
    else if (kind === 'bike') ML.saveBike(form);
    else if (kind === 'odo') ML.saveOdo(form);
    else if (kind === 'reminder') ML.saveReminder(form);
  });

  /* ---------------- input ---------------- */
  document.addEventListener('input', function (e) {
    const t = e.target;

    if (t.id === 'history-search') {
      ML.ui.historyQuery = t.value;
      ML.refreshHistory();
      return;
    }

    const form = t.closest ? t.closest('#record-form') : null;
    if (!form) return;

    if (t.name === 'liters' || t.name === 'price') {
      const l = ML.num(form.elements.liters.value);
      const p = ML.num(form.elements.price.value);
      if (l != null && p != null) form.elements.amount.value = Math.round(l * p);
    }

    if (form.dataset.type === 'oil') {
      if (t.name === 'nextOdo') form.dataset.touchedNext = '1';
      if (t.name === 'nextDate') form.dataset.touchedNextDate = '1';

      if (t.name === 'odo' && !form.dataset.touchedNext) {
        const odo = ML.num(t.value);
        if (odo != null) form.elements.nextOdo.value = odo + (ML.num(S.settings.oilKm) || 2500);
      }
      if (t.name === 'date' && !form.dataset.touchedNextDate && ML.validISO(t.value)) {
        form.elements.nextDate.value = ML.addMonthsISO(t.value, ML.num(S.settings.oilMonths) || 4);
      }
    }
  });

  /* ---------------- change ---------------- */
  document.addEventListener('change', function (e) {
    const t = e.target;

    if (t.matches && t.matches('input[data-photo]')) {
      handlePhoto(t);
      return;
    }

    if (t.id === 'import-file') {
      const file = t.files && t.files[0];
      t.value = '';
      importFile(file);
      return;
    }

    if (t.matches && t.matches('[data-setting]')) {
      const key = t.dataset.setting;
      let value = ML.num(t.value);
      if (key === 'oilKm') {
        value = Math.max(200, Math.min(20000, Math.round(value || 2500)));
      } else if (key === 'oilMonths') {
        value = Math.max(1, Math.min(36, Math.round(value || 4)));
      }
      if (value == null) return;
      S.settings[key] = value;
      ML.persist();
      t.value = value;
    }
  });

  /* ---------------- keyboard ---------------- */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      ML.closeSheet();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role="button"][data-act]')) {
      e.preventDefault();
      e.target.click();
    }
  });

  /* ---------------- install prompt ---------------- */
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
  });
  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    ML.toast('MotoLog berhasil dipasang', 'good');
    ML.render();
  });

  /* ---------------- route & scroll ---------------- */
  window.addEventListener('hashchange', function () {
    ML.render();
    window.scrollTo(0, 0);
  });

  window.addEventListener('popstate', function () {
    ML.handlePopState();
  });

  window.addEventListener('scroll', function () {
    const topbar = document.getElementById('topbar');
    if (topbar) topbar.classList.toggle('scrolled', window.scrollY > 4);
  }, { passive: true });

  window.addEventListener('online', function () {
    ML.updateSettingsInfo();
    if (Cloud) Cloud.flush();
  });
  window.addEventListener('offline', function () {
    ML.updateSettingsInfo();
  });

  // Pastikan perubahan terakhir sempat dikirim saat aplikasi ditinggalkan.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && Cloud) Cloud.flush();
  });
  window.addEventListener('pagehide', function () {
    if (Cloud) Cloud.flush();
  });

  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = function () {
      if (S.settings.theme === 'auto') {
        applyTheme();
        if (ML.currentRoute() === 'settings') ML.render();
      }
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  /* ---------------- status sinkronisasi -> UI ---------------- */
  if (Cloud && typeof Cloud.onStatus === 'function') {
    Cloud.onStatus(function () {
      if (!ML.currentRoute || ML.currentRoute() !== 'settings') return;
      if (typeof ML.updateSettingsInfo === 'function') ML.updateSettingsInfo();
    });
  }

  /* ---------------- sesi ---------------- */
  if (Cloud && typeof Cloud.onAuth === 'function') {
    Cloud.onAuth(function (event) {
      // Callback ini berjalan di dalam lock Supabase; jangan panggil
      // method Supabase lain langsung dari sini.
      if (event === 'SIGNED_OUT') {
        setTimeout(function () {
          if (appEl && !appEl.hidden) location.reload();
        }, 0);
      }
    });
  }

  /* ---------------- init ---------------- */
  ML.localDataAvailable = function () {
    try { return ML.hasLocalState(); } catch (e) { return false; }
  };

  function init() {
    applyTheme();
    boot();
  }

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* cache app shell tidak tersedia */ });
    });
  }

  init();
})();
