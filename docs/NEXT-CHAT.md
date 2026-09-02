# Einstieg für den nächsten Chat

Kopiere einen der beiden Blöcke als erste Nachricht.

---

## A — Weitermachen: ausliefern

```
Variation Toolbox. Lies zuerst das Memory [[fee-data-public-page]] und die Obsidian-Notiz
"Projects/Variation-Toolbox/Gebührenseite & Gebühren-Editor.md".

Stand: v1.18.0 ist auf main gemergt und liegt live auf dem NAS. Ionos steht noch auf 1.6.7.
Alle drei Prüfungen sind bestanden (Golden Master, 1.6.7 gegen 1.18.0, Excel-Vergleich über
alle 421 Zeilen). Offen sind: Push nach origin und der Ionos-Deploy.

Zeig mir zuerst, wie weit main und origin/main auseinanderliegen.
```

---

## B — Etwas Neues am selben Projekt

```
Variation Toolbox. Lies zuerst das Memory [[fee-data-public-page]] — es beschreibt den
aktuellen Stand und die Fallen, die du kennen musst.

Stand: main ist auf v1.18.0, das NAS auch, Ionos noch auf 1.6.7 und noch nicht gepusht.

Ich will <...>
```

---

## Was der nächste Chat unbedingt wissen muss

1. **`convert.py` niemals über die ausgelieferte `assets/js/vcl-calc-data.js` laufen lassen.**
   Die Datei wird von Hand mitgepflegt und trägt `POINT_VALUES`, die `F_pt..V_pt`-Punktspalten
   und die `T/U/V`-Spalten, die der Konverter nicht erzeugt. Er hat eine Warnung im Kopf.
2. **Drei Prüfungen, drei verschiedene Fragen** — die erste allein reicht selten:
   - `verify_current.py` — „hat sich etwas bewegt?" 151.830 Kombinationen, ~10 min,
     SHA-256 beginnt mit `5b7fc3fc`. Vergleicht den Rechner **mit sich selbst**.
   - `compare_excel.py --wide` — „stimmt der Rechner überhaupt?" 14.660 Beträge über
     alle 421 Zeilen, unter 5 Minuten. Das ist die Prüfung gegen die Grundwahrheit.
   - `compare_versions.py` — „ändert der Deploy etwas?" Rechnet `origin/main` gegen den
     Working Tree über dieselbe Matrix.
3. **Ein Nullergebnis erst glauben, wenn ein gepflanzter Fehler gefunden wird.** Ein blindes
   Werkzeug meldet dasselbe wie ein bestandener Lauf. Und der Gegentest selbst misslingt gern
   still: die Neu-Extraktion in `compare_versions.py` überschreibt die Manipulation, und die
   von Hand gepflegte Datendatei schreibt `"F": 0.0` **mit** Leerzeichen, die erzeugte ohne.
   Deshalb immer die Zahl der gepflanzten Fehler mitloggen — steht da 0, war der Test wertlos.
4. **Beträge kann der User selbst pflegen, Rechenwege nicht.** Der Gebühren-Editor ändert
   neun Spalten je Zeile (F, G, H/I/J, K, T, U, V). *Wie* sie verrechnet werden, steht in den
   Formeln der Zeile — ein Deckel etwa in `Sf` als `IF(P>T, T, P)`, nicht in `Pf`. Ein Land,
   das erstmals deckelt, braucht eine Handänderung an `vcl-calc-data.js`.
5. **Die Arbeitsmappe ist jetzt im Repo** (`Variation-Fee-Calculator-EU.xlsx`, per Ausnahme in
   der `.gitignore`). Sie ist die Referenz für die Formelsemantik, auch wenn die Toolbox sie
   nicht mehr ausliefert.
6. **`build_zip.py` hat eine Allowlist von Hand.** Neue Datei ⇒ dort eintragen **und** in
   `includes/lookup.php` registrieren, sonst bricht der Build ab bzw. die Datei fehlt im Plugin.
7. **Ionos ist die Produktion, das NAS die Testumgebung.** Ein Ionos-Deploy liefert derzeit
   v1.7.0 bis v1.18.0 auf einmal aus, inklusive des Gebühren-Editors. Nachgewiesen ist: der
   Sprung ändert keinen Betrag.
8. **CRLF-Falle beim NAS-Abgleich.** Etliche unveränderte Dateien unterscheiden sich dort nur
   in den Zeilenenden. Vor dem Hash-Vergleich die Wagenrückläufe entfernen, sonst sieht ein
   Deploy nach dreimal so vielen offenen Dateien aus, wie es sind.

## Offene Punkte

Siehe `Projects/Variation-Toolbox/TODOs & Roadmap.md` im Obsidian-Vault.
