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
  var TIMEOUT = 20000;
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
      '.mc-bar{display:flex;flex-wrap:wrap;gap:.6em;padding:.6em 1.5em}' +
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

  // Сервер с протоколом online.js:
  //   /lite/events            → [{balanser, name, account_only, ...}]
  //   /lite/{balanser}?params → {streams:[{url, quality, voice, subtitles, ...}]}
  // Платные балансеры опрашиваются, если включена настройка «Все балансеры»; при отказе сервера — пропускаются.
  function myUid() {
    var u = get('uid', '');
    if (!u) { u = 'mc' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); set('uid', u); } // собственный id плагина
    return u;
  }
  function isTv(m) { return !!(m.name || m.first_air_date || m.number_of_seasons); }
  function lcParams(movie, extra) {
    var o = {
      id: movie.id, tmdb_id: movie.id, imdb_id: movie.imdb_id, kinopoisk_id: movie.kinopoisk_id,
      title: movie.title || movie.name, original_title: movie.original_title || movie.original_name,
      original_language: movie.original_language, serial: isTv(movie) ? 1 : 0,
      year: ((movie.release_date || movie.first_air_date || '') + '').slice(0, 4), uid: myUid()
    };
    var g = (movie.genres || []).map(function (x) { return x && x.id; }).filter(Boolean).join(',');
    if (g) o.genres = g;
    for (var k in (extra || {})) o[k] = extra[k];
    Object.keys(o).forEach(function (k) { if (o[k] === undefined || o[k] === null || o[k] === '') delete o[k]; });
    return $.param(o);
  }
  function preview(j) {
    try { return (typeof j === 'string' ? j : JSON.stringify(j)).replace(/\s+/g, ' ').slice(0, 140); } catch (e) { return ''; }
  }
  function parseStreams(j, b, host) {
    if (typeof j === 'string') { try { j = JSON.parse(j); } catch (e) { return []; } }
    var st = (j && j.streams) || [];
    var out = [];
    st.forEach(function (s) {
      if (!s || !s.url) return;
      var item = {
        src: host + '/' + b.balanser, srcn: b.name || b.balanser,
        voice: ((s.voice || '') + '').trim() || b.name || b.balanser,
        quality: s.quality || '', url: s.url
      };
      if (Array.isArray(s.subtitles)) {
        item.subtitles = s.subtitles.filter(function (x) { return x && x.url; })
          .map(function (x) { return { label: x.label || x.name || x.lang || 'sub', url: x.url }; });
      }
      if (!bad(item)) out.push(item);
    });
    return out;
  }

  function fromLampac(base, movie, season, done) {
    base = (base + '').replace(/\/+$/, '');
    var host = hostOf(base);
    request(base + '/lite/events?' + lcParams(movie), function (list) {
      if (typeof list === 'string') { try { list = JSON.parse(list); } catch (e) {} }
      if (!Array.isArray(list)) { note(host + ': /lite/events вернул не список: ' + preview(list)); return done([]); }
      var bals = list.filter(function (b) {
        return b && b.balanser && b.balanser !== 'example' && (fld('paid', true) || (!b.account_only && !b.paid && !b.need_auth));
      }).slice(0, 40);
      note(host + ': балансеров всего ' + list.length + ', к опросу ' + bals.length + (bals.length ? ' (' + bals.map(function (b) { return b.balanser; }).join(', ') + ')' : ''));
      if (!bals.length) return done([]);
      var out = [];

      if (isTv(movie)) {
        // сериал: серии берутся из TMDB, поток запрашивается при выборе серии
        var seasons = (movie.seasons || []).filter(function (s) { return s && s.season_number > 0 && s.episode_count > 0; });
        if (!seasons.length) seasons = [{ season_number: 1, episode_count: 12 }];
        bals.forEach(function (b) {
          seasons.forEach(function (s) {
            for (var e = 1; e <= s.episode_count; e++) (function (sn, ep) {
              out.push({
                src: host + '/' + b.balanser, srcn: b.name || b.balanser, voice: b.name || b.balanser,
                season: sn, episode: ep, title: 'Серия ' + ep,
                resolve: function (cb) {
                  request(base + '/lite/' + encodeURIComponent(b.balanser) + '?' + lcParams(movie, { season: sn, episode: ep }),
                    function (j) { cb(parseStreams(j, b, host)); }, function () { cb([]); });
                }
              });
            })(s.season_number, e);
          });
        });
        note(host + ': сериал, потоки запрашиваются при выборе серии');
        return done(out);
      }

      var pending = bals.length;
      function fin() { if (!--pending) done(out); }
      bals.forEach(function (b) {
        request(base + '/lite/' + encodeURIComponent(b.balanser) + '?' + lcParams(movie), function (j) {
          var r = parseStreams(j, b, host);
          out = out.concat(r);
          note(host + '/' + b.balanser + ': потоков ' + r.length + (r.length ? '' : ' · ответ: ' + preview(j)));
          fin();
        }, function (code) { note(host + '/' + b.balanser + ': ошибка ' + code); fin(); });
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
    note('MyCombo v3 (разбор streams)');

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
    var bar = $('<div class="mc-bar"></div>');
    var list = $('<div></div>');
    var movie = object.movie, items = [], sources = [], seasons = [];
    var tv = isTv(movie);
    var curSrc = get('src', ''), curSeason = object.season || 0, last, self = this;

    function keyOf(i) { return i.episode ? (i.season || 0) + 'x' + i.episode : 'v:' + (i.srcn || '') + '|' + (i.voice || ''); }
    function isSeen(k) { return arr('seen_' + movie.id).indexOf(k) > -1; }
    function markSeen(k) { var a = arr('seen_' + movie.id); if (a.indexOf(k) < 0) { a.push(k); set('seen_' + movie.id, a); } }
    function favs() { return arr('fav_' + movie.id); }
    function toggleIn(name, k) {
      var a = arr(name + movie.id), p = a.indexOf(k);
      if (p > -1) a.splice(p, 1); else a.push(k);
      set(name + movie.id, a);
    }

    this.create = function () {
      scroll.append(bar); scroll.append(list);
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
        items = d; sources = []; seasons = [];
        d.forEach(function (i) {
          var s = i.srcn || i.src || '';
          if (s && sources.indexOf(s) < 0) sources.push(s);
          if (i.season && seasons.indexOf(i.season) < 0) seasons.push(i.season);
        });
        seasons.sort(function (a, b) { return a - b; });
        if (!curSeason && seasons.length) curSeason = seasons[0];
        if (curSrc && sources.indexOf(curSrc) < 0) curSrc = '';
        if (tv && !curSrc) curSrc = sources[0] || ''; // у сериала серии берутся у одного источника
        self.draw();
        self.activity.toggle();
      });
    };

    this.empty = function (msg) {
      bar.empty();
      var dg = DIAG.map(function (l) { return $('<div>').text(l).html(); }).join('<br>');
      list.empty().append('<div class="mc-empty">' + (msg || 'Ничего не найдено') +
        (dg ? '<div style="font-size:.6em;margin-top:1.5em;text-align:left;opacity:.8">' + dg + '</div>' : '') + '</div>');
      this.activity.toggle();
    };

    function button(text, enter) {
      var b = $('<div class="mc-chip selector"></div>').text(text);
      b.on('hover:enter', enter);
      b.on('hover:focus', function (e) { last = e.target; scroll.update($(e.target), true); });
      return b;
    }
    function choose(title, opts, cb) {
      Lampa.Select.show({
        title: title,
        items: opts,
        onSelect: function (a) { cb(a.value); },
        onBack: function () { Lampa.Controller.toggle('content'); }
      });
    }
    function redraw() { last = false; self.draw(); self.start(); }

    // группировка: фильм → одна строка на озвучку (все качества внутри), сериал → серии
    function groupVoices(inSrc) {
      var map = {}, out = [];
      inSrc.forEach(function (i) {
        var k = (i.srcn || '') + '|' + (i.voice || '');
        var g = map[k];
        if (!g) { g = map[k] = { srcn: i.srcn, src: i.src, voice: i.voice, title: i.voice || i.title || movie.title || movie.name, streams: [] }; out.push(g); }
        g.streams.push(i);
      });
      out.forEach(function (g) {
        g.streams.sort(function (a, b) { return qRank(b.quality) - qRank(a.quality); });
        g.url = g.streams[0].url; g.quality = g.streams[0].quality; g.subtitles = g.streams[0].subtitles;
        g.key = keyOf(g);
      });
      return out;
    }

    function play(title, s) {
      var pl = [{ title: title, url: s.url, subtitles: s.subtitles, quality: s.quality }];
      Lampa.Player.play({ title: title, url: s.url, subtitles: s.subtitles, quality: s.quality, playlist: pl });
      Lampa.Player.playlist(pl);
    }
    function pickStream(title, streams) {
      choose('Озвучка / качество', streams.map(function (s) {
        return { title: (s.voice ? s.voice + ' · ' : '') + (s.quality || 'auto'), value: s };
      }), function (s) { play(title, s); });
    }

    this.draw = function () {
      if (!items.length) return this.empty();
      bar.empty(); list.empty();

      // верхняя панель: одна строка кнопок
      if (sources.length > 1) {
        var cnt = {}; items.forEach(function (i) { var s = i.srcn || i.src; cnt[s] = (cnt[s] || 0) + 1; });
        bar.append(button('Источник: ' + (curSrc || 'все (' + sources.length + ')') + ' ▾', function () {
          var opts = sources.map(function (n) { return { title: n + ' · ' + (tv ? '' : cnt[n] + ' шт.'), value: n, selected: n === curSrc }; });
          if (!tv) opts.unshift({ title: 'Все источники (' + sources.length + ')', value: '', selected: !curSrc });
          choose('Источник', opts, function (v) { curSrc = v; set('src', v); redraw(); });
        }));
      }
      if (seasons.length > 1) {
        bar.append(button('Сезон ' + curSeason + ' ▾', function () {
          choose('Сезон', seasons.map(function (s) { return { title: 'Сезон ' + s, value: s, selected: s === curSeason }; }),
            function (v) { curSeason = v; redraw(); });
        }));
      }
      bar.append(button((fld('sort', 'source') === 'quality' ? 'Сортировка: по качеству' : 'Сортировка: как у источника') + ' ▾', function () {
        Lampa.Storage.set(NAME + '_sort', fld('sort', 'source') === 'quality' ? 'source' : 'quality'); redraw();
      }));

      var inSrc = items.filter(function (i) {
        return (!curSrc || (i.srcn || i.src) === curSrc) && (!seasons.length || !i.season || i.season === curSeason);
      });
      var rows = tv ? inSrc.map(function (i) { i.key = keyOf(i); return i; }) : groupVoices(inSrc);
      if (!rows.length) { list.append('<div class="mc-empty">Нет вариантов для выбранного источника</div>'); return; }

      if (fld('sort', 'source') === 'quality' && !tv) rows.sort(function (a, b) { return qRank(b.quality) - qRank(a.quality); });
      var fv = favs();
      rows.forEach(function (r, n) { r._i = n; });
      rows.sort(function (a, b) { return ((fv.indexOf(b.key) > -1) - (fv.indexOf(a.key) > -1)) || (a._i - b._i); }); // избранное выше, порядок сохраняется

      var view = fld('view', 'list');
      var cont = view === 'grid' ? $('<div class="mc-grid"></div>') : list;
      var lastKey = get('last_' + movie.id, '');

      rows.forEach(function (g) {
        var key = g.key;
        var title = tv ? (g.title || 'Серия ' + g.episode) : (g.title || movie.title || movie.name);
        var quals = [];
        (g.streams || [g]).forEach(function (s) { if (s.quality && quals.indexOf(s.quality) < 0) quals.push(s.quality); });
        var badges = quals.slice(0, 4).map(function (q) { return '<span class="mc-b">' + $('<i>').text(q).html() + '</span>'; }).join('');
        var flag = fv.indexOf(key) > -1 ? '★' : (isSeen(key) ? '✓' : (key === lastKey ? '▶' : ''));
        var row;
        if (view === 'grid') {
          row = $('<div class="mc-tile selector"><div class="mc-tile__t"></div><div class="mc-tile__m"></div></div>');
          row.find('.mc-tile__t').text((flag ? flag + ' ' : '') + title);
          row.find('.mc-tile__m').html(badges + '<span class="mc-item__s"></span>');
          row.find('.mc-item__s').text(sources.length > 1 && !curSrc ? (g.srcn || '') : '');
        } else {
          row = $('<div class="mc-item selector"><span class="mc-flag"></span><span class="mc-item__t"></span><span class="mc-item__s"></span></div>');
          row.find('.mc-flag').text(flag);
          row.find('.mc-item__t').text(title);
          row.find('.mc-item__s').text(sources.length > 1 && !curSrc ? (g.srcn || '') : '');
          row.append(badges);
        }
        row.on('hover:focus', function (e) { last = e.target; scroll.update($(e.target), true); });
        row.on('hover:enter', function () {
          set('last_' + movie.id, key); markSeen(key);
          if (g.resolve) { // сериал: поток запрашивается для конкретной серии
            Lampa.Noty.show('Загрузка…');
            return g.resolve(function (streams) {
              if (!streams.length) return Lampa.Noty.show('Балансер не вернул потоков для этой серии');
              if (streams.length === 1) return play(title, streams[0]);
              pickStream(title, streams);
            });
          }
          play(title, g.streams ? g.streams[0] : g); // фильм: лучшее качество сразу
        });
        row.on('hover:long', function () { self.menu(g, key, title); });
        cont.append(row);
        if (key === lastKey && !last) last = row[0];
      });
      if (view === 'grid') list.append(cont);
    };

    this.menu = function (g, key, title) {
      var fv = favs(), isFav = fv.indexOf(key) > -1;
      var opts = [];
      if (g.streams && g.streams.length > 1) opts.push({ title: 'Выбрать качество (' + g.streams.length + ')', value: 'q' });
      opts.push({ title: isFav ? 'Убрать из избранного' : 'В избранное', value: 'fav' });
      opts.push({ title: isSeen(key) ? 'Снять отметку «просмотрено»' : 'Отметить просмотренным', value: 'seen' });
      opts.push({ title: 'Вид: ' + (fld('view', 'list') === 'list' ? 'плитки' : 'список'), value: 'view' });
      opts.push({ title: 'Обновить', value: 'reload' });
      choose('MyCombo', opts, function (v) {
        if (v === 'q') return pickStream(title, g.streams);
        if (v === 'fav') toggleIn('fav_', key);
        if (v === 'seen') toggleIn('seen_', key);
        if (v === 'view') Lampa.Storage.set(NAME + '_view', fld('view', 'list') === 'list' ? 'grid' : 'list');
        if (v === 'reload') { cache = {}; return self.fetch(); }
        redraw();
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
