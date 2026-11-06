// Interface language (English, Polish). Static markup is tagged with
// data-i18n="key" (text), data-i18n-placeholder / -title / -aria-label
// (attributes); scripts call t(key, vars). Missing keys fall back to English,
// then to the key itself. User content (titles, tags, file names) is never
// translated.
//
// A value is a string with {placeholders}, or plural forms keyed by
// Intl.PluralRules category (Polish: one / few / many), chosen by vars.n.

export const LANGS = { en: "English", pl: "Polski" };
const STORE_KEY = "keepstack_lang";

const STRINGS = {
  en: {
    "app.title": "Keepstack - Digital Asset Management",
    "lang.label": "Language",

    // sign in
    "login.tagline": "Open digital asset management",
    "login.username": "Username",
    "login.password": "Password",
    "login.submit": "Sign in",
    "login.invalid": "Invalid credentials",
    "login.locked": "Too many failed attempts. Try again later.",

    // top bar and navigation
    "search.placeholder": "Search assets, tags, metadata...",
    "search.mode": "Search mode",
    "search.keyword": "Keyword",
    "search.semantic": "Semantic",
    "nav.upload": "Upload",
    "nav.signout": "Sign out",
    "nav.library": "Library",
    "nav.collections": "Collections",
    "nav.dashboard": "Dashboard",
    "nav.users": "Users",
    "nav.audit": "Audit log",
    "facets.media": "Media type",
    "facets.tags": "Top tags",

    // media types and roles
    "media.image": "image", "media.video": "video", "media.audio": "audio",
    "media.document": "document", "media.other": "other",
    "role.admin": "Administrator", "role.editor": "Editor", "role.contributor": "Contributor",
    "role.uploader": "Uploader", "role.viewer": "Viewer",
    "role.admin.desc": "Full access, including users, audit log and settings.",
    "role.editor.desc": "Browse, add, edit and delete assets.",
    "role.contributor.desc": "Browse, add and edit assets, tags and collections. Cannot delete.",
    "role.uploader.desc": "Browse, search, download and add new files. Cannot edit or delete.",
    "role.viewer.desc": "Browse, search, view and download.",

    // library
    "library.title": "Library ({n})",
    "library.results": "Results ({n})",
    "library.empty": "No assets yet. Click Upload to get started.",
    "library.selectPage": "Select page",
    "library.selectPageTitle": "Select every file on this page",
    "library.layout": "Layout",
    "library.grid": "Grid view",
    "library.list": "List view",
    "library.perPage": "Items per page",
    "library.pageSize": "{n} per page",
    "library.select": "Select {name}",
    "pager.label": "Pages",
    "pager.prev": "Prev",
    "pager.next": "Next",
    "pager.range": "{from}-{to} of {total}",
    "sort.label": "Sort",
    "sort.by": "Sort by {col}",
    "sort.relevance": "Best match",
    "sort.newest": "Newest",
    "sort.oldest": "Oldest",
    "sort.name": "Name A-Z",
    "sort.name_desc": "Name Z-A",
    "sort.largest": "Largest file",
    "sort.smallest": "Smallest file",
    "sort.type": "Type A-Z",
    "sort.type_desc": "Type Z-A",
    "sort.dims_desc": "Largest dimensions",
    "sort.dims": "Smallest dimensions",
    "col.name": "Name", "col.type": "Type", "col.tags": "Tags", "col.size": "Size",
    "col.dims": "Dimensions", "col.added": "Added",

    // filters
    "filters.active": "Active filters",
    "filters.clearAll": "Clear all",
    "filters.remove": "{what} (click to remove)",
    "filters.mediaType": "Media type",
    "filters.collection": "Collection",
    "filters.collectionChip": "collection",
    "filters.mustHave": "Must have tag",
    "filters.mustNotHave": "Must not have tag",
    "filters.not": "not",
    "tf.button": "Filter tags",
    "tf.region": "Filter by tags",
    "tf.find": "Find a tag...",
    "tf.mustHave": "Files must have",
    "tf.all": "all of the ✓ tags",
    "tf.any": "any of the ✓ tags",
    "tf.legendIn": "must have",
    "tf.legendOut": "must not have",
    "tf.clear": "Clear",
    "tf.apply": "Filter",
    "tf.loading": "Loading tags...",
    "tf.more": "{n} more tags; type to narrow the list",
    "tf.none": "No tags match",
    "tf.summaryIn": "{n} must have",
    "tf.summaryOut": "{n} must not have",
    "tf.summaryNone": "No tags chosen",

    // bulk actions
    "bulk.region": "Bulk actions",
    "bulk.clear": "Clear",
    "bulk.tagName": "Tag name",
    "bulk.addTag": "Add tag",
    "bulk.removeTag": "Remove tag",
    "bulk.delete": "Delete",
    "bulk.files": { one: "{n} file", other: "{n} files" },
    "bulk.selected": { one: "{n} file selected", other: "{n} files selected" },
    "bulk.elsewhere": "({n} on other pages)",
    "bulk.toCollection": "Add to collection...",
    "bulk.newCollection": "+ New collection...",
    "bulk.newCollectionPrompt": "New collection name",
    "bulk.tagged": "Tag \"{tag}\" added to {files}",
    "bulk.untagged": "Tag \"{tag}\" removed from {files}",
    "bulk.collected": "{files} added to \"{name}\"",
    "bulk.deleted": "{files} deleted",
    "bulk.hadIt": "({n} already had it)",
    "bulk.lacked": "({n} did not have it)",
    "bulk.alreadyThere": "({n} already there)",
    "bulk.typeTagFirst": "Type the tag to remove first",
    "bulk.confirmDelete": "Delete {files}? They disappear from the library for everyone.",

    // asset drawer
    "common.loading": "Loading...",
    "common.close": "Close",
    "common.cancel": "Cancel",
    "common.save": "Save",
    "common.delete": "Delete",
    "common.error": "Something went wrong",
    "asset.download": "Download",
    "asset.share": "Create share link",
    "asset.edit": "Edit metadata",
    "asset.fTitle": "Title",
    "asset.fDescription": "Description",
    "asset.fAlt": "Alt text (accessibility)",
    "asset.fCreator": "Creator",
    "asset.fRights": "Rights / license",
    "asset.fRetention": "Retention until",
    "asset.saveChanges": "Save changes",
    "asset.tags": "Tags",
    "asset.addTag": "+ add tag",
    "asset.similar": "Similar assets",
    "asset.oai": "View OAI-PMH XML",
    "asset.embedded": "Embedded metadata (EXIF / IPTC)",
    "asset.versions": "Versions",
    "asset.saved": "Saved",
    "asset.tagFailed": "Could not add tag",
    "asset.shareCopied": "Share link copied: {url}",
    "asset.confirmDelete": "Delete this asset?",
    "asset.deleted": "Deleted",

    // upload dialog
    "upload.title": "Upload assets",
    "upload.drop": "Drag files here or click to browse",
    "upload.ai": "Run AI enrichment (tags, alt-text)",
    "upload.uploading": "uploading...",
    "upload.done": "done",
    "upload.duplicate": "duplicate (deduped)",
    "upload.failed": "failed",
    "upload.tooLarge": "too large ({size}, limit {limit})",
    "upload.processed": "{done} of {total} processed",
    "upload.dupCount": "{n} duplicate",
    "upload.failedCount": "{n} failed",
    "tagimport.title": "Import tags",
    "tagimport.help": "CSV, XLSX or XML. First column: file name (e.g. <code>logo.ai</code>) or UUID; next columns: tags. Several tags in one cell can be separated with <code>;</code> or <code>,</code>.",
    "tagimport.drop": "Drag a CSV, XLSX or XML file here or click to choose",
    "tagimport.importing": "importing...",
    "tagimport.wrongType": "use a .csv, .xlsx or .xml file",
    "tagimport.result": "{files} tagged, {tags} added",
    "tagimport.tags": { one: "{n} tag", other: "{n} tags" },
    "tagimport.notFound": "Not found ({n}): {names}",

    // collections
    "collections.new": "New collection",
    "collections.namePrompt": "Collection name",
    "collections.assets": { one: "{n} asset", other: "{n} assets" },
    "collections.none": "No collections yet.",

    // dashboard
    "dash.totalAssets": "Total assets",
    "dash.storage": "Storage used",
    "dash.dedup": "Saved by dedup",
    "dash.tags": "Tags",
    "dash.collections": "Collections",
    "dash.settings": "Settings",
    "dash.uploadLimit": "Maximum upload size",
    "dash.perFile": "GB per file",
    "dash.uploadLimitHelp": "Larger files are refused before they are uploaded. Applies to new uploads and new versions.",
    "dash.limitSaved": "Upload limit set to {size}",
    "dash.limitFailed": "Could not save settings",
    "dash.integrity": "Integrity",
    "dash.integrityHelp": "Re-hash every stored blob against its recorded SHA-256 (digital preservation fixity check).",
    "dash.runFixity": "Run fixity check",
    "dash.checking": "Checking...",
    "dash.fixityOk": "All {n} blobs verified. Integrity intact.",
    "dash.fixityFailed": "{failed} of {n} failed fixity.",

    // users
    "users.add": "Add user",
    "users.user": "User", "users.email": "Email", "users.role": "Role", "users.status": "Status",
    "users.lastLogin": "Last login",
    "users.you": "(you)",
    "users.ownRole": "You cannot change your own role",
    "users.active": "Active", "users.disabled": "Disabled", "users.never": "never",
    "users.edit": "Edit", "users.disable": "Disable", "users.enable": "Enable",
    "users.nowRole": "{user} is now {role}",
    "users.wasDisabled": "{user} disabled",
    "users.wasEnabled": "{user} enabled",
    "users.confirmDelete": "Delete user \"{user}\"? This cannot be undone. Files they uploaded stay in the library.",
    "users.deleted": "{user} deleted",
    "users.editTitle": "Edit {user}",
    "users.create": "Create user",
    "users.fUsername": "Username",
    "users.fFullName": "Full name",
    "users.fEmail": "Email",
    "users.fPassword": "Password (min. 8 characters)",
    "users.fNewPassword": "New password (leave empty to keep)",
    "users.fActive": "Active (can sign in)",
    "users.errUsername": "Username must be at least 3 characters.",
    "users.errPassword": "Password is required.",
    "users.errShort": "Password must be at least 8 characters.",
    "users.errRole": "Choose a role.",
    "users.updated": "User updated",
    "users.created": "User {user} created",

    // tags view (translations)
    "nav.tags": "Tags",
    "tv.search": "Find a tag or a translation...",
    "tv.missing": "Only without a label in my language",
    "tv.help": "A tag keeps one name, used by filters and links. Labels are what people see in each language. Searching a label finds the tag's files, and typing it when tagging adds the existing tag instead of a new one.",
    "tv.colTag": "Tag",
    "tv.colFiles": "Files",
    "tv.lang.en": "English",
    "tv.lang.pl": "Polish",
    "tv.auto": "Machine translation; edit to confirm",
    "tv.saved": "{name} \u2192 {label}",
    "tv.removed": "Label removed from {name}",
    "tv.none": "No tags found",

    // audit
    "audit.time": "Time", "audit.user": "User", "audit.action": "Action", "audit.target": "Target",
    "audit.detail": "Detail", "audit.ip": "IP",
  },

  pl: {
    "app.title": "Keepstack - zarządzanie zasobami cyfrowymi",
    "lang.label": "Język",

    "login.tagline": "Otwarty system zarządzania zasobami cyfrowymi",
    "login.username": "Login",
    "login.password": "Hasło",
    "login.submit": "Zaloguj się",
    "login.invalid": "Nieprawidłowy login lub hasło",
    "login.locked": "Zbyt wiele nieudanych prób. Spróbuj ponownie później.",

    "search.placeholder": "Szukaj plików, tagów, metadanych...",
    "search.mode": "Tryb wyszukiwania",
    "search.keyword": "Tekstowe",
    "search.semantic": "Semantyczne",
    "nav.upload": "Dodaj pliki",
    "nav.signout": "Wyloguj",
    "nav.library": "Biblioteka",
    "nav.collections": "Kolekcje",
    "nav.dashboard": "Panel",
    "nav.users": "Użytkownicy",
    "nav.audit": "Dziennik zdarzeń",
    "facets.media": "Typ pliku",
    "facets.tags": "Popularne tagi",

    "media.image": "obraz", "media.video": "wideo", "media.audio": "audio",
    "media.document": "dokument", "media.other": "inne",
    "role.admin": "Administrator", "role.editor": "Redaktor", "role.contributor": "Współtwórca",
    "role.uploader": "Dodający", "role.viewer": "Przeglądający",
    "role.admin.desc": "Pełny dostęp, w tym użytkownicy, dziennik zdarzeń i ustawienia.",
    "role.editor.desc": "Przeglądanie, dodawanie, edycja i usuwanie plików.",
    "role.contributor.desc": "Przeglądanie, dodawanie i edycja plików, tagów i kolekcji. Bez usuwania.",
    "role.uploader.desc": "Przeglądanie, wyszukiwanie, pobieranie i dodawanie nowych plików. Bez edycji i usuwania.",
    "role.viewer.desc": "Przeglądanie, wyszukiwanie, podgląd i pobieranie.",

    "library.title": "Biblioteka ({n})",
    "library.results": "Wyniki ({n})",
    "library.empty": "Nie ma jeszcze plików. Kliknij „Dodaj pliki”, aby zacząć.",
    "library.selectPage": "Zaznacz stronę",
    "library.selectPageTitle": "Zaznacz wszystkie pliki na tej stronie",
    "library.layout": "Układ",
    "library.grid": "Widok kafelków",
    "library.list": "Widok listy",
    "library.perPage": "Liczba na stronę",
    "library.pageSize": "{n} na stronę",
    "library.select": "Zaznacz {name}",
    "pager.label": "Strony",
    "pager.prev": "Poprzednia",
    "pager.next": "Następna",
    "pager.range": "{from}-{to} z {total}",
    "sort.label": "Sortowanie",
    "sort.by": "Sortuj: {col}",
    "sort.relevance": "Najlepsze dopasowanie",
    "sort.newest": "Najnowsze",
    "sort.oldest": "Najstarsze",
    "sort.name": "Nazwa A-Z",
    "sort.name_desc": "Nazwa Z-A",
    "sort.largest": "Największy plik",
    "sort.smallest": "Najmniejszy plik",
    "sort.type": "Typ A-Z",
    "sort.type_desc": "Typ Z-A",
    "sort.dims_desc": "Największe wymiary",
    "sort.dims": "Najmniejsze wymiary",
    "col.name": "Nazwa", "col.type": "Typ", "col.tags": "Tagi", "col.size": "Rozmiar",
    "col.dims": "Wymiary", "col.added": "Dodano",

    "filters.active": "Aktywne filtry",
    "filters.clearAll": "Wyczyść wszystko",
    "filters.remove": "{what} (kliknij, aby usunąć)",
    "filters.mediaType": "Typ pliku",
    "filters.collection": "Kolekcja",
    "filters.collectionChip": "kolekcja",
    "filters.mustHave": "Musi mieć tag",
    "filters.mustNotHave": "Nie może mieć tagu",
    "filters.not": "bez",
    "tf.button": "Filtruj tagi",
    "tf.region": "Filtrowanie po tagach",
    "tf.find": "Znajdź tag...",
    "tf.mustHave": "Pliki muszą mieć",
    "tf.all": "wszystkie tagi ✓",
    "tf.any": "dowolny z tagów ✓",
    "tf.legendIn": "musi mieć",
    "tf.legendOut": "nie może mieć",
    "tf.clear": "Wyczyść",
    "tf.apply": "Filtruj",
    "tf.loading": "Wczytywanie tagów...",
    "tf.more": { one: "Jeszcze {n} tag; wpisz, aby zawęzić listę", few: "Jeszcze {n} tagi; wpisz, aby zawęzić listę", many: "Jeszcze {n} tagów; wpisz, aby zawęzić listę", other: "Jeszcze {n} tagu; wpisz, aby zawęzić listę" },
    "tf.none": "Żaden tag nie pasuje",
    "tf.summaryIn": "{n} musi mieć",
    "tf.summaryOut": "{n} nie może mieć",
    "tf.summaryNone": "Nie wybrano tagów",

    "bulk.region": "Akcje zbiorcze",
    "bulk.clear": "Odznacz",
    "bulk.tagName": "Nazwa tagu",
    "bulk.addTag": "Dodaj tag",
    "bulk.removeTag": "Usuń tag",
    "bulk.delete": "Usuń",
    "bulk.files": { one: "{n} plik", few: "{n} pliki", many: "{n} plików", other: "{n} pliku" },
    "bulk.selected": { one: "Zaznaczono {n} plik", few: "Zaznaczono {n} pliki", many: "Zaznaczono {n} plików", other: "Zaznaczono {n} pliku" },
    "bulk.elsewhere": "({n} na innych stronach)",
    "bulk.toCollection": "Dodaj do kolekcji...",
    "bulk.newCollection": "+ Nowa kolekcja...",
    "bulk.newCollectionPrompt": "Nazwa nowej kolekcji",
    "bulk.tagged": "Tag „{tag}” dodany: {files}",
    "bulk.untagged": "Tag „{tag}” usunięty: {files}",
    "bulk.collected": "Dodano do „{name}”: {files}",
    "bulk.deleted": "Usunięto: {files}",
    "bulk.hadIt": "({n} już go miało)",
    "bulk.lacked": "({n} go nie miało)",
    "bulk.alreadyThere": "({n} już tam było)",
    "bulk.typeTagFirst": "Najpierw wpisz tag do usunięcia",
    "bulk.confirmDelete": "Usunąć {files}? Znikną z biblioteki dla wszystkich.",

    "common.loading": "Wczytywanie...",
    "common.close": "Zamknij",
    "common.cancel": "Anuluj",
    "common.save": "Zapisz",
    "common.delete": "Usuń",
    "common.error": "Coś poszło nie tak",
    "asset.download": "Pobierz",
    "asset.share": "Utwórz link do udostępnienia",
    "asset.edit": "Edycja metadanych",
    "asset.fTitle": "Tytuł",
    "asset.fDescription": "Opis",
    "asset.fAlt": "Tekst alternatywny (dostępność)",
    "asset.fCreator": "Autor",
    "asset.fRights": "Prawa / licencja",
    "asset.fRetention": "Przechowywać do",
    "asset.saveChanges": "Zapisz zmiany",
    "asset.tags": "Tagi",
    "asset.addTag": "+ dodaj tag",
    "asset.similar": "Podobne pliki",
    "asset.oai": "Pokaż XML OAI-PMH",
    "asset.embedded": "Metadane osadzone (EXIF / IPTC)",
    "asset.versions": "Wersje",
    "asset.saved": "Zapisano",
    "asset.tagFailed": "Nie udało się dodać tagu",
    "asset.shareCopied": "Skopiowano link: {url}",
    "asset.confirmDelete": "Usunąć ten plik?",
    "asset.deleted": "Usunięto",

    "upload.title": "Dodaj pliki",
    "upload.drop": "Przeciągnij pliki tutaj albo kliknij, aby wybrać",
    "upload.ai": "Wzbogacanie AI (tagi, tekst alternatywny)",
    "upload.uploading": "wysyłanie...",
    "upload.done": "gotowe",
    "upload.duplicate": "duplikat (pominięty)",
    "upload.failed": "błąd",
    "upload.tooLarge": "za duży ({size}, limit {limit})",
    "upload.processed": "Przetworzono {done} z {total}",
    "upload.dupCount": { one: "{n} duplikat", few: "{n} duplikaty", many: "{n} duplikatów", other: "{n} duplikatu" },
    "upload.failedCount": "{n} z błędem",
    "tagimport.title": "Import tagów",
    "tagimport.help": "CSV, XLSX lub XML. Pierwsza kolumna: nazwa pliku (np. <code>logo.ai</code>) albo UUID; kolejne kolumny: tagi. Kilka tagów w jednej komórce można rozdzielić znakiem <code>;</code> lub <code>,</code>.",
    "tagimport.drop": "Przeciągnij plik CSV, XLSX lub XML tutaj albo kliknij, aby wybrać",
    "tagimport.importing": "importowanie...",
    "tagimport.wrongType": "użyj pliku .csv, .xlsx lub .xml",
    "tagimport.result": "otagowano: {files}, dodano: {tags}",
    "tagimport.tags": { one: "{n} tag", few: "{n} tagi", many: "{n} tagów", other: "{n} tagu" },
    "tagimport.notFound": "Nie znaleziono ({n}): {names}",

    "collections.new": "Nowa kolekcja",
    "collections.namePrompt": "Nazwa kolekcji",
    "collections.assets": { one: "{n} plik", few: "{n} pliki", many: "{n} plików", other: "{n} pliku" },
    "collections.none": "Nie ma jeszcze kolekcji.",

    "dash.totalAssets": "Wszystkie pliki",
    "dash.storage": "Zajęte miejsce",
    "dash.dedup": "Zaoszczędzone (deduplikacja)",
    "dash.tags": "Tagi",
    "dash.collections": "Kolekcje",
    "dash.settings": "Ustawienia",
    "dash.uploadLimit": "Maksymalny rozmiar pliku",
    "dash.perFile": "GB na plik",
    "dash.uploadLimitHelp": "Większe pliki są odrzucane przed wysłaniem. Dotyczy nowych plików i nowych wersji.",
    "dash.limitSaved": "Limit ustawiony na {size}",
    "dash.limitFailed": "Nie udało się zapisać ustawień",
    "dash.integrity": "Integralność",
    "dash.integrityHelp": "Ponownie oblicza skrót każdego zapisanego pliku i porównuje z zapisanym SHA-256 (kontrola integralności archiwum).",
    "dash.runFixity": "Sprawdź integralność",
    "dash.checking": "Sprawdzanie...",
    "dash.fixityOk": "Sprawdzono {n} plików. Integralność zachowana.",
    "dash.fixityFailed": "{failed} z {n} nie przeszło kontroli.",

    "users.add": "Dodaj użytkownika",
    "users.user": "Użytkownik", "users.email": "E-mail", "users.role": "Rola", "users.status": "Status",
    "users.lastLogin": "Ostatnie logowanie",
    "users.you": "(ty)",
    "users.ownRole": "Nie możesz zmienić własnej roli",
    "users.active": "Aktywny", "users.disabled": "Wyłączony", "users.never": "nigdy",
    "users.edit": "Edytuj", "users.disable": "Wyłącz", "users.enable": "Włącz",
    "users.nowRole": "{user} ma teraz rolę: {role}",
    "users.wasDisabled": "{user}: konto wyłączone",
    "users.wasEnabled": "{user}: konto włączone",
    "users.confirmDelete": "Usunąć użytkownika „{user}”? Tego nie da się cofnąć. Dodane przez niego pliki zostaną w bibliotece.",
    "users.deleted": "Usunięto użytkownika {user}",
    "users.editTitle": "Edycja: {user}",
    "users.create": "Utwórz użytkownika",
    "users.fUsername": "Login",
    "users.fFullName": "Imię i nazwisko",
    "users.fEmail": "E-mail",
    "users.fPassword": "Hasło (min. 8 znaków)",
    "users.fNewPassword": "Nowe hasło (puste = bez zmian)",
    "users.fActive": "Aktywny (może się logować)",
    "users.errUsername": "Login musi mieć co najmniej 3 znaki.",
    "users.errPassword": "Hasło jest wymagane.",
    "users.errShort": "Hasło musi mieć co najmniej 8 znaków.",
    "users.errRole": "Wybierz rolę.",
    "users.updated": "Zapisano użytkownika",
    "users.created": "Utworzono użytkownika {user}",

    "nav.tags": "Tagi",
    "tv.search": "Znajdź tag lub tłumaczenie...",
    "tv.missing": "Tylko bez tłumaczenia na mój język",
    "tv.help": "Tag ma jedną nazwę, używaną w filtrach i linkach. Tłumaczenia to to, co widzą użytkownicy w danym języku. Wyszukanie tłumaczenia znajduje pliki z tym tagiem, a wpisanie go przy tagowaniu dodaje istniejący tag zamiast tworzyć nowy.",
    "tv.colTag": "Tag",
    "tv.colFiles": "Pliki",
    "tv.lang.en": "Angielski",
    "tv.lang.pl": "Polski",
    "tv.auto": "Tłumaczenie maszynowe; popraw, aby zatwierdzić",
    "tv.saved": "{name} \u2192 {label}",
    "tv.removed": "Usunięto tłumaczenie tagu {name}",
    "tv.none": "Nie znaleziono tagów",

    "audit.time": "Czas", "audit.user": "Użytkownik", "audit.action": "Akcja", "audit.target": "Obiekt",
    "audit.detail": "Szczegóły", "audit.ip": "IP",
  },
};

