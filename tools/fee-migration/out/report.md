# Abgleich: Regelmodell gegen Golden Master

**Vergleichsumfang:** Der Golden Master erfasst neun Felder je Ergebniszeile. Dieser Abgleich prueft nur die vier, die die Frage "traegt das Regelmodell" beantworten: `total`, `subsumed`, `capValue`, `groupingFee`. `singleTotal`, `rawSumSingle`, `groupingBase` und `groupingPerAdditional` entstehen aus den beiden Zusatzlaeufen (Einzeltyp, Staerke 1) und dienen nur der Anzeige -- sie sind im Golden Master vorhanden, damit ein spaeterer Baustein sie pruefen kann, wenn die Oberflaeche umgebaut wird, aber hier **nicht** Teil der Kennzahl unten.

**Fremdwaehrungs-Hinweis:** `evaluate()` nutzt bewusst die lokalen `*_lc`-Betraege unkonvertiert (Spec B2 -- die Umrechnung ist Aufgabe einer spaeteren PHP-Laufzeit, nicht dieses Referenz-Evaluators). Der Golden Master haelt dagegen den vom echten Rechner in EUR umgerechneten Betrag fest. Fuer jede Zeile mit `currency != EUR` weichen `total`/`capValue` daher systematisch um den Wechselkurs-Faktor ab -- das ist eine bewusste Bereichsgrenze des Referenz-Evaluators, kein Zaehlfehler dieses Abgleichs. Siehe `out/findings.md` fuer Details.

- verglichene Ergebniszeilen: **347040**
- übereinstimmend: **223721**
- abweichend: **71479**
- nicht berechenbar (rule: unknown, 17 DK-Zeilen): **51840**
- fehlend: **0**

Die "nicht berechenbar"-Zeilen sind weder als Treffer noch als Abweichung gezaehlt: das Regelmodell liefert dort bewusst keine Zahl (siehe `out/findings.md`), statt eine zu erraten.

## Abweichungen je Excel-Zeile

| Zeile | Anzahl |
|---|---|
| 116 | 2880 |
| 163 | 2490 |
| 156 | 2052 |
| 35 | 1800 |
| 36 | 1800 |
| 37 | 1800 |
| 38 | 1800 |
| 154 | 1620 |
| 343 | 1536 |
| 91 | 1380 |
| 92 | 1380 |
| 93 | 1380 |
| 102 | 1380 |
| 103 | 1380 |
| 104 | 1380 |
| 113 | 1380 |
| 114 | 1380 |
| 115 | 1380 |
| 158 | 1308 |
| 164 | 1026 |
| 246 | 960 |
| 247 | 960 |
| 248 | 960 |
| 17 | 900 |
| 18 | 900 |
| 19 | 900 |
| 20 | 900 |
| 25 | 900 |
| 26 | 900 |
| 27 | 900 |
| 28 | 900 |
| 157 | 816 |
| 338 | 768 |
| 347 | 768 |
| 33 | 720 |
| 34 | 720 |
| 147 | 714 |
| 166 | 654 |
| 360 | 540 |
| 409 | 535 |
| 148 | 516 |
| 226 | 480 |
| 323 | 480 |
| 324 | 480 |
| 328 | 480 |
| 329 | 480 |
| 333 | 480 |
| 334 | 480 |
| 402 | 475 |
| 403 | 475 |

## Nicht berechenbare Zeilen (rule: unknown) je Excel-Zeile

| Zeile | Land | Anzahl Läufe |
|---|---|---|
| 87 | DK | 3840 |
| 98 | DK | 3840 |
| 109 | DK | 3840 |
| 94 | DK | 2880 |
| 90 | DK | 2880 |
| 95 | DK | 2880 |
| 96 | DK | 2880 |
| 97 | DK | 2880 |
| 105 | DK | 2880 |
| 101 | DK | 2880 |
| 106 | DK | 2880 |
| 107 | DK | 2880 |
| 108 | DK | 2880 |
| 112 | DK | 2880 |
| 117 | DK | 2880 |
| 118 | DK | 2880 |
| 119 | DK | 2880 |

## Erste 100 Abweichungen im Einzelnen

