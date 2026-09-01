# Abgleich: Regelmodell gegen Golden Master

**Kernaussage:** Von den verglichenen **347040** Ergebniszeilen tragen **193470** (55.7%) auf beiden Seiten ueberhaupt keinen Betrag (subsumiert durch eine hoehere Variationsart) und sagen nichts darueber aus, ob das Regelmodell funktioniert. Von den verbleibenden **153570** Zeilen mit Betrag sind **34080** mit dem Regelmodell nicht berechenbar (rule: unknown, DK). Trefferquote **ueber alle Zeilen mit Betrag**: 84347/153570 = **54.9%**. Trefferquote **ueber Zeilen mit Betrag, die zusaetzlich berechenbar sind**: 84347/119490 = **70.6%** -- das ist die eigentliche Antwort dieser Studie; die beiden Zahlen oben duerfen nicht mit einer Kennzahl ueber alle 347040 Zeilen verwechselt werden.

**Vergleichsumfang:** Der Golden Master erfasst neun Felder je Ergebniszeile. Dieser Abgleich prueft nur die vier, die die Frage "traegt das Regelmodell" beantworten: `total`, `subsumed`, `capValue`, `groupingFee`. `singleTotal`, `rawSumSingle`, `groupingBase` und `groupingPerAdditional` entstehen aus den beiden Zusatzlaeufen (Einzeltyp, Staerke 1) und dienen nur der Anzeige -- sie sind im Golden Master vorhanden, damit ein spaeterer Baustein sie pruefen kann, wenn die Oberflaeche umgebaut wird, aber hier **nicht** Teil der Kennzahl oben.

**Fremdwaehrungs-Hinweis:** `evaluate()` rechnet mit `amountsEur` -- den Betraegen, die der echte Rechner unter den Netzwerk-blockierten Bedingungen der Golden-Master-Aufnahme tatsaechlich verwendet hat (F_lc / Kurs, wo ein STATIC_FX_RATES-Fallback existiert, sonst die unveraenderten F..K-Spalten). Das war vormals ein systematischer Wechselkurs-Fehler auf jeder Nicht-EUR-Zeile (Cause B); er ist jetzt geschlossen, keine verbleibende Bereichsgrenze mehr. Siehe `out/findings.md` fuer Details, u.a. dass der ausgelieferte Rechner selbst bei unerreichbarer ECB-API nur fuer HU/NO/SI konvertiert, nicht fuer die anderen sieben Laender mit lokaler Waehrung.

## Ergebnis-Buckets

| Bucket | Anzahl | Anteil an allen Zeilen |
|---|---|---|
| kein Betrag auf beiden Seiten (subsumiert) | 193470 | 55.7% |
| Betrag vorhanden, uebereinstimmend | 84347 | 24.3% |
| Betrag vorhanden, abweichend | 35143 | 10.1% |
| Betrag vorhanden, nicht berechenbar (rule: unknown, DK) | 34080 | 9.8% |
| fehlend | 0 | 0.0% |

Die "kein Betrag"- und "nicht berechenbar"-Zeilen sind weder als Treffer noch als Abweichung gezaehlt: in beiden Faellen liefert das Regelmodell bewusst keine Zahl (siehe `out/findings.md`), statt eine zu erraten oder zu unterstellen.

**Was "uebereinstimmend" hier bedeutet:** Massgeblich ist `total` -- der Gebuehrenbetrag, die eigentliche Frage der Studie. Stimmt `total` ueberein, zaehlt die Zeile als Treffer, auch wenn `capValue`/`groupingFee` abweichen: der Golden Master leitet beide aus einem separaten Einzeltyp-Lauf ab, einer anderen operationalen Definition als dieser Auswerter verwendet (Root Cause 3 in `out/findings.md`) -- ein dokumentierter Vergleichsgrenzfall, kein Regelmodell-Fehler. **6925** der 84347 Treffer haben trotzdem eine Abweichung auf `capValue`, `subsumed` oder `groupingFee`; sie tauchen deshalb nicht in den Abweichungs-Tabellen unten auf (die zeigen nur Zeilen, bei denen `total` selbst abweicht).

## Abweichende Ergebniszeilen je Excel-Zeile

(Zeilen mit mindestens einer abweichenden Ergebniszeile, nicht Feld-Abweichungen -- eine Ergebniszeile kann auf mehreren der vier Felder gleichzeitig abweichen, zaehlt hier aber nur einmal.)

