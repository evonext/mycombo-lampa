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
    var css = [
      '.mc-root{position:relative;font-size:' + z + 'em;color:#fff}',
      '.mc-wrap{position:relative;height:calc(100vh - 6.2em);overflow:hidden;overflow:clip}',
      '.mc-inner{position:relative;padding:0 2em 4em 1.5em;transition:transform .28s ease;will-change:transform}',
      '.mc-track{position:absolute;right:.5em;top:.4em;bottom:.4em;width:.28em;border-radius:1em;background:rgba(255,255,255,.12);opacity:0;transition:opacity .3s}',
      '.mc-track.on{opacity:1}',
      '.mc-track i{position:absolute;left:0;right:0;top:0;border-radius:1em;background:rgba(255,255,255,.65)}',

      /* шапка */
      '.mc-hero{display:flex;padding:.8em 0 1em}',
      '.mc-poster{flex:none;width:9.5em;height:14em;border-radius:.7em;background:rgba(255,255,255,.08) center/cover no-repeat;box-shadow:0 .4em 1.4em rgba(0,0,0,.45)}',
      '.mc-info{flex:1;min-width:0;margin-left:1.6em;display:flex;flex-direction:column}',
      '.mc-title{font-size:2.3em;font-weight:700;line-height:1.1}',
      '.mc-orig{opacity:.55;margin-top:.25em;font-size:1.1em}',
      '.mc-meta{display:flex;flex-wrap:wrap;align-items:center;margin-top:.7em;font-size:1.15em}',
      '.mc-meta span{margin-right:1em;opacity:.85}',
      '.mc-meta .mc-rate{padding:.05em .55em;border-radius:.4em;background:#e5b73b;color:#000;font-weight:700;opacity:1}',
      '.mc-desc{margin-top:.8em;font-size:1.1em;line-height:1.45;opacity:.8;max-width:46em;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}',
      '.mc-actions{display:flex;flex-wrap:wrap;margin-top:auto;padding-top:1em}',

      /* кнопки и фильтры */
      '.mc-btn{display:inline-flex;align-items:center;padding:.65em 1.4em;margin:0 .7em .5em 0;border-radius:2em;background:rgba(255,255,255,.1);font-size:1.25em}',
      '.mc-btn.focus{background:#fff;color:#000;transform:scale(1.04)}',
      '.mc-btn--main{background:#e5b73b;color:#000;font-weight:700}',
      '.mc-btn--main.focus{background:#fff}',
      '.mc-btn small{margin-left:.7em;opacity:.7;font-size:.8em;font-weight:400}',
      '.mc-bar{display:flex;flex-wrap:wrap;padding:.3em 0 .6em}',
      '.mc-sect{margin:.6em 0 .4em;font-size:1.1em;opacity:.55;text-transform:uppercase;letter-spacing:.08em}',

      /* строки списка */
      '.mc-ep{position:relative;display:flex;align-items:center;margin:.45em 0;padding:.8em 1.1em;border-radius:.9em;background:rgba(255,255,255,.07);overflow:hidden}',
      '.mc-ep.focus{background:#fff;color:#000;transform:scale(1.012);box-shadow:0 .3em 1.2em rgba(0,0,0,.4)}',
      '.mc-ep__img{flex:none;position:relative;width:11.5em;height:6.5em;margin-right:1.2em;border-radius:.6em;background:rgba(255,255,255,.1) center/cover no-repeat}',
      '.mc-ep__n{position:absolute;left:.4em;top:.3em;padding:0 .5em;border-radius:.4em;background:rgba(0,0,0,.65);color:#fff;font-size:.95em;font-weight:700}',
      '.mc-ep__num{flex:none;width:2.4em;margin-right:.8em;text-align:center;font-size:1.5em;font-weight:700;opacity:.6}',
      '.mc-ep__body{flex:1;min-width:0}',
      '.mc-ep__t{font-size:1.45em;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.mc-ep__s{margin-top:.25em;font-size:1em;opacity:.65}',
      '.mc-ep__d{margin-top:.35em;font-size:1em;line-height:1.35;opacity:.7;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.mc-ep__st{margin-top:.35em;font-size:.95em;opacity:.8}',
      '.mc-ep__r{flex:none;margin-left:1em;text-align:right;display:flex;align-items:center}',
      '.mc-ep__src{opacity:.55;font-size:.95em;margin-right:.6em}',
      '.mc-ep__ok{font-size:1.5em;opacity:.8}',
      '.mc-b{margin-left:.5em;padding:.02em .5em;border-radius:.4em;border:2px solid currentColor;font-size:.85em;white-space:nowrap}',
      '.mc-prog{height:.3em;margin-top:.55em;border-radius:1em;background:rgba(255,255,255,.2);overflow:hidden}',
      '.mc-prog i{display:block;height:100%;border-radius:1em;background:#e5b73b}',
      '.mc-ep.focus .mc-prog{background:rgba(0,0,0,.15)}',
      '.mc-empty{padding:2.5em 1em;text-align:center;font-size:1.5em;opacity:.7}'
    ].join('');
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
        // сериал: серии берутся из TMDB в интерфейсе, поток запрашивается при выборе серии
        bals.forEach(function (b) {
          out.push({
            src: host + '/' + b.balanser, srcn: b.name || b.balanser, tvsrc: true,
            resolveFor: function (sn, ep, cb) {
              request(base + '/lite/' + encodeURIComponent(b.balanser) + '?' + lcParams(movie, { season: sn, episode: ep }),
                function (j) {
                  var r = parseStreams(j, b, host);
                  if (!r.length) note(host + '/' + b.balanser + ' s' + sn + 'e' + ep + ': ответ ' + preview(j));
                  cb(r);
                }, function (code) { note(host + '/' + b.balanser + ': ошибка ' + code); cb([]); });
            }
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
        all = all.filter(function (i) { if (!i.url) return true; if (seen[i.url]) return false; seen[i.url] = 1; return true; });
        cache[key] = { t: Date.now(), d: all, n: tasks.length, diag: DIAG };
        done(all, tasks.length);
      });
    });
  }

  // ---------- компонент ----------
  function tmdbImg(size, path) {
    if (!path) return '';
    try { return Lampa.TMDB.image('t/p/' + size + path); } catch (e) { return 'https://image.tmdb.org/t/p/' + size + path; }
  }

  function Component(object) {
    var html = $('<div class="mc-root"></div>');
    var wrap = $('<div class="mc-wrap"></div>');
    var inner = $('<div class="mc-inner"></div>');
    var track = $('<div class="mc-track"><i></i></div>');
    var hero = $('<div class="mc-hero"></div>');
    var bar = $('<div class="mc-bar"></div>');
    var list = $('<div class="mc-list"></div>');
    inner.append(hero).append(bar).append(list);
    wrap.append(inner);
    html.append(wrap).append(track);

    var movie = object.movie, items = [], sources = [], seasons = [], epCache = {};
    var tv = isTv(movie);
    var curSrc = get('src', ''), curSeason = object.season || 0, last, self = this, shift = 0;
    var actions;

    // ---- собственная прокрутка (не зависит от Lampa.Scroll) ----
    // Браузер/Lampa может сам прокрутить контейнер при фокусе (overflow:hidden это не запрещает программно),
    // и тогда сдвиг складывается с моим transform: верх страницы остаётся обрезанным. Сбрасываем нативную прокрутку.
    function unscroll() {
      var n = wrap[0], k = 0;
      while (n && k++ < 5) {
        if (n.scrollTop) n.scrollTop = 0;
        if (n.scrollLeft) n.scrollLeft = 0;
        n = n.parentElement;
      }
    }
    wrap.on('scroll', unscroll);
    function setShift(y, max, H, IH) {
      unscroll();
      shift = y;
      inner.css('transform', 'translate3d(0,' + (-shift) + 'px,0)');
      if (max <= 0) return track.removeClass('on');
      var TH = track.height(), len = Math.max(TH * 0.08, TH * H / IH);
      track.addClass('on').find('i').css({ height: len + 'px', top: (TH - len) * (shift / max) + 'px' });
    }
    function reveal(el) {
      var H = wrap.height(), IH = inner[0].scrollHeight || inner.height();
      var top = 0, n = el;
      while (n && n !== inner[0]) { top += n.offsetTop; n = n.offsetParent; }
      var h = el.offsetHeight, max = Math.max(0, IH - H);
      // элемент целиком помещается без прокрутки (шапка, фильтры, первые серии) → показываем страницу сверху
      var y = (top + h + 16 <= H) ? 0 : Math.max(0, Math.min(max, top - H * 0.3));
      setShift(y, max, H, IH);
    }
    function toTop() {
      var H = wrap.height(), IH = inner[0].scrollHeight || inner.height();
      setShift(0, Math.max(0, IH - H), H, IH);
    }
    function focusable(e) { last = e.target; reveal(e.target); }

    // ---- таймлайн Lampa (прогресс просмотра, «продолжить») ----
    function tlHash(season, episode) {
      var t = movie.original_name || movie.original_title || movie.title || movie.name || '';
      return Lampa.Utils.hash(season ? [season, season > 10 ? ':' : '', episode, t].join('') : t);
    }
    function tlView(season, episode) {
      try { return Lampa.Timeline.view(tlHash(season, episode)); } catch (e) { return null; }
    }
    function pct(v) { return v && v.percent ? v.percent : 0; }
    function leftText(v) {
      if (!v || !v.percent) return '';
      if (v.percent >= 90) return 'Просмотрено';
      var left = v.duration && v.time ? Math.max(1, Math.round((v.duration - v.time) / 60)) : 0;
      return left ? 'Осталось ' + left + ' мин' : 'Просмотрено ' + Math.round(v.percent) + '%';
    }
    function history() { try { Lampa.Favorite.add('history', movie, 100); } catch (e) {} }

    function isSeen(k) { return arr('seen_' + movie.id).indexOf(k) > -1; }
    function markSeen(k) { var a = arr('seen_' + movie.id); if (a.indexOf(k) < 0) { a.push(k); set('seen_' + movie.id, a); } }
    function favs() { return arr('fav_' + movie.id); }
    function toggleIn(name, k) {
      var a = arr(name + movie.id), p = a.indexOf(k);
      if (p > -1) a.splice(p, 1); else a.push(k);
      set(name + movie.id, a);
    }

    // ---- шапка с информацией ----
    function buildHero() {
      var m = movie, year = ((m.release_date || m.first_air_date || '') + '').slice(0, 4);
      var rt = m.runtime || (m.episode_run_time && m.episode_run_time[0]) || 0;
      var gen = (m.genres || []).map(function (g) { return g && g.name; }).filter(Boolean).slice(0, 3).join(', ');
      var meta = [];
      if (m.vote_average > 0) meta.push('<span class="mc-rate">★ ' + Number(m.vote_average).toFixed(1) + '</span>');
      if (year) meta.push('<span>' + year + '</span>');
      if (tv && m.number_of_seasons) meta.push('<span>' + m.number_of_seasons + ' сез.' + (m.number_of_episodes ? ' · ' + m.number_of_episodes + ' сер.' : '') + '</span>');
      if (rt) meta.push('<span>' + rt + ' мин</span>');
      if (gen) meta.push('<span></span>');
      hero.empty();
      var poster = $('<div class="mc-poster"></div>');
      var img = tmdbImg('w342', m.poster_path);
      if (img) poster.css('background-image', 'url(' + img + ')');
      var info = $('<div class="mc-info"><div class="mc-title"></div><div class="mc-orig"></div><div class="mc-meta"></div><div class="mc-desc"></div></div>');
      info.find('.mc-title').text(m.title || m.name || '');
      var orig = m.original_title || m.original_name || '';
      info.find('.mc-orig').text(orig && orig !== (m.title || m.name) ? orig : '').toggle(!!(orig && orig !== (m.title || m.name)));
      info.find('.mc-meta').html(meta.join(''));
      if (gen) info.find('.mc-meta span').last().text(gen);
      info.find('.mc-desc').text(m.overview || '');
      actions = $('<div class="mc-actions"></div>');
      info.append(actions);
      hero.append(poster).append(info);
    }

    this.create = function () {
      buildHero();
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
        if (tv) seasons = seasonList();
        seasons.sort(function (a, b) { return a - b; });
        if (!curSeason) curSeason = get('season_' + movie.id, 0) || seasons[0] || 1;
        if (seasons.indexOf(curSeason) < 0 && seasons.length) curSeason = seasons[0];
        if (curSrc && sources.indexOf(curSrc) < 0) curSrc = '';
        if (tv && !curSrc) curSrc = sources[0] || ''; // у сериала серии берутся у одного источника
        self.draw();
        self.activity.toggle();
      });
    };

    this.empty = function (msg) {
      bar.empty(); list.empty();
      if (actions) actions.empty();
      var dg = DIAG.map(function (l) { return $('<div>').text(l).html(); }).join('<br>');
      list.append('<div class="mc-empty">' + (msg || 'Ничего не найдено') +
        (dg ? '<div style="font-size:.6em;margin-top:1.5em;text-align:left;opacity:.8">' + dg + '</div>' : '') + '</div>');
      this.activity.toggle();
    };

    function button(text, enter, cls, small) {
      var b = $('<div class="mc-btn selector' + (cls ? ' ' + cls : '') + '"></div>').text(text);
      if (small) b.append($('<small></small>').text(small));
      b.on('hover:enter', enter);
      b.on('hover:focus', focusable);
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

    // ---- данные: сезоны и серии ----
    function seasonList() {
      var a = (movie.seasons || []).filter(function (x) { return x && x.season_number > 0; }).map(function (x) { return x.season_number; });
      if (!a.length && movie.number_of_seasons) for (var n = 1; n <= movie.number_of_seasons; n++) a.push(n);
      return a.length ? a : [1];
    }
    function loadEpisodes(sn, cb) {
      var cnt = 0;
      (movie.seasons || []).forEach(function (x) { if (x && x.season_number === sn) cnt = x.episode_count || 0; });
      function fallback(why) {
        note('Серии сезона ' + sn + ' не получены из TMDB (' + why + '), показаны 1..' + (cnt || 12));
        var a = [];
        for (var n = 1; n <= (cnt || 12); n++) a.push({ n: n, name: '' });
        epCache[sn] = a; cb();
      }
      try {
        if (!Lampa.TMDB || !Lampa.TMDB.api) return fallback('нет Lampa.TMDB');
        var lang = Lampa.Storage.field('tmdb_lang') || Lampa.Storage.field('language') || 'ru';
        var url = Lampa.TMDB.api('tv/' + movie.id + '/season/' + sn + '?api_key=' + Lampa.TMDB.key() + '&language=' + lang);
        request(url, function (j) {
          var a = ((j && j.episodes) || []).map(function (e) {
            return { n: e.episode_number, name: e.name || '', air: e.air_date || '', runtime: e.runtime || 0, still: e.still_path || '', overview: e.overview || '' };
          });
          if (!a.length) return fallback('пустой ответ');
          epCache[sn] = a; cb();
        }, function (code) { fallback('ошибка ' + code); });
      } catch (e) { fallback('исключение'); }
    }
    function dateText(s) {
      if (!s) return '';
      try { return new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return s; }
    }

    // ---- потоки ----
    function qualityMap(streams, voice) {
      var m = {};
      streams.forEach(function (x) { if ((!voice || x.voice === voice) && x.quality && !m[x.quality]) m[x.quality] = x.url; });
      return m;
    }
    function bestOf(streams, voice, quality) {
      var c = streams.filter(function (x) { return !voice || x.voice === voice; });
      if (!c.length) c = streams;
      var same = quality ? c.filter(function (x) { return x.quality === quality; })[0] : null;
      return same || c.slice().sort(function (x, y) { return qRank(y.quality) - qRank(x.quality); })[0];
    }
    function qOrMap(streams, voice, fallbackQ) {
      var m = qualityMap(streams, voice);
      return Object.keys(m).length > 1 ? m : fallbackQ;
    }
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
        g.url = g.streams[0].url; g.quality = g.streams[0].quality;
        g.key = keyOf(g);
      });
      return out;
    }
    function keyOf(i) { return i.episode ? (i.season || 0) + 'x' + i.episode : 'v:' + (i.srcn || '') + '|' + (i.voice || ''); }

    function play(title, s, all) {
      history();
      var cur = { title: title, url: s.url, subtitles: s.subtitles, quality: all ? qOrMap(all, s.voice, s.quality) : s.quality };
      var v = tlView(0, 0); if (v) cur.timeline = v;
      Lampa.Player.play(cur);
      Lampa.Player.playlist([cur]);
    }
    // сериал: плейлист всего сезона, серии запрашиваются «лениво», когда плеер до них доходит
    function playSeries(rows, g, s, streams) {
      history();
      set('tvpick', { voice: s.voice, quality: s.quality });
      var name = movie.title || movie.name;
      var label = function (r) { return name + ' · s' + r.season + 'e' + r.episode + (s.voice ? ' · ' + s.voice : ''); };
      var cur = { title: label(g), url: s.url, subtitles: s.subtitles, season: g.season, episode: g.episode, quality: qOrMap(streams, s.voice, s.quality) };
      var v0 = tlView(g.season, g.episode); if (v0) cur.timeline = v0;
      var pl = rows.map(function (r) {
        if (r === g) return cur;
        var it = { title: label(r), season: r.season, episode: r.episode };
        var v = tlView(r.season, r.episode); if (v) it.timeline = v;
        it.url = function (call) {
          var me = (this && this.episode === r.episode) ? this : it;
          r.resolve(function (list) {
            var b = list.length ? bestOf(list, s.voice, s.quality) : null;
            if (!b) { Lampa.Noty.show('Серия ' + r.episode + ' недоступна у этого источника'); try { Lampa.Player.close(); } catch (e) {} return; }
            me.url = b.url; me.quality = qOrMap(list, b.voice, b.quality);
            if (b.subtitles) me.subtitles = b.subtitles;
            call();
          });
        };
        return it;
      });
      Lampa.Player.play(cur);
      Lampa.Player.playlist(pl);
    }
    function chooseStream(streams, cb) {
      choose('Озвучка / качество', streams.map(function (x) {
        return { title: (x.voice ? x.voice + ' · ' : '') + (x.quality || 'auto'), value: x };
      }), cb);
    }

    // запуск строки (серия или озвучка фильма)
    function open(g, rows, title) {
      set('last_' + movie.id, g.key); markSeen(g.key);
      if (g.resolve) {
        Lampa.Noty.show('Загрузка…');
        return g.resolve(function (streams) {
          if (!streams.length) return Lampa.Noty.show('Балансер не вернул потоков для этой серии');
          var pick = get('tvpick', null), known = pick && streams.some(function (x) { return x.voice === pick.voice; });
          if (streams.length === 1) return playSeries(rows, g, streams[0], streams);
          if (known) return playSeries(rows, g, bestOf(streams, pick.voice, pick.quality), streams); // озвучка запомнена
          chooseStream(streams, function (x) { playSeries(rows, g, x, streams); });
        });
      }
      play(title, g.streams ? g.streams[0] : g, g.streams);
    }

    // что показать на главной кнопке
    function mainTarget(rows) {
      if (tv) {
        var inprog = rows.filter(function (r) { var p = pct(r.view); return p > 2 && p < 90; });
        if (inprog.length) return { row: inprog[inprog.length - 1], label: 'Продолжить', sub: 'Серия ' + inprog[inprog.length - 1].episode };
        var li = -1;
        rows.forEach(function (r, i) { if (pct(r.view) >= 90 || isSeen(r.key)) li = i; });
        var nx = rows[Math.min(li + 1, rows.length - 1)];
        return { row: nx, label: li >= 0 ? 'Следующая серия' : 'Смотреть', sub: 'Серия ' + nx.episode };
      }
      var lk = get('last_' + movie.id, ''), row = rows.filter(function (r) { return r.key === lk; })[0] || rows[0];
      var p = pct(tlView(0, 0));
      return { row: row, label: p > 2 && p < 90 ? 'Продолжить' : 'Смотреть', sub: row.title };
    }

    this.draw = function () {
      if (!items.length) return this.empty();
      buildHero(); bar.empty(); list.empty();

      // фильтры
      if (sources.length > 1) {
        var cnt = {}; items.forEach(function (i) { var s = i.srcn || i.src; cnt[s] = (cnt[s] || 0) + 1; });
        bar.append(button('Источник: ' + (curSrc || 'все (' + sources.length + ')') + ' ▾', function () {
          var opts = sources.map(function (n) { return { title: tv ? n : n + ' · ' + cnt[n] + ' шт.', value: n, selected: n === curSrc }; });
          if (!tv) opts.unshift({ title: 'Все источники (' + sources.length + ')', value: '', selected: !curSrc });
          choose('Источник', opts, function (v) { curSrc = v; set('src', v); redraw(); });
        }));
      }
      if (seasons.length > 1) {
        bar.append(button('Сезон ' + curSeason + ' ▾', function () {
          choose('Сезон', seasons.map(function (s) { return { title: 'Сезон ' + s, value: s, selected: s === curSeason }; }),
            function (v) { curSeason = v; set('season_' + movie.id, v); redraw(); });
        }));
      }
      bar.append(button((fld('sort', 'source') === 'quality' ? 'Сортировка: по качеству' : 'Сортировка: как есть') + ' ▾', function () {
        Lampa.Storage.set(NAME + '_sort', fld('sort', 'source') === 'quality' ? 'source' : 'quality'); redraw();
      }));

      var inSrc = items.filter(function (i) {
        return (!curSrc || (i.srcn || i.src) === curSrc) && (!seasons.length || !i.season || i.season === curSeason);
      });
      var rows;
      if (tv) {
        var eps = epCache[curSeason];
        if (!eps) {
          list.append('<div class="mc-empty">Загрузка серий…</div>');
          loadEpisodes(curSeason, function () { self.draw(); self.start(); });
          return;
        }
        var src = inSrc[0] || items[0];
        rows = eps.map(function (e) {
          return {
            episode: e.n, season: curSeason, srcn: src.srcn, key: curSeason + 'x' + e.n, ep: e,
            title: 'Серия ' + e.n + (e.name ? ' · ' + e.name : ''),
            resolve: function (cb) { src.resolveFor(curSeason, e.n, cb); }
          };
        });
        rows.forEach(function (r) { r.view = tlView(r.season, r.episode); });
      } else {
        rows = groupVoices(inSrc);
        var mv = tlView(0, 0), lk0 = get('last_' + movie.id, '');
        rows.forEach(function (r) { r.view = r.key === lk0 ? mv : null; });
      }
      if (!rows.length) { list.append('<div class="mc-empty">Нет вариантов для выбранного источника</div>'); return; }

      if (fld('sort', 'source') === 'quality' && !tv) rows.sort(function (a, b) { return qRank(b.quality) - qRank(a.quality); });
      var fv = favs();
      rows.forEach(function (r, n) { r._i = n; });
      rows.sort(function (a, b) { return ((fv.indexOf(b.key) > -1) - (fv.indexOf(a.key) > -1)) || (a._i - b._i); });

      // главная кнопка в шапке
      var mt = mainTarget(rows);
      actions.append(button('▶ ' + mt.label, function () { open(mt.row, rows, mt.row.title || movie.title || movie.name); }, 'mc-btn--main', mt.sub));
      if (!last) last = actions.find('.selector')[0];

      list.append('<div class="mc-sect">' + (tv ? 'Сезон ' + curSeason + ' · ' + rows.length + ' сер.' : 'Озвучки · ' + rows.length) + '</div>');

      var lastKey = get('last_' + movie.id, '');
      rows.forEach(function (g) {
        var key = g.key;
        var title = g.title || movie.title || movie.name;
        var row = $('<div class="mc-ep selector"></div>');
        var body = $('<div class="mc-ep__body"><div class="mc-ep__t"></div><div class="mc-ep__s"></div></div>');
        body.find('.mc-ep__t').text(title);
        var right = $('<div class="mc-ep__r"></div>');

        if (tv) {
          var e = g.ep || {};
          var img = $('<div class="mc-ep__img"><span class="mc-ep__n"></span></div>');
          img.find('.mc-ep__n').text(g.episode);
          var still = tmdbImg('w300', e.still);
          if (still) img.css('background-image', 'url(' + still + ')');
          row.append(img);
          body.find('.mc-ep__t').text(e.name ? e.name : 'Серия ' + g.episode);
          body.find('.mc-ep__s').text([dateText(e.air), e.runtime ? e.runtime + ' мин' : ''].filter(Boolean).join(' · '));
          if (e.overview) body.append($('<div class="mc-ep__d"></div>').text(e.overview));
        } else {
          var quals = [];
          g.streams.forEach(function (s) { if (s.quality && quals.indexOf(s.quality) < 0) quals.push(s.quality); });
          body.find('.mc-ep__s').text(g.srcn ? 'Источник: ' + g.srcn + (g.streams.length > 1 ? ' · вариантов качества: ' + g.streams.length : '') : '');
          quals.slice(0, 4).forEach(function (q) { right.append($('<span class="mc-b"></span>').text(q)); });
        }

        var p = pct(g.view), seen = p >= 90 || isSeen(key);
        if (p > 0) {
          body.append($('<div class="mc-prog"><i></i></div>')).find('.mc-prog i').css('width', Math.min(100, p) + '%');
          body.append($('<div class="mc-ep__st"></div>').text(leftText(g.view)));
        } else if (key === lastKey && !tv) {
          body.append($('<div class="mc-ep__st">Последний запуск</div>'));
        }
        if (fv.indexOf(key) > -1) right.prepend('<span class="mc-ep__ok">★</span>');
        else if (seen) right.prepend('<span class="mc-ep__ok">✓</span>');
        if (tv && sources.length > 1) right.prepend($('<span class="mc-ep__src"></span>').text(g.srcn || ''));

        row.append(body).append(right);
        row.on('hover:focus', focusable);
        row.on('hover:enter', function () { open(g, rows, tv ? (movie.title || movie.name) + ' · s' + g.season + 'e' + g.episode : title); });
        row.on('hover:long', function () { self.menu(g, key, title, rows); });
        list.append(row);
        if (key === lastKey && !last) last = row[0];
      });
      if (tv && mt && mt.row) { // фокус сразу на нужной серии, если шапка не в фокусе
        var rr = list.find('.mc-ep')[rows.indexOf(mt.row)];
        if (rr) last = rr;
      }
    };

    this.menu = function (g, key, title, rows) {
      var fv = favs(), isFav = fv.indexOf(key) > -1;
      var opts = [];
      if (g.streams && g.streams.length > 1) opts.push({ title: 'Выбрать качество (' + g.streams.length + ')', value: 'q' });
      if (g.resolve) opts.push({ title: 'Выбрать озвучку / качество', value: 'tvq' });
      opts.push({ title: isFav ? 'Убрать из избранного' : 'В избранное', value: 'fav' });
      opts.push({ title: isSeen(key) ? 'Снять отметку «просмотрено»' : 'Отметить просмотренным', value: 'seen' });
      opts.push({ title: 'Обновить', value: 'reload' });
      choose('MyCombo', opts, function (v) {
        if (v === 'q') return chooseStream(g.streams, function (x) { play(title, x, g.streams); });
        if (v === 'tvq') {
          Lampa.Noty.show('Загрузка…');
          return g.resolve(function (streams) {
            if (!streams.length) return Lampa.Noty.show('Нет потоков');
            chooseStream(streams, function (x) { playSeries(rows, g, x, streams); });
          });
        }
        if (v === 'fav') toggleIn('fav_', key);
        if (v === 'seen') toggleIn('seen_', key);
        if (v === 'reload') { cache = {}; epCache = {}; return self.fetch(); }
        redraw();
      });
    };

    this.start = function () {
      Lampa.Controller.add('content', {
        toggle: function () {
          Lampa.Controller.collectionSet(html);
          Lampa.Controller.collectionFocus(last || false, html);
          if (last) reveal(last);
        },
        up: function () { if (Navigator.canmove('up')) Navigator.move('up'); else { toTop(); Lampa.Controller.toggle('head'); } },
        down: function () { Navigator.move('down'); },
        left: function () { if (Navigator.canmove('left')) Navigator.move('left'); else Lampa.Controller.toggle('menu'); },
        right: function () { Navigator.move('right'); },
        back: function () { Lampa.Activity.backward(); }
      });
      Lampa.Controller.toggle('content');
    };

    this.pause = function () {}; this.stop = function () {};
    this.render = function () { return html; };
    this.destroy = function () { html.remove(); items = []; };
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
