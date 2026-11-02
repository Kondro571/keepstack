# TODO: podglądy plików .ai bez wbudowanej miniatury

Keepstack pokazuje podgląd pliku `.ai`/`.eps` tylko wtedy, gdy plik ma go w sobie
(JPEG w metadanych XMP albo TIFF za nagłówkiem DOS EPS) — patrz
`_embedded_preview()` w [keepstack/thumbnails.py](../keepstack/thumbnails.py).
Poniższe pliki takiego podglądu nie mają, więc w bibliotece widać zwykły placeholder.
Z plikami wszystko jest w porządku — to cecha ich formatu.

| Plik | Dlaczego brak podglądu | Co można zrobić |
|---|---|---|
| `AdobeStock_13009038.ai`, `AdobeStock_36818919.ai`, `AdobeStock_39133862.ai` | Stary format Illustratora 8 (czysty PostScript). W środku nie ma żadnego podglądu. | Wyrenderować plik, np. Ghostscriptem. |
| `AdobeStock_30554434.ai` | Illustrator CS3 zapisany jako zgodny z PDF. Ma tylko własną miniaturkę Illustratora 128×92 px (`%AI7_Thumbnail`). | Zdekodować tę miniaturkę albo wyrenderować część PDF. |

## Pomysły na wdrożenie

- **Ghostscript jako opcjonalny renderer** — używany tylko, gdy jest zainstalowany
  (`gs` / `gswin64c` w PATH), jako ostatni krok przed placeholderem. Obsłużyłby
  wszystkie cztery pliki. To zewnętrzny program, więc nie dodaje zależności Pythona.
- **Renderowanie PDF przez PyMuPDF** — działa dla plików zgodnych z PDF, ale biblioteka
  ma licencję AGPL, co kłóci się z licencją MIT projektu.
- **Dekoder `%AI7_Thumbnail`** — bez zależności, ale daje tylko ~128 px.

Po wdrożeniu usunąć folder `data/thumbnails`, żeby miniatury zbudowały się od nowa.
