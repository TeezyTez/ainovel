import 'reader_text_normalization.dart';

String readerKnownObjectId(String kind, String name) {
  var hash = 2166136261;
  for (final point in readerNormalizeName(name).runes) {
    hash ^= point;
    hash =
        (hash +
            (hash << 1) +
            (hash << 4) +
            (hash << 7) +
            (hash << 8) +
            (hash << 24)) &
        0xffffffff;
  }
  return '$kind:${hash.toRadixString(36)}';
}
