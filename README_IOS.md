# Сборка IPA для iOS

## Быстрый старт на Mac in Cloud

### 1. Арендуй Mac
- Зайди на https://www.macincloud.com
- Выбери "Pay As You Go" (~$5-8/час)
- Подключись по RDP

### 2. На облачном Mac выполни:

```bash
# Установи Node.js (если нет)
curl -fsSL https://nodejs.org/dist/v20.x/node-v20.x.x-darwin-x64.tar.gz | tar -xz
export PATH="/usr/local/bin:$PATH"

# Распакуй проект и зайди в папку
cd ~/Downloads/smooli

# Установи зависимости
npm install

# Собери веб-версию
npm run build

# Добавь iOS платформу и открой Xcode
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap add ios
npx cap sync ios
npx cap open ios
```

### 3. В Xcode
1. Выбери `Any iOS Device (arm64)`
2. `Product` → `Archive`
3. В Organizer: `Distribute App` → `Ad Hoc` или `Development`
4. Сохрани IPA на рабочий стол

### 4. Перенос на iPhone
- Через **Telegram** (самый простой)
- Через **3uTools** на Windows
- Через **AltStore** (требует Apple ID, без Developer аккаунта)

---

## Альтернатива: локальный Mac
Если есть доступ к Mac:
```bash
git clone <repo> smooli
cd smooli
npm install
npm run build
npx cap add ios
npx cap sync ios
npx cap open ios
# Product → Archive → Export IPA
```

## Примечания
- Иконки уже добавлены: `public/icon-192.png`, `public/icon-512.png`
- Для production замени их на реальные
- Без Apple Developer аккаунта ($99/год) IPA работает 7 дней, потом нужно переустановить через Xcode
