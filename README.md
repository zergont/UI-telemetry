# Честная Генерация — Dashboard

Веб-панель мониторинга дизель-генераторных установок (ДГУ) в реальном времени.

**Стек:** FastAPI (Python) + React (TypeScript) + PostgreSQL + MQTT

---

## Архитектура

```
Роутеры (MQTT) -> Брокер MQTT -> Backend (Python/FastAPI) -> WebSocket -> Frontend (React)
                                       |
                               PostgreSQL (справочники, история, latest_state)
```

- **MQTT** -- реальное время (регистры ДГУ по топику `cg/v1/decoded/SN/<router_sn>/pcc/<panel_id>`)
- **PostgreSQL** -- справочники объектов/оборудования, история, GPS
- **WebSocket** -- передача данных из MQTT в браузер
- **REST API** -- объекты, оборудование, регистры, история, события
- **nginx** -- TLS termination, статика фронтенда, reverse proxy на бэкенд

---

## Требования

- **Ubuntu 24.04** (основная платформа)
- **Python 3.11+**
- **Node.js 18+** и **npm**
- **PostgreSQL 14+** (уже установлен, данные пишутся другим сервисом)
- **MQTT брокер** (Mosquitto) на порту 1883
- **nginx**
- **git**

---

## Быстрая установка (Ubuntu 24)

### LAN-only (по IP, self-signed сертификат)

```bash
# 1. Клонировать репозиторий
git clone https://github.com/zergont/UI-telemetry.git /opt/cg-dashboard
cd /opt/cg-dashboard

# 2. Запустить скрипт установки
sudo bash deploy/install.sh

# 3. Отредактировать конфиг (пароли БД!)
sudo nano /opt/cg-dashboard/config.yaml

# 4. Запустить
sudo systemctl start cg-dashboard
```

### С доменом и NAT (роутер: WAN:443 → сервер:9443)

```bash
git clone https://github.com/zergont/UI-telemetry.git /opt/cg-dashboard
cd /opt/cg-dashboard

# Установка с указанием домена
sudo CG_PUBLIC_BASE_URL="https://cg.example.com" \
     CG_SERVER_NAME="cg.example.com" \
     bash deploy/install.sh

sudo nano /opt/cg-dashboard/config.yaml
sudo systemctl start cg-dashboard

# Опционально: Let's Encrypt (нужен проброс WAN:80 → сервер:80)
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d cg.example.com
```

Скрипт `deploy/install.sh` автоматически:
- Установит Python 3, Node.js 20, nginx, git
- Создаст пользователя `cg` и директорию `/opt/cg-dashboard`
- Настроит Python venv и установит pip-зависимости
- Соберёт фронтенд (`npm run build`)
- Сгенерирует self-signed TLS сертификат
- Установит systemd сервис и nginx конфиг
- Настроит sudoers для auto-update из админки

---

## Ручная установка (пошагово)

### 1. Клонировать репозиторий

```bash
git clone https://github.com/zergont/UI-telemetry.git /opt/cg-dashboard
cd /opt/cg-dashboard
```

### 2. Создать конфигурацию

```bash
cp config.yaml.example config.yaml
nano config.yaml
```

Ключевые параметры:

```yaml
database:
  host: "localhost"             # PostgreSQL на этом же сервере
  name: "cg_telemetry"
  admin_user: "cg_writer"
  admin_password: "ВАШ_ПАРОЛЬ"
  ui_user: "cg_ui"
  ui_password: "ВАШ_ПАРОЛЬ_UI"

mqtt:
  host: "localhost"             # MQTT на этом же сервере

auth:
  token: "СЛУЧАЙНАЯ_СТРОКА"    # токен для API

access:
  public_base_url: "https://your-domain.com"  # без порта при NAT 443→9443
  session_secret: "СЛУЧАЙНАЯ_СТРОКА_32_СИМВОЛА"
```

### 3. Настроить PostgreSQL

```bash
sudo -u postgres psql -d cg_telemetry
```