| Zeile | Anzahl abweichender Ergebniszeilen |
|---|---|
| 116 | 2820 |
| 154 | 1620 |
| 163 | 1080 |
| 156 | 948 |
| 343 | 884 |
| 246 | 720 |
| 247 | 720 |
| 248 | 720 |
| 91 | 540 |
| 92 | 540 |
| 93 | 540 |
| 102 | 540 |
| 103 | 540 |
| 104 | 540 |
| 113 | 540 |
| 114 | 540 |
| 115 | 540 |
| 360 | 540 |
| 164 | 474 |
| 338 | 444 |
| 347 | 442 |
| 185 | 360 |
| 190 | 360 |
| 195 | 360 |
| 351 | 360 |
| 355 | 360 |
| 152 | 297 |
| 75 | 288 |
| 186 | 288 |
| 191 | 288 |
| 196 | 288 |
| 227 | 288 |
| 82 | 280 |
| 147 | 258 |
| 83 | 252 |
| 84 | 252 |
| 68 | 240 |
| 234 | 240 |
| 403 | 237 |
| 404 | 237 |
| 408 | 237 |
| 409 | 237 |
| 423 | 225 |
| 424 | 225 |
| 402 | 221 |
| 407 | 221 |
| 244 | 216 |
| 245 | 216 |
| 414 | 216 |
| 233 | 208 |

## Nicht berechenbare Zeilen (rule: unknown) je Excel-Zeile

| Zeile | Land | Anzahl Läufe |
|---|---|---|
| 94 | DK | 2880 |
| 95 | DK | 2880 |
| 96 | DK | 2880 |
| 97 | DK | 2880 |
| 105 | DK | 2880 |
| 106 | DK | 2880 |
| 107 | DK | 2880 |
| 108 | DK | 2880 |
| 117 | DK | 2880 |
| 118 | DK | 2880 |
| 119 | DK | 2880 |
| 90 | DK | 720 |
| 101 | DK | 720 |
| 112 | DK | 720 |
| 87 | DK | 80 |
| 98 | DK | 80 |
| 109 | DK | 80 |

## Erste 100 Feld-Abweichungen im Einzelnen

(Eine Zeile je abweichendem Feld, nicht je Ergebniszeile -- siehe Bucket-Tabelle oben fuer die Anzahl der Ergebniszeilen.)