// Server error messages (the API answers in English) shown in the UI.
const SERVER_PL = {
  "At least one active administrator must remain": "Musi zostać co najmniej jeden aktywny administrator",
  "Invalid email address": "Nieprawidłowy adres e-mail",
  "Name required": "Nazwa jest wymagana",
  "Only assets can be shared": "Udostępniać można tylko pliki",
  "Password is required": "Hasło jest wymagane",
  "Tag name required": "Nazwa tagu jest wymagana",
  "Username must be 3-64 characters: letters, digits, . _ @ -": "Login musi mieć 3-64 znaki: litery, cyfry, . _ @ -",
  "You cannot remove your own admin access or delete yourself": "Nie możesz odebrać sobie uprawnień administratora ani usunąć własnego konta",
  "Authentication required": "Wymagane logowanie",
  "Invalid credentials": "Nieprawidłowy login lub hasło",
  "Too many failed attempts, try again later": "Zbyt wiele nieudanych prób, spróbuj później",
  "You can only revoke your own share links": "Możesz wycofać tylko własne linki",
  "Asset not found": "Nie znaleziono pliku",
  "Collection not found": "Nie znaleziono kolekcji",
  "User not found": "Nie znaleziono użytkownika",
  "Username already exists": "Taki login już istnieje",
  "Preferences too large": "Za dużo zapisanych ustawień",
  "Content-Length required": "Brak nagłówka Content-Length",
  "Tag not found": "Nie znaleziono tagu",
};
const SERVER_PL_PATTERNS = [
  [/^Password must be at least (\d+) characters$/, "Hasło musi mieć co najmniej $1 znaków"],
  [/^Requires (\w+) role$/, "Wymagana rola: $1"],
  [/^File too large \(limit (\d+) MB\)$/, "Plik za duży (limit $1 MB)"],
  [/^Upload limit must be a whole number of MB between (\d+) and (\d+)$/, "Limit musi być liczbą całkowitą MB od $1 do $2"],
  [/^Could not read (.+?): (.*)$/, "Nie udało się odczytać $1: $2"],
  [/^Unknown role: (.*)$/, "Nieznana rola: $1"],
  [/^Send 1 to (\d+) asset uuids$/, "Wyślij od 1 do $1 plików"],
  [/^"(.+)" is already used by the tag "(.+)"$/, "„$1” jest już używane przez tag „$2”"],
];

