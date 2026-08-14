# Сборка IPA для iOS через Mac in Cloud

## Что нужно
- Аккаунт на macincloud.com (бесплатный пробный период есть)
- Проект загружен на GitHub/GitLab/как ZIP

## Шаг 1: Арендуй Mac
1. Зайди на https://www.macincloud.com
2. Выбери "Pay As You Go" или бесплатный триал если доступен
3. Арендуй Mac на 1-2 часа (достаточно)
4. Подключись по RDP (Windows) или Screen Sharing (Mac)

## Шаг 2: На облачном Mac выполни:

```bash
# Установи Node.js (если нет)
curl -fsSL https://nodejs.org/dist/v20.x/node-v20.x.x-darwin-x64.tar.gz | tar -xz
export PATH="/usr/local/bin:$PATH"

# Клонируй проект или распакуй ZIP
git clone <твой-репо> smooli
cd smooli

# Установи зависимости
npm install

# Установи Capacitor iOS
npm install @capacitor/core @capacitor/cli @capacitor/ios

# Добавь iOS платформу
npx cap add ios

# Собери веб-версию
npm run build

# Синхронизируй с iOS
npx cap sync ios

# Открой Xcode
npx cap open ios
```

## Шаг 3: В Xcode
1. Выбери любую команду (Any iOS Device)
2. Product → Archive
3. В окне Organizer выбери Export
4. Выбери "Save for Ad Hoc Deployment" или "Development"
5. Сохрани IPA на рабочий стол

## Альтернативный вариант: Expo Application Services
Если проект на React Native - можно использовать EAS Build бесплатно.
Но твой проект на Capacitor/веб.

## Примечания
- Без Apple Developer аккаунта ($99/год) IPA можно установить только через Xcode на свой iPhone (действует 7 дней)
- Для тестирования на других устройствах нужен Developer аккаунт
- Если есть Mac nearby - можно собрать локально бесплатно через Xcode
