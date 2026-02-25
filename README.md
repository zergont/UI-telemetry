# Честная Генерация — Dashboard

Веб-панель мониторинга дизель-генераторных установок (ДГУ) в реальном времени.

**Стек:** FastAPI (Python) + React (TypeScript) + PostgreSQL + MQTT

---

## Архитектура

```
Роутеры (MQTT) → Брокер MQTT → Backend (Python/FastAPI) → WebSocket → Frontend (React)
                                       ↕
                               PostgreSQL (справочники, история, latest_state)
```

- **MQTT** — реальное время (регистры ДГУ приходят по топику `cg/v1/decoded/SN/<router_sn>/pcc/<panel_id>`)
- **PostgreSQL** — справочники объектов/оборудования, история, GPS
- **WebSocket** — передача данных из MQTT в браузер
- **REST API** — объекты, оборудование, регистры, история, события

---

## Требования

### На сервере (где стоит PostgreSQL и MQTT брокер)

- PostgreSQL 14+
- MQTT брокер (Mosquitto или аналог) на порту 1883
- Данные телеметрии уже пишутся в БД другим сервисом

### На машине с дашбордом

- **Python 3.11+**
- **Node.js 18+** и **npm**
- Сетевой доступ к серверу БД и MQTT (локалка или VPN)

---

## Установка

### 1. Клонировать репозиторий

```bash
git clone <url-репозитория> cg-dashboard
cd cg-dashboard
```

### 2. Создать конфигурацию

```bash
cp config.yaml.example config.yaml
```

Отредактировать `config.yaml`:

```yaml
database:
  host: "192.168.0.130"       # адрес сервера PostgreSQL
  port: 5432
  name: "cg_telemetry"        # имя базы данных
  admin_user: "cg_writer"     # пользователь для миграций
  admin_password: "ВАШ_ПАРОЛЬ"
  ui_user: "cg_ui"            # пользователь для чтения (создаётся при первом запуске)
  ui_password: "ВАШ_ПАРОЛЬ_UI"

mqtt:
  host: "192.168.0.130"       # адрес MQTT брокера
  port: 1883

auth:
  token: "СМЕНИТЬ_НА_СЛУЧАЙНУЮ_СТРОКУ"  # токен авторизации для API

backend:
  host: "0.0.0.0"
  port: 5555                  # порт бэкенда
```

### 3. Настроить PostgreSQL

На сервере с PostgreSQL нужно:

**a) Разрешить подключения извне** — в `postgresql.conf`:
```
listen_addresses = '*'
```

**b) Добавить правила доступа** — в `pg_hba.conf`:
```
# Локальная сеть
host    cg_telemetry    cg_writer    192.168.0.0/24    md5
host    cg_telemetry    cg_ui        192.168.0.0/24    md5

# VPN подсеть (если используется)
host    cg_telemetry    cg_writer    10.10.10.0/24     md5
host    cg_telemetry    cg_ui        10.10.10.0/24     md5
```

**c) Создать пользователя cg_ui:**
```bash
sudo -u postgres psql -d cg_telemetry
```

```sql
CREATE ROLE cg_ui WITH LOGIN PASSWORD 'ВАШ_ПАРОЛЬ_UI';
GRANT CONNECT ON DATABASE cg_telemetry TO cg_ui;
GRANT USAGE ON SCHEMA public TO cg_ui;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO cg_ui;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO cg_ui;
GRANT UPDATE (name, notes) ON objects TO cg_ui;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS name TEXT;
GRANT UPDATE (name) ON equipment TO cg_ui;
```

**d) Перезагрузить PostgreSQL:**
```bash
sudo systemctl reload postgresql
```

### 4. Установить зависимости бэкенда

```bash
cd backend
python -m venv .venv

# Linux/macOS:
source .venv/bin/activate

# Windows:
.venv\Scripts\activate

pip install -r requirements.txt
cd ..
```

### 5. Установить зависимости фронтенда

```bash
cd frontend
npm install
cd ..
```

---

## Запуск

### Режим разработки (dev)

В двух терминалах:

**Терминал 1 — бэкенд:**
```bash
cd backend

# Linux/macOS:
source .venv/bin/activate

# Windows:
.venv\Scripts\activate

uvicorn app.main:app --host 0.0.0.0 --port 5555 --reload
```

**Терминал 2 — фронтенд:**
```bash
cd frontend
npm run dev -- --host
```

Открыть в браузере: `http://localhost:5173`

### Режим продакшн (Linux-сервер)

#### a) Собрать фронтенд

```bash
cd frontend
npm run build
cd ..
```

Собранные файлы появятся в `frontend/dist/`.

#### b) Создать systemd-сервис для бэкенда

Создать файл `/etc/systemd/system/cg-dashboard.service`:

```ini
[Unit]
Description=CG Dashboard Backend
After=network.target postgresql.service mosquitto.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/cg-dashboard/backend
Environment=PATH=/opt/cg-dashboard/backend/.venv/bin
ExecStart=/opt/cg-dashboard/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 5555
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable cg-dashboard
sudo systemctl start cg-dashboard
```

#### c) Настроить nginx как реверс-прокси

Создать файл `/etc/nginx/sites-available/cg-dashboard`:

```nginx
server {
    listen 80;
    server_name _;  # или ваш домен

    # Фронтенд (статика)
    root /opt/cg-dashboard/frontend/dist;
    index index.html;

    # SPA — все пути отдают index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API запросы → бэкенд
    location /api/ {
        proxy_pass http://127.0.0.1:5555;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # WebSocket → бэкенд
    location /ws {
        proxy_pass http://127.0.0.1:5555;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/cg-dashboard /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## Проверка работы

### 1. Проверить здоровье бэкенда

```bash
curl http://localhost:5555/api/health
# Ожидаемый ответ: {"status":"ok"}
```

### 2. Проверить конфигурацию

```bash
curl http://localhost:5555/api/config
# Покажет имя приложения, настройки карты, ключевые регистры
```

### 3. Проверить подключение к БД

```bash
curl -H "Authorization: Bearer ВАШ_ТОКЕН" http://localhost:5555/api/objects
# Должен вернуть JSON-массив объектов
```

### 4. Проверить MQTT

В логах бэкенда должна быть строка:
```
MQTT connected to 192.168.0.130:1883, subscribing to cg/v1/decoded/SN/+/pcc/+
```

### 5. Проверить WebSocket

Открыть дашборд в браузере. В шапке справа — индикатор:
- Зелёная точка + **Online** — WebSocket подключён
- Жёлтая точка + **Connecting...** — переподключение

### 6. Проверить логи (продакшн)

```bash
# Логи бэкенда
sudo journalctl -u cg-dashboard -f

# Логи nginx
sudo tail -f /var/log/nginx/error.log
```

---

## Доступ из интернета (проброс порта)

### Вариант 1: Nginx + проброс порта на роутере

1. Настроить nginx как описано выше (порт 80)
2. На роутере пробросить **внешний порт** → **внутренний IP:80**
   - Например: `внешний:8080` → `192.168.0.130:80`
3. Открыть в браузере: `http://ваш-внешний-ip:8080`

### Вариант 2: Nginx + SSL (рекомендуется)

1. Получить домен (например, через DuckDNS — бесплатно)
2. Пробросить порты 80 и 443 на сервер
3. Установить certbot и получить SSL-сертификат:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d ваш-домен.duckdns.org
```

4. Обновить `frontend/vite.config.ts` — прокси для dev:
```ts
ws_url: "wss://ваш-домен.duckdns.org/ws"
```

### Вариант 3: Только через VPN (текущая настройка)

Самый безопасный вариант — без проброса портов:

1. Подключиться к WireGuard VPN
2. Открыть `http://10.10.10.1:5173` (dev) или `http://10.10.10.1` (prod с nginx)

**Важно:** при доступе через VPN, `config.yaml` должен содержать адрес сервера, доступный и из локалки, и через VPN (`192.168.0.130` если VPN-сервер на том же хосте).

---

## Обновление

### На dev-машине

```bash
cd cg-dashboard
git pull

# Обновить зависимости бэкенда (если изменились)
cd backend
source .venv/bin/activate   # или .venv\Scripts\activate на Windows
pip install -r requirements.txt
cd ..

# Обновить зависимости фронтенда (если изменились)
cd frontend
npm install
cd ..
```

