#!/usr/bin/env bash
# =============================================================
# Честная Генерация — Установка на Ubuntu 24.04
# =============================================================
#
# Запуск:
#   sudo bash deploy/install.sh
#
# Что делает:
#   1. Устанавливает системные пакеты (Python 3, Node.js 20, nginx, git)
#   2. Создаёт пользователя cg и директорию /opt/cg-dashboard
#   3. Клонирует репозиторий от имени пользователя cg (не root!)
#   4. Автоматически ищет пароли БД из существующих конфигов
#   5. Настраивает Python venv и pip install
#   6. Собирает фронтенд (npm install + npm run build)
#   7. Генерирует self-signed TLS сертификат
#   8. Устанавливает systemd сервис (автозапуск при ребуте)
#   9. Устанавливает nginx конфиг (автозапуск при ребуте)
#  10. Настраивает sudoers для auto-update из админки
# =============================================================

set -euo pipefail

# ── Цвета ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
step()  { echo -e "\n${CYAN}── $* ──${NC}"; }

# ── Проверка root ──
[[ $EUID -eq 0 ]] || error "Запустите с sudo: sudo bash deploy/install.sh"

# ── Параметры ──
INSTALL_DIR="/opt/cg-dashboard"
CG_USER="cg"
REPO_URL="https://github.com/zergont/UI-telemetry.git"
SSL_DIR="/etc/ssl/cg-dashboard"

# Если запускаем из клонированного репо — берём URL оттуда
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_SRC="$(dirname "$SCRIPT_DIR")"
if [[ -d "$PROJECT_SRC/.git" ]]; then
    REPO_URL=$(git -C "$PROJECT_SRC" remote get-url origin 2>/dev/null || echo "$REPO_URL")
fi

info "Репозиторий: $REPO_URL"
info "Установка в: $INSTALL_DIR"

# =============================================================
step "1. Системные пакеты"
# =============================================================
apt-get update -qq
apt-get install -y -qq \
    python3 python3-venv python3-pip \
    nginx git curl openssl rsync \
    > /dev/null 2>&1

# Node.js 20 (если нет или < 18)
if ! command -v node &> /dev/null || [[ $(node -v | cut -d. -f1 | tr -d v) -lt 18 ]]; then
    info "Устанавливаем Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
    apt-get install -y -qq nodejs > /dev/null 2>&1
fi

info "Python: $(python3 --version)"
info "Node:   $(node --version)"
info "npm:    $(npm --version)"
info "git:    $(git --version)"

# =============================================================
step "2. Пользователь $CG_USER"
# =============================================================
if ! id -u "$CG_USER" &>/dev/null; then
    info "Создаём пользователя $CG_USER..."
    useradd -r -s /bin/bash -m -d /home/$CG_USER $CG_USER
    info "Пользователь $CG_USER создан"
else
    info "Пользователь $CG_USER уже существует"
    # Починить shell и home если пользователь был создан без них
    CG_SHELL=$(getent passwd $CG_USER | cut -d: -f7)
    CG_HOME=$(getent passwd $CG_USER | cut -d: -f6)
    if [[ "$CG_SHELL" == */nologin || "$CG_SHELL" == */false ]]; then
        info "Меняем shell $CG_USER на /bin/bash..."
        usermod -s /bin/bash $CG_USER
    fi
    if [[ ! -d "$CG_HOME" ]]; then
        info "Создаём home для $CG_USER: $CG_HOME..."
        mkdir -p "$CG_HOME"
        chown $CG_USER:$CG_USER "$CG_HOME"
    fi
fi

# =============================================================
step "3. Клонирование репозитория (от имени $CG_USER)"
# =============================================================
if [[ -d "$INSTALL_DIR/.git" ]]; then
    info "Репозиторий уже есть, обновляем..."
    # safe.directory для git
    su -s /bin/bash $CG_USER -c "git config --global --add safe.directory $INSTALL_DIR" 2>/dev/null || true
    su -s /bin/bash $CG_USER -c "cd $INSTALL_DIR && git pull origin master" || warn "git pull не удался"
else
    info "Клонируем в $INSTALL_DIR..."
    # Создаём пустую директорию от root, отдаём cg, git clone в неё
    rm -rf "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"
    chown $CG_USER:$CG_USER "$INSTALL_DIR"

    su -s /bin/bash $CG_USER -c "git clone $REPO_URL $INSTALL_DIR"
    su -s /bin/bash $CG_USER -c "git config --global --add safe.directory $INSTALL_DIR"
    info "Репозиторий склонирован"
fi

# Проверяем что файлы на месте
[[ -f "$INSTALL_DIR/backend/requirements.txt" ]] || error "Файлы проекта не найдены в $INSTALL_DIR"
info "Файлы проекта ОК"

