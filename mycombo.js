/*
 * MyCombo v4.1 — личный онлайн-плагин для Lampa (Samsung Tizen).
 * Установка: https://evonext.github.io/mycombo-lampa/mycombo.js
 *
 * Источники:
 *  - серверы Lampac (протокол online.js: /lite/events → /lite/{балансер}), по умолчанию rust.bwa.ad;
 *    балансеры «только для аккаунта» опрашиваются, если включено «Платные»;
 *  - свои API (контракт ниже) и Internet Archive.
 * Интерфейс: шапка с постером/актёрами/трейлером, кнопки-фильтры (источник, сезон, озвучка, платные,
 *   сортировка), серии из TMDB с прогрессом, плейлист сезона с ленивой подгрузкой серий,
 *   поиск по своему названию, журнал ошибок и диагностика в настройках.
 *
 * Контракт своего API:  GET {api}?title=&year=&imdb=&kp=&tmdb=&type=movie|tv[&season=]
 *   → [{voice, quality, title, url, season, episode, subtitles:[{label,url}], paid?, auth?}]  (или {items:[...]})
 * Конфиг по URL (JSON):  {"apis":[...],"lampac":["https://rust.bwa.ad"],"archive":true,"paid":true}
 */
(function () {
  'use strict';
  // адрес, с которого Lampa загрузила этот файл (нужен для проверки обновлений); доступен только при первом запуске скрипта
  var SELF_URL = (function () { try { return (document.currentScript && document.currentScript.src) || ''; } catch (e) { return ''; } })();
  if (window.mycombo_ready) return;
  window.mycombo_ready = true;

  var NAME = 'mycombo';
  var TTL = 10 * 60 * 1000;
  var TIMEOUT = 20000;
  // Серверы Lampac по умолчанию (можно изменить в настройках). Берутся только бесплатные балансеры.
  var DEFAULT_LAMPAC = 'https://rust.bwa.ad';
  var VERSION = '4.1';

  // ---------- журнал ошибок ----------
  var LOG = [];
  function log(m) { LOG.push(new Date().toLocaleTimeString() + ' ' + m); if (LOG.length > 60) LOG.shift(); }
  // обёртка: любая ошибка внутри обработчика не роняет экран, а попадает в журнал (Настройки → MyCombo → Журнал ошибок)
  function safe(fn, where) {
    return function () {
      try { return fn.apply(this, arguments); }
      catch (e) {
        log(where + ': ' + (e && e.message || e));
        try { Lampa.Noty.show('MyCombo: ошибка (' + where + '), подробности в журнале'); } catch (_) {}
      }
    };
  }

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
      '.mc-hero{display:flex;margin:.4em 0 .8em;padding:1em 1.2em;border-radius:1em;background:rgba(255,255,255,.05) center/cover no-repeat}',
      '.mc-poster{flex:none;width:9.5em;height:14em;border-radius:.7em;background:rgba(255,255,255,.08) center/cover no-repeat;box-shadow:0 .4em 1.4em rgba(0,0,0,.45)}',
      '.mc-info{flex:1;min-width:0;margin-left:1.6em;display:flex;flex-direction:column}',
      '.mc-title{font-size:2.3em;font-weight:700;line-height:1.1}',
      '.mc-orig{opacity:.55;margin-top:.25em;font-size:1.1em}',
      '.mc-meta{display:flex;flex-wrap:wrap;align-items:center;margin-top:.7em;font-size:1.15em}',
      '.mc-meta span{margin-right:1em;opacity:.85}',
      '.mc-meta .mc-rate{padding:.05em .55em;border-radius:.4em;background:#e5b73b;color:#000;font-weight:700;opacity:1}',
      '.mc-desc{margin-top:.8em;font-size:1.1em;line-height:1.45;opacity:.8;max-width:46em;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}',
      '.mc-cast{margin-top:.6em;font-size:1em;opacity:.65}',
      '.mc-next{margin-top:.35em;font-size:1em;color:#e5b73b}',
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
      '.mc-miss{color:#ff8a65}',
      '.mc-ep.focus .mc-miss{color:#c0392b}',
      '.mc-live{font-size:.95em;opacity:.45;text-transform:none;letter-spacing:0}',
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
    if (/1080|fhd/i.test(q)) return 3;
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

  // ---------- здоровье источников ----------
  // Сетевая ошибка / таймаут дважды подряд → источник на 15 минут пропускается. Пустой ответ ошибкой не считается.
  var HEALTH = {}, FORCE = false;

  // контекст одного опроса: свой счётчик, своя диагностика, частичные результаты.
  // У каждого открытого экрана свой контекст, поэтому две карточки подряд не путают данные друг друга.
  var LASTDIAG = [];
  function Ctx() {
    var c = { done: 0, total: 0, diag: [], items: [], onPart: null };
    c.note = function (m) { c.diag.push(m); LASTDIAG = c.diag; };
    c.part = function (r) {
      if (!r || !r.length) return;
      c.items = c.items.concat(r);
      try { if (c.onPart) c.onPart(); } catch (e) { log('частичная отрисовка: ' + (e && e.message || e)); } // опрос не должен зависнуть
    };
    return c;
  }
  // убрать дубли по url (у сериальных источников url нет — их не трогаем)
  function uniq(list) {
    var seen = {};
    return list.filter(function (i) { if (!i.url) return true; if (seen[i.url]) return false; seen[i.url] = 1; return true; });
  }
  function hGet(k) { return HEALTH[k] || (HEALTH[k] = { fail: 0, t: 0, ms: 0, n: 0 }); }
  function hOk(k, ms) { var h = hGet(k); h.fail = 0; h.ms = h.n ? Math.round((h.ms * h.n + ms) / (h.n + 1)) : ms; h.n++; h.t = Date.now(); }
  function hFail(k) { var h = hGet(k); h.fail++; h.t = Date.now(); }
  function hDown(k) { var h = HEALTH[k]; return !FORCE && !!(h && h.fail >= 2 && Date.now() - h.t < 15 * 60 * 1000); }
  function hMs(k) { var h = HEALTH[k]; return h && h.n ? h.ms : 99999; }
  function trequest(key, url, ok, fail) {
    var t0 = Date.now();
    request(url, function (j) { hOk(key, Date.now() - t0); ok(j); }, function (c) { hFail(key); fail(c); });
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
  function fromApi(api, movie, season, done, ctx) {
    var url = api + (api.indexOf('?') > -1 ? '&' : '?') + $.param(query(movie, season));
    request(url, function (j) {
      var d = Array.isArray(j) ? j : (j && j.items) || [];
      d = d.filter(function (i) { return !bad(i); });
      d.forEach(function (i) { i.src = i.src || hostOf(api); });
      ctx.note(hostOf(api) + ': потоков ' + d.length);
      ctx.part(d);
      done(d);
    }, function (code) { ctx.note(hostOf(api) + ': ошибка ' + code); done([], code); }); // 401/402/403 → источник просто пропускается
  }
  function hostOf(u) { var m = (u + '').match(/^https?:\/\/([^\/?#]+)/i); return m ? m[1] : 'api'; }

  // Internet Archive: бесплатно, без авторизации (в основном общественное достояние)
  function fromArchive(movie, season, done, ctx) {
    if (isTv(movie)) return done([]); // только фильмы
    var note = ctx.note;
    var title = (movie.title || '').replace(/["\\()]/g, ' ').trim();
    var orig = (movie.original_title || '').replace(/["\\()]/g, ' ').trim();
    var name = movie._clar ? title : (orig || title);
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
          if (!--left) { ctx.part(out); done(out); }
        }, function () { if (!--left) { ctx.part(out); done(out); } });
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
    if (movie._clar) o.clarification = 1; // название введено вручную (как «уточнить поиск» в online.js)
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
        src: host + '/' + b.balanser, srcn: b.name || b.balanser, hkey: host + '/' + b.balanser,
        voice: ((s.voice || '') + '').trim() || b.name || b.balanser,
        quality: s.quality || '', url: s.url
      };
      if (Array.isArray(s.subtitles)) {
        item.subtitles = s.subtitles.filter(function (x) { return x && x.url; })
          .map(function (x) { return { label: x.label || x.name || x.lang || 'sub', url: x.url }; });
      }
      // если балансер отдаёт тайминги заставки — передаём плееру как есть (кнопка «Пропустить» в плеере Lampa)
      if (s.segments) item.segments = s.segments;
      if (!bad(item)) out.push(item);
    });
    return out;
  }

  function fromLampac(base, movie, season, done, ctx) {
    base = (base + '').replace(/\/+$/, '');
    var host = hostOf(base), note = ctx.note;
    function unit() { ctx.done++; }
    var orig = movie.original_title || movie.original_name || '';
    // запасной запрос по оригинальному названию, если по русскому ничего не нашлось
    var altMovie = (orig && orig !== (movie.title || movie.name)) ? $.extend({}, movie, movie.name ? { name: orig } : { title: orig }) : null;

    trequest(host + '/events', base + '/lite/events?' + lcParams(movie), function (list) {
      if (typeof list === 'string') { try { list = JSON.parse(list); } catch (e) {} }
      if (!Array.isArray(list)) { note(host + ': /lite/events вернул не список: ' + preview(list)); unit(); return done([]); }
      var all = list.filter(function (b) {
        return b && b.balanser && b.balanser !== 'example' && (fld('paid', true) || (!b.account_only && !b.paid && !b.need_auth));
      }).slice(0, 40);
      var down = all.filter(function (b) { return hDown(host + '/' + b.balanser); });
      var bals = all.filter(function (b) { return !hDown(host + '/' + b.balanser); });
      note(host + ': балансеров всего ' + list.length + ', к опросу ' + bals.length +
        (bals.length ? ' (' + bals.map(function (b) { return b.balanser; }).join(', ') + ')' : '') +
        (down.length ? ', пропущено недоступных ' + down.length + ' (' + down.map(function (b) { return b.balanser; }).join(', ') + ')' : ''));
      if (!bals.length) { unit(); return done([]); }

      if (isTv(movie)) {
        // сериал: серии берутся из TMDB в интерфейсе, поток запрашивается при выборе серии
        var out = [];
        bals.forEach(function (b) {
          var key = host + '/' + b.balanser;
          out.push({
            src: key, srcn: b.name || b.balanser, hkey: key, tvsrc: true,
            resolveFor: function (sn, ep, cb) {
              function go(m, retry) {
                trequest(key, base + '/lite/' + encodeURIComponent(b.balanser) + '?' + lcParams(m, { season: sn, episode: ep }),
                  function (j) {
                    var r = parseStreams(j, b, host);
                    if (!r.length && !retry && altMovie) return go(altMovie, true);
                    if (!r.length) note(key + ' s' + sn + 'e' + ep + ': ответ ' + preview(j));
                    cb(r);
                  }, function (code) { note(key + ': ошибка ' + code); cb([]); });
              }
              go(movie, false);
            }
          });
        });
        note(host + ': сериал, потоки запрашиваются при выборе серии');
        unit();
        return done(out);
      }

      ctx.total += bals.length - 1; // вместо одной «единицы» сервера считаем каждый балансер
      function runMovie(m, retry) {
        var out = [], pending = bals.length;
        function fin() {
          if (--pending) return;
          if (!out.length && !retry && altMovie) { note(host + ': повтор по оригинальному названию «' + orig + '»'); return runMovie(altMovie, true); }
          done(out);
        }
        bals.forEach(function (b) {
          var key = host + '/' + b.balanser;
          trequest(key, base + '/lite/' + encodeURIComponent(b.balanser) + '?' + lcParams(m), function (j) {
            var r = parseStreams(j, b, host);
            out = out.concat(r);
            note(key + ': потоков ' + r.length + (r.length ? '' : ' · ответ: ' + preview(j)));
            if (!retry) ctx.done++;
            ctx.part(r); // показать сразу, не дожидаясь медленных балансеров
            fin();
          }, function (code) { note(key + ': ошибка ' + code); if (!retry) ctx.done++; fin(); });
        });
      }
      runMovie(movie, false);
    }, function (code) { note(host + ': /lite/events недоступен, код ' + code + (code === 0 ? ' (сеть/CORS/блокировка)' : '')); unit(); done([]); });
  }

  var cache = {};

  // done(all, n) — когда ответили все; ctx.onPart — каждый раз, когда пришла новая порция потоков
  function collect(movie, season, done, ctx) {
    var key = [movie.id, movie.title || movie.name, movie._clar ? 1 : 0, season || '', fld('apis', ''), fld('lampac', DEFAULT_LAMPAC), fld('archive', true), fld('paid', true)].join('|');
    var c = cache[key];
    if (c && Date.now() - c.t < TTL) { ctx.diag = c.diag.slice(); LASTDIAG = ctx.diag; ctx.items = c.d; return done(c.d, c.n); }
    ctx.note('MyCombo v' + VERSION);

    var apis = (fld('apis', '') + '').split(/[\s,;]+/).filter(function (x) { return /^https?:\/\//i.test(x); });
    var tasks = apis.map(function (a) { return { fn: function (cb) { fromApi(a, movie, season, cb, ctx); } }; });
    (fld('lampac', DEFAULT_LAMPAC) + '').split(/[\s,;]+/).filter(function (x) { return /^https?:\/\//i.test(x); }).forEach(function (a) {
      tasks.push({ own: true, fn: function (cb) { fromLampac(a, movie, season, cb, ctx); } }); // сам считает свои единицы прогресса
    });
    if (fld('archive', true)) tasks.push({ fn: function (cb) { fromArchive(movie, season, cb, ctx); } });
    if (!tasks.length) return done([], 0);

    ctx.done = 0; ctx.total = tasks.length;
    var all = [], left = tasks.length;
    tasks.forEach(function (t) {
      t.fn(function (d) {
        if (!t.own) ctx.done++;
        all = all.concat(d || []);
        if (--left) return;
        all = uniq(all);
        cache[key] = { t: Date.now(), d: all, n: tasks.length, diag: ctx.diag };
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
    var curSrc = get('src_' + movie.id, ''), curSeason = object.season || 0, last, self = this, shift = 0;
    var actions, lastStreams = null, mainRow = null, needRefresh = false, lastFocusKey = '', keepKey = '', timer = null;
    // ctx — текущий опрос; dead — экран закрыт (поздние ответы игнорируются); polling — опрос ещё идёт
    var ctx = Ctx(), dead = false, polling = false, drawn = false, partTimer = null;
    var resCache = {}, RES_TTL = 10 * 60 * 1000; // ответы по сериям: «серия → потоки всех источников»

    // название для поиска: из карточки или введённое вручную (запоминается для этой карточки)
    function qmovie() {
      var q = get('q_' + movie.id, '');
      if (!q) return movie;
      return $.extend({}, movie, tv ? { name: q, original_name: q } : { title: q, original_title: q }, { _clar: true });
    }

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
    function focusable(e) { last = e.target; lastFocusKey = $(e.target).data('key') || ''; reveal(e.target); }

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

    // выбранная озвучка помнится отдельно по каждому сериалу (и общая — как запасная)
    function getPick() { return get('tvpick_' + movie.id, null) || get('tvpick', null); }
    function setPick(s) {
      var p = s ? { voice: s.voice, quality: s.quality, hkey: s.hkey || '' } : '';
      set('tvpick_' + movie.id, p);
      set('tvpick', p);
    }

    function dateText(d) {
      if (!d) return '';
      try { return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return d; }
    }

    // ---- шапка с информацией ----
    function trailerKey() {
      var v = (object.videos && object.videos.results) || (movie.videos && movie.videos.results) || [];
      var t = v.filter(function (x) { return x && x.site === 'YouTube' && x.key && /trailer|teaser/i.test(x.type || ''); })[0] || v.filter(function (x) { return x && x.site === 'YouTube' && x.key; })[0];
      return t ? t.key : '';
    }
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
      var back = tmdbImg('w780', m.backdrop_path);
      if (back) hero.css('background-image', 'linear-gradient(90deg,rgba(18,14,12,.94) 0%,rgba(18,14,12,.7) 55%,rgba(18,14,12,.35) 100%),url(' + back + ')');
      var poster = $('<div class="mc-poster"></div>');
      var img = tmdbImg('w342', m.poster_path);
      if (img) poster.css('background-image', 'url(' + img + ')');
      var info = $('<div class="mc-info"><div class="mc-title"></div><div class="mc-orig"></div><div class="mc-meta"></div><div class="mc-desc"></div><div class="mc-cast"></div><div class="mc-next"></div></div>');
      info.find('.mc-title').text(m.title || m.name || '');
      var orig = m.original_title || m.original_name || '';
      info.find('.mc-orig').text(orig && orig !== (m.title || m.name) ? orig : '').toggle(!!(orig && orig !== (m.title || m.name)));
      info.find('.mc-meta').html(meta.join(''));
      if (gen) info.find('.mc-meta span').last().text(gen);
      info.find('.mc-desc').text(m.overview || '');
      var cast = ((object.persons && object.persons.cast) || (m.credits && m.credits.cast) || []).map(function (c) { return c && c.name; }).filter(Boolean).slice(0, 4);
      info.find('.mc-cast').text(cast.length ? 'В ролях: ' + cast.join(', ') : '').toggle(!!cast.length);
      var ne = m.next_episode_to_air;
      info.find('.mc-next').text(ne && ne.air_date ? 'Следующая серия выйдет ' + dateText(ne.air_date) : '').toggle(!!(ne && ne.air_date));
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

    function stopTimer() { if (timer) { clearInterval(timer); timer = null; } if (partTimer) { clearTimeout(partTimer); partTimer = null; } }
    function liveText(c) { return 'Ещё отвечают источники: ' + c.done + ' из ' + c.total + '…'; }

    // разложить потоки по источникам/сезонам и отрисовать.
    // final=false — пришла очередная порция, опрос продолжается: перерисовываем, сохраняя фокус
    function apply(d, final) {
      items = d; sources = []; seasons = [];
      d.forEach(function (i) {
        var s = i.srcn || i.src || '';
        if (s && sources.indexOf(s) < 0) sources.push(s);
        if (i.season && seasons.indexOf(i.season) < 0) seasons.push(i.season);
      });
      if (tv) seasons = seasonList();
      seasons.sort(function (a, b) { return a - b; });
      if (!curSeason) curSeason = parseInt(get('season_' + movie.id, 0), 10) || seasons[0] || 1;
      if (seasons.indexOf(curSeason) < 0 && seasons.length) curSeason = seasons[0];
      // источник, выбранный для этой карточки, мог ещё не ответить — пока опрос идёт, не сбрасываем его
      var src = curSrc;
      if (curSrc && sources.indexOf(curSrc) < 0) { src = ''; if (final) curSrc = ''; }
      var keep = curSrc; curSrc = src;
      var first = !drawn;
      drawn = true;
      if (!first) { keepKey = lastFocusKey; last = false; }
      self.draw();
      curSrc = keep;
      if (first) { self.activity.loader(false); self.activity.toggle(); }
      else refocus();
    }
    // после перерисовки вернуть фокус, но только если управление сейчас у этого экрана (не у меню, не у плеера)
    function refocus() {
      try {
        var a = Lampa.Activity.active && Lampa.Activity.active();
        if (a && a.activity && a.activity !== self.activity) return;
        if (Lampa.Controller.enabled().name !== 'content') return;
        Lampa.Controller.collectionSet(html);
        Lampa.Controller.collectionFocus(last || false, html);
      } catch (e) { log('фокус: ' + (e && e.message || e)); }
    }

    this.fetch = function () {
      stopTimer();
      var my = ctx = Ctx();
      keepKey = keepKey || lastFocusKey; last = false; // фокус вернётся на ту же кнопку/строку
      this.activity.loader(true);
      bar.empty(); if (actions) actions.empty();
      polling = true; drawn = false;
      var show = function () {
        if (dead || my !== ctx || !polling) return;
        if (!drawn) list.html('<div class="mc-empty">Опрос источников… ' + my.done + ' из ' + my.total + '</div>');
        else list.find('.mc-live').text(liveText(my));
      };
      // фильм: показываем первые найденные потоки сразу, остальное дорисовываем не чаще раза в 1,5 с
      my.onPart = function () {
        if (dead || my !== ctx || tv || !polling) return;
        if (!drawn) return apply(uniq(my.items), false);
        if (partTimer) return;
        partTimer = setTimeout(function () {
          partTimer = null;
          if (!dead && my === ctx && polling) apply(uniq(my.items), false);
        }, 1500);
      };
      collect(qmovie(), curSeason, safe(function (d, n) {
        if (dead || my !== ctx) return; // экран закрыт или запущен новый опрос
        polling = false; stopTimer(); FORCE = false;
        self.activity.loader(false);
        if (!n) return self.empty('Нет источников. Укажите адрес API в Настройки → MyCombo или включите Internet Archive');
        if (!d.length) { drawn = false; return self.empty(); }
        apply(d, true);
      }, 'загрузка'), my);
      if (polling) { show(); timer = setInterval(show, 250); }
    };

    this.empty = function (msg) {
      stopTimer();
      bar.empty(); list.empty();
      if (actions) actions.empty();
      var q = get('q_' + movie.id, '');
      var dg = ctx.diag.map(function (l) { return $('<div>').text(l).html(); }).join('<br>');
      list.append('<div class="mc-empty">' + (msg || 'Ничего не найдено') + (q ? ' по запросу «' + $('<div>').text(q).html() + '»' : '') +
        (dg ? '<div style="font-size:.6em;margin-top:1.5em;text-align:left;opacity:.8">' + dg + '</div>' : '') + '</div>');
      // даже на пустом экране есть что нажать: повторить, поискать по другому названию, переключить платные
      bar.append(button('↻ Повторить', function () { cache = {}; HEALTH = {}; FORCE = true; self.fetch(); }, '', '', 'b:retry'));
      bar.append(searchButton());
      bar.append(button('Платные: ' + (fld('paid', true) ? 'вкл' : 'выкл'), function () { togglePaid(); }, '', '', 'b:paid'));
      last = bar.find('.selector')[0];
      this.activity.toggle();
    };

    function button(text, enter, cls, small, key) {
      var b = $('<div class="mc-btn selector' + (cls ? ' ' + cls : '') + '"></div>').text(text);
      if (small) b.append($('<small></small>').text(small));
      if (key) b.data('key', key);
      b.on('hover:enter', safe(enter, 'кнопка'));
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
    function resetData() { epCache = {}; resCache = {}; lastStreams = null; }
    function togglePaid() {
      Lampa.Storage.set(NAME + '_paid', !fld('paid', true));
      cache = {}; resetData();
      self.fetch();
    }

    // ручной поиск: своё название, если по названию карточки ничего не нашлось или нашлось не то
    function askSearch() {
      var cur = get('q_' + movie.id, '') || movie.title || movie.name || '';
      var done = safe(function (v) {
        v = ((v === undefined || v === null ? '' : v) + '').trim();
        var q = v && v !== (movie.title || movie.name) ? v : '';
        if (q === get('q_' + movie.id, '')) return Lampa.Controller.toggle('content'); // ничего не поменялось
        set('q_' + movie.id, q);
        Lampa.Noty.show(q ? 'Поиск: ' + q : 'Поиск по названию карточки');
        resetData(); keepKey = 'b:search';
        Lampa.Controller.toggle('content'); // вернуть пульт экрану, пока идёт опрос
        self.fetch();
      }, 'поиск');
      try {
        if (Lampa.Input && Lampa.Input.edit) return Lampa.Input.edit({ title: 'Название (пусто — как в карточке)', value: cur, free: true, nosave: true }, done);
      } catch (e) { log('поиск: ' + e.message); }
      Lampa.Noty.show('Ввод текста на этом устройстве недоступен');
    }
    function searchButton() {
      var q = get('q_' + movie.id, '');
      return button(q ? 'Поиск: «' + q + '»' : 'Поиск…', askSearch, '', '', 'b:search');
    }

    // ---- данные: сезоны и серии ----
    // «Сезон 2 · 7/10 ✓» — сколько серий сезона уже просмотрено
    function seasonTitle(s) {
      var nums = [];
      if (epCache[s]) nums = epCache[s].map(function (e) { return e.n; });
      else (movie.seasons || []).forEach(function (x) { if (x && x.season_number === s) for (var n = 1; n <= (x.episode_count || 0); n++) nums.push(n); });
      if (!nums.length) return 'Сезон ' + s;
      var w = nums.filter(function (n) { return pct(tlView(s, n)) >= 90 || isSeen(s + 'x' + n); }).length;
      return 'Сезон ' + s + ' · ' + w + '/' + nums.length + (w === nums.length ? ' ✓' : '');
    }
    function seasonList() {
      var a = (movie.seasons || []).filter(function (x) { return x && x.season_number > 0; }).map(function (x) { return x.season_number; });
      if (!a.length && movie.number_of_seasons) for (var n = 1; n <= movie.number_of_seasons; n++) a.push(n);
      return a.length ? a : [1];
    }
    function loadEpisodes(sn, cb) {
      var cnt = 0;
      (movie.seasons || []).forEach(function (x) { if (x && x.season_number === sn) cnt = x.episode_count || 0; });
      function fallback(why) {
        ctx.note('Серии сезона ' + sn + ' не получены из TMDB (' + why + '), показаны 1..' + (cnt || 12));
        var a = [];
        for (var n = 1; n <= (cnt || 12); n++) a.push({ n: n, name: '' });
        epCache[sn] = a; if (!dead) cb();
      }
      try {
        if (!Lampa.TMDB || !Lampa.TMDB.api) return fallback('нет Lampa.TMDB');
        var lang = Lampa.Storage.field('tmdb_lang') || Lampa.Storage.field('language') || 'ru';
        var url = Lampa.TMDB.api('tv/' + movie.id + '/season/' + sn + '?api_key=' + Lampa.TMDB.key() + '&language=' + lang);
        request(url, function (j) {
          var a = ((j && j.episodes) || []).map(function (e) {
            return { n: e.episode_number, name: e.name || '', air: e.air_date || '', runtime: e.runtime || 0, still: e.still_path || '', overview: e.overview || '', vote: e.vote_average || 0 };
          });
          if (!a.length) return fallback('пустой ответ');
          epCache[sn] = a; if (!dead) cb();
        }, function (code) { fallback('ошибка ' + code); });
      } catch (e) { fallback('исключение'); }
    }

    // ---- потоки ----
    function qualityMap(streams, voice) {
      var m = {};
      streams.forEach(function (x) { if ((!voice || x.voice === voice) && x.quality && !m[x.quality]) m[x.quality] = x.url; });
      return m;
    }
    // подбор потока: нужная озвучка, затем качество — точное, иначе ближайшее не выше, иначе ближайшее выше;
    // среди равных берётся источник, который отвечает быстрее
    function bestOf(streams, voice, quality, info) {
      var c = voice ? streams.filter(function (x) { return x.voice === voice; }) : streams;
      if (info) info.voiceMissing = !!voice && !c.length;
      if (!c.length) c = streams;
      var fast = function (a, b) { return hMs(a.hkey) - hMs(b.hkey); };
      var byQ = function (a, b) { return qRank(b.quality) - qRank(a.quality) || fast(a, b); };
      if (!quality) return c.slice().sort(byQ)[0];
      var rq = qRank(quality);
      // «1080», «1080p», «FHD» — одно и то же качество: сравниваем по рангу, а не по строке
      var exact = c.filter(function (x) { return x.quality === quality || (rq > 0 && qRank(x.quality) === rq); }).sort(fast)[0];
      if (exact) return exact;
      var lower = c.filter(function (x) { return qRank(x.quality) <= rq; }).sort(byQ)[0];
      return lower || c.slice().sort(function (a, b) { return qRank(a.quality) - qRank(b.quality) || fast(a, b); })[0];
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

    function withExtras(o, s) {
      if (s.segments) o.segments = s.segments;
      return o;
    }
    function play(title, s, all) {
      history(); needRefresh = true;
      var cur = withExtras({ title: title, url: s.url, subtitles: s.subtitles, quality: all ? qOrMap(all, s.voice, s.quality) : s.quality }, s);
      var v = tlView(0, 0); if (v) cur.timeline = v;
      Lampa.Player.play(cur);
      Lampa.Player.playlist([cur]);
    }
    // сериал: плейлист всего сезона, серии запрашиваются «лениво», когда плеер до них доходит.
    // Переход на следующую серию, таймер и отметки просмотра ведёт сам плеер Lampa и её таймлайн.
    function playSeries(rows, g, s, streams) {
      history(); needRefresh = true;
      setPick(s);
      var name = movie.title || movie.name;
      var label = function (r) { return name + ' · s' + r.season + 'e' + r.episode + (s.voice ? ' · ' + s.voice : ''); };
      var cur = withExtras({ title: label(g), url: s.url, subtitles: s.subtitles, season: g.season, episode: g.episode, quality: qOrMap(streams, s.voice, s.quality) }, s);
      var v0 = tlView(g.season, g.episode); if (v0) cur.timeline = v0;
      // следующую серию сначала спрашиваем у того же балансера, что отдал текущую (обычно ответ за 1–2 с),
      // и только если у него нет нужной озвучки — у всех остальных
      var pref = { hkey: s.hkey, voice: s.voice };
      var pl = rows.map(function (r) {
        if (r === g) return cur;
        var it = { title: label(r), season: r.season, episode: r.episode };
        var v = tlView(r.season, r.episode); if (v) it.timeline = v;
        it.url = function (call) {
          var me = (this && this.episode === r.episode) ? this : it;
          r.resolve(function (list) {
            var info = {}, b = list.length ? bestOf(list, s.voice, s.quality, info) : null;
            if (!b) { Lampa.Noty.show('Серия ' + r.episode + ' недоступна у выбранных источников'); try { Lampa.Player.close(); } catch (e) {} return; }
            if (info.voiceMissing) Lampa.Noty.show('Серия ' + r.episode + ': озвучки «' + s.voice + '» нет, взята «' + b.voice + '»');
            else if (b.hkey) pref.hkey = b.hkey; // дальше держимся источника, который реально отдал серию
            me.url = b.url; me.quality = qOrMap(list, b.voice, b.quality);
            me.title = label(r).replace(s.voice || '', b.voice || '');
            if (b.subtitles) me.subtitles = b.subtitles;
            withExtras(me, b);
            call();
          }, pref);
        };
        return it;
      });
      Lampa.Player.play(cur);
      Lampa.Player.playlist(pl);
    }

    // запрос серии у нескольких балансеров параллельно; ждём всех, но не дольше 9 секунд.
    // Недоступные источники пропускаются, одинаковые ссылки склеиваются, потоки сортируются по скорости отклика.
    function resolveAll(srcs, sn, ep, cb) {
      var live = srcs.filter(function (s) { return !hDown(s.hkey); });
      if (!live.length) live = srcs;
      var out = [], left = live.length, done = false, t = null;
      function fin() {
        if (done) return; done = true; clearTimeout(t);
        var seen = {};
        out = out.filter(function (x) { if (seen[x.url]) return false; seen[x.url] = 1; return true; });
        cb(out);
      }
      if (!left) return fin();
      t = setTimeout(fin, 9000);
      live.forEach(function (s) {
        s.resolveFor(sn, ep, function (r) { if (!done) out = out.concat(r || []); if (!--left) fin(); });
      });
    }
    // потоки серии: из кэша (10 мин), иначе сначала у «своего» балансера (pref = {hkey, voice}),
    // а если у него нет нужной озвучки или он молчит 6 с — у всех. cb(list, onlyPref)
    function resolveEp(srcs, sn, ep, cb, pref) {
      var ck = sn + 'x' + ep, c = resCache[ck];
      if (c && Date.now() - c.t < RES_TTL) return cb(c.list, false);
      var full = function () {
        resolveAll(srcs, sn, ep, function (list) {
          if (list.length) resCache[ck] = { t: Date.now(), list: list };
          cb(list, false);
        });
      };
      var ps = pref && pref.hkey ? srcs.filter(function (s) { return s.hkey === pref.hkey && !hDown(s.hkey); })[0] : null;
      if (!ps || srcs.length < 2) return full();
      var done = false, t = setTimeout(function () { if (!done) { done = true; full(); } }, 6000);
      ps.resolveFor(sn, ep, function (r) {
        if (done) return; done = true; clearTimeout(t);
        r = uniq(r || []);
        if (r.some(function (x) { return !pref.voice || x.voice === pref.voice; })) return cb(r, true);
        full();
      });
    }
    function chooseStream(streams, cb, extra) {
      var multi = {}; streams.forEach(function (x) { if (x.srcn) multi[x.srcn] = 1; });
      var many = Object.keys(multi).length > 1;
      // у одинаковых озвучка+качество из разных источников отмечаем самый быстрый
      var fastest = {};
      streams.forEach(function (x) {
        var k = x.voice + '|' + x.quality;
        if (!fastest[k] || hMs(x.hkey) < hMs(fastest[k].hkey)) fastest[k] = x;
      });
      var cnt = {}; streams.forEach(function (x) { var k = x.voice + '|' + x.quality; cnt[k] = (cnt[k] || 0) + 1; });
      var opts = streams.map(function (x) {
        var k = x.voice + '|' + x.quality;
        return { title: (x.voice ? x.voice + ' · ' : '') + (x.quality || 'auto') + (many && x.srcn ? ' · ' + x.srcn : '') + (cnt[k] > 1 && fastest[k] === x ? ' ⚡' : ''), value: x };
      });
      choose('Озвучка / качество', (extra || []).concat(opts), cb);
    }

    // запуск строки (серия или озвучка фильма)
    function open(g, rows, title) {
      set('last_' + movie.id, g.key); markSeen(g.key);
      if (g.resolve) {
        Lampa.Noty.show('Загрузка…');
        var pick = getPick();
        return g.resolve(safe(function (streams, onlyPref) {
          if (dead) return;
          if (!streams.length) return Lampa.Noty.show('Источники не вернули потоков для этой серии');
          if (!onlyPref) lastStreams = streams;
          var known = pick && streams.some(function (x) { return x.voice === pick.voice; });
          if (streams.length === 1) return playSeries(rows, g, streams[0], streams);
          if (known) return playSeries(rows, g, bestOf(streams, pick.voice, pick.quality), streams); // озвучка запомнена
          chooseStream(streams, function (x) { playSeries(rows, g, x, streams); }); // запомненной нет → показываем выбор
        }, 'серия'), pick);
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

    // список озвучек для кнопки «Озвучка»: берём последний ответ или запрашиваем главную серию
    function voiceChoices(cb) {
      if (lastStreams && lastStreams.length) return cb(lastStreams);
      if (!mainRow) return;
      Lampa.Noty.show('Загрузка озвучек…');
      mainRow.resolve(function (st) {
        if (dead) return;
        if (!st.length) return Lampa.Noty.show('Источники не вернули озвучки');
        lastStreams = st; cb(st);
      });
    }

    this.draw = safe(function () {
      if (!items.length) return this.empty();
      buildHero(); bar.empty(); list.empty();

      // фильтры
      if (sources.length > 1) {
        var cnt = {}; items.forEach(function (i) { var s = i.srcn || i.src; cnt[s] = (cnt[s] || 0) + 1; });
        bar.append(button('Источник: ' + (curSrc || 'все (' + sources.length + ')') + ' ▾', function () {
          var opts = sources.map(function (n) { return { title: tv ? n : n + ' · ' + cnt[n] + ' шт.', value: n, selected: n === curSrc }; });
          opts.unshift({ title: 'Все источники (' + sources.length + ')', value: '', selected: !curSrc });
          choose('Источник', opts, function (v) { curSrc = v; set('src_' + movie.id, v); lastStreams = null; resCache = {}; redraw(); });
        }, '', '', 'b:src'));
      }
      if (seasons.length > 1) {
        bar.append(button('Сезон ' + curSeason + ' ▾', function () {
          choose('Сезон', seasons.map(function (s) { return { title: seasonTitle(s), value: s, selected: s === curSeason }; }),
            function (v) { curSeason = v; set('season_' + movie.id, v); redraw(); });
        }, '', '', 'b:season'));
      }
      if (tv) {
        var pk = getPick();
        bar.append(button('Озвучка: ' + (pk ? pk.voice + (pk.quality ? ' · ' + pk.quality : '') : 'авто') + ' ▾', function () {
          voiceChoices(function (st) {
            chooseStream(st, function (v) {
              if (v === 'auto') { setPick(null); Lampa.Noty.show('Озвучка: выбор при запуске'); } else { setPick(v); Lampa.Noty.show('Озвучка: ' + v.voice); }
              redraw();
            }, [{ title: 'Авто — спрашивать при запуске', value: 'auto' }]);
          });
        }, '', '', 'b:voice'));
      }
      bar.append(searchButton());
      bar.append(button('Платные: ' + (fld('paid', true) ? 'вкл' : 'выкл'), togglePaid, '', '', 'b:paid'));
      if (!tv) bar.append(button((fld('sort', 'source') === 'quality' ? 'Сортировка: по качеству' : 'Сортировка: как есть') + ' ▾', function () {
        Lampa.Storage.set(NAME + '_sort', fld('sort', 'source') === 'quality' ? 'source' : 'quality'); redraw();
      }, '', '', 'b:sort'));

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
        var srcList = curSrc ? inSrc : items, sn = curSeason;
        rows = eps.map(function (e) {
          return {
            episode: e.n, season: sn, srcn: curSrc || '', key: sn + 'x' + e.n, ep: e,
            title: 'Серия ' + e.n + (e.name ? ' · ' + e.name : ''),
            resolve: function (cb, pref) { resolveEp(srcList, sn, e.n, cb, pref); }
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

      // главная кнопка и трейлер в шапке
      var mt = mainTarget(rows);
      mainRow = mt.row;
      actions.append(button('▶ ' + mt.label, function () { open(mt.row, rows, mt.row.title || movie.title || movie.name); }, 'mc-btn--main', mt.sub, 'main'));
      var tk = trailerKey();
      if (tk) actions.append(button('Трейлер', function () {
        try { if (Lampa.YouTube && Lampa.YouTube.play) return Lampa.YouTube.play(tk); } catch (e) {}
        Lampa.Player.play({ title: 'Трейлер', url: 'https://www.youtube.com/watch?v=' + tk });
      }, '', '', 'trailer'));
      if (!last) last = actions.find('.selector')[0];

      list.append('<div class="mc-sect">' + (tv ? 'Сезон ' + curSeason + ' · ' + rows.length + ' сер.' : 'Озвучки · ' + rows.length) + '</div>');
      if (polling && !tv) list.append($('<div class="mc-sect mc-live"></div>').text(liveText(ctx)));
      var pick = tv ? getPick() : null;

      var lastKey = get('last_' + movie.id, '');
      rows.forEach(function (g) {
        var key = g.key;
        var title = g.title || movie.title || movie.name;
        var row = $('<div class="mc-ep selector"></div>').data('key', key);
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
          body.find('.mc-ep__s').text([dateText(e.air), e.runtime ? e.runtime + ' мин' : '', e.vote > 0 ? '★ ' + Number(e.vote).toFixed(1) : ''].filter(Boolean).join(' · '));
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
        // серия уже запрашивалась, и выбранной озвучки у неё нет — видно сразу, а не только в плеере
        var rc = tv && pick && pick.voice && resCache[key];
        if (rc && !rc.list.some(function (x) { return x.voice === pick.voice; })) {
          body.append($('<div class="mc-ep__st mc-miss"></div>').text('Нет озвучки «' + pick.voice + '»' + (rc.list.length ? ', будет взята другая' : '')));
        }
        if (fv.indexOf(key) > -1) right.prepend('<span class="mc-ep__ok">★</span>');
        else if (seen) right.prepend('<span class="mc-ep__ok">✓</span>');
        if (tv && sources.length > 1) right.prepend($('<span class="mc-ep__src"></span>').text(g.srcn || ''));

        row.append(body).append(right);
        row.on('hover:focus', focusable);
        row.on('hover:enter', safe(function () { open(g, rows, tv ? (movie.title || movie.name) + ' · s' + g.season + 'e' + g.episode : title); }, 'запуск'));
        row.on('hover:long', safe(function () { self.menu(g, key, title, rows); }, 'меню'));
        list.append(row);
        if (key === lastKey && !last) last = row[0];
      });
      if (tv && mt && mt.row) { // фокус сразу на нужной серии
        var rr = list.find('.mc-ep')[rows.indexOf(mt.row)];
        if (rr) last = rr;
      }
      if (keepKey) { // после возврата из плеера остаёмся на той же строке
        var kk = html.find('.selector').filter(function () { return $(this).data('key') === keepKey; })[0];
        if (kk) last = kk;
        keepKey = '';
      }
    }, 'отрисовка');

    this.menu = function (g, key, title, rows) {
      var fv = favs(), isFav = fv.indexOf(key) > -1;
      var opts = [];
      if (g.streams && g.streams.length > 1) opts.push({ title: 'Выбрать качество (' + g.streams.length + ')', value: 'q' });
      if (g.resolve) opts.push({ title: 'Выбрать озвучку / качество', value: 'tvq' });
      opts.push({ title: isFav ? 'Убрать из избранного' : 'В избранное', value: 'fav' });
      opts.push({ title: isSeen(key) ? 'Снять отметку «просмотрено»' : 'Отметить просмотренным', value: 'seen' });
      opts.push({ title: 'Искать по другому названию', value: 'search' });
      opts.push({ title: 'Обновить (сбросить пропуски источников)', value: 'reload' });
      choose('MyCombo', opts, function (v) {
        if (v === 'q') return chooseStream(g.streams, function (x) { play(title, x, g.streams); });
        if (v === 'tvq') {
          Lampa.Noty.show('Загрузка…');
          return g.resolve(function (streams) {
            if (dead) return;
            if (!streams.length) return Lampa.Noty.show('Нет потоков');
            lastStreams = streams;
            chooseStream(streams, function (x) { playSeries(rows, g, x, streams); });
          });
        }
        if (v === 'fav') toggleIn('fav_', key);
        if (v === 'seen') toggleIn('seen_', key);
        if (v === 'search') return askSearch();
        if (v === 'reload') { cache = {}; HEALTH = {}; resetData(); FORCE = true; return self.fetch(); }
        redraw();
      });
    };

    this.start = function () {
      if (needRefresh && items.length) { needRefresh = false; keepKey = lastFocusKey; self.draw(); } // обновить полосы просмотра после плеера
      Lampa.Controller.add('content', {
        toggle: function () {
          if (needRefresh && items.length) { needRefresh = false; keepKey = lastFocusKey; self.draw(); }
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
    this.destroy = function () { dead = true; polling = false; stopTimer(); ctx.onPart = null; html.remove(); items = []; };
  }

  // ---------- настройки: загрузка, экспорт, обновление ----------
  function applyConfig(j) {
    if (typeof j === 'string') j = JSON.parse(j);
    if (j.apis) Lampa.Storage.set(NAME + '_apis', [].concat(j.apis).join(' '));
    if (j.lampac) Lampa.Storage.set(NAME + '_lampac', [].concat(j.lampac).join(' '));
    if (typeof j.archive === 'boolean') Lampa.Storage.set(NAME + '_archive', j.archive);
    if (typeof j.paid === 'boolean') Lampa.Storage.set(NAME + '_paid', j.paid);
    if (j.sort) Lampa.Storage.set(NAME + '_sort', j.sort);
    if (j.scale) { Lampa.Storage.set(NAME + '_scale', j.scale); applyCss(); }
    cache = {}; HEALTH = {};
  }
  function importConfig() {
    var u = fld('cfgurl', '');
    if (!/^https?:\/\//i.test(u)) return Lampa.Noty.show('Укажите адрес конфигурации');
    request(u, function (j) {
      try { applyConfig(j); Lampa.Noty.show('MyCombo: настройки загружены'); } catch (e) { Lampa.Noty.show('MyCombo: неверный JSON'); }
    }, function () { Lampa.Noty.show('MyCombo: не удалось загрузить настройки'); });
  }
  function exportConfig() {
    var text = JSON.stringify({
      apis: fld('apis', ''), lampac: fld('lampac', DEFAULT_LAMPAC), archive: !!fld('archive', true),
      paid: !!fld('paid', true), sort: fld('sort', 'source'), scale: fld('scale', '1')
    });
    try {
      Lampa.Utils.copyTextToClipboard(text, function () { Lampa.Noty.show('MyCombo: настройки скопированы'); }, function () { Lampa.Noty.show('MyCombo: не удалось скопировать'); });
    } catch (e) { Lampa.Noty.show('MyCombo: копирование недоступно'); }
  }
  function importClipboard() {
    try {
      navigator.clipboard.readText().then(function (t) {
        try { applyConfig(t); Lampa.Noty.show('MyCombo: настройки вставлены'); } catch (e) { Lampa.Noty.show('MyCombo: в буфере не JSON'); }
      }, function () { Lampa.Noty.show('MyCombo: нет доступа к буферу, используйте ссылку'); });
    } catch (e) { Lampa.Noty.show('MyCombo: буфер недоступен, используйте ссылку'); }
  }

  function xhrText(url, ok, fail) {
    var x = new XMLHttpRequest();
    x.open('GET', url, true); x.timeout = 15000;
    x.onload = function () { (x.status >= 200 && x.status < 300) ? ok(x.responseText) : fail(x.status); };
    x.onerror = x.ontimeout = function () { fail(0); };
    x.send();
  }
  function cmpVer(a, b) {
    var x = (a + '').split('.'), y = (b + '').split('.');
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var d = (parseInt(x[i], 10) || 0) - (parseInt(y[i], 10) || 0);
      if (d) return d;
    }
    return 0;
  }
  // сравнивает версию в файле, с которого Lampa загрузила плагин, с версией, которая работает сейчас
  function checkUpdate(manual) {
    if (!SELF_URL) { if (manual) Lampa.Noty.show('MyCombo v' + VERSION + ': адрес плагина не определён, проверить нельзя'); return; }
    xhrText(SELF_URL + (SELF_URL.indexOf('?') > -1 ? '&' : '?') + 'nocache=' + Date.now(), function (t) {
      var m = (t || '').match(/var VERSION = '([0-9.]+)'/);
      if (!m) { if (manual) Lampa.Noty.show('MyCombo: не удалось определить версию на сервере'); return; }
      if (cmpVer(m[1], VERSION) > 0) Lampa.Noty.show('MyCombo: доступна версия ' + m[1] + ' (у вас ' + VERSION + '). Переустановите расширение');
      else if (manual) Lampa.Noty.show('MyCombo v' + VERSION + ': обновлений нет');
    }, function (c) { if (manual) Lampa.Noty.show('MyCombo: сервер плагина недоступен (' + c + ')'); });
  }

  function showLines(title, lines) {
    Lampa.Select.show({
      title: title,
      items: (lines.length ? lines : ['Пусто']).map(function (l) { return { title: l }; }),
      onSelect: function () { Lampa.Controller.toggle('settings_component'); },
      onBack: function () { Lampa.Controller.toggle('settings_component'); }
    });
  }
  function showLog() { showLines('Журнал ошибок MyCombo', LOG.slice(-20).reverse()); }
  function showDiag() {
    var lines = LASTDIAG.slice();
    Object.keys(HEALTH).forEach(function (k) {
      var h = HEALTH[k];
      lines.push('здоровье ' + k + ': ' + (h.n ? 'отклик ' + h.ms + ' мс' : 'нет ответов') + (h.fail ? ', подряд ошибок ' + h.fail : ''));
    });
    showLines('Диагностика источников', lines);
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
        Lampa.Activity.push({
          url: '', title: movie.title || movie.name, component: NAME, movie: movie, page: 1,
          persons: e.data.persons, videos: e.data.videos
        });
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
    var B = function (name, title, descr, fn) {
      Lampa.SettingsApi.addParam({
        component: NAME,
        param: { name: NAME + '_' + name, type: 'button' },
        field: { name: title, description: descr || '' },
        onChange: safe(fn, name)
      });
    };
    P('apis', 'input', '', 'Адреса API', 'Один или несколько через пробел. Платные и требующие входа потоки скрываются');
    P('lampac', 'input', DEFAULT_LAMPAC, 'Серверы Lampac', 'Адреса через пробел (свой сервер). Балансеры «только для аккаунта» и платные пропускаются');
    P('paid', 'trigger', true, 'Все балансеры, включая платные', 'Не скрывать источники «только для аккаунта». Если сервер откажет — источник просто пропускается');
    P('archive', 'trigger', true, 'Internet Archive', 'Бесплатные фильмы без авторизации (в основном общественное достояние)');
    P('sort', 'select', 'source', 'Сортировка', '', { source: 'Как у источника', quality: 'По качеству' });
    P('scale', 'select', '1', 'Масштаб', 'Размер текста на ТВ', { '0.85': 'Мельче', '1': 'Обычный', '1.2': 'Крупнее', '1.4': 'Очень крупно' }, applyCss);
    P('cfgurl', 'input', '', 'Адрес конфигурации (JSON)', 'Удобно править на ПК, а на ТВ только вставить ссылку');
    B('import', 'Загрузить настройки по ссылке', '', importConfig);
    B('export', 'Скопировать настройки (JSON)', 'Резервная копия: сохраните текст и вставьте потом', exportConfig);
    B('importclip', 'Вставить настройки из буфера', 'Работает, если ТВ разрешает чтение буфера', importClipboard);
    B('update', 'Проверить обновление', 'Установлена версия ' + VERSION, function () { checkUpdate(true); });
    B('diag', 'Диагностика источников', 'Ответы балансеров и их скорость', showDiag);
    B('journal', 'Журнал ошибок', 'Если что-то не работает — посмотрите здесь', showLog);

    // раз в 12 часов тихо проверяем, нет ли новой версии
    if (Date.now() - (parseInt(get('upd_t', 0), 10) || 0) > 12 * 3600 * 1000) { set('upd_t', Date.now()); checkUpdate(false); }
  }

  if (window.appready) init();
  else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') init(); });
})();
