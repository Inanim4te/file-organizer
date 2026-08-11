# file-organizer

`file-organizer` — CLI-застосунок на Node.js для аналізу директорій, пошуку дублікатів, сортування файлів за категоріями та безпечного видалення застарілих файлів.

## Вимоги

- Node.js 18 або новіша версія
- npm (постачається разом із Node.js)

Застосунок використовує лише вбудовані модулі Node.js, тому встановлювати сторонні залежності не потрібно.

## Встановлення

```bash
git clone <посилання-на-репозиторій>
cd file-organizer
npm install
```

Перегляд довідки:

```bash
node file-organizer.js --help
```

## Команда `scan`

Рекурсивно сканує директорію та показує:

- загальну кількість і розмір файлів;
- статистику за розширеннями;
- кількість файлів, змінених за останні 7 і 30 днів;
- кількість файлів, старіших за 90 днів;
- три найбільші файли;
- найстаріший файл.

```bash
node file-organizer.js scan /path/to/directory
# або
npm run scan -- /path/to/directory
```

## Команда `duplicates`

Рекурсивно обчислює SHA-256 кожного файлу за допомогою readable stream, групує файли з однаковим вмістом та рахує місце, зайняте зайвими копіями.

```bash
node file-organizer.js duplicates /path/to/directory
# або
npm run duplicates -- /path/to/directory
```

Назви файлів не впливають на результат: дублікати визначаються виключно за вмістом.

## Команда `organize`

Копіює всі файли з вихідної директорії до цільової та розподіляє їх між `Documents`, `Images`, `Archives`, `Code`, `Videos` і `Other`.

```bash
node file-organizer.js organize /source/directory --output /target/directory
# або
npm run organize -- /source/directory --output /target/directory
```

- Оригінали не змінюються і не видаляються.
- Файли від 10 MB копіюються через streams і `pipeline()`.
- Якщо ім'я вже зайняте, створюється нове: `file.pdf`, `file(1).pdf`, `file(2).pdf`.
- Якщо цільова директорія розташована всередині вихідної, вона виключається зі сканування.

Відповідність розширень категоріям:

| Категорія | Розширення |
| --- | --- |
| Documents | `.pdf`, `.docx`, `.doc`, `.txt`, `.md`, `.xlsx`, `.pptx` |
| Images | `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.bmp` |
| Archives | `.zip`, `.rar`, `.tar`, `.gz`, `.7z` |
| Code | `.js`, `.py`, `.java`, `.cpp`, `.html`, `.css`, `.json` |
| Videos | `.mp4`, `.avi`, `.mkv`, `.mov`, `.webm` |
| Other | усі інші розширення та файли без розширення |

## Команда `cleanup`

Без `--confirm` команда працює в режимі попереднього перегляду: показує файли, але нічого не видаляє.

```bash
node file-organizer.js cleanup /path/to/directory --older-than 90
# або
npm run cleanup -- /path/to/directory --older-than 90
```

Для фактичного видалення додайте `--confirm`:

```bash
node file-organizer.js cleanup /path/to/directory --older-than 90 --confirm
```

`--older-than <days>` — мінімальний вік файлу в днях, обчислений за датою останньої модифікації. Значення може бути невід'ємним числом.

> Видалення з `--confirm` є незворотним. Спочатку завжди рекомендовано виконати dry run.

## Архітектура та події

Кожна команда реалізована окремим класом, що наслідується від `EventEmitter`. Бізнес-логіка не виводить дані в консоль; точка входу підписується на події та показує прогрес.

| Клас | Основні події |
| --- | --- |
| `Scanner` | `scan-start`, `files-counted`, `file-found`, `scan-complete` |
| `DuplicateFinder` | `search-start`, `file-processed`, `file-error`, `duplicates-found` |
| `Organizer` | `folder-created`, `organize-start`, `copy-start`, `copy-complete`, `copy-error`, `organize-complete` |
| `Cleanup` | `cleanup-start`, `file-found`, `files-ready`, `file-deleted`, `cleanup-complete` |

Файлові операції виконуються асинхронно та мають обробку помилок. Для `ENOENT`, `EACCES`/`EPERM`, `ENOTDIR`, `ENOSPC` та інших помилок CLI показує зрозуміле повідомлення і завершується з кодом `1`.

## Структура проєкту

```text
file-organizer/
├── package.json
├── .gitignore
├── README.md
├── file-organizer.js
└── lib/
    ├── scanner.js
    ├── duplicates.js
    ├── organizer.js
    └── cleanup.js
```

## Безпека

- `organize` лише копіює файли та ніколи не перезаписує наявні.
- `cleanup` без явного `--confirm` не видаляє файли.
- Символічні посилання не обходяться, щоб не вийти за межі вибраної директорії та не створити рекурсивний цикл.