```sql
-- Создать пользователя для UI (только чтение)
CREATE ROLE cg_ui WITH LOGIN PASSWORD 'ВАШ_ПАРОЛЬ_UI';
GRANT CONNECT ON DATABASE cg_telemetry TO cg_ui;
GRANT USAGE ON SCHEMA public TO cg_ui;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO cg_ui;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO cg_ui;

-- Разрешить переименование объектов
GRANT UPDATE (name, notes) ON objects TO cg_ui;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS name TEXT;
GRANT UPDATE (name) ON equipment TO cg_ui;
```

В `pg_hba.conf` добавить (если ещё нет):
```
host    cg_telemetry    cg_writer    127.0.0.1/32    md5
host    cg_telemetry    cg_ui        127.0.0.1/32    md5
```

```bash
sudo systemctl reload postgresql
```

### 4. Бэкенд

```bash
cd /opt/cg-dashboard/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 5. Фронтенд

```bash
cd /opt/cg-dashboard/frontend
npm install
npm run build
```

Собранные файлы появятся в `frontend/dist/`.

### 6. Systemd сервис

```bash
sudo cp deploy/cg-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable cg-dashboard
sudo systemctl start cg-dashboard
```

### 7. Nginx

```bash
# Генерация self-signed сертификата
sudo mkdir -p /etc/ssl/cg-dashboard
sudo openssl req -x509 -nodes -days 3650 \
    -newkey rsa:2048 \
    -keyout /etc/ssl/cg-dashboard/cg-selfsigned.key \
    -out /etc/ssl/cg-dashboard/cg-selfsigned.crt \
    -subj "/CN=cg-dashboard/O=CG/C=RU"

# Установка конфига
sudo cp deploy/cg-dashboard-nginx.conf /etc/nginx/sites-available/cg-dashboard
sudo ln -sf /etc/nginx/sites-available/cg-dashboard /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 8. Sudoers для auto-update

Чтобы обновление из админки могло перезапустить сервис:

```bash
echo "cg ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart cg-dashboard" | \
    sudo tee /etc/sudoers.d/cg-dashboard
sudo chmod 440 /etc/sudoers.d/cg-dashboard
```

---

## Проверка работы

```bash
# Статус сервиса
sudo systemctl status cg-dashboard

# Здоровье бэкенда
curl http://localhost:5555/api/health
# -> {"status":"ok"}

# Конфигурация
curl http://localhost:5555/api/config

# Объекты из БД
curl -H "Authorization: Bearer ВАШ_ТОКЕН" http://localhost:5555/api/objects

# Логи
sudo journalctl -u cg-dashboard -f

# Логи nginx
sudo tail -f /var/log/nginx/cg-dashboard-error.log
```

В логах бэкенда должно быть:
```
MQTT connected to localhost:1883, subscribing to cg/v1/decoded/SN/+/pcc/+
nginx доступен на порту 9443 -- внешний доступ настроен
Backend ready on 0.0.0.0:5555
```

Браузер: `https://IP-СЕРВЕРА:9443`

---

## Обновление

### Из админки (рекомендуется)

1. Откройте дашборд в браузере
2. Нажмите иконку шестерёнки в шапке
3. Нажмите "Проверить обновления"
4. Если есть обновления -- "Обновить"

Система сама выполнит: `git pull` -> `pip install` (если нужно) -> `npm build` (если нужно) -> `systemctl restart`.

### Вручную

```bash
cd /opt/cg-dashboard
sudo -u cg git pull origin master

# Если изменились зависимости бэкенда
cd backend && sudo -u cg .venv/bin/pip install -r requirements.txt && cd ..

# Если изменился фронтенд
cd frontend && sudo -u cg npm install && sudo -u cg npm run build && cd ..

# Перезапустить
sudo systemctl restart cg-dashboard
# nginx перезапускать не нужно -- статика обновилась на диске
```

---

## Структура проекта

