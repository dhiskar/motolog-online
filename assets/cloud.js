/* ===========================================================
   MotoLog online — cloud: Supabase auth + sinkronisasi data
   Data utama ada di Supabase. Setiap perubahan dari ML.persist()
   diantrikan, lalu dibandingkan dengan snapshot terakhir dan
   dikirim sebagai upsert/delete per tabel.
   =========================================================== */
'use strict';

window.MLCloud = (function () {
  const ML = window.ML;
  const CFG = window.MOTOLOG_CONFIG || {};

  let client = null;
  const cfgError = (function () {
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) {
      return 'Supabase belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_ANON_KEY di assets/config.js.';
    }
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      return 'Pustaka Supabase gagal dimuat. Periksa koneksi lalu muat ulang halaman.';
    }
    return '';
  })();

  if (!cfgError) {
    client = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });
  }

  /* ---------------- util ---------------- */
  const isNum = (v) => v !== null && v !== undefined && v !== '' && isFinite(Number(v));
  const numOrNull = (v) => (isNum(v) ? Number(v) : null);
  const stamp = (ms) => {
    const n = Number(ms);
    return new Date(isFinite(n) && n > 0 ? n : Date.now()).toISOString();
  };
  const epoch = (v) => {
    const t = v ? Date.parse(v) : NaN;
    return isNaN(t) ? Date.now() : t;
  };
  const text = (v, max) => String(v == null ? '' : v).slice(0, max || 4000);

  function keyed(rows) {
    const out = {};
    rows.forEach((row) => { out[row.id] = row; });
    return out;
  }

  function chunk(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }

  function assertReady() {
    if (cfgError) throw new Error(cfgError);
    if (!client) throw new Error('Klien Supabase tidak tersedia.');
    if (!currentUserId) throw new Error('Sesi login tidak ditemukan.');
  }

  async function exec(promise) {
    const res = await promise;
    if (res && res.error) throw res.error;
    return res;
  }

  /* ---------------- mapping state <-> baris DB ---------------- */
  function bikeRow(b) {
    return {
      id: b.id,
      name: text(b.name, 60) || 'Motor',
      brand: text(b.brand, 40),
      model: text(b.model, 40),
      year: numOrNull(b.year),
      plate: text(b.plate, 20),
      color: text(b.color, 30),
      odo: Number(b.odo) || 0,
      photo: text(b.photo, 3000000),
      created_at: stamp(b.createdAt)
    };
  }

  function recordRow(r) {
    return {
      id: r.id,
      bike_id: r.bikeId,
      type: r.type,
      date: r.date,
      odo: numOrNull(r.odo),
      amount: Number(r.amount) || 0,
      note: text(r.note, 500),
      title: text(r.title, 90),
      oil_brand: text(r.oilBrand, 50),
      oil_type: text(r.oilType, 50),
      next_odo: numOrNull(r.nextOdo),
      next_date: r.nextDate || null,
      liters: numOrNull(r.liters),
      price: numOrNull(r.price),
      full: r.full !== false,
      shop: text(r.shop, 70),
      category: text(r.category, 40),
      created_at: stamp(r.createdAt)
    };
  }

  function reminderRow(r) {
    return {
      id: r.id,
      bike_id: r.bikeId,
      title: text(r.title, 90) || 'Pengingat',
      due_date: r.dueDate || null,
      due_odo: numOrNull(r.dueOdo),
      note: text(r.note, 400),
      done: !!r.done,
      created_at: stamp(r.createdAt)
    };
  }

  function settingsRow(s) {
    return {
      theme: ['auto', 'light', 'dark'].indexOf(s.theme) >= 0 ? s.theme : 'auto',
      oil_km: Math.max(200, Math.min(20000, Math.round(Number(s.oilKm) || 2500))),
      oil_months: Math.max(1, Math.min(36, Math.round(Number(s.oilMonths) || 4))),
      active_bike: s.activeBike || null,
      install_dismissed: !!s.installDismissed
    };
  }

  function collect(state) {
    return {
      bikes: state.bikes.map(bikeRow),
      records: state.records.map(recordRow),
      reminders: state.reminders.map(reminderRow),
      settings: settingsRow(state.settings)
    };
  }

  function bikeFromRow(r) {
    return {
      id: r.id,
      name: r.name || 'Motor',
      brand: r.brand || '',
      model: r.model || '',
      year: r.year == null ? null : Number(r.year),
      plate: r.plate || '',
      color: r.color || '',
      odo: Number(r.odo) || 0,
      photo: r.photo || '',
      createdAt: epoch(r.created_at)
    };
  }

  function recordFromRow(r) {
    return {
      id: r.id,
      bikeId: r.bike_id,
      type: r.type,
      date: r.date || '',
      odo: r.odo == null ? null : Number(r.odo),
      amount: Number(r.amount) || 0,
      note: r.note || '',
      title: r.title || '',
      oilBrand: r.oil_brand || '',
      oilType: r.oil_type || '',
      nextOdo: r.next_odo == null ? null : Number(r.next_odo),
      nextDate: r.next_date || '',
      liters: r.liters == null ? null : Number(r.liters),
      price: r.price == null ? null : Number(r.price),
      full: r.full !== false,
      shop: r.shop || '',
      category: r.category || '',
      createdAt: epoch(r.created_at),
      updatedAt: r.updated_at ? epoch(r.updated_at) : null
    };
  }

  function reminderFromRow(r) {
    return {
      id: r.id,
      bikeId: r.bike_id,
      title: r.title || 'Pengingat',
      dueDate: r.due_date || '',
      dueOdo: r.due_odo == null ? null : Number(r.due_odo),
      note: r.note || '',
      done: !!r.done,
      createdAt: epoch(r.created_at)
    };
  }

  function sameRow(a, b) {
    if (!b) return true;
    const x = Object.assign({}, a);
    const y = Object.assign({}, b);
    delete x.updated_at;
    delete y.updated_at;
    return JSON.stringify(x) !== JSON.stringify(y);
  }

  /* ---------------- status ---------------- */
  let status = 'idle';
  let lastError = '';
  const statusListeners = [];

  function setStatus(next, error) {
    status = next;
    if (error !== undefined) lastError = error || '';
    statusListeners.forEach((fn) => {
      try { fn(status, lastError); } catch (e) { /* diabaikan */ }
    });
  }

  function statusText() {
    if (status === 'saving') return 'Menyimpan…';
    if (status === 'saved') return 'Tersimpan';
    if (status === 'error') return 'Gagal menyimpan';
    if (status === 'offline') return 'Offline';
    return 'Siap';
  }

  /* ---------------- auth ---------------- */
  async function getSession() {
    if (!client) return null;
    try {
      const res = await client.auth.getSession();
      return res && res.data ? res.data.session : null;
    } catch (e) {
      return null;
    }
  }

  async function signIn(email, password) {
    if (!client) throw new Error(cfgError || 'Klien Supabase tidak tersedia.');
    const res = await client.auth.signInWithPassword({ email: email, password: password });
    if (res.error) throw res.error;
    return res.data;
  }

  async function signUp(email, password) {
    if (!client) throw new Error(cfgError || 'Klien Supabase tidak tersedia.');
    const res = await client.auth.signUp({ email: email, password: password });
    if (res.error) throw res.error;
    return res.data;
  }

  async function signOut() {
    ready = false;
    currentUserId = null;
    snapshot = emptySnapshot();
    if (timer) { clearTimeout(timer); timer = null; }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (!client) return;
    const res = await client.auth.signOut();
    if (res.error) throw res.error;
  }

  function onAuth(cb) {
    if (!client) return { data: { subscription: { unsubscribe: function () {} } } };
    return client.auth.onAuthStateChange(cb);
  }

  /* ---------------- muat data ---------------- */
  let currentUserId = null;
  let ready = false;
  let snapshot = emptySnapshot();
  let timer = null;
  let retryTimer = null;
  let saving = false;
  let again = false;

  function emptySnapshot() {
    return { bikes: {}, records: {}, reminders: {}, settings: '' };
  }

  async function loadAll() {
    assertReady();
    const userId = currentUserId;

    const [profRes, bikesRes, recordsRes, remindersRes] = await Promise.all([
      client.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
      client.from('bikes').select('*').eq('user_id', userId).order('created_at', { ascending: true }),
      client.from('records').select('*').eq('user_id', userId).order('created_at', { ascending: true }),
      client.from('reminders').select('*').eq('user_id', userId).order('created_at', { ascending: true })
    ]);

    if (profRes.error) throw profRes.error;
    if (bikesRes.error) throw bikesRes.error;
    if (recordsRes.error) throw recordsRes.error;
    if (remindersRes.error) throw remindersRes.error;

    let prof = profRes.data;
    if (!prof) {
      const created = await exec(
        client.from('profiles').upsert({ user_id: userId }, { onConflict: 'user_id' }).select('*').single()
      );
      prof = created.data;
    }

    const settings = {
      theme: prof && ['auto', 'light', 'dark'].indexOf(prof.theme) >= 0 ? prof.theme : 'auto',
      oilKm: prof ? Number(prof.oil_km) || 2500 : 2500,
      oilMonths: prof ? Number(prof.oil_months) || 4 : 4,
      activeBike: prof ? prof.active_bike || null : null,
      installDismissed: !!(prof && prof.install_dismissed)
    };

    return {
      user: { id: userId, email: emailOfSession },
      state: {
        v: 1,
        bikes: (bikesRes.data || []).map(bikeFromRow),
        records: (recordsRes.data || []).map(recordFromRow),
        reminders: (remindersRes.data || []).map(reminderFromRow),
        settings: settings
      }
    };
  }

  let emailOfSession = '';

  function markClean(state) {
    snapshot = collect(state);
    ready = true;
    setStatus('saved', '');
  }

  /* ---------------- simpan (diff) ---------------- */
  function queueSave() {
    if (!ready) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      flush();
    }, 700);
  }

  async function flush() {
    if (!ready) return;
    if (saving) { again = true; return; }
    saving = true;
    setStatus('saving', '');

    try {
      await syncOnce();
      setStatus('saved', '');
    } catch (e) {
      setStatus('error', (e && e.message) || 'Gagal menyimpan');
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(function () {
        retryTimer = null;
        flush();
      }, 6000);
    } finally {
      saving = false;
      if (again) {
        again = false;
        queueSave();
      }
    }
  }

  async function syncOnce() {
    assertReady();
    const cur = collect(ML.state);
    const userId = currentUserId;

    /* motor */
    const bikeUpserts = cur.bikes.filter((row) => sameRow(row, snapshot.bikes[row.id]));
    const bikeDeletes = Object.keys(snapshot.bikes).filter((id) => !cur.bikes.some((r) => r.id === id));
    if (bikeUpserts.length) {
      for (const part of chunk(bikeUpserts, 200)) {
        await exec(client.from('bikes').upsert(part, { onConflict: 'id' }));
      }
    }

    /* catatan */
    const recUpserts = cur.records.filter((row) => sameRow(row, snapshot.records[row.id]));
    const recDeletes = Object.keys(snapshot.records).filter((id) => !cur.records.some((r) => r.id === id));
    if (recUpserts.length) {
      for (const part of chunk(recUpserts, 200)) {
        await exec(client.from('records').upsert(part, { onConflict: 'id' }));
      }
    }

    /* pengingat */
    const remUpserts = cur.reminders.filter((row) => sameRow(row, snapshot.reminders[row.id]));
    const remDeletes = Object.keys(snapshot.reminders).filter((id) => !cur.reminders.some((r) => r.id === id));
    if (remUpserts.length) {
      for (const part of chunk(remUpserts, 200)) {
        await exec(client.from('reminders').upsert(part, { onConflict: 'id' }));
      }
    }

    /* pengaturan */
    if (JSON.stringify(cur.settings) !== snapshot.settings) {
      await exec(client.from('profiles').upsert(Object.assign({ user_id: userId }, cur.settings), { onConflict: 'user_id' }));
    }

    /* hapus setelah upsert supaya foreign key aman */
    if (recDeletes.length) {
      for (const part of chunk(recDeletes, 200)) {
        await exec(client.from('records').delete().in('id', part).eq('user_id', userId));
      }
    }
    if (remDeletes.length) {
      for (const part of chunk(remDeletes, 200)) {
        await exec(client.from('reminders').delete().in('id', part).eq('user_id', userId));
      }
    }
    if (bikeDeletes.length) {
      for (const part of chunk(bikeDeletes, 200)) {
        await exec(client.from('bikes').delete().in('id', part).eq('user_id', userId));
      }
    }

    snapshot = {
      bikes: keyed(cur.bikes),
      records: keyed(cur.records),
      reminders: keyed(cur.reminders),
      settings: JSON.stringify(cur.settings)
    };
  }

  /* ---------------- impor / ganti seluruh data ---------------- */
  async function clearTables(userId) {
    await exec(client.from('records').delete().eq('user_id', userId));
    await exec(client.from('reminders').delete().eq('user_id', userId));
    await exec(client.from('bikes').delete().eq('user_id', userId));
  }

  async function insertRows(table, rows) {
    for (const part of chunk(rows, 200)) {
      await exec(client.from(table).insert(part));
    }
  }

  async function importAll(nextState) {
    assertReady();
    ready = false;
    if (timer) { clearTimeout(timer); timer = null; }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    setStatus('saving', '');

    const userId = currentUserId;
    const cur = collect(nextState);

    try {
      await clearTables(userId);
      await insertRows('bikes', cur.bikes);
      await insertRows('records', cur.records);
      await insertRows('reminders', cur.reminders);
      await exec(client.from('profiles').upsert(Object.assign({ user_id: userId }, cur.settings), { onConflict: 'user_id' }));

      snapshot = {
        bikes: keyed(cur.bikes),
        records: keyed(cur.records),
        reminders: keyed(cur.reminders),
        settings: JSON.stringify(cur.settings)
      };
      ready = true;
      setStatus('saved', '');
    } catch (e) {
      ready = true;
      setStatus('error', (e && e.message) || 'Gagal mengimpor data');
      throw e;
    }
  }

  async function clearAll() {
    return importAll({
      v: 1,
      bikes: [],
      records: [],
      reminders: [],
      settings: { theme: 'auto', oilKm: 2500, oilMonths: 4, activeBike: null, installDismissed: false }
    });
  }

  function setUser(user) {
    currentUserId = user && user.id ? user.id : null;
    emailOfSession = user && user.email ? user.email : '';
  }

  /* ML.persist() akan memanggil fungsi ini otomatis. */
  ML.onSave = queueSave;

  return {
    configured: () => !cfgError,
    configError: () => cfgError,
    client: () => client,
    getSession: getSession,
    setUser: setUser,
    signIn: signIn,
    signUp: signUp,
    signOut: signOut,
    onAuth: onAuth,
    loadAll: loadAll,
    markClean: markClean,
    importAll: importAll,
    clearAll: clearAll,
    queueSave: queueSave,
    flush: flush,
    status: () => status,
    statusText: statusText,
    lastError: () => lastError,
    onStatus: (fn) => { if (typeof fn === 'function') statusListeners.push(fn); },
    userEmail: () => emailOfSession
  };
})();

/* Alias singkat untuk app.js */
window.MLCloud = window.MLCloud;
