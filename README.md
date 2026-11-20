# MyCombo — личный онлайн-плагин для Lampa (Samsung Tizen)

ТВ-интерфейс под пульт: сезоны, озвучки, виды «Список/Плитки», масштаб, продолжить, избранное.
Платные и требующие авторизацию источники скрываются. Встроен бесплатный Internet Archive.

## Установка
1. Включите GitHub Pages (Settings → Pages → Deploy from branch → `main` / root).
2. В Lampa: Настройки → Расширения → добавить `https://evonext.github.io/mycombo-lampa/mycombo.js`.
3. Перезапустите Lampa. На карточке фильма появится кнопка **MyCombo**.
4. Настройки → MyCombo: адреса API, вид, масштаб.

## Формат API
`GET {api}?title=&year=&imdb=&kp=&tmdb=&type=movie|tv[&season=]`
→ `[{voice, quality, title, url, season, episode, subtitles:[{label,url}], paid?, auth?}]`

Конфиг по ссылке: см. `example/config.json`.

## Статус
Код написан без запуска на реальной Lampa — возможны правки названий методов API.

## Серверы Lampac
Настройки → MyCombo → «Серверы Lampac»: адрес сервера, совместимого с Lampac (`/lite/events`, `/lite/{balanser}`).
Балансеры с `account_only`/`paid` отбрасываются. Конфиг по ссылке: `{"lampac":["https://мой-сервер"]}`.