function initialLang() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (LANGS[saved]) return saved;
  } catch {}
  return (navigator.language || "").toLowerCase().startsWith("pl") ? "pl" : "en";
}

export let lang = initialLang();

export function t(key, vars = {}) {
  let s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  if (typeof s === "object") s = s[new Intl.PluralRules(lang).select(vars.n ?? 0)] ?? s.other;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

// Translate an API error message; unknown ones are shown as they are.
export function tServer(detail) {
  if (lang !== "pl" || !detail) return detail;
  if (SERVER_PL[detail]) return SERVER_PL[detail];
  for (const [re, out] of SERVER_PL_PATTERNS) if (re.test(detail)) return detail.replace(re, out);
  return detail;
}

// Media type and role names come from the server as identifiers.
export const mediaLabel = (m) => STRINGS[lang]["media." + m] ?? m;
export const roleLabel = (r, fallback) => STRINGS[lang]["role." + r] ?? fallback ?? r;
export const roleDesc = (r, fallback) => STRINGS[lang]["role." + r + ".desc"] ?? fallback ?? "";
// Numbers with the language's digit grouping (1 234 in Polish).
export const fmtNum = (n) => Number(n).toLocaleString(lang);

// Fill in every tagged element under `root`. data-i18n-html is for the few
// strings that carry markup (<code>); they come from this file, never users.
export function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-html]").forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  for (const attr of ["placeholder", "title", "aria-label"]) {
    root.querySelectorAll(`[data-i18n-${attr}]`).forEach(el => {
      el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`)));
    });
  }
  document.documentElement.lang = lang;
  document.title = t("app.title");
  root.querySelectorAll("select.lang-select").forEach(sel => { sel.value = lang; });
}

// Switch language; views listen for "keepstack:lang-changed" to re-render.
// The choice is kept in this browser (the sign-in screen needs it) and, once
// signed in, in the user's preferences (see main.js).
export function setLang(next) {
  if (!LANGS[next] || next === lang) return false;
  lang = next;
  try { localStorage.setItem(STORE_KEY, lang); } catch {}
  applyI18n();
  document.dispatchEvent(new CustomEvent("keepstack:lang-changed", { detail: lang }));
  return true;
}
