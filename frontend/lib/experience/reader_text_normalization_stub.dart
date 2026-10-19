// Native fallback; the Web target uses the source JavaScript NFKC algorithm.
String readerNormalizeName(String value) =>
    value.trim().replaceAll(RegExp(r'\s+'), ' ').toLowerCase();
