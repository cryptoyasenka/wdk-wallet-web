/**
 * Minimal i18n for EN/RU/UK.
 *
 * A flat key → translation map. The active locale is stored in
 * localStorage so it survives reload.
 */

export type Locale = "en" | "ru" | "uk";

const STORAGE_KEY = "wdk-locale";

export function getLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "ru" || stored === "en" || stored === "uk") return stored;
  } catch {
    // Fall through to browser language detection when storage is unavailable.
  }
  // Auto-detect from browser
  if (typeof navigator !== "undefined") {
    if (navigator.language?.startsWith("uk")) return "uk";
    if (navigator.language?.startsWith("ru")) return "ru";
  }
  return "en";
}

export function setLocale(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale);
}

const translations: Record<string, Record<Locale, string>> = {
  // Header
  "app.title": { en: "WDK Web Wallet", ru: "WDK Веб Кошелёк", uk: "WDK Веб-гаманець" },
  "app.subtitle": { en: "Reference self-custodial WDK multi-chain wallet", ru: "Референсный самостоятельный мультичейн WDK кошелёк", uk: "Референсний самостійний мультичейн WDK гаманець" },
  "app.worker": { en: "Core worker active", ru: "Ядро активно", uk: "Ядро активне" },

  // Wallet card
  "wallets.title": { en: "Your Wallets", ru: "Ваши кошельки", uk: "Ваші гаманці" },
  "wallets.new": { en: "New Wallet", ru: "Новый кошелёк", uk: "Новий гаманець" },
  "wallets.hint": { en: "Each wallet is an independent seed. Switching locks the current wallet — you unlock the one you pick.", ru: "Каждый кошелёк — это независимый seed. Переключение блокирует текущий — вы разблокируете выбранный.", uk: "Кожен гаманець — це незалежний seed. Перемикання блокує поточний — ви розблоковуєте обраний." },

  // Onboarding
  "onboard.create": { en: "Create", ru: "Создать", uk: "Створити" },
  "onboard.import": { en: "Import", ru: "Импорт", uk: "Імпорт" },
  "onboard.seed_label": { en: "Seed phrase", ru: "Seed-фраза", uk: "Seed-фраза" },
  "onboard.seed_placeholder": { en: "twelve or twenty-four words separated by spaces", ru: "двенадцать или двадцать четыре слова через пробел", uk: "дванадцять або двадцять чотири слова через пробіл" },
  "onboard.pass_label": { en: "Passphrase (encrypts the vault on this device)", ru: "Пароль (шифрует хранилище на этом устройстве)", uk: "Пароль (шифрує сховище на цьому пристрої)" },
  "onboard.pass_placeholder": { en: "at least 8 characters", ru: "минимум 8 символов", uk: "щонайменше 8 символів" },
  "onboard.confirm_label": { en: "Confirm passphrase", ru: "Подтвердите пароль", uk: "Підтвердіть пароль" },
  "onboard.confirm_placeholder": { en: "repeat it", ru: "повторите", uk: "повторіть" },
  "onboard.btn_create": { en: "Create wallet", ru: "Создать кошелёк", uk: "Створити гаманець" },
  "onboard.btn_import": { en: "Import wallet", ru: "Импортировать кошелёк", uk: "Імпортувати гаманець" },
  "onboard.watch": { en: "Watch", ru: "Наблюдение", uk: "Спостереження" },

  // Watch-only (Phase 5)
  "watch.onboard_hint": { en: "Monitor any EVM address read-only — no seed, no signing.", ru: "Наблюдайте за любым EVM-адресом только для чтения — без seed-фразы и подписи.", uk: "Спостерігайте за будь-якою EVM-адресою лише для читання — без seed-фрази та підпису." },
  "watch.existing": { en: "Watched addresses", ru: "Отслеживаемые адреса", uk: "Відстежувані адреси" },
  "watch.chain_label": { en: "Chain", ru: "Сеть", uk: "Мережа" },
  "watch.address_label": { en: "Address to watch", ru: "Адрес для наблюдения", uk: "Адреса для спостереження" },
  "watch.label_label": { en: "Label (optional)", ru: "Метка (необязательно)", uk: "Мітка (необов'язково)" },
  "watch.label_placeholder": { en: "e.g. Cold storage", ru: "напр. Холодный кошелёк", uk: "напр. Холодний гаманець" },
  "watch.start": { en: "Start watching", ru: "Начать наблюдение", uk: "Почати спостереження" },
  "watch.addr_invalid": { en: "Enter a valid EVM address (0x + 40 hex characters).", ru: "Введите корректный EVM-адрес (0x + 40 hex-символов).", uk: "Введіть коректну EVM-адресу (0x + 40 hex-символів)." },
  "watch.badge": { en: "Watch-only", ru: "Только наблюдение", uk: "Лише спостереження" },
  "watch.exit": { en: "Exit", ru: "Выйти", uk: "Вийти" },
  "watch.add_another": { en: "Watch another", ru: "Ещё адрес", uk: "Ще адреса" },
  "watch.remove": { en: "Remove", ru: "Удалить", uk: "Видалити" },
  "watch.copy_addr": { en: "Copy watched address", ru: "Копировать адрес", uk: "Копіювати адресу" },
  "watch.cannot_sign": { en: "Watch-only wallets cannot sign. Import the seed to send.", ru: "Кошельки в режиме наблюдения не могут подписывать. Импортируйте seed-фразу для отправки.", uk: "Гаманці в режимі спостереження не можуть підписувати. Імпортуйте seed-фразу, щоб надсилати." },
  "watch.empty": { en: "No balances on this chain for the watched address.", ru: "Нет балансов в этой сети для отслеживаемого адреса.", uk: "Немає балансів у цій мережі для відстежуваної адреси." },

  // Backup
  "backup.title": { en: "Back up your seed phrase", ru: "Сохраните вашу seed-фразу", uk: "Збережіть вашу seed-фразу" },
  "backup.desc": { en: "This is the only way to recover the wallet. Write it down offline. It is shown once.", ru: "Это единственный способ восстановить кошелёк. Запишите офлайн. Показывается один раз.", uk: "Це єдиний спосіб відновити гаманець. Запишіть офлайн. Показується один раз." },
  "backup.checkbox": { en: "I have written it down somewhere safe.", ru: "Я записал(а) это в безопасном месте.", uk: "Я записав(ла) це в безпечному місці." },
  "backup.continue": { en: "Continue", ru: "Продолжить", uk: "Продовжити" },

  // Backup quiz
  "quiz.title": { en: "Verify your seed phrase", ru: "Проверьте вашу seed-фразу", uk: "Перевірте вашу seed-фразу" },
  "quiz.desc": { en: "Select the correct word for each position to verify you saved your seed phrase.", ru: "Выберите правильное слово для каждой позиции, чтобы подтвердить, что вы сохранили seed-фразу.", uk: "Оберіть правильне слово для кожної позиції, щоб підтвердити, що ви зберегли seed-фразу." },
  "quiz.word_n": { en: "Word #", ru: "Слово #", uk: "Слово #" },

  // Lock
  "lock.title": { en: "Unlock", ru: "Разблокировать", uk: "Розблокувати" },
  "lock.pass_label": { en: "Passphrase", ru: "Пароль", uk: "Пароль" },
  "lock.pass_placeholder": { en: "your passphrase", ru: "ваш пароль", uk: "ваш пароль" },
  "lock.btn": { en: "Unlock", ru: "Разблокировать", uk: "Розблокувати" },

  // Account
  "account.title": { en: "Account", ru: "Аккаунт", uk: "Акаунт" },
  "account.add": { en: "Add account", ru: "Добавить аккаунт", uk: "Додати акаунт" },
  "account.hint": { en: "Every account derives from the one seed at a distinct HD index. Switching scopes the portfolio, receive address, and activity below; the selection is remembered on this device.", ru: "Каждый аккаунт происходит от одного seed по уникальному HD-индексу. Переключение меняет портфель, адрес и активность; выбор сохраняется на устройстве.", uk: "Кожен акаунт походить від одного seed за унікальним HD-індексом. Перемикання змінює портфель, адресу та активність; вибір зберігається на пристрої." },

  // Portfolio
  "portfolio.title": { en: "Portfolio", ru: "Портфель", uk: "Портфель" },
  "portfolio.lock": { en: "Lock / Menu", ru: "Блок. / Меню", uk: "Блок. / Меню" },
  "portfolio.total": { en: "Total value", ru: "Общая стоимость", uk: "Загальна вартість" },

  // Send
  "send.title": { en: "Send", ru: "Отправить", uk: "Надіслати" },
  "send.no_assets": { en: "No sendable assets on configured chains.", ru: "Нет доступных активов на настроенных сетях.", uk: "Немає доступних активів у налаштованих мережах." },
  "send.asset": { en: "Asset", ru: "Актив", uk: "Актив" },
  "send.recipient": { en: "Recipient address", ru: "Адрес получателя", uk: "Адреса отримувача" },
  "send.recipient_placeholder": { en: "destination address", ru: "адрес назначения", uk: "адреса призначення" },
  "send.amount": { en: "Amount", ru: "Сумма", uk: "Сума" },
  "send.review": { en: "Review transaction", ru: "Проверить транзакцию", uk: "Перевірити транзакцію" },
  "send.confirm_hint": { en: "Decoded from the transaction — not raw hex. Check every line.", ru: "Декодировано из транзакции — не сырой hex. Проверьте каждую строку.", uk: "Декодовано з транзакції — не сирий hex. Перевірте кожен рядок." },
  "send.confirm_btn": { en: "Confirm & send", ru: "Подтвердить и отправить", uk: "Підтвердити та надіслати" },
  "send.cancel": { en: "Cancel", ru: "Отмена", uk: "Скасувати" },
  "send.broadcast": { en: "Broadcast. It appears below as pending until the network confirms it.", ru: "Отправлено. Появится ниже как ожидающее до подтверждения сетью.", uk: "Надіслано. З'явиться нижче як очікувана до підтвердження мережею." },
  "send.another": { en: "Send another", ru: "Отправить ещё", uk: "Надіслати ще" },
  "send.save_contact": { en: "Save contact", ru: "Сохранить контакт", uk: "Зберегти контакт" },
  "send.contacts": { en: "Contacts", ru: "Контакты", uk: "Контакти" },
  "send.max": { en: "Send entire balance", ru: "Отправить весь баланс", uk: "Надіслати весь баланс" },
  "send.save_contact_prompt": { en: "Recipient not in contacts. Save recipient?", ru: "Получателя нет в контактах. Сохранить получателя?", uk: "Отримувача немає в контактах. Зберегти отримувача?" },
  "send.templates": { en: "Templates", ru: "Шаблоны", uk: "Шаблони" },
  "send.template_applied": { en: "Template applied", ru: "Шаблон применён", uk: "Шаблон застосовано" },

  // Receive
  "receive.title": { en: "Receive", ru: "Получить", uk: "Отримати" },
  "receive.no_addr": { en: "No addresses.", ru: "Нет адресов.", uk: "Немає адрес." },
  "receive.mode_address": { en: "Address", ru: "Адрес", uk: "Адреса" },
  "receive.mode_request": { en: "Request", ru: "Запрос", uk: "Запит" },
  "receive.req_amount": { en: "Amount (optional)", ru: "Сумма (необязательно)", uk: "Сума (необов'язково)" },
  "receive.req_amount_ph": { en: "0.00", ru: "0,00", uk: "0,00" },
  "receive.req_memo": { en: "Memo / reference (optional)", ru: "Памятка / референс (необязательно)", uk: "Примітка / референс (необов'язково)" },
  "receive.req_memo_ph": { en: "e.g. invoice #42", ru: "напр. счёт №42", uk: "напр. рахунок №42" },
  "receive.req_uri": { en: "Payment request", ru: "Запрос платежа", uk: "Запит платежу" },
  "receive.req_copy": { en: "Copy payment request", ru: "Скопировать запрос платежа", uk: "Скопіювати запит платежу" },
  "receive.req_invalid": { en: "Enter a valid positive amount.", ru: "Введите корректную положительную сумму.", uk: "Введіть коректну додатну суму." },
  "receive.req_none": { en: "No assets available for a payment request.", ru: "Нет активов, доступных для запроса платежа.", uk: "Немає активів, доступних для запиту платежу." },
  "receive.req_qr_label": { en: "Payment request QR", ru: "QR запроса платежа", uk: "QR запиту платежу" },

  // Pre-send safety panel
  "safety.title": { en: "Before you send", ru: "Перед отправкой", uk: "Перед надсиланням" },
  "safety.official_token": { en: "Official Tether contract", ru: "Официальный контракт Tether", uk: "Офіційний контракт Tether" },
  "safety.unknown_token": { en: "Unrecognised token contract — verify it.", ru: "Неизвестный контракт токена — проверьте его.", uk: "Невідомий контракт токена — перевірте його." },
  "safety.sending": { en: "Sending", ru: "Отправка", uk: "Надсилання" },
  "safety.recipient_self": { en: "This is one of your own receive addresses.", ru: "Это один из ваших адресов получения.", uk: "Це одна з ваших адрес отримання." },
  "safety.recipient_saved": { en: "Saved contact", ru: "Сохранённый контакт", uk: "Збережений контакт" },
  "safety.recipient_recent": { en: "Recently used recipient.", ru: "Недавно использованный получатель.", uk: "Нещодавно використаний отримувач." },
  "safety.recipient_new": { en: "New recipient — not in your address book.", ru: "Новый получатель — нет в адресной книге.", uk: "Новий отримувач — немає в адресній книзі." },
  "safety.poisoning": { en: "Looks like a known address but is NOT the same. Check every character.", ru: "Похоже на известный адрес, но это НЕ он. Проверьте каждый символ.", uk: "Схоже на відому адресу, але це НЕ вона. Перевірте кожен символ." },
  "safety.poisoning_resembles": { en: "Resembles", ru: "Похоже на", uk: "Схоже на" },
  "safety.gas_note": { en: "Network fee is paid separately in the chain's native coin, not in the token amount above.", ru: "Комиссия сети оплачивается отдельно в нативной монете сети, а не из суммы токена выше.", uk: "Комісія мережі сплачується окремо в нативній монеті мережі, а не із суми токена вище." },
  "safety.view_recipient": { en: "View recipient on explorer", ru: "Посмотреть получателя в проводнике", uk: "Переглянути отримувача в провіднику" },

  // Activity
  "activity.title": { en: "Activity", ru: "Активность", uk: "Активність" },
  "activity.refresh": { en: "Refresh", ru: "Обновить", uk: "Оновити" },
  "activity.empty": { en: "No transactions yet. Send or receive funds to see activity here.", ru: "Транзакций пока нет. Отправьте или получите средства, чтобы увидеть активность.", uk: "Транзакцій поки немає. Надішліть або отримайте кошти, щоб побачити активність." },
  "activity.hint": { en: "Outgoing sends made in this wallet via this app. Inbound and external transfers need a WDK indexer — see docs/ARCHITECTURE.md (ADR-003). Statuses come from the on-chain receipt, never guessed.", ru: "Исходящие отправки из этого кошелька через это приложение. Входящие и внешние переводы требуют WDK-индексер. Статусы из блокчейна, не угаданы.", uk: "Вихідні надсилання з цього гаманця через цей застосунок. Вхідні та зовнішні перекази потребують WDK-індексатора. Статуси з блокчейну, не вгадані." },

  // Security
  "security.title": { en: "Security", ru: "Безопасность", uk: "Безпека" },
  "security.passkey_added": { en: "Passkey added. It will be the preferred unlock next time; your passphrase still works.", ru: "Passkey добавлен. Будет предпочтительным способом разблокировки; пароль по-прежнему работает.", uk: "Passkey додано. Буде кращим способом розблокування; пароль і надалі працює." },
  "security.passkey_desc": { en: "Add a passkey (Face ID / Touch ID / security key) for unlock. Optional — your passphrase keeps working unchanged; the passkey is just preferred once enrolled.", ru: "Добавьте passkey (Face ID / Touch ID / ключ безопасности) для разблокировки. Опционально — пароль продолжает работать; passkey становится предпочтительным.", uk: "Додайте passkey (Face ID / Touch ID / ключ безпеки) для розблокування. Необов'язково — пароль і надалі працює; passkey стає кращим після додавання." },
  "security.add_passkey": { en: "Add passkey unlock", ru: "Добавить passkey разблокировку", uk: "Додати розблокування passkey" },

  // Settings
  "settings.title": { en: "Settings", ru: "Настройки", uk: "Налаштування" },
  "settings.back": { en: "← Back", ru: "← Назад", uk: "← Назад" },
  "settings.autolock": { en: "Auto-Lock Timer", ru: "Автоблокировка", uk: "Автоблокування" },
  "settings.autolock_desc": { en: "Lock wallet after inactivity", ru: "Блокировать кошелёк после бездействия", uk: "Блокувати гаманець після бездіяльності" },
  "settings.minutes": { en: "minutes", ru: "минут", uk: "хвилин" },
  "settings.language": { en: "Language", ru: "Язык", uk: "Мова" },
  "settings.reveal": { en: "Recovery Check", ru: "Проверка восстановления", uk: "Перевірка відновлення" },
  "settings.reveal_desc": { en: "Enter your passphrase to verify that this wallet can still be decrypted. Seed words stay hidden after onboarding.", ru: "Введите пароль, чтобы проверить, что кошелёк всё ещё расшифровывается. Seed-фраза остаётся скрытой после онбординга.", uk: "Введіть пароль, щоб перевірити, що гаманець усе ще розшифровується. Seed-фраза залишається прихованою після онбордингу." },
  "settings.reveal_btn": { en: "Verify passphrase", ru: "Проверить пароль", uk: "Перевірити пароль" },
  "settings.recovery_success": { en: "Passphrase verified. Keep your offline seed backup available before deleting or moving this wallet.", ru: "Пароль проверен. Перед удалением или переносом кошелька убедитесь, что офлайн backup seed-фразы доступен.", uk: "Пароль перевірено. Перед видаленням або перенесенням гаманця переконайтеся, що офлайн-резервна копія seed-фрази доступна." },
  "settings.contacts_title": { en: "Address Book", ru: "Адресная книга", uk: "Адресна книга" },
  "settings.contacts_empty": { en: "No saved contacts yet.", ru: "Нет сохранённых контактов.", uk: "Немає збережених контактів." },
  "settings.contacts_add": { en: "Add contact", ru: "Добавить контакт", uk: "Додати контакт" },
  "settings.contacts_name": { en: "Contact Name", ru: "Имя контакта", uk: "Ім'я контакту" },
  "settings.contacts_address": { en: "Address", ru: "Адрес", uk: "Адреса" },
  "settings.contacts_chain": { en: "Chain", ru: "Сеть", uk: "Мережа" },
  "settings.contacts_add_title": { en: "Add New Contact", ru: "Добавить новый контакт", uk: "Додати новий контакт" },
  "settings.contacts_note": { en: "Note (optional)", ru: "Заметка (необязательно)", uk: "Нотатка (необов'язково)" },
  "settings.contacts_note_ph": { en: "e.g. exchange deposit, rent", ru: "напр. депозит биржи, аренда", uk: "напр. депозит біржі, оренда" },
  "settings.contacts_favorite": { en: "Favorite", ru: "Избранное", uk: "Обране" },
  "settings.contacts_unfavorite": { en: "Remove from favorites", ru: "Убрать из избранного", uk: "Прибрати з обраного" },
  "settings.contacts_edit": { en: "Edit contact", ru: "Редактировать контакт", uk: "Редагувати контакт" },
  "settings.contacts_last_used": { en: "Last used", ru: "Использован", uk: "Використано" },
  "settings.contacts_save_template": { en: "Save as template", ru: "Сохранить как шаблон", uk: "Зберегти як шаблон" },
  "settings.tpl_title": { en: "New payment template", ru: "Новый платёжный шаблон", uk: "Новий платіжний шаблон" },
  "settings.tpl_name": { en: "Template name", ru: "Название шаблона", uk: "Назва шаблону" },
  "settings.tpl_name_ph": { en: "e.g. Monthly rent", ru: "напр. Аренда за месяц", uk: "напр. Оренда за місяць" },
  "settings.tpl_asset": { en: "Asset", ru: "Актив", uk: "Актив" },
  "settings.tpl_amount": { en: "Amount (optional)", ru: "Сумма (необязательно)", uk: "Сума (необов'язково)" },
  "settings.tpl_save": { en: "Save template", ru: "Сохранить шаблон", uk: "Зберегти шаблон" },
  "ds.title": { en: "Data Sources & Privacy", ru: "Источники данных и приватность", uk: "Джерела даних і приватність" },
  "ds.intro": { en: "Every network endpoint this wallet talks to. Defaults are privacy-preserving; overrides are stored on this device only.", ru: "Все сетевые узлы, к которым обращается кошелёк. По умолчанию — приватные настройки; переопределения хранятся только на этом устройстве.", uk: "Усі мережеві вузли, до яких звертається гаманець. За замовчуванням — приватні налаштування; перевизначення зберігаються лише на цьому пристрої." },
  "ds.rpc_eth": { en: "Ethereum RPC URLs", ru: "RPC-узлы Ethereum", uk: "RPC-вузли Ethereum" },
  "ds.rpc_polygon": { en: "Polygon RPC URLs", ru: "RPC-узлы Polygon", uk: "RPC-вузли Polygon" },
  "ds.rpc_arbitrum": { en: "Arbitrum RPC URLs", ru: "RPC-узлы Arbitrum", uk: "RPC-вузли Arbitrum" },
  "ds.rpc_plasma": { en: "Plasma RPC URLs", ru: "RPC-узлы Plasma", uk: "RPC-вузли Plasma" },
  "ds.rpc_solana": { en: "Solana RPC URLs", ru: "RPC-узлы Solana", uk: "RPC-вузли Solana" },
  "ds.rpc_ph": { en: "comma or newline separated; blank = public default", ru: "через запятую или с новой строки; пусто = публичный узел", uk: "через кому або з нового рядка; порожньо = публічний вузол" },
  "ds.btc_ws": { en: "Bitcoin Electrum-WS URL", ru: "URL Electrum-WS (Bitcoin)", uk: "URL Electrum-WS (Bitcoin)" },
  "ds.btc_ws_ph": { en: "wss://… ; blank = BTC disabled", ru: "wss://… ; пусто = BTC отключён", uk: "wss://… ; порожньо = BTC вимкнено" },
  "ds.indexer_mode": { en: "Activity source", ru: "Источник истории", uk: "Джерело історії" },
  "ds.indexer_local": { en: "Local activity only", ru: "Только локальная история", uk: "Лише локальна історія" },
  "ds.indexer_remote": { en: "Use configured indexer", ru: "Использовать индексатор", uk: "Використовувати індексатор" },
  "ds.indexer_url": { en: "Indexer URL", ru: "URL индексатора", uk: "URL індексатора" },
  "ds.prices_enabled": { en: "Fetch USD prices (CoinGecko)", ru: "Загружать цены в USD (CoinGecko)", uk: "Завантажувати ціни в USD (CoinGecko)" },
  "ds.price_endpoint": { en: "Price endpoint", ru: "Узел цен", uk: "Вузол цін" },
  "ds.price_endpoint_ph": { en: "blank = api.coingecko.com", ru: "пусто = api.coingecko.com", uk: "порожньо = api.coingecko.com" },
  "ds.priv_rpc": { en: "Public RPCs can see the addresses you query.", ru: "Публичные RPC видят адреса, которые вы запрашиваете.", uk: "Публічні RPC бачать адреси, які ви запитуєте." },
  "ds.priv_local": { en: "Local-only activity never fetches inbound/external transfers.", ru: "Локальная история не запрашивает входящие/внешние переводы.", uk: "Локальна історія не запитує вхідні/зовнішні перекази." },
  "ds.priv_prices": { en: "The price oracle sees your IP and the static asset set, never your addresses.", ru: "Оракул цен видит ваш IP и фиксированный набор активов, но не ваши адреса.", uk: "Оракул цін бачить вашу IP та фіксований набір активів, але не ваші адреси." },
  "ds.priv_indexer": { en: "A custom indexer improves completeness but changes the privacy model.", ru: "Сторонний индексатор повышает полноту, но меняет модель приватности.", uk: "Сторонній індексатор підвищує повноту, але змінює модель приватності." },
  "ds.save": { en: "Save data sources", ru: "Сохранить источники", uk: "Зберегти джерела" },
  "ds.saved_relock": { en: "Data sources saved. Unlock again to apply.", ru: "Источники сохранены. Разблокируйте заново, чтобы применить.", uk: "Джерела збережено. Розблокуйте знову, щоб застосувати." },
  "ds.csp_blocked": { en: "These origins are not in this deployment's Content-Security-Policy allow-list, so the browser will block requests to them. They only work on a self-hosted build whose CSP env includes them:", ru: "Эти узлы не входят в список разрешённых в Content-Security-Policy этого деплоя, поэтому браузер заблокирует запросы к ним. Они заработают только в self-hosted-сборке, чей CSP-env включает их:", uk: "Ці вузли не входять до списку дозволених у Content-Security-Policy цього деплою, тому браузер заблокує запити до них. Вони запрацюють лише в self-hosted-збірці, чий CSP-env включає їх:" },
  "settings.delete": { en: "Delete Wallet", ru: "Удалить кошелёк", uk: "Видалити гаманець" },
  "settings.delete_desc": { en: "Permanently erase this wallet from this device. This cannot be undone. Make sure you have your seed phrase backed up.", ru: "Безвозвратно удалить этот кошелёк с устройства. Это нельзя отменить. Убедитесь, что у вас есть резервная копия seed-фразы.", uk: "Безповоротно видалити цей гаманець із пристрою. Це не можна скасувати. Переконайтеся, що у вас є резервна копія seed-фрази." },
  "settings.delete_btn": { en: "Delete this wallet", ru: "Удалить этот кошелёк", uk: "Видалити цей гаманець" },
  "settings.delete_confirm": { en: "Are you absolutely sure? This will wipe all data for this wallet from this device.", ru: "Вы абсолютно уверены? Это сотрет все данные этого кошелька с этого устройства.", uk: "Ви абсолютно впевнені? Це зітре всі дані цього гаманця з цього пристрою." },

  // Accessible names for controls whose visible label is not programmatically associated
  "a11y.select_wallet": { en: "Select wallet", ru: "Выбрать кошелёк", uk: "Обрати гаманець" },
  "a11y.select_account": { en: "Select account", ru: "Выбрать аккаунт", uk: "Обрати акаунт" },
  "a11y.select_watch": { en: "Select watched wallet", ru: "Выбрать отслеживаемый кошелёк", uk: "Обрати відстежуваний гаманець" },
  "a11y.switch_language": { en: "Switch language", ru: "Сменить язык", uk: "Змінити мову" },
  "a11y.rename_wallet": { en: "Rename this wallet", ru: "Переименовать этот кошелёк", uk: "Перейменувати цей гаманець" },

  // Toast messages
  "toast.copied": { en: "Copied to clipboard", ru: "Скопировано", uk: "Скопійовано" },
  "toast.copy_failed": { en: "Could not copy — copy it manually", ru: "Не удалось скопировать — скопируйте вручную", uk: "Не вдалося скопіювати — скопіюйте вручну" },
  "toast.sent": { en: "Transaction broadcast successfully", ru: "Транзакция успешно отправлена", uk: "Транзакцію успішно надіслано" },
  "toast.locked": { en: "Wallet locked", ru: "Кошелёк заблокирован", uk: "Гаманець заблоковано" },
  "toast.autolock": { en: "Wallet auto-locked due to inactivity", ru: "Кошелёк заблокирован из-за бездействия", uk: "Гаманець заблоковано через бездіяльність" },
  "toast.contact_saved": { en: "Contact saved", ru: "Контакт сохранён", uk: "Контакт збережено" },
  "toast.contact_removed": { en: "Contact removed", ru: "Контакт удалён", uk: "Контакт видалено" },
  "toast.contact_updated": { en: "Contact updated", ru: "Контакт обновлён", uk: "Контакт оновлено" },
  "toast.template_saved": { en: "Template saved", ru: "Шаблон сохранён", uk: "Шаблон збережено" },
  "toast.template_removed": { en: "Template removed", ru: "Шаблон удалён", uk: "Шаблон видалено" },
  "toast.wallet_renamed": { en: "Wallet renamed", ru: "Кошелёк переименован", uk: "Гаманець перейменовано" },
  "toast.wallet_deleted": { en: "Wallet deleted successfully", ru: "Кошелёк успешно удалён", uk: "Гаманець успішно видалено" },
  "toast.wallet_verified": { en: "Wallet created and verified", ru: "Кошелёк создан и проверен", uk: "Гаманець створено та перевірено" },
  "toast.passkey_added": { en: "Passkey enrolled successfully", ru: "Passkey успешно добавлен", uk: "Passkey успішно додано" },
  "error.contact_required": { en: "Name and address are required.", ru: "Имя и адрес обязательны.", uk: "Ім'я та адреса обов'язкові." },
  "error.delete_failed": { en: "Failed to wipe wallet storage.", ru: "Не удалось стереть хранилище кошелька.", uk: "Не вдалося стерти сховище гаманця." },

  // Validation / thrown-error messages
  "error.pass_too_short": { en: "Use a passphrase of at least 8 characters.", ru: "Используйте пароль не менее 8 символов.", uk: "Використовуйте пароль щонайменше з 8 символів." },
  "error.pass_mismatch": { en: "Passphrases do not match.", ru: "Пароли не совпадают.", uk: "Паролі не збігаються." },
  "error.seed_required": { en: "Enter your seed phrase.", ru: "Введите вашу seed-фразу.", uk: "Введіть вашу seed-фразу." },
  "error.pass_required": { en: "Enter your passphrase.", ru: "Введите ваш пароль.", uk: "Введіть ваш пароль." },
  "error.recipient_required": { en: "Enter a recipient address.", ru: "Введите адрес получателя.", uk: "Введіть адресу отримувача." },
  "error.amount_invalid": { en: "Enter a positive amount, e.g. 12.5", ru: "Введите положительную сумму, напр. 12,5", uk: "Введіть додатну суму, напр. 12,5" },
  "error.amount_decimals": { en: "Too many decimal places — this asset has {n}.", ru: "Слишком много знаков после запятой — у этого актива {n}.", uk: "Забагато знаків після коми — у цього активу {n}." },
  "error.amount_positive": { en: "Amount must be greater than zero.", ru: "Сумма должна быть больше нуля.", uk: "Сума має бути більшою за нуль." },
  "error.quiz_wrong": { en: "Incorrect answer for word #{n}. Please try again.", ru: "Неверный ответ для слова #{n}. Попробуйте снова.", uk: "Невірна відповідь для слова #{n}. Спробуйте ще раз." },
  "error.wrong_passphrase": { en: "Wrong passphrase, or the vault is corrupt.", ru: "Неверный пароль или хранилище повреждено.", uk: "Невірний пароль або сховище пошкоджено." },
  "error.invalid_seed": { en: "That is not a valid BIP-39 seed phrase.", ru: "Это не корректная BIP-39 seed-фраза.", uk: "Це не коректна BIP-39 seed-фраза." },
  "error.wallet_exists": { en: "A wallet already exists on this device.", ru: "На этом устройстве уже есть кошелёк.", uk: "На цьому пристрої вже є гаманець." },
  "error.generic": { en: "Something went wrong.", ru: "Что-то пошло не так.", uk: "Щось пішло не так." },

  // Empty states
  "empty.portfolio": { en: "Your portfolio is empty. Receive funds to get started!", ru: "Ваш портфель пуст. Получите средства, чтобы начать!", uk: "Ваш портфель порожній. Отримайте кошти, щоб почати!" },
  "empty.portfolio_cta": { en: "View receive addresses ↓", ru: "Посмотреть адреса для получения ↓", uk: "Переглянути адреси для отримання ↓" },

  // Misc & Hardcoded replacements
  "misc.working": { en: "Working…", ru: "Работаем…", uk: "Працюємо…" },
  "misc.loading": { en: "Loading wallet…", ru: "Загрузка кошелька…", uk: "Завантаження гаманця…" },
  "misc.retry": { en: "Retry", ru: "Повторить", uk: "Повторити" },
  "misc.scan_qr": { en: "Scan QR", ru: "Сканировать QR", uk: "Сканувати QR" },
  "misc.close": { en: "Close", ru: "Закрыть", uk: "Закрити" },
  "misc.skip": { en: "Skip", ru: "Пропустить", uk: "Пропустити" },
  "misc.cancel": { en: "Cancel", ru: "Отмена", uk: "Скасувати" },
  "misc.save": { en: "Save", ru: "Сохранить", uk: "Зберегти" },
  "misc.remove": { en: "Remove", ru: "Удалить", uk: "Видалити" },
  "misc.on": { en: "on", ru: "на", uk: "у" },
  "misc.view_explorer": { en: "View on explorer", ru: "Посмотреть в проводнике", uk: "Переглянути в провіднику" },
  "misc.amount": { en: "Amount", ru: "Сумма", uk: "Сума" },
  "misc.asset": { en: "Asset", ru: "Актив", uk: "Актив" },
  "misc.chain": { en: "Chain", ru: "Сеть", uk: "Мережа" },
  "misc.recipient": { en: "Recipient", ru: "Получатель", uk: "Отримувач" },
  "misc.network_fee": { en: "Network fee", ru: "Комиссия сети", uk: "Комісія мережі" },
  "account.name_template": { en: "Account #", ru: "Аккаунт #", uk: "Акаунт #" },
};

export function t(key: string, locale: Locale): string {
  return translations[key]?.[locale] ?? translations[key]?.en ?? key;
}
