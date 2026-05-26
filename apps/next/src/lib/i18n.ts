/**
 * Minimal i18n for EN/RU.
 *
 * A flat key → translation map. The active locale is stored in
 * localStorage so it survives reload.
 */

export type Locale = "en" | "ru";

const STORAGE_KEY = "wdk-locale";

export function getLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "ru" || stored === "en") return stored;
  } catch {
    // Fall through to browser language detection when storage is unavailable.
  }
  // Auto-detect from browser
  if (typeof navigator !== "undefined" && navigator.language?.startsWith("ru")) return "ru";
  return "en";
}

export function setLocale(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale);
}

const translations: Record<string, Record<Locale, string>> = {
  // Header
  "app.title": { en: "WDK Web Wallet", ru: "WDK Веб Кошелёк" },
  "app.subtitle": { en: "Reference self-custodial WDK multi-chain wallet", ru: "Референсный самостоятельный мультичейн WDK кошелёк" },
  "app.worker": { en: "Core worker active", ru: "Ядро активно" },

  // Wallet card
  "wallets.title": { en: "Your Wallets", ru: "Ваши кошельки" },
  "wallets.new": { en: "New Wallet", ru: "Новый кошелёк" },
  "wallets.hint": { en: "Each wallet is an independent seed. Switching locks the current wallet — you unlock the one you pick.", ru: "Каждый кошелёк — это независимый seed. Переключение блокирует текущий — вы разблокируете выбранный." },

  // Onboarding
  "onboard.create": { en: "Create", ru: "Создать" },
  "onboard.import": { en: "Import", ru: "Импорт" },
  "onboard.seed_label": { en: "Seed phrase", ru: "Seed-фраза" },
  "onboard.seed_placeholder": { en: "twelve or twenty-four words separated by spaces", ru: "двенадцать или двадцать четыре слова через пробел" },
  "onboard.pass_label": { en: "Passphrase (encrypts the vault on this device)", ru: "Пароль (шифрует хранилище на этом устройстве)" },
  "onboard.pass_placeholder": { en: "at least 8 characters", ru: "минимум 8 символов" },
  "onboard.confirm_label": { en: "Confirm passphrase", ru: "Подтвердите пароль" },
  "onboard.confirm_placeholder": { en: "repeat it", ru: "повторите" },
  "onboard.btn_create": { en: "Create wallet", ru: "Создать кошелёк" },
  "onboard.btn_import": { en: "Import wallet", ru: "Импортировать кошелёк" },
  "onboard.watch": { en: "Watch", ru: "Наблюдение" },

  // Watch-only (Phase 5)
  "watch.onboard_hint": { en: "Monitor any EVM address read-only — no seed, no signing.", ru: "Наблюдайте за любым EVM-адресом только для чтения — без seed-фразы и подписи." },
  "watch.existing": { en: "Watched addresses", ru: "Отслеживаемые адреса" },
  "watch.chain_label": { en: "Chain", ru: "Сеть" },
  "watch.address_label": { en: "Address to watch", ru: "Адрес для наблюдения" },
  "watch.label_label": { en: "Label (optional)", ru: "Метка (необязательно)" },
  "watch.label_placeholder": { en: "e.g. Cold storage", ru: "напр. Холодный кошелёк" },
  "watch.start": { en: "Start watching", ru: "Начать наблюдение" },
  "watch.addr_invalid": { en: "Enter a valid EVM address (0x + 40 hex characters).", ru: "Введите корректный EVM-адрес (0x + 40 hex-символов)." },
  "watch.badge": { en: "Watch-only", ru: "Только наблюдение" },
  "watch.exit": { en: "Exit", ru: "Выйти" },
  "watch.add_another": { en: "Watch another", ru: "Ещё адрес" },
  "watch.remove": { en: "Remove", ru: "Удалить" },
  "watch.copy_addr": { en: "Copy watched address", ru: "Копировать адрес" },
  "watch.cannot_sign": { en: "Watch-only wallets cannot sign. Import the seed to send.", ru: "Кошельки в режиме наблюдения не могут подписывать. Импортируйте seed-фразу для отправки." },
  "watch.empty": { en: "No balances on this chain for the watched address.", ru: "Нет балансов в этой сети для отслеживаемого адреса." },

  // Backup
  "backup.title": { en: "Back up your seed phrase", ru: "Сохраните вашу seed-фразу" },
  "backup.desc": { en: "This is the only way to recover the wallet. Write it down offline. It is shown once.", ru: "Это единственный способ восстановить кошелёк. Запишите офлайн. Показывается один раз." },
  "backup.checkbox": { en: "I have written it down somewhere safe.", ru: "Я записал(а) это в безопасном месте." },
  "backup.continue": { en: "Continue", ru: "Продолжить" },

  // Backup quiz
  "quiz.title": { en: "Verify your seed phrase", ru: "Проверьте вашу seed-фразу" },
  "quiz.desc": { en: "Select the correct word for each position to verify you saved your seed phrase.", ru: "Выберите правильное слово для каждой позиции, чтобы подтвердить, что вы сохранили seed-фразу." },
  "quiz.word_n": { en: "Word #", ru: "Слово #" },

  // Lock
  "lock.title": { en: "Unlock", ru: "Разблокировать" },
  "lock.pass_label": { en: "Passphrase", ru: "Пароль" },
  "lock.pass_placeholder": { en: "your passphrase", ru: "ваш пароль" },
  "lock.btn": { en: "Unlock", ru: "Разблокировать" },

  // Account
  "account.title": { en: "Account", ru: "Аккаунт" },
  "account.add": { en: "Add account", ru: "Добавить аккаунт" },
  "account.hint": { en: "Every account derives from the one seed at a distinct HD index. Switching scopes the portfolio, receive address, and activity below; the selection is remembered on this device.", ru: "Каждый аккаунт происходит от одного seed по уникальному HD-индексу. Переключение меняет портфель, адрес и активность; выбор сохраняется на устройстве." },

  // Portfolio
  "portfolio.title": { en: "Portfolio", ru: "Портфель" },
  "portfolio.lock": { en: "Lock / Menu", ru: "Блок. / Меню" },
  "portfolio.total": { en: "Total value", ru: "Общая стоимость" },

  // Send
  "send.title": { en: "Send", ru: "Отправить" },
  "send.no_assets": { en: "No sendable assets on configured chains.", ru: "Нет доступных активов на настроенных сетях." },
  "send.asset": { en: "Asset", ru: "Актив" },
  "send.recipient": { en: "Recipient address", ru: "Адрес получателя" },
  "send.recipient_placeholder": { en: "destination address", ru: "адрес назначения" },
  "send.amount": { en: "Amount", ru: "Сумма" },
  "send.review": { en: "Review transaction", ru: "Проверить транзакцию" },
  "send.confirm_hint": { en: "Decoded from the transaction — not raw hex. Check every line.", ru: "Декодировано из транзакции — не сырой hex. Проверьте каждую строку." },
  "send.confirm_btn": { en: "Confirm & send", ru: "Подтвердить и отправить" },
  "send.cancel": { en: "Cancel", ru: "Отмена" },
  "send.broadcast": { en: "Broadcast. It appears below as pending until the network confirms it.", ru: "Отправлено. Появится ниже как ожидающее до подтверждения сетью." },
  "send.another": { en: "Send another", ru: "Отправить ещё" },
  "send.save_contact": { en: "Save contact", ru: "Сохранить контакт" },
  "send.contacts": { en: "Contacts", ru: "Контакты" },
  "send.max": { en: "Send entire balance", ru: "Отправить весь баланс" },
  "send.save_contact_prompt": { en: "Recipient not in contacts. Save recipient?", ru: "Получателя нет в контактах. Сохранить получателя?" },
  "send.templates": { en: "Templates", ru: "Шаблоны" },
  "send.template_applied": { en: "Template applied", ru: "Шаблон применён" },

  // Receive
  "receive.title": { en: "Receive", ru: "Получить" },
  "receive.no_addr": { en: "No addresses.", ru: "Нет адресов." },
  "receive.mode_address": { en: "Address", ru: "Адрес" },
  "receive.mode_request": { en: "Request", ru: "Запрос" },
  "receive.req_amount": { en: "Amount (optional)", ru: "Сумма (необязательно)" },
  "receive.req_amount_ph": { en: "0.00", ru: "0,00" },
  "receive.req_memo": { en: "Memo / reference (optional)", ru: "Памятка / референс (необязательно)" },
  "receive.req_memo_ph": { en: "e.g. invoice #42", ru: "напр. счёт №42" },
  "receive.req_uri": { en: "Payment request", ru: "Запрос платежа" },
  "receive.req_copy": { en: "Copy payment request", ru: "Скопировать запрос платежа" },
  "receive.req_invalid": { en: "Enter a valid positive amount.", ru: "Введите корректную положительную сумму." },
  "receive.req_none": { en: "No assets available for a payment request.", ru: "Нет активов, доступных для запроса платежа." },
  "receive.req_qr_label": { en: "Payment request QR", ru: "QR запроса платежа" },

  // Pre-send safety panel
  "safety.title": { en: "Before you send", ru: "Перед отправкой" },
  "safety.official_token": { en: "Official Tether contract", ru: "Официальный контракт Tether" },
  "safety.unknown_token": { en: "Unrecognised token contract — verify it.", ru: "Неизвестный контракт токена — проверьте его." },
  "safety.sending": { en: "Sending", ru: "Отправка" },
  "safety.recipient_self": { en: "This is one of your own receive addresses.", ru: "Это один из ваших адресов получения." },
  "safety.recipient_saved": { en: "Saved contact", ru: "Сохранённый контакт" },
  "safety.recipient_recent": { en: "Recently used recipient.", ru: "Недавно использованный получатель." },
  "safety.recipient_new": { en: "New recipient — not in your address book.", ru: "Новый получатель — нет в адресной книге." },
  "safety.poisoning": { en: "Looks like a known address but is NOT the same. Check every character.", ru: "Похоже на известный адрес, но это НЕ он. Проверьте каждый символ." },
  "safety.poisoning_resembles": { en: "Resembles", ru: "Похоже на" },
  "safety.gas_note": { en: "Network fee is paid separately in the chain's native coin, not in the token amount above.", ru: "Комиссия сети оплачивается отдельно в нативной монете сети, а не из суммы токена выше." },
  "safety.view_recipient": { en: "View recipient on explorer", ru: "Посмотреть получателя в проводнике" },

  // Activity
  "activity.title": { en: "Activity", ru: "Активность" },
  "activity.refresh": { en: "Refresh", ru: "Обновить" },
  "activity.empty": { en: "No transactions yet. Send or receive funds to see activity here.", ru: "Транзакций пока нет. Отправьте или получите средства, чтобы увидеть активность." },
  "activity.hint": { en: "Outgoing sends made in this wallet via this app. Inbound and external transfers need a WDK indexer — see docs/ARCHITECTURE.md (ADR-003). Statuses come from the on-chain receipt, never guessed.", ru: "Исходящие отправки из этого кошелька через это приложение. Входящие и внешние переводы требуют WDK-индексер. Статусы из блокчейна, не угаданы." },

  // Security
  "security.title": { en: "Security", ru: "Безопасность" },
  "security.passkey_added": { en: "Passkey added. It will be the preferred unlock next time; your passphrase still works.", ru: "Passkey добавлен. Будет предпочтительным способом разблокировки; пароль по-прежнему работает." },
  "security.passkey_desc": { en: "Add a passkey (Face ID / Touch ID / security key) for unlock. Optional — your passphrase keeps working unchanged; the passkey is just preferred once enrolled.", ru: "Добавьте passkey (Face ID / Touch ID / ключ безопасности) для разблокировки. Опционально — пароль продолжает работать; passkey становится предпочтительным." },
  "security.add_passkey": { en: "Add passkey unlock", ru: "Добавить passkey разблокировку" },

  // Settings
  "settings.title": { en: "Settings", ru: "Настройки" },
  "settings.back": { en: "← Back", ru: "← Назад" },
  "settings.autolock": { en: "Auto-Lock Timer", ru: "Автоблокировка" },
  "settings.autolock_desc": { en: "Lock wallet after inactivity", ru: "Блокировать кошелёк после бездействия" },
  "settings.minutes": { en: "minutes", ru: "минут" },
  "settings.language": { en: "Language", ru: "Язык" },
  "settings.reveal": { en: "Recovery Check", ru: "Проверка восстановления" },
  "settings.reveal_desc": { en: "Enter your passphrase to verify that this wallet can still be decrypted. Seed words stay hidden after onboarding.", ru: "Введите пароль, чтобы проверить, что кошелёк всё ещё расшифровывается. Seed-фраза остаётся скрытой после онбординга." },
  "settings.reveal_btn": { en: "Verify passphrase", ru: "Проверить пароль" },
  "settings.recovery_success": { en: "Passphrase verified. Keep your offline seed backup available before deleting or moving this wallet.", ru: "Пароль проверен. Перед удалением или переносом кошелька убедитесь, что офлайн backup seed-фразы доступен." },
  "settings.contacts_title": { en: "Address Book", ru: "Адресная книга" },
  "settings.contacts_empty": { en: "No saved contacts yet.", ru: "Нет сохранённых контактов." },
  "settings.contacts_add": { en: "Add contact", ru: "Добавить контакт" },
  "settings.contacts_name": { en: "Contact Name", ru: "Имя контакта" },
  "settings.contacts_address": { en: "Address", ru: "Адрес" },
  "settings.contacts_chain": { en: "Chain", ru: "Сеть" },
  "settings.contacts_add_title": { en: "Add New Contact", ru: "Добавить новый контакт" },
  "settings.contacts_note": { en: "Note (optional)", ru: "Заметка (необязательно)" },
  "settings.contacts_note_ph": { en: "e.g. exchange deposit, rent", ru: "напр. депозит биржи, аренда" },
  "settings.contacts_favorite": { en: "Favorite", ru: "Избранное" },
  "settings.contacts_unfavorite": { en: "Remove from favorites", ru: "Убрать из избранного" },
  "settings.contacts_edit": { en: "Edit contact", ru: "Редактировать контакт" },
  "settings.contacts_last_used": { en: "Last used", ru: "Использован" },
  "settings.contacts_save_template": { en: "Save as template", ru: "Сохранить как шаблон" },
  "settings.tpl_title": { en: "New payment template", ru: "Новый платёжный шаблон" },
  "settings.tpl_name": { en: "Template name", ru: "Название шаблона" },
  "settings.tpl_name_ph": { en: "e.g. Monthly rent", ru: "напр. Аренда за месяц" },
  "settings.tpl_asset": { en: "Asset", ru: "Актив" },
  "settings.tpl_amount": { en: "Amount (optional)", ru: "Сумма (необязательно)" },
  "settings.tpl_save": { en: "Save template", ru: "Сохранить шаблон" },
  "ds.title": { en: "Data Sources & Privacy", ru: "Источники данных и приватность" },
  "ds.intro": { en: "Every network endpoint this wallet talks to. Defaults are privacy-preserving; overrides are stored on this device only.", ru: "Все сетевые узлы, к которым обращается кошелёк. По умолчанию — приватные настройки; переопределения хранятся только на этом устройстве." },
  "ds.rpc_eth": { en: "Ethereum RPC URLs", ru: "RPC-узлы Ethereum" },
  "ds.rpc_polygon": { en: "Polygon RPC URLs", ru: "RPC-узлы Polygon" },
  "ds.rpc_arbitrum": { en: "Arbitrum RPC URLs", ru: "RPC-узлы Arbitrum" },
  "ds.rpc_plasma": { en: "Plasma RPC URLs", ru: "RPC-узлы Plasma" },
  "ds.rpc_ph": { en: "comma or newline separated; blank = public default", ru: "через запятую или с новой строки; пусто = публичный узел" },
  "ds.btc_ws": { en: "Bitcoin Electrum-WS URL", ru: "URL Electrum-WS (Bitcoin)" },
  "ds.btc_ws_ph": { en: "wss://… ; blank = BTC disabled", ru: "wss://… ; пусто = BTC отключён" },
  "ds.indexer_mode": { en: "Activity source", ru: "Источник истории" },
  "ds.indexer_local": { en: "Local activity only", ru: "Только локальная история" },
  "ds.indexer_remote": { en: "Use configured indexer", ru: "Использовать индексатор" },
  "ds.indexer_url": { en: "Indexer URL", ru: "URL индексатора" },
  "ds.prices_enabled": { en: "Fetch USD prices (CoinGecko)", ru: "Загружать цены в USD (CoinGecko)" },
  "ds.price_endpoint": { en: "Price endpoint", ru: "Узел цен" },
  "ds.price_endpoint_ph": { en: "blank = api.coingecko.com", ru: "пусто = api.coingecko.com" },
  "ds.priv_rpc": { en: "Public RPCs can see the addresses you query.", ru: "Публичные RPC видят адреса, которые вы запрашиваете." },
  "ds.priv_local": { en: "Local-only activity never fetches inbound/external transfers.", ru: "Локальная история не запрашивает входящие/внешние переводы." },
  "ds.priv_prices": { en: "The price oracle sees your IP and the static asset set, never your addresses.", ru: "Оракул цен видит ваш IP и фиксированный набор активов, но не ваши адреса." },
  "ds.priv_indexer": { en: "A custom indexer improves completeness but changes the privacy model.", ru: "Сторонний индексатор повышает полноту, но меняет модель приватности." },
  "ds.save": { en: "Save data sources", ru: "Сохранить источники" },
  "ds.saved_relock": { en: "Data sources saved. Unlock again to apply.", ru: "Источники сохранены. Разблокируйте заново, чтобы применить." },
  "settings.delete": { en: "Delete Wallet", ru: "Удалить кошелёк" },
  "settings.delete_desc": { en: "Permanently erase this wallet from this device. This cannot be undone. Make sure you have your seed phrase backed up.", ru: "Безвозвратно удалить этот кошелёк с устройства. Это нельзя отменить. Убедитесь, что у вас есть резервная копия seed-фразы." },
  "settings.delete_btn": { en: "Delete this wallet", ru: "Удалить этот кошелёк" },
  "settings.delete_confirm": { en: "Are you absolutely sure? This will wipe all data for this wallet from this device.", ru: "Вы абсолютно уверены? Это сотрет все данные этого кошелька с этого устройства." },

  // Toast messages
  "toast.copied": { en: "Copied to clipboard", ru: "Скопировано" },
  "toast.sent": { en: "Transaction broadcast successfully", ru: "Транзакция успешно отправлена" },
  "toast.locked": { en: "Wallet locked", ru: "Кошелёк заблокирован" },
  "toast.autolock": { en: "Wallet auto-locked due to inactivity", ru: "Кошелёк заблокирован из-за бездействия" },
  "toast.contact_saved": { en: "Contact saved", ru: "Контакт сохранён" },
  "toast.contact_removed": { en: "Contact removed", ru: "Контакт удалён" },
  "toast.contact_updated": { en: "Contact updated", ru: "Контакт обновлён" },
  "toast.template_saved": { en: "Template saved", ru: "Шаблон сохранён" },
  "toast.template_removed": { en: "Template removed", ru: "Шаблон удалён" },
  "toast.wallet_renamed": { en: "Wallet renamed", ru: "Кошелёк переименован" },
  "toast.wallet_deleted": { en: "Wallet deleted successfully", ru: "Кошелёк успешно удалён" },
  "toast.wallet_verified": { en: "Wallet created and verified", ru: "Кошелёк создан и проверен" },
  "toast.passkey_added": { en: "Passkey enrolled successfully", ru: "Passkey успешно добавлен" },
  "error.contact_required": { en: "Name and address are required.", ru: "Имя и адрес обязательны." },
  "error.delete_failed": { en: "Failed to wipe wallet storage.", ru: "Не удалось стереть хранилище кошелька." },

  // Empty states
  "empty.portfolio": { en: "Your portfolio is empty. Receive funds to get started!", ru: "Ваш портфель пуст. Получите средства, чтобы начать!" },
  "empty.portfolio_cta": { en: "View receive addresses ↓", ru: "Посмотреть адреса для получения ↓" },

  // Misc & Hardcoded replacements
  "misc.working": { en: "Working…", ru: "Работаем…" },
  "misc.loading": { en: "Loading wallet…", ru: "Загрузка кошелька…" },
  "misc.retry": { en: "Retry", ru: "Повторить" },
  "misc.scan_qr": { en: "Scan QR", ru: "Сканировать QR" },
  "misc.close": { en: "Close", ru: "Закрыть" },
  "misc.skip": { en: "Skip", ru: "Пропустить" },
  "misc.cancel": { en: "Cancel", ru: "Отмена" },
  "misc.save": { en: "Save", ru: "Сохранить" },
  "misc.remove": { en: "Remove", ru: "Удалить" },
  "misc.on": { en: "on", ru: "на" },
  "misc.view_explorer": { en: "View on explorer", ru: "Посмотреть в проводнике" },
  "misc.amount": { en: "Amount", ru: "Сумма" },
  "misc.asset": { en: "Asset", ru: "Актив" },
  "misc.chain": { en: "Chain", ru: "Сеть" },
  "misc.recipient": { en: "Recipient", ru: "Получатель" },
  "misc.network_fee": { en: "Network fee", ru: "Комиссия сети" },
  "account.name_template": { en: "Account #", ru: "Аккаунт #" },
};

export function t(key: string, locale: Locale): string {
  return translations[key]?.[locale] ?? translations[key]?.en ?? key;
}