| Lauf | Zeile | Feld | Golden Master | Regelmodell |
|---|---|---|---|---|
| 965 | 17 | total | 8810.61 | 17621.22 |
| 966 | 17 | total | 8810.61 | 17621.22 |
| 967 | 17 | total | 8810.61 | 17621.22 |
| 968 | 17 | total | 8810.61 | 17621.22 |
| 969 | 17 | total | 8810.61 | 17621.22 |
| 970 | 17 | total | 8810.61 | 17621.22 |
| 971 | 17 | total | 8810.61 | 17621.22 |
| 972 | 17 | total | 8810.61 | 17621.22 |
| 973 | 17 | total | 8810.61 | 17621.22 |
| 974 | 17 | total | 8810.61 | 17621.22 |
| 975 | 17 | total | 8810.61 | 17621.22 |
| 976 | 17 | total | 8810.61 | 17621.22 |
| 977 | 17 | total | 8810.61 | 17621.22 |
| 978 | 17 | total | 8810.61 | 17621.22 |
| 979 | 17 | total | 8810.61 | 17621.22 |
| 985 | 17 | total | 8810.61 | 17621.22 |
| 986 | 17 | total | 8810.61 | 17621.22 |
| 987 | 17 | total | 8810.61 | 17621.22 |
| 988 | 17 | total | 8810.61 | 17621.22 |
| 989 | 17 | total | 8810.61 | 17621.22 |
| 990 | 17 | total | 8810.61 | 17621.22 |
| 991 | 17 | total | 8810.61 | 17621.22 |
| 992 | 17 | total | 8810.61 | 17621.22 |
| 993 | 17 | total | 8810.61 | 17621.22 |
| 994 | 17 | total | 8810.61 | 17621.22 |
| 995 | 17 | total | 8810.61 | 17621.22 |
| 996 | 17 | total | 8810.61 | 17621.22 |
| 997 | 17 | total | 8810.61 | 17621.22 |
| 998 | 17 | total | 8810.61 | 17621.22 |
| 999 | 17 | total | 8810.61 | 17621.22 |
| 1005 | 17 | total | 8810.61 | 17621.22 |
| 1006 | 17 | total | 8810.61 | 17621.22 |
| 1007 | 17 | total | 8810.61 | 17621.22 |
| 1008 | 17 | total | 8810.61 | 17621.22 |
| 1009 | 17 | total | 8810.61 | 17621.22 |
| 1010 | 17 | total | 8810.61 | 17621.22 |
| 1011 | 17 | total | 8810.61 | 17621.22 |
| 1012 | 17 | total | 8810.61 | 17621.22 |
| 1013 | 17 | total | 8810.61 | 17621.22 |
| 1014 | 17 | total | 8810.61 | 17621.22 |
| 1015 | 17 | total | 8810.61 | 17621.22 |
| 1016 | 17 | total | 8810.61 | 17621.22 |
| 1017 | 17 | total | 8810.61 | 17621.22 |
| 1018 | 17 | total | 8810.61 | 17621.22 |
| 1019 | 17 | total | 8810.61 | 17621.22 |
| 1025 | 17 | total | 8810.61 | 17621.22 |
| 1026 | 17 | total | 8810.61 | 17621.22 |
| 1027 | 17 | total | 8810.61 | 17621.22 |
| 1028 | 17 | total | 8810.61 | 17621.22 |
| 1029 | 17 | total | 8810.61 | 17621.22 |
| 1030 | 17 | total | 8810.61 | 17621.22 |
| 1031 | 17 | total | 8810.61 | 17621.22 |
| 1032 | 17 | total | 8810.61 | 17621.22 |
| 1033 | 17 | total | 8810.61 | 17621.22 |
| 1034 | 17 | total | 8810.61 | 17621.22 |
| 1035 | 17 | total | 8810.61 | 17621.22 |
| 1036 | 17 | total | 8810.61 | 17621.22 |
| 1037 | 17 | total | 8810.61 | 17621.22 |
| 1038 | 17 | total | 8810.61 | 17621.22 |
| 1039 | 17 | total | 8810.61 | 17621.22 |
| 1040 | 15 | total | 3065.55 | 6131.1 |
| 1041 | 15 | total | 3065.55 | 6131.1 |
| 1042 | 15 | total | 3065.55 | 6131.1 |
| 1043 | 15 | total | 3065.55 | 6131.1 |
| 1044 | 15 | total | 3065.55 | 6131.1 |
| 1045 | 17 | total | 8810.61 | 26431.83 |
| 1046 | 17 | total | 8810.61 | 26431.83 |
| 1047 | 17 | total | 8810.61 | 26431.83 |
| 1048 | 17 | total | 8810.61 | 26431.83 |
| 1049 | 17 | total | 8810.61 | 26431.83 |
| 1050 | 17 | total | 8810.61 | 26431.83 |
| 1051 | 17 | total | 8810.61 | 26431.83 |
| 1052 | 17 | total | 8810.61 | 26431.83 |
| 1053 | 17 | total | 8810.61 | 26431.83 |
| 1054 | 17 | total | 8810.61 | 26431.83 |
| 1055 | 17 | total | 8810.61 | 26431.83 |
| 1056 | 17 | total | 8810.61 | 26431.83 |
| 1057 | 17 | total | 8810.61 | 26431.83 |
| 1058 | 17 | total | 8810.61 | 26431.83 |
| 1059 | 17 | total | 8810.61 | 26431.83 |
| 1060 | 15 | total | 3065.55 | 6131.1 |
| 1061 | 15 | total | 3065.55 | 6131.1 |
| 1062 | 15 | total | 3065.55 | 6131.1 |
| 1063 | 15 | total | 3065.55 | 6131.1 |
| 1064 | 15 | total | 3065.55 | 6131.1 |
| 1065 | 17 | total | 8810.61 | 26431.83 |
| 1066 | 17 | total | 8810.61 | 26431.83 |
| 1067 | 17 | total | 8810.61 | 26431.83 |
| 1068 | 17 | total | 8810.61 | 26431.83 |
| 1069 | 17 | total | 8810.61 | 26431.83 |
| 1070 | 17 | total | 8810.61 | 26431.83 |
| 1071 | 17 | total | 8810.61 | 26431.83 |
| 1072 | 17 | total | 8810.61 | 26431.83 |
| 1073 | 17 | total | 8810.61 | 26431.83 |
| 1074 | 17 | total | 8810.61 | 26431.83 |
| 1075 | 17 | total | 8810.61 | 26431.83 |
| 1076 | 17 | total | 8810.61 | 26431.83 |
| 1077 | 17 | total | 8810.61 | 26431.83 |
| 1078 | 17 | total | 8810.61 | 26431.83 |
| 1079 | 17 | total | 8810.61 | 26431.83 |