```
cg-dashboard/
|-- config.yaml              # Конфигурация (НЕ в git)
|-- config.yaml.example      # Шаблон конфигурации
|-- deploy/
|   |-- install.sh           # Скрипт установки (Ubuntu 24)
|   |-- cg-dashboard.service # Systemd сервис
|   |-- cg-dashboard-nginx.conf  # Nginx конфиг (production)
|-- backend/
|   |-- app/
|   |   |-- main.py          # FastAPI приложение
|   |   |-- config.py        # Загрузка config.yaml
|   |   |-- auth.py          # Аутентификация (LAN/cookie/bearer)
|   |   |-- db/
|   |   |   |-- pool.py      # asyncpg пул соединений
|   |   |   |-- migrate.py   # Автомиграции при старте
|   |   |   |-- queries/     # SQL-запросы
|   |   |-- mqtt/
|   |   |   |-- hub.py       # In-memory pub/sub + кэш
|   |   |   |-- listener.py  # MQTT подписка + реконнект
|   |   |-- routers/         # REST-эндпоинты
|   |   |-- schemas/         # Pydantic модели
|   |   |-- services/        # updater, share_links, offline_tracker
|   |-- requirements.txt
|-- frontend/
|   |-- src/
|   |   |-- pages/           # StartPage, ObjectPage, EquipmentPage, SystemPage
|   |   |-- components/      # UI-компоненты
|   |   |-- hooks/           # React Query хуки
|   |   |-- stores/          # Zustand (live-телеметрия)
|   |   |-- lib/             # API, WS, конверсии
|   |-- package.json
|-- nginx/                   # Nginx конфиг (Windows dev)
|-- scripts/                 # Скрипты (Windows dev)
```

---

## Таблицы БД

Дашборд читает из следующих таблиц (создаются внешним сервисом):

| Таблица | Назначение |
|---------|------------|
| `objects` | Объекты (router_sn, name, notes) |
| `equipment` | Оборудование (router_sn, equip_type, panel_id, name) |
| `latest_state` | Последнее значение каждого регистра |
| `history` | Исторические значения регистров |
| `gps_latest_filtered` | GPS-координаты объектов |
| `events` | События (опционально) |
| `share_links` | Ссылки доступа (создаётся автоматически) |

---

## Доступ из интернета

### Вариант 1: Проброс порта 9443 (минимальный)

1. На роутере: `WAN:9443` → `сервер:9443`
2. Доступ: `https://ваш-ip:9443` (self-signed, предупреждение браузера)
3. В `config.yaml`: `public_base_url: "https://ваш-ip:9443"`

### Вариант 2: Домен + NAT 443→9443 (рекомендуется)

1. Настроить A-запись домена → ваш внешний IP
2. На роутере: `WAN:443` → `сервер:9443`, `WAN:80` → `сервер:80`
3. Установить с параметрами:
   ```bash
   sudo CG_PUBLIC_BASE_URL="https://cg.example.com" \
        CG_SERVER_NAME="cg.example.com" \
        bash deploy/install.sh
   ```
4. Опционально — Let's Encrypt для доверенного сертификата:
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d cg.example.com
   ```

### Вариант 3: DDNS + проброс

1. Настроить DDNS (например, ngs.myds.me)
2. Пробросить порт 9443 (или 443→9443 для чистого URL)
3. В `config.yaml`: `public_base_url: "https://ngs.myds.me"`

---

## Устранение неполадок

| Проблема | Решение |
|----------|---------|
| `database does not exist` | Проверьте имя БД в `config.yaml` |
| `no pg_hba.conf entry` | Добавьте правила в `pg_hba.conf`, `sudo systemctl reload postgresql` |
| `password authentication failed` | Проверьте пароль cg_writer/cg_ui в `config.yaml` |
| `MQTT connection lost: timed out` | `telnet localhost 1883` -- проверьте MQTT |
| Фронтенд 502 Bad Gateway | `sudo systemctl status cg-dashboard` -- бэкенд не запущен |
| "НЕТ СВЯЗИ" у всех объектов | Данные в `latest_state` старше 5 мин -- проверьте телеметрию |
| Auto-update не перезапускает | Проверьте `/etc/sudoers.d/cg-dashboard` |
| Git fetch ошибка | `sudo -u cg git -C /opt/cg-dashboard remote -v` |
