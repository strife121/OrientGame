# Ski-O Map Memory Multiplayer (MVP)

Форк игры `skiomapmemory` с синхронным мультиплеером:

- одинаковая карта у всех в комнате;
- одинаковая нога (старт/финиш) у всех;
- комната ожидания перед стартом;
- общий старт с таймером;
- профиль игрока: имя + случайный цвет маркера;
- кнопка `MAP` во время гонки: открывает обзорную карту с текущей позицией и ногой;
- при перезагрузке страницы игрок восстанавливает позицию и прогресс на текущей ноге;
- фиксация финиша каждого игрока;
- таблица результатов по времени.

## Локальный запуск

```bash
npm install
npm run start
```

Открой: `http://localhost:3000`

## Онлайн версия

- Сайт: `https://orientgame.onrender.com`
- Прямая ссылка для входа: `https://orientgame.onrender.com`

## Быстрый сценарий игры

1. Первый игрок нажимает `Создать`.
2. Копирует ссылку `Копировать ссылку` и отправляет остальным.
3. Все заходят в одну комнату.
4. В лобби можно нажать `Новая карта` или `Новая нога`.
5. Нажать `Старт`.
6. Игроки проходят дистанцию, по финишу попадают в таблицу результатов.

## Как закрыть игру от случайных посетителей и роботов

### Защита от индексации

В проекте уже есть:

- `meta name="robots" content="noindex,nofollow,noarchive"`
- заголовок `X-Robots-Tag: noindex, nofollow, noarchive`
- `robots.txt` с `Disallow: /`

Важно: это просьба к ботам, а не абсолютная защита.

## Деплой

Подходит любой сервис, который запускает Node.js (`npm run start`):

- Render
- Railway
- Fly.io
- VPS/VM с Docker или systemd

Главное:

- задать `PORT` (если требует провайдер);
- использовать HTTPS в проде.

### Деплой через Blueprint (`render.yaml`)

В репозитории есть `render.yaml`, поэтому можно создавать сервис через Blueprint:

1. В Render нажми `New +` -> `Blueprint`.
2. Выбери репозиторий `strife121/OrientGame`.
3. Подтверди создание сервиса.

### Полезные официальные ссылки

- Render: deploy Node.js/Express app  
  https://render.com/docs/deploy-node-express-app
- Render: environment variables  
  https://render.com/docs/configure-environment-variables
- Render и WebSockets  
  https://render.com/blog/websocket-tutorial
- Google Search Central: robots `noindex`  
  https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
- Google Search Central: `robots.txt`  
  https://developers.google.com/search/docs/crawling-indexing/robots/intro
- Cloudflare Access (доступ по auth/политикам)  
  https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-apps/

## Технически

- `server.js` — Express + Socket.IO, хранение комнат в памяти.
- `public/game.js` — клиент, оригинальная механика карты + мультиплеерная синхронизация.
- `public/index.html` / `public/styles.css` — UI лобби, таймера и результатов.

## Ограничения MVP

- Состояние комнат хранится в памяти процесса (при рестарте сервера комнаты сбрасываются).
- Переподключение игрока сохраняется в пределах `DISCONNECT_GRACE_MS` (по умолчанию 180 секунд).
- Античит не реализован (финиш клиент подтверждает через сервер по факту события).