| Lauf | Zeile | Feld | Golden Master | Regelmodell |
|---|---|---|---|---|
| 23016 | 59 | total | 9576.83 | 11612.44 |
| 23017 | 59 | total | 12743.44 | 16814.66 |
| 23018 | 59 | total | 19076.65 | 27219.1 |
| 23019 | 59 | total | 34909.70 | 53230.2 |
| 23021 | 59 | total | 17380.16 | 19415.77 |
| 23022 | 59 | total | 23147.88 | 27219.1 |
| 23023 | 59 | total | 34683.31 | 42825.76 |
| 23024 | 59 | total | 63521.91 | 81842.41 |
| 23026 | 59 | total | 25183.49 | 27219.1 |
| 23027 | 59 | total | 33552.32 | 37623.54 |
| 23028 | 59 | total | 50289.97 | 58432.42 |
| 23029 | 59 | total | 92134.12 | 110454.62 |
| 23036 | 59 | total | 11273.32 | 15344.55 |
| 23037 | 59 | total | 15005.43 | 23147.88 |
| 23038 | 59 | total | 22469.65 | 38754.54 |
| 23039 | 59 | total | 41130.19 | 77771.19 |
| 23041 | 59 | total | 19076.65 | 23147.88 |
| 23042 | 59 | total | 25409.87 | 33552.32 |
| 23043 | 59 | total | 38076.31 | 54361.2 |
| 23044 | 59 | total | 69742.40 | 106383.39 |
| 23046 | 59 | total | 26879.98 | 30951.21 |
| 23047 | 59 | total | 35814.31 | 43956.76 |
| 23048 | 59 | total | 53682.97 | 69967.86 |
| 23049 | 59 | total | 98354.61 | 134995.6 |
| 23056 | 59 | total | 12969.82 | 19076.65 |
| 23057 | 59 | total | 17267.43 | 29481.09 |
| 23058 | 59 | total | 25862.64 | 50289.97 |
| 23059 | 59 | total | 47350.68 | 102312.17 |
| 23061 | 59 | total | 20773.15 | 26879.98 |
| 23062 | 59 | total | 27671.87 | 39885.53 |
| 23063 | 59 | total | 41469.30 | 65896.63 |
| 23064 | 59 | total | 75962.89 | 130924.38 |
| 23066 | 59 | total | 28576.48 | 34683.31 |
| 23067 | 59 | total | 38076.31 | 50289.97 |
| 23068 | 59 | total | 57075.96 | 81503.29 |
| 23069 | 59 | total | 104575.10 | 159536.59 |
| 23076 | 59 | total | 8694.64 | 11024.31 |
| 23077 | 59 | total | 11567.18 | 16226.53 |
| 23078 | 59 | total | 17312.27 | 26630.97 |
| 23079 | 59 | total | 31675.00 | 52642.07 |
| 23081 | 59 | total | 16497.97 | 18827.64 |
| 23082 | 59 | total | 21971.62 | 26630.97 |
| 23083 | 59 | total | 32918.93 | 42237.63 |
| 23084 | 59 | total | 60287.21 | 81254.28 |
| 23086 | 59 | total | 24301.30 | 26630.97 |
| 23087 | 59 | total | 32376.06 | 37035.41 |
| 23088 | 59 | total | 48525.59 | 57844.29 |
| 23089 | 59 | total | 88899.42 | 109866.49 |
| 23091 | 58 | total | 2587.80 | 2881.87 |
| 23092 | 58 | total | 3424.74 | 4012.87 |
| 23093 | 58 | total | 5098.61 | 6274.86 |
| 23094 | 58 | total | 9283.28 | 11929.85 |
| 23096 | 59 | total | 10391.13 | 14756.42 |
| 23097 | 59 | total | 13829.18 | 22559.75 |
| 23098 | 59 | total | 20705.27 | 38166.41 |
| 23099 | 59 | total | 37895.49 | 77183.06 |
| 23101 | 59 | total | 18194.46 | 22559.75 |
| 23102 | 59 | total | 24233.62 | 32964.19 |
| 23103 | 59 | total | 36311.93 | 53773.07 |
| 23104 | 59 | total | 66507.70 | 105795.27 |
| 23106 | 59 | total | 25997.79 | 30363.08 |
| 23107 | 59 | total | 34638.06 | 43368.63 |
| 23108 | 59 | total | 51918.59 | 69379.73 |
| 23109 | 59 | total | 95119.91 | 134407.48 |
| 23111 | 58 | total | 4284.30 | 4578.36 |
| 23112 | 58 | total | 5686.73 | 6274.86 |
| 23113 | 58 | total | 8491.60 | 9667.86 |
| 23114 | 58 | total | 15503.77 | 18150.34 |
| 23116 | 59 | total | 12087.63 | 18488.53 |
| 23117 | 59 | total | 16091.17 | 28892.97 |
| 23118 | 59 | total | 24098.26 | 49701.85 |
| 23119 | 59 | total | 44115.98 | 101724.05 |
| 23121 | 59 | total | 19890.96 | 26291.86 |
| 23122 | 59 | total | 26495.61 | 39297.41 |
| 23123 | 59 | total | 39704.92 | 65308.51 |
| 23124 | 59 | total | 72728.19 | 130336.26 |
| 23126 | 59 | total | 27694.29 | 34095.19 |
| 23127 | 59 | total | 36900.05 | 49701.85 |
| 23128 | 59 | total | 55311.58 | 80915.17 |
| 23129 | 59 | total | 101340.40 | 158948.47 |
| 23131 | 58 | total | 5980.80 | 6274.86 |
| 23132 | 58 | total | 7948.73 | 8536.86 |
| 23133 | 58 | total | 11884.60 | 13060.85 |
| 23134 | 58 | total | 21724.26 | 24370.83 |
| 23136 | 59 | total | 13784.13 | 22220.64 |
| 23137 | 59 | total | 18353.17 | 35226.19 |
| 23138 | 59 | total | 27491.26 | 61237.28 |
| 23139 | 59 | total | 50336.47 | 126265.03 |
| 23141 | 59 | total | 21587.46 | 30023.97 |
| 23142 | 59 | total | 28757.61 | 45630.62 |
| 23143 | 59 | total | 43097.92 | 76843.94 |
| 23144 | 59 | total | 78948.68 | 154877.24 |
| 23146 | 59 | total | 29390.79 | 37827.3 |
| 23147 | 59 | total | 39162.05 | 56035.06 |
| 23148 | 59 | total | 58704.58 | 92450.6 |
| 23149 | 59 | total | 107560.89 | 183489.45 |
| 23156 | 59 | total | 9508.94 | 14168.29 |
| 23157 | 59 | total | 12652.92 | 21971.62 |
| 23158 | 59 | total | 18940.89 | 37578.28 |
| 23159 | 59 | total | 34660.79 | 76594.93 |
