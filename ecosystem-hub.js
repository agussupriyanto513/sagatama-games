/**
 * SAGATAMA ECOSYSTEM HUB v1.0
 * Firebase project: sagatama-ecosystem
 * 
 * Fungsi utama:
 * 1. Single Sign-On (SSO) — login sekali, akses semua portal
 * 2. Central Data Aggregator — kumpulkan data dari semua portal
 * 3. Cross-portal Notifications — notifikasi lintas portal
 * 4. Ecosystem Analytics — statistik gabungan real-time
 * 
 * Cara pakai di setiap portal:
 *   <script src="ecosystem-hub.js"></script>
 *   EcoHub.init().then(() => { ... })
 */

(function() {
  'use strict';

  // ── CONFIG SEMUA PROJECT ──
  var PROJECTS = {
    ecosystem: {
      apiKey:            'AIzaSyBXdC1d1RM6VXQsjsrff47osVFyZmkY3q0',
      authDomain:        'sagatama-ecosystem.firebaseapp.com',
      projectId:         'sagatama-ecosystem',
      storageBucket:     'sagatama-ecosystem.firebasestorage.app',
      messagingSenderId: '310542599525',
      appId:             '1:310542599525:web:6fbb102addeb53530ccd8c'
    },
    mart: {
      apiKey:            'AIzaSyDNWOochfAyHjBYUNyq2IAYhA9p7Ie834M',
      authDomain:        'portal-sagatama.firebaseapp.com',
      projectId:         'portal-sagatama',
      storageBucket:     'portal-sagatama.firebasestorage.app',
      messagingSenderId: '372845954028',
      appId:             '1:372845954028:web:189f2a3127ea8189b9f6c9'
    },
    pendidikan: {
      apiKey:            'AIzaSyCVKeCAJ6_IitpZfu-tF2QaT0esFbbNCAM',
      authDomain:        'hidayatulamin-e6f22.firebaseapp.com',
      projectId:         'hidayatulamin-e6f22',
      storageBucket:     'hidayatulamin-e6f22.firebasestorage.app',
      messagingSenderId: '80743607267',
      appId:             '1:80743607267:web:f5f94165de021759958ed6'
    }
  };

  var PORTALS = {
    mart:      'https://sagatama-mart.vercel.app',
    pendidikan:'https://hidayatulamin.vercel.app',
    yayasan:   'https://dashboard-sagatama.vercel.app'
  };

  // ── FIREBASE INSTANCES ──
  var _apps = {};
  var _dbs  = {};
  var _auth = null;

  function _initApp(name) {
    if (_apps[name]) return _apps[name];
    var existing = firebase.apps.find(function(a) { return a.name === name; });
    _apps[name] = existing || firebase.initializeApp(PROJECTS[name], name);
    _dbs[name]  = _apps[name].firestore();
    return _apps[name];
  }

  function _initAll() {
    _initApp('ecosystem');
    _initApp('mart');
    _initApp('pendidikan');
    _auth = _apps['ecosystem'].auth();
    console.log('[EcoHub] All Firebase apps initialized ✅');
  }

  // ── SSO TOKEN HELPERS ──
  function _saveToken(user, role, portals) {
    try {
      var token = {
        uid:     user.uid,
        email:   user.email,
        name:    user.displayName || user.email.split('@')[0],
        role:    role || 'user',
        portals: portals || [],
        ts:      Date.now()
      };
      localStorage.setItem('eco_token', JSON.stringify(token));
      // Set juga di format masing-masing portal agar kompatibel
      localStorage.setItem('ha_uid',   user.uid);
      localStorage.setItem('ha_role',  role || '');
      localStorage.setItem('ha_name',  token.name);
      localStorage.setItem('userRole', role || '');
    } catch(e) {}
  }

  function _getToken() {
    try {
      var raw = localStorage.getItem('eco_token');
      if (!raw) return null;
      var token = JSON.parse(raw);
      // Token expired after 24 jam
      if (Date.now() - token.ts > 86400000) { _clearToken(); return null; }
      return token;
    } catch(e) { return null; }
  }

  function _clearToken() {
    try {
      ['eco_token','ha_uid','ha_role','ha_name','userRole','userName'].forEach(function(k) {
        localStorage.removeItem(k);
      });
    } catch(e) {}
  }

  // ── NOTIFIKASI HELPER ──
  function _toast(msg, type) {
    var el = document.getElementById('_eco_toast');
    if (!el) {
      el = document.createElement('div');
      el.id = '_eco_toast';
      el.style.cssText = [
        'position:fixed', 'top:20px', 'right:20px', 'z-index:99999',
        'padding:14px 20px', 'border-radius:14px', 'font-family:sans-serif',
        'font-size:13px', 'font-weight:700', 'display:flex', 'align-items:center',
        'gap:10px', 'box-shadow:0 8px 32px rgba(0,0,0,.2)',
        'transition:all .3s', 'max-width:340px', 'color:#fff',
        'border:1px solid rgba(255,255,255,0.2)'
      ].join(';');
      document.body.appendChild(el);
    }
    var bg = {success:'#10b981', error:'#ef4444', warning:'#f59e0b', info:'#6366f1'}[type||'info'] || '#6366f1';
    var ic = {success:'✓', error:'✕', warning:'⚠', info:'🌐'}[type||'info'] || '🌐';
    el.style.background = bg;
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
    el.innerHTML = '<span style="font-size:16px">' + ic + '</span><span>' + msg + '</span>';
    setTimeout(function() { el.style.opacity = '0'; el.style.transform = 'translateY(-10px)'; }, 3500);
  }

  // ── DATA AGGREGATOR ──
  var _cache = {
    stats:    null,
    lastSync: null,
    notif:    []
  };

  async function _aggregateStats() {
    var stats = {
      mart:       { orders:0, products:0, revPi:0, revRp:0, umkm:0 },
      pendidikan: { santri:0, ustadz:0, sgt:0, hafalan:0, donasi:0 },
      yayasan:    { donasi:0, donasiPi:0 },
      lastSync:   new Date()
    };

    await Promise.allSettled([
      // Mart stats
      _dbs['mart'].collection('orders').get()
        .then(function(s) {
          stats.mart.orders = s.size;
          s.docs.forEach(function(d) {
            var data = d.data();
            if (data.status === 'completed' || data.status === 'selesai') {
              stats.mart.revPi += parseFloat(data.totalPi || data.total || 0);
              stats.mart.revRp += parseFloat(data.totalRp || 0);
            }
          });
        }).catch(function(){}),

      _dbs['mart'].collection('products').get()
        .then(function(s) { stats.mart.products = s.size; }).catch(function(){}),

      _dbs['mart'].collection('umkm').get()
        .then(function(s) { stats.mart.umkm = s.size; }).catch(function(){}),

      // Pendidikan stats
      _dbs['pendidikan'].collection('users').get()
        .then(function(s) {
          s.docs.forEach(function(d) {
            var data = d.data();
            if (data.role === 'santri') stats.pendidikan.santri++;
            if (data.role === 'ustadz') stats.pendidikan.ustadz++;
            stats.pendidikan.sgt += parseFloat(data.sgt_balance || 0);
          });
        }).catch(function(){}),

      _dbs['pendidikan'].collection('hafalan').get()
        .then(function(s) { stats.pendidikan.hafalan = s.size; }).catch(function(){}),

      _dbs['pendidikan'].collection('donasi').get()
        .then(function(s) {
          stats.pendidikan.donasi = s.size;
          s.docs.forEach(function(d) {
            var data = d.data();
            if (data.status === 'completed') {
              if (data.method === 'pi') stats.yayasan.donasiPi += parseFloat(data.amount || 0);
              else stats.yayasan.donasi += parseFloat(data.amount || 0);
            }
          });
        }).catch(function(){})
    ]);

    // Simpan ke ecosystem Firestore sebagai snapshot
    try {
      await _dbs['ecosystem'].collection('ecosystem_stats').doc('latest').set({
        mart:       stats.mart,
        pendidikan: stats.pendidikan,
        yayasan:    stats.yayasan,
        updatedAt:  firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch(e) {}

    _cache.stats    = stats;
    _cache.lastSync = new Date();
    return stats;
  }

  // ── CROSS PORTAL NOTIFICATIONS ──
  async function _pushNotif(type, title, body, data) {
    try {
      await _dbs['ecosystem'].collection('notifications').add({
        type:      type || 'info',
        title:     title,
        body:      body,
        data:      data || {},
        read:      false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch(e) { console.warn('[EcoHub] pushNotif:', e); }
  }

  function _listenNotif(callback) {
    try {
      return _dbs['ecosystem'].collection('notifications')
        .where('read', '==', false)
        .orderBy('createdAt', 'desc')
        .limit(10)
        .onSnapshot(function(snap) {
          var notifs = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
          _cache.notif = notifs;
          if (typeof callback === 'function') callback(notifs);
        });
    } catch(e) { return function() {}; }
  }

  // ── MAIN ECOHUB OBJECT ──
  window.EcoHub = {

    /* Inisialisasi EcoHub — wajib dipanggil pertama */
    init: function() {
      return new Promise(function(resolve) {
        if (typeof firebase === 'undefined') {
          console.error('[EcoHub] Firebase SDK belum dimuat!');
          resolve(false); return;
        }
        try {
          _initAll();
          resolve(true);
          console.log('[EcoHub] Ready ✅ — sagatama-ecosystem hub aktif');
        } catch(e) {
          console.error('[EcoHub] init error:', e);
          resolve(false);
        }
      });
    },

    /* SSO Login — login di satu portal, berlaku di semua */
    login: async function(email, password, onSuccess, onError) {
      try {
        var cred = await _auth.signInWithEmailAndPassword(email, password);
        var user = cred.user;

        // Ambil data user dari ecosystem Firestore
        var snap = await _dbs['ecosystem'].collection('users').doc(user.uid).get();
        var userData = snap.exists ? snap.data() : { role: 'user', portals: [] };

        _saveToken(user, userData.role, userData.portals);
        _toast('Selamat datang, ' + (user.displayName || email.split('@')[0]) + '!', 'success');

        // Push notif login
        await _pushNotif('login', 'Login Ekosistem', (user.displayName || email) + ' masuk ke sistem', { uid: user.uid });

        if (typeof onSuccess === 'function') onSuccess(user, userData);
        return { user: user, data: userData };
      } catch(e) {
        var msg = {
          'auth/wrong-password':    'Password salah.',
          'auth/user-not-found':    'Email tidak terdaftar.',
          'auth/invalid-email':     'Format email tidak valid.',
          'auth/too-many-requests': 'Terlalu banyak percobaan.'
        }[e.code] || e.message;
        _toast(msg, 'error');
        if (typeof onError === 'function') onError(msg);
        return null;
      }
    },

    /* SSO Logout — logout dari semua portal */
    logout: async function() {
      if (!confirm('Keluar dari semua portal Sagatama Ecosystem?')) return;
      try { await _auth.signOut(); } catch(e) {}
      _clearToken();
      _toast('Berhasil keluar dari ekosistem', 'info');
      setTimeout(function() { window.location.href = 'ecosystem-login.html'; }, 1500);
    },

    /* Daftar user baru ke ekosistem */
    register: async function(email, password, name, role, portals) {
      try {
        var cred = await _auth.createUserWithEmailAndPassword(email, password);
        var user = cred.user;
        await user.updateProfile({ displayName: name });

        var userData = {
          uid:       user.uid,
          email:     email,
          name:      name,
          role:      role || 'user',
          portals:   portals || [],
          sgt_balance: 0,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        await _dbs['ecosystem'].collection('users').doc(user.uid).set(userData);
        _saveToken(user, role, portals);
        await _pushNotif('register', 'User Baru', name + ' bergabung ke ekosistem', { uid: user.uid, role });
        _toast('Akun berhasil dibuat!', 'success');
        return { user, data: userData };
      } catch(e) { _toast(e.message, 'error'); return null; }
    },

    /* Cek apakah user sudah login (dari token lokal) */
    getSession: function() { return _getToken(); },

    /* Require auth — redirect ke login jika belum */
    requireAuth: function(callback) {
      var token = _getToken();
      if (!token) { window.location.href = 'ecosystem-login.html'; return; }
      if (typeof callback === 'function') callback(token);
    },

    /* Aggregate semua statistik dari 3 portal */
    getStats: async function(forceRefresh) {
      if (!forceRefresh && _cache.stats && _cache.lastSync) {
        var age = (Date.now() - _cache.lastSync.getTime()) / 1000;
        if (age < 300) return _cache.stats; // cache 5 menit
      }
      _toast('Mengambil data semua portal...', 'info');
      var stats = await _aggregateStats();
      _toast('Data ekosistem diperbarui ✓', 'success');
      return stats;
    },

    /* Baca stats terakhir dari Firestore (tanpa re-aggregate) */
    getLatestStats: async function() {
      try {
        var snap = await _dbs['ecosystem'].collection('ecosystem_stats').doc('latest').get();
        return snap.exists ? snap.data() : null;
      } catch(e) { return null; }
    },

    /* Push notifikasi lintas portal */
    pushNotif: _pushNotif,

    /* Listen notifikasi real-time */
    listenNotif: _listenNotif,

    /* Baca daftar notifikasi */
    getNotif: function() { return _cache.notif; },

    /* Tandai notif sudah dibaca */
    markRead: async function(notifId) {
      try {
        await _dbs['ecosystem'].collection('notifications').doc(notifId).update({ read: true });
      } catch(e) {}
    },

    /* Akses Firestore masing-masing project */
    db: {
      get ecosystem() { return _dbs['ecosystem']; },
      get mart()      { return _dbs['mart']; },
      get pendidikan(){ return _dbs['pendidikan']; }
    },

    /* Auth instance (ecosystem project) */
    get auth() { return _auth; },

    /* URL portal */
    portals: PORTALS,

    /* Format helpers */
    fmt: {
      pi:     function(n) { return parseFloat(n||0).toFixed(2) + ' π'; },
      rupiah: function(n) { return 'Rp ' + parseInt(n||0).toLocaleString('id-ID'); },
      sgt:    function(n) { return parseInt(n||0).toLocaleString('id-ID') + ' SGT'; },
      num:    function(n) { return parseInt(n||0).toLocaleString('id-ID'); }
    },

    toast:    _toast,
    projects: PROJECTS
  };

  console.log('[EcoHub] ecosystem-hub.js v1.0 loaded — sagatama-ecosystem ready');

})();