# =============================================================
step "4. Конфигурация (автопоиск паролей)"
# =============================================================
if [[ ! -f "$INSTALL_DIR/config.yaml" ]]; then
    info "Создаём config.yaml из шаблона..."
    cp "$INSTALL_DIR/config.yaml.example" "$INSTALL_DIR/config.yaml"

    # ── Автопоиск паролей БД из существующих конфигов ──
    DB_PASS=""
    DB_NAME=""

    # Ищем в типичных местах (включая сервисные и home-каталоги)
    SEARCH_PATHS=(
        "/home/db-writer"
        "/home/telemetry*"
        "/home/*/db-writer*"
        "/home/*/telemetry*"
        "/home/*/cg-telemetry"
        "/opt/db-writer*"
        "/opt/cg-telemetry"
        "/opt/cg-*"
        "/opt/telemetry*"
        "/etc/cg-telemetry"
        "/etc/cg-*"
    )

    for pattern in "${SEARCH_PATHS[@]}"; do
        for cfg_file in $pattern/*.yaml $pattern/*.yml $pattern/*.conf $pattern/config* $pattern/.env; do
            if [[ -f "$cfg_file" && ! "$cfg_file" =~ example ]]; then
                # Ищем пароль cg_writer (пропускаем пустые, плейсхолдеры, комментарии)
                found_pass=$(grep -oP '(?:admin_password|cg_writer.*password|password)[\s:="]+\K[^\s"#]+' "$cfg_file" 2>/dev/null | grep -v -E '^(YOUR_|CHANGE_ME|заполнить|$)' | head -1 || true)
                if [[ -n "$found_pass" && ${#found_pass} -ge 3 ]]; then
                    DB_PASS="$found_pass"
                    info "Найден пароль БД в: $cfg_file"
                fi
                # Ищем имя базы
                found_db=$(grep -oP '(?:database|dbname|db_name|name)[\s:="]+\K(cg_\w+)' "$cfg_file" 2>/dev/null | head -1 || true)
                if [[ -n "$found_db" ]]; then
                    DB_NAME="$found_db"
                fi
            fi
        done
    done

    # Также ищем в PostgreSQL напрямую
    if [[ -z "$DB_PASS" ]] && command -v psql &>/dev/null; then
        # Проверяем существование БД
        if sudo -u postgres psql -lqt 2>/dev/null | grep -q "cg_telemetry"; then
            DB_NAME="cg_telemetry"
            info "Найдена БД: cg_telemetry"
        fi
    fi

    # Генерируем случайные строки для секретов
    AUTH_TOKEN=$(openssl rand -hex 24)
    SESSION_SECRET=$(openssl rand -hex 24)

    # Применяем найденные значения
    cd "$INSTALL_DIR"
    # Базовые подстановки: localhost для локального сервера
    sed -i 's|host: "localhost".*# на сервере|host: "localhost"           # на сервере|' config.yaml

    # auth token
    sed -i "s|CHANGE_ME_TO_SECURE_RANDOM_STRING|${AUTH_TOKEN}|" config.yaml

    # session secret
    sed -i "s|CHANGE_ME_TO_RANDOM_SECRET_32_CHARS|${SESSION_SECRET}|" config.yaml

    # DB password (если нашли)
    if [[ -n "$DB_PASS" ]]; then
        sed -i "s|YOUR_ADMIN_PASSWORD|${DB_PASS}|" config.yaml
        info "Пароль БД (admin_password) подставлен: найден в конфигах"
        # ui_password = admin_password (cg_ui создаётся автоматически при старте)
        sed -i "s|YOUR_UI_PASSWORD|${DB_PASS}|" config.yaml
        info "Пароль БД (ui_password) подставлен автоматически"
    fi

    # DB name
    if [[ -n "$DB_NAME" ]]; then
        sed -i "s|name: \"cg_telemetry\"|name: \"${DB_NAME}\"|" config.yaml
    fi

    # public_base_url — подставляем IP сервера
    SERVER_IP=$(hostname -I | awk '{print $1}')
    if [[ -n "$SERVER_IP" ]]; then
        sed -i "s|https://your-domain.com:9443|https://${SERVER_IP}:9443|" config.yaml
        info "public_base_url: https://${SERVER_IP}:9443"
    fi

    chown $CG_USER:$CG_USER "$INSTALL_DIR/config.yaml"
    chmod 600 "$INSTALL_DIR/config.yaml"

    # ── Итоговые предупреждения (только если что-то не найдено) ──
    WARN_COUNT=0
    if [[ -z "$DB_PASS" ]]; then
        ((WARN_COUNT++))
    fi

    if [[ $WARN_COUNT -gt 0 ]]; then
        echo ""
        warn "═══ ПРОВЕРЬТЕ config.yaml ═══"
        warn "  sudo nano $INSTALL_DIR/config.yaml"
        if [[ -z "$DB_PASS" ]]; then
            warn "  ! database.admin_password — НЕ НАЙДЕН, укажите вручную"
            warn "  ! database.ui_password — НЕ НАЙДЕН, укажите вручную"
        fi
        echo ""
    else
        echo ""
        info "config.yaml полностью настроен автоматически ✓"
        info "  Если нужно поправить: sudo nano $INSTALL_DIR/config.yaml"
        echo ""
    fi
else
    info "config.yaml уже существует — не трогаем"
fi

# =============================================================
step "5. Python venv + зависимости бэкенда"
# =============================================================
cd "$INSTALL_DIR/backend"
su -s /bin/bash $CG_USER -c "cd $INSTALL_DIR/backend && python3 -m venv .venv"
su -s /bin/bash $CG_USER -c "cd $INSTALL_DIR/backend && .venv/bin/pip install --upgrade pip -q 2>/dev/null"
su -s /bin/bash $CG_USER -c "cd $INSTALL_DIR/backend && .venv/bin/pip install -r requirements.txt -q 2>/dev/null"
info "Python-зависимости установлены"

# =============================================================
step "6. Фронтенд: npm install + build"
# =============================================================
su -s /bin/bash $CG_USER -c "cd $INSTALL_DIR/frontend && npm install --silent 2>/dev/null"
su -s /bin/bash $CG_USER -c "cd $INSTALL_DIR/frontend && npm run build 2>/dev/null"

if [[ -d "$INSTALL_DIR/frontend/dist" ]]; then
    info "Фронтенд собран → frontend/dist/"
else
    warn "Фронтенд не собрался! Проверьте вручную: cd $INSTALL_DIR/frontend && npm run build"
fi

# =============================================================
step "7. Self-signed TLS сертификат"
# =============================================================
if [[ ! -f "$SSL_DIR/cg-selfsigned.crt" ]]; then
    info "Генерируем self-signed TLS сертификат..."
    mkdir -p "$SSL_DIR"
    openssl req -x509 -nodes -days 3650 \
        -newkey rsa:2048 \
        -keyout "$SSL_DIR/cg-selfsigned.key" \
        -out "$SSL_DIR/cg-selfsigned.crt" \
        -subj "/CN=cg-dashboard/O=CG/C=RU" \
        2>/dev/null
    chmod 600 "$SSL_DIR/cg-selfsigned.key"
    info "Сертификат: $SSL_DIR/cg-selfsigned.crt (10 лет)"
else
    info "TLS сертификат уже существует"
fi

# =============================================================
step "8. Systemd сервис (автозапуск при ребуте)"
# =============================================================
cp "$INSTALL_DIR/deploy/cg-dashboard.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable cg-dashboard
info "cg-dashboard.service — enabled (стартует при ребуте)"

# =============================================================
step "9. Sudoers для auto-update"
# =============================================================
SUDOERS_FILE="/etc/sudoers.d/cg-dashboard"
if [[ ! -f "$SUDOERS_FILE" ]]; then
    echo "$CG_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart cg-dashboard" > "$SUDOERS_FILE"
    chmod 440 "$SUDOERS_FILE"
    info "$CG_USER может: sudo systemctl restart cg-dashboard (без пароля)"
else
    info "sudoers уже настроен"
fi

# =============================================================
step "10. Nginx (автозапуск при ребуте)"
# =============================================================
cp "$INSTALL_DIR/deploy/cg-dashboard-nginx.conf" /etc/nginx/sites-available/cg-dashboard
ln -sf /etc/nginx/sites-available/cg-dashboard /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Убедиться что nginx enabled
systemctl enable nginx

if nginx -t 2>&1 | grep -q "successful"; then
    systemctl reload nginx
    info "nginx настроен, enabled (стартует при ребуте)"
else
    warn "nginx -t ошибка! Проверьте:"
    nginx -t 2>&1 || true
fi

# =============================================================
step "Проверка автозапуска"
# =============================================================
echo ""
info "Сервисы при ребуте:"
systemctl is-enabled cg-dashboard 2>/dev/null && info "  cg-dashboard: ✓ enabled" || warn "  cg-dashboard: ✗ disabled"
systemctl is-enabled nginx 2>/dev/null && info "  nginx:        ✓ enabled" || warn "  nginx:        ✗ disabled"
systemctl is-enabled postgresql 2>/dev/null && info "  postgresql:   ✓ enabled" || warn "  postgresql:   ✗ disabled"
systemctl is-enabled mosquitto 2>/dev/null && info "  mosquitto:    ✓ enabled" || warn "  mosquitto:    не найден (проверьте MQTT)"

# =============================================================
# Готово!
# =============================================================
echo ""
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Установка завершена! v$(grep 'version:' $INSTALL_DIR/config.yaml.example | head -1 | grep -oP '[\d.]+')${NC}"
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo ""
echo "  Следующие шаги:"
echo ""
echo "  1. Проверьте конфиг (пароли БД!):"
echo "     sudo nano $INSTALL_DIR/config.yaml"
echo ""
echo "  2. Запустите сервис:"
echo "     sudo systemctl start cg-dashboard"
echo ""
echo "  3. Проверьте:"
echo "     sudo systemctl status cg-dashboard"
echo "     curl http://localhost:5555/api/health"
echo ""
echo "  4. Откройте:"
echo "     https://$(hostname -I | awk '{print $1}'):9443"
echo ""
echo "  5. Логи:"
echo "     sudo journalctl -u cg-dashboard -f"
echo ""
echo -e "  ${CYAN}После ребута всё поднимется автоматически!${NC}"
echo ""
