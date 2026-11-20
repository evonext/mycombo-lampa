/*
 * MyCombo v2 — личный онлайн-плагин для Lampa (Samsung Tizen).
 *
 * Возможности:
 *  - несколько источников одновременно (свои API + встроенный Internet Archive);
 *  - платные / требующие авторизацию источники и потоки отбрасываются автоматически;
 *  - ТВ-интерфейс: виды «Список» и «Плитки», масштаб, сезоны, озвучки, бейджи 4K/HDR;
 *  - «Продолжить», отметки просмотренного, избранное, сортировка по качеству;
 *  - долгое «ОК» на потоке — быстрое меню;
 *  - загрузка настроек с URL (вместо ввода длинных адресов пультом).
 *
 * Контракт своего API:  GET {api}?title=&year=&imdb=&kp=&tmdb=&type=movie|tv[&season=]
 *   → [{voice, quality, title, url, season, episode, subtitles:[{label,url}],
 *       paid?, auth?}]  (или {items:[...]}). Всё с paid/auth/premium=true отбрасывается.
 * Конфиг по URL (JSON):  {"apis":["https://a/api","https://b/api"],"archive":true}
 */
(function () {
  'use strict';
  if (window.mycombo_ready) return;
  window.mycombo_ready = true;

  var NAME = 'mycombo';
  var TTL = 10 * 60 * 1000;
  var TIMEOUT = 12000;
  // Серверы Lampac по умолчанию (можно изменить в настройках). Берутся только бесплатные балансеры.
  var DEFAULT_LAMPAC = 'https://rust.bwa.ad';

  // ---------- хранилище ----------
  function get(k, d) { var v = Lampa.Storage.get(NAME + '_' + k, ''); return v === '' || v === undefined ? d : v; }
  function set(k, v) { Lampa.Storage.set(NAME + '_' + k, v); }
  function fld(k, d) { var v = Lampa.Storage.field(NAME + '_' + k); return v === '' || v === undefined || v === null ? d : v; }
  function arr(k) { var v = get(k, []); return Array.isArray(v) ? v : []; }

  // ---------- стили ----------
  function applyCss() {
    var z = parseFloat(fld('scale', '1')) || 1;
    var css =
      '.mc-root{font-size:' + z + 'em}' +
      '.mc-row{display:flex;flex-wrap:wrap;gap:.5em;padding:.6em 1.5em}' +
      '.mc-chip{padding:.5em 1.1em;border-radius:2em;background:rgba(255,255,255,.08);font-size:1.25em}' +
      '.mc-chip.active{background:rgba(255,255,255,.25)}' +
      '.mc-chip.focus{background:#fff;color:#000;transform:scale(1.05)}' +
      '.mc-item{display:flex;align-items:center;margin:.35em 1.5em;padding:.9em 1.3em;border-radius:.8em;background:rgba(255,255,255,.06);font-size:1.45em}' +
      '.mc-item.focus{background:#fff;color:#000}' +
      '.mc-item__t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.mc-item__s{opacity:.55;margin-left:1em;font-size:.7em}' +
      '.mc-b{margin-left:.7em;padding:.05em .55em;border-radius:.4em;border:2px solid currentColor;font-size:.75em}' +
      '.mc-flag{width:1.4em;text-align:center;margin-right:.5em}' +
      '.mc-grid{display:flex;flex-wrap:wrap;padding:.4em 1em}' +
      '.mc-tile{width:calc(25% - 1em);margin:.5em;padding:1.1em;border-radius:.8em;background:rgba(255,255,255,.06);font-size:1.3em;min-height:5em;box-sizing:border-box}' +
      '.mc-tile.focus{background:#fff;color:#000}' +
      '.mc-tile__t{font-weight:bold;margin-bottom:.4em}' +
      '.mc-empty{padding:3em;text-align:center;font-size:1.6em;opacity:.7}';
    $('#mc-style').remove();
    $('<style id="mc-style">').text(css).appendTo('head');
  }

  // ---------- фильтры качества ----------
  function qRank(q) {
    q = (q || '') + '';
    if (/2160|4k|uhd/i.test(q)) return 5;
    if (/1440|2k/i.test(q)) return 4;
    if (/1080/i.test(q)) return 3;
    if (/720/i.test(q)) return 2;
    if (/480|sd/i.test(q)) return 1;
    return 0;
  }
  function bad(i) {
    // платные / с авторизацией / без ссылки
    if (!i || !i.url) return true;
    var f = function (v) { return v === true || v === 1 || v === 'true' || v === '1'; };
    if (fld('paid', true)) return false; // режим «показывать всё»: решает сервер, при отказе источник пропускается
    if (f(i.paid) || f(i.premium) || f(i.auth) || f(i.need_auth) || f(i.requires_auth) || f(i.login)) return true;
    if (/(^|[?&])(token|apikey|api_key|auth)=\s*(&|$)/i.test(i.url)) return true;
    return false;
  }

  // ---------- сеть ----------
  function request(url, ok, fail) {
    var net = new Lampa.Reguest();
    net.timeout(TIMEOUT);
    net.silent(url, ok, function (a, st) { fail(a && a.status || st || 0); });
  }

  function query(movie, season) {
    var q = {
      title: movie.title || movie.name || '',
      year: ((movie.release_date || movie.first_air_date || '') + '').slice(0, 4),
      imdb: movie.imdb_id || '', kp: movie.kinopoisk_id || '', tmdb: movie.id,
      type: movie.name ? 'tv' : 'movie'
    };
    if (season) q.season = season;
    return q;
  }

  // свой API
  function fromApi(api, movie, season, done) {
    var url = api + (api.indexOf('?') > -1 ? '&' : '?') + $.param(query(movie, season));
    request(url, function (j) {
      var d = Array.isArray(j) ? j : (j && j.items) || [];
      d = d.filter(function (i) { return !bad(i); });
      d.forEach(function (i) { i.src = i.src || hostOf(api); });
      note(hostOf(api) + ': потоков ' + d.length);
      done(d);
    }, function (code) { note(hostOf(api) + ': ошибка ' + code); done([], code); }); // 401/402/403 → источник просто пропускается
  }
  function hostOf(u) { var m = (u + '').match(/^https?:\/\/([^\/?#]+)/i); return m ? m[1] : 'api'; }

  // Internet Archive: бесплатно, без авторизации (в основном общественное достояние)
  function fromArchive(movie, season, done) {
    if (movie.name) return done([]); // только фильмы
    var title = (movie.title || '').replace(/["\\()]/g, ' ').trim();
    var orig = (movie.original_title || '').replace(/["\\()]/g, ' ').trim();
    var name = orig || title;
    if (!name) return done([]);
    var q = 'title:("' + name + '") AND mediatype:movies';
    var url = 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent(q) +
      '&fl[]=identifier&fl[]=title&fl[]=year&rows=3&output=json';
    request(url, function (j) {
      var docs = (j && j.response && j.response.docs) || [];
      var year = ((movie.release_date || '') + '').slice(0, 4);
      docs = docs.filter(function (d) { return !year || !d.year || Math.abs(parseInt(d.year, 10) - parseInt(year, 10)) <= 1; });
      note('archive.org: найдено записей ' + docs.length);
      if (!docs.length) return done([]);
      var out = [], left = docs.length;
      docs.forEach(function (d) {
        request('https://archive.org/metadata/' + encodeURIComponent(d.identifier), function (m) {
          (m && m.files || []).forEach(function (f) {
            if (!/\.(mp4|m4v|webm)$/i.test(f.name || '')) return;
            if (/_thumb|sample|trailer/i.test(f.name)) return;
            var h = parseInt(f.height, 10) || 0;
            out.push({
              src: 'archive.org', voice: 'Archive.org',
              quality: h ? h + 'p' : (/512kb|ia\.mp4/i.test(f.name) ? 'SD' : ''),
              title: d.title || name,
              url: 'https://archive.org/download/' + encodeURIComponent(d.identifier) + '/' + encodeURIComponent(f.name)
            });
          });
          if (!--left) done(out);
        }, function () { if (!--left) done(out); });
      });
    }, function () { done([]); });
  }

  // Сервер, совместимый с Lampac (/lite/events → список балансеров → /lite/{balanser}).
  // Берутся только балансеры без account_only/paid; всё платное и привязанное к аккаунту отбрасывается.
  function fromLampac(base, movie, season, done) {
    base = (base + '').replace(/\/+$/, '');
    var q = query(movie, season);
    var lq = {
      id: movie.id, imdb_id: q.imdb, kinopoisk_id: q.kp, title: q.title,
      original_title: movie.original_title || movie.original_name || '',
      serial: movie.name ? 1 : 0, year: q.year, source: 'tmdb', rjson: 'true'
    };
    if (season) lq.s = season;
    var out = [], host = hostOf(base);
    request(base + '/lite/events?' + $.param(lq), function (list) {
      if (typeof list === 'string') { try { list = JSON.parse(list); } catch (e) {} }
      if (!Array.isArray(list)) { note(host + ': /lite/events вернул не список (' + (typeof list) + ')'); return done([]); }
      var bals = list.filter(function (b) {
        return b && b.balanser && b.balanser !== 'example' && (fld('paid', true) || (!b.account_only && !b.paid && !b.need_auth));
      }).slice(0, 40);
      note(host + ': балансеров всего ' + list.length + ', к опросу ' + bals.length + (bals.length ? ' (' + bals.map(function (b) { return b.balanser; }).join(', ') + ')' : ''));
      if (!bals.length) return done([]);
      var pending = bals.length;
      function fin() { if (!--pending) done(out); }

      function parse(b, j, depth, cb) {
        if (typeof j === 'string') { try { j = JSON.parse(j); } catch (e) { return cb(); } }
        var data = j && j.data;
        if (!Array.isArray(data)) return cb();
        var waiting = 1;
        function end() { if (!--waiting) cb(); }
        data.forEach(function (d) {
          if (!d || !d.url) return;
          if (d.method === 'link' && depth < 2) {
            waiting++;
            request(d.url, function (r) { parse(b, r, depth + 1, end); }, end);
            return;
          }
          if (d.method && d.method !== 'play') return;
          var url = d.url, quality = d.quality;
          if (quality && typeof quality === 'object') { // {"1080p": url, ...} → лучшее
            var ks = Object.keys(quality).sort(function (a, c) { return qRank(c) - qRank(a); });
            if (ks.length) { url = quality[ks[0]]; quality = ks[0]; } else quality = '';
          }
          var item = {
            src: host + '/' + b.balanser, srcn: b.name || b.balanser, voice: d.voice_name || d.translate || b.name || b.balanser,
            quality: quality || d.maxquality || '', title: d.title || d.name || '',
            url: url, subtitles: Array.isArray(d.subtitles) ? d.subtitles.map(function (s) { return { label: s.label, url: s.url }; }) : undefined,
            season: d.season, episode: d.episode
          };
          if (!bad(item)) out.push(item);
        });
        end();
      }

      bals.forEach(function (b) {
        request(base + '/lite/' + encodeURIComponent(b.balanser) + '?' + $.param(lq), function (j) {
          var before = out.length;
          parse(b, j, 0, function () { note(host + '/' + b.balanser + ': потоков ' + (out.length - before)); fin(); });
        }, function (code) { note(host + '/' + b.balanser + ': ошибка ' + code); fin(); }); // 401/402/403 → балансер пропускается
      });
    }, function (code) { note(host + ': /lite/events недоступен, код ' + code + (code === 0 ? ' (сеть/CORS/блокировка)' : '')); done([]); });
  }

  var cache = {};
  var DIAG = [];
  function note(m) { DIAG.push(m); }

  function collect(movie, season, done) {
    var key = movie.id + '|' + (season || '') + '|' + fld('apis', '') + '|' + fld('lampac', DEFAULT_LAMPAC) + '|' + fld('archive', true);
    var c = cache[key];
    if (c && Date.now() - c.t < TTL) { DIAG = c.diag || []; return done(c.d, c.n); }
    DIAG = [];

    var apis = (fld('apis', '') + '').split(/[\s,;]+/).filter(function (x) { return /^https?:\/\//i.test(x); });
    var tasks = apis.map(function (a) { return function (cb) { fromApi(a, movie, season, cb); }; });
    (fld('lampac', DEFAULT_LAMPAC) + '').split(/[\s,;]+/).filter(function (x) { return /^https?:\/\//i.test(x); }).forEach(function (a) {
      tasks.push(function (cb) { fromLampac(a, movie, season, cb); });
    });
    if (fld('archive', true)) tasks.push(function (cb) { fromArchive(movie, season, cb); });
    if (!tasks.length) return done([], 0);

    var all = [], left = tasks.length;
    tasks.forEach(function (t) {
      t(function (d) {
        all = all.concat(d || []);
        if (--left) return;
        // убрать дубли по url
        var seen = {};
        all = all.filter(function (i) { if (seen[i.url]) return false; seen[i.url] = 1; return true; });
        cache[key] = { t: Date.now(), d: all, n: tasks.length, diag: DIAG };
        done(all, tasks.length);
      });
    });
  }

  // ---------- компонент ----------
  function Component(object) {
    var scroll = new Lampa.Scroll({ mask: true, over: true });
    var html = $('<div class="mc-root"></div>');
    var seasonsBox = $('<div class="mc-row"></div>');
    var srcBox = $('<div class="mc-row"></div>');
    var voicesBox = $('<div class="mc-row"></div>');
    var list = $('<div></div>');
    var movie = object.movie, items = [], voices = [], seasons = [];
    var curVoice = '', curSrc = get('src', ''), sources = [], curSeason = object.season || 0, last, self = this;

    function seenKey(i, n) { return (i.season || 0) + 'x' + (i.episode || n); }
    function isSeen(k) { return arr('seen_' + movie.id).indexOf(k) > -1; }
    function markSeen(k) { var a = arr('seen_' + movie.id); if (a.indexOf(k) < 0) { a.push(k); set('seen_' + movie.id, a); } }
    function favs() { return arr('fav_' + movie.id); }

    this.create = function () {
      scroll.append(seasonsBox); scroll.append(srcBox); scroll.append(voicesBox); scroll.append(list);
      html.append(scroll.render());
      this.activity.loader(true);
      this.fetch();
      return this.render();
    };

    this.fetch = function () {
      this.activity.loader(true);
      collect(movie, curSeason, function (d, n) {
        self.activity.loader(false);
        if (!n) return self.empty('Нет источников. Укажите адрес API в Настройки → MyCombo или включите Internet Archive');
        items = d;
        sources = []; seasons = [];
        d.forEach(function (i) {
          var n = i.srcn || i.src || '';
          if (n && sources.indexOf(n) < 0) sources.push(n);
          if (i.season && seasons.indexOf(i.season) < 0) seasons.push(i.season);
        });
        seasons.sort(function (a, b) { return a - b; });
        if (!curSeason && seasons.length) curSeason = seasons[0];
        if (curSrc && sources.indexOf(curSrc) < 0) curSrc = '';
        self.draw();
        self.activity.toggle();
      });
    };

    this.empty = function (msg) {
      seasonsBox.empty(); srcBox.empty(); voicesBox.empty();
      var dg = DIAG.map(function (l) { return $('<div>').text(l).html(); }).join('<br>');
      list.empty().append('<div class="mc-empty">' + (msg || 'Ничего не найдено (платные и закрытые источники скрыты)') +
        (dg ? '<div style="font-size:.6em;margin-top:1.5em;text-align:left;opacity:.8">' + dg + '</div>' : '') + '</div>');
      this.activity.toggle();
    };

    function chip(text, active, enter) {
      var b = $('<div class="mc-chip selector' + (active ? ' active' : '') + '"></div>').text(text);
      b.on('hover:enter', enter);
      b.on('hover:focus', function (e) { last = e.target; scroll.update($(e.target), true); });
      return b;
    }

    this.draw = function () {
      if (!items.length) return this.empty();
      seasonsBox.empty(); srcBox.empty(); voicesBox.empty(); list.empty();
      var inSrc = items.filter(function (i) { return !curSrc || (i.srcn || i.src) === curSrc; });
      voices = [];
      inSrc.forEach(function (i) { if (i.voice && voices.indexOf(i.voice) < 0) voices.push(i.voice); });
      var lv = get('voice', '');
      if (voices.indexOf(curVoice) < 0) curVoice = voices.indexOf(lv) > -1 ? lv : (voices[0] || '');
      if (sources.length > 1) {
        srcBox.append(chip('Все источники (' + sources.length + ')', !curSrc, function () { curSrc = ''; set('src', ''); self.draw(); self.start(); }));
        sources.forEach(function (n) {
          var cnt = items.filter(function (i) { return (i.srcn || i.src) === n; }).length;
          srcBox.append(chip(n + ' · ' + cnt, n === curSrc, function () { curSrc = n; set('src', n); self.draw(); self.start(); }));
        });
      }
      seasons.forEach(function (s) {
        if (seasons.length < 2) return;
        seasonsBox.append(chip('Сезон ' + s, s === curSeason, function () { curSeason = s; self.draw(); self.start(); }));
      });
      voices.forEach(function (v) {
        voicesBox.append(chip(v, v === curVoice, function () { curVoice = v; set('voice', v); self.draw(); self.start(); }));
      });

      var shown = inSrc.filter(function (i) {
        return (!voices.length || i.voice === curVoice) && (!seasons.length || !i.season || i.season === curSeason);
      });
      var sort = fld('sort', 'source');
      if (sort === 'quality') shown.sort(function (a, b) { return qRank(b.quality) - qRank(a.quality); });
      var fv = favs();
      shown.sort(function (a, b) { return (fv.indexOf(b.url) > -1) - (fv.indexOf(a.url) > -1); }); // избранное выше

      if (!shown.length) { list.append('<div class="mc-empty">Нет потоков для выбранных фильтров</div>'); return; }

      var view = fld('view', 'list');
      var cont = view === 'grid' ? $('<div class="mc-grid"></div>') : list;
      var lastKey = get('last_' + movie.id, '');
      var playlist = shown.map(function (p) {
        return { title: p.title || movie.title || movie.name, url: p.url, subtitles: p.subtitles, quality: p.quality };
      });

      shown.forEach(function (i, n) {
        var key = seenKey(i, n);
        var title = i.title || (i.episode ? 'Серия ' + i.episode : movie.title || movie.name);
        var badges = '';
        if (i.quality) badges += '<span class="mc-b">' + $('<i>').text(i.quality).html() + '</span>';
        if (/hdr|dolby.?vision|\bdv\b/i.test((i.quality || '') + (i.title || ''))) badges += '<span class="mc-b">HDR</span>';
        var flag = fv.indexOf(i.url) > -1 ? '★' : (isSeen(key) ? '✓' : (key === lastKey ? '▶' : ''));
        var row;
        if (view === 'grid') {
          row = $('<div class="mc-tile selector"><div class="mc-tile__t"></div><div class="mc-tile__m"></div></div>');
          row.find('.mc-tile__t').text((flag ? flag + ' ' : '') + title);
          row.find('.mc-tile__m').html(badges + '<span class="mc-item__s"></span>');
          row.find('.mc-item__s').text(i.src || '');
        } else {
          row = $('<div class="mc-item selector"><span class="mc-flag"></span><span class="mc-item__t"></span><span class="mc-item__s"></span></div>');
          row.find('.mc-flag').text(flag);
          row.find('.mc-item__t').text(title);
          row.find('.mc-item__s').text(i.src || '');
          row.append(badges);
        }
        row.on('hover:focus', function (e) { last = e.target; scroll.update($(e.target), true); });
        row.on('hover:enter', function () {
          set('last_' + movie.id, key); markSeen(key);
          Lampa.Player.play({ title: title, url: i.url, subtitles: i.subtitles, quality: i.quality, playlist: playlist });
          Lampa.Player.playlist(playlist);
        });
        row.on('hover:long', function () { self.menu(i, key); });
        cont.append(row);
        if (key === lastKey && !last) last = row[0];
      });
      if (view === 'grid') list.append(cont);
    };

    this.menu = function (i, key) {
      var fv = favs(), isFav = fv.indexOf(i.url) > -1;
      Lampa.Select.show({
        title: 'MyCombo',
        items: [
          { title: isFav ? 'Убрать из избранного' : 'В избранное', act: 'fav' },
          { title: isSeen(key) ? 'Снять отметку «просмотрено»' : 'Отметить просмотренным', act: 'seen' },
          { title: 'Вид: ' + (fld('view', 'list') === 'list' ? 'переключить на плитки' : 'переключить на список'), act: 'view' },
          { title: 'Сортировка: ' + (fld('sort', 'source') === 'quality' ? 'как у источника' : 'по качеству'), act: 'sort' },
          { title: 'Обновить', act: 'reload' }
        ],
        onSelect: function (a) {
          if (a.act === 'fav') { if (isFav) fv.splice(fv.indexOf(i.url), 1); else fv.push(i.url); set('fav_' + movie.id, fv); }
          if (a.act === 'seen') { var s = arr('seen_' + movie.id), p = s.indexOf(key); if (p > -1) s.splice(p, 1); else s.push(key); set('seen_' + movie.id, s); }
          if (a.act === 'view') Lampa.Storage.set(NAME + '_view', fld('view', 'list') === 'list' ? 'grid' : 'list');
          if (a.act === 'sort') Lampa.Storage.set(NAME + '_sort', fld('sort', 'source') === 'quality' ? 'source' : 'quality');
          if (a.act === 'reload') { cache = {}; return self.fetch(); }
          last = false; self.draw(); self.start();
        },
        onBack: function () { Lampa.Controller.toggle('content'); }
      });
    };

    this.start = function () {
      Lampa.Controller.add('content', {
        toggle: function () {
          Lampa.Controller.collectionSet(scroll.render());
          Lampa.Controller.collectionFocus(last || false, scroll.render());
        },
        up: function () { if (Navigator.canmove('up')) Navigator.move('up'); else Lampa.Controller.toggle('head'); },
        down: function () { Navigator.move('down'); },
        left: function () { if (Navigator.canmove('left')) Navigator.move('left'); else Lampa.Controller.toggle('menu'); },
        right: function () { Navigator.move('right'); },
        back: function () { Lampa.Activity.backward(); }
      });
      Lampa.Controller.toggle('content');
    };

    this.pause = function () {}; this.stop = function () {};
    this.render = function () { return html; };
    this.destroy = function () { scroll.destroy(); html.remove(); items = []; };
  }

  // ---------- загрузка конфига по URL ----------
  function importConfig() {
    var u = fld('cfgurl', '');
    if (!/^https?:\/\//i.test(u)) return Lampa.Noty.show('Укажите адрес конфигурации');
    request(u, function (j) {
      try {
        if (typeof j === 'string') j = JSON.parse(j);
        if (j.apis) Lampa.Storage.set(NAME + '_apis', [].concat(j.apis).join(' '));
        if (j.lampac) Lampa.Storage.set(NAME + '_lampac', [].concat(j.lampac).join(' '));
        if (typeof j.archive === 'boolean') Lampa.Storage.set(NAME + '_archive', j.archive);
        cache = {};
        Lampa.Noty.show('MyCombo: настройки загружены');
      } catch (e) { Lampa.Noty.show('MyCombo: неверный JSON'); }
    }, function () { Lampa.Noty.show('MyCombo: не удалось загрузить настройки'); });
  }

  // ---------- регистрация ----------
  function init() {
    applyCss();
    Lampa.Component.add(NAME, Component);

    Lampa.Listener.follow('full', function (e) {
      if (e.type !== 'complite') return;
      var movie = e.data.movie;
      var btn = $('<div class="full-start__button selector view--' + NAME + '"><span>MyCombo</span></div>');
      btn.on('hover:enter', function () {
        Lampa.Activity.push({ url: '', title: movie.title || movie.name, component: NAME, movie: movie, page: 1 });
      });
      var root = e.object.activity.render();
      var after = root.find('.view--torrent');
      if (after.length) after.after(btn); else root.find('.full-start__buttons').append(btn);
    });

    Lampa.SettingsApi.addComponent({
      component: NAME, name: 'MyCombo',
      icon: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>'
    });
    var P = function (name, type, def, title, descr, values, onChange) {
      Lampa.SettingsApi.addParam({
        component: NAME,
        param: { name: NAME + '_' + name, type: type, values: values || '', default: def },
        field: { name: title, description: descr || '' },
        onChange: onChange
      });
    };
    P('apis', 'input', '', 'Адреса API', 'Один или несколько через пробел. Платные и требующие входа потоки скрываются');
    P('lampac', 'input', DEFAULT_LAMPAC, 'Серверы Lampac', 'Адреса через пробел (свой сервер). Балансеры «только для аккаунта» и платные пропускаются');
    P('paid', 'trigger', true, 'Все балансеры, включая платные', 'Не скрывать источники «только для аккаунта». Если сервер откажет — источник просто пропускается');
    P('archive', 'trigger', true, 'Internet Archive', 'Бесплатные фильмы без авторизации (в основном общественное достояние)');
    P('view', 'select', 'list', 'Вид', '', { list: 'Список', grid: 'Плитки' });
    P('sort', 'select', 'source', 'Сортировка', '', { source: 'Как у источника', quality: 'По качеству' });
    P('scale', 'select', '1', 'Масштаб', 'Размер текста на ТВ', { '0.85': 'Мельче', '1': 'Обычный', '1.2': 'Крупнее', '1.4': 'Очень крупно' }, applyCss);
    P('cfgurl', 'input', '', 'Адрес конфигурации (JSON)', 'Удобно править на ПК, а на ТВ только вставить ссылку');
    Lampa.SettingsApi.addParam({
      component: NAME,
      param: { name: NAME + '_import', type: 'button' },
      field: { name: 'Загрузить настройки по ссылке' },
      onChange: importConfig
    });
  }

  if (window.appready) init();
  else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') init(); });
})();