Перезапустить бэкенд и фронтенд.

### На продакшн-сервере

```bash
cd /opt/cg-dashboard
git pull

# Бэкенд
cd backend
source .venv/bin/activate
pip install -r requirements.txt
cd ..
sudo systemctl restart cg-dashboard

# Фронтенд (пересобрать статику)
cd frontend
npm install
npm run build
cd ..

# nginx не нужно перезапускать — статика обновилась на диске
```

---

## Удаление

### Остановить и удалить сервисы (продакшн)

```bash
# Остановить сервис
sudo systemctl stop cg-dashboard
sudo systemctl disable cg-dashboard
sudo rm /etc/systemd/system/cg-dashboard.service
sudo systemctl daemon-reload

# Удалить конфигурацию nginx
sudo rm /etc/nginx/sites-enabled/cg-dashboard
sudo rm /etc/nginx/sites-available/cg-dashboard
sudo systemctl reload nginx

# Удалить файлы проекта
sudo rm -rf /opt/cg-dashboard
```

### Удалить пользователя БД (опционально)

```bash
sudo -u postgres psql -d cg_telemetry
```

```sql
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM cg_ui;
REVOKE CONNECT ON DATABASE cg_telemetry FROM cg_ui;
DROP ROLE cg_ui;
```

### Удалить на dev-машине

Просто удалить папку проекта:
```bash
rm -rf cg-dashboard
```

---

## Структура проекта

```
cg-dashboard/
├── config.yaml              # Конфигурация (НЕ в git)
├── config.yaml.example      # Шаблон конфигурации
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI приложение
│   │   ├── config.py        # Загрузка config.yaml
│   │   ├── auth.py          # Bearer-токен авторизация
│   │   ├── db/
│   │   │   ├── pool.py      # asyncpg пул соединений
│   │   │   ├── migrate.py   # Автомиграции при старте
│   │   │   └── queries/     # SQL-запросы к таблицам
│   │   ├── mqtt/
│   │   │   ├── hub.py       # In-memory pub/sub + кэш
│   │   │   └── listener.py  # MQTT подписка + реконнект
│   │   ├── routers/         # REST-эндпоинты
│   │   ├── schemas/         # Pydantic модели
│   │   └── services/        # Бизнес-логика (конверсии, статусы)
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/           # Стартовая, Объект, Оборудование
│   │   ├── components/      # UI-компоненты
│   │   ├── hooks/           # React Query хуки
│   │   ├── stores/          # Zustand (live-телеметрия)
│   │   └── lib/             # API, WS, конверсии, форматирование
│   └── package.json
└── scripts/                 # Скрипты запуска (Windows dev)
```

---

## Таблицы БД (ожидаемая схема)

Дашборд читает из следующих таблиц (создаются внешним сервисом):

| Таблица | Назначение |
|---------|------------|
| `objects` | Объекты (router_sn, name, notes) |
| `equipment` | Оборудование (router_sn, equip_type, panel_id, name) |
| `latest_state` | Последнее значение каждого регистра |
| `history` | Историческые значения регистров |
| `gps_latest_filtered` | GPS-координаты объектов |
| `events` | События (опционально) |

---

## Устранение неполадок

| Проблема | Решение |
|----------|---------|
| `database "X" does not exist` | Проверьте имя БД в `config.yaml` |
| `no pg_hba.conf entry` | Добавьте правила в `pg_hba.conf` и выполните `sudo systemctl reload postgresql` |
| `password authentication failed for user "cg_ui"` | Создайте пользователя вручную (см. раздел установки) |
| `MQTT connection lost: timed out` | Проверьте доступность MQTT брокера: `telnet 192.168.0.130 1883` |
| Фронтенд не подключается к API | Проверьте что бэкенд запущен на порту 5555 |
| «НЕТ СВЯЗИ» у всех объектов | Данные в `latest_state` старше 5 минут. Проверьте работу сервиса записи телеметрии |
| История не загружается | Проверьте наличие данных в таблице `history` |
