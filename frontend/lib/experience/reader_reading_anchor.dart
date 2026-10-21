import 'experience_models.dart';

/// A local reference to published prose, never a world fact or a story command.
/// Keeping the source text makes an edited/replaced page detectable without
/// treating a reused page number or paragraph index as the same content.
class ReaderReadingAnchor {
  const ReaderReadingAnchor({
    required this.revision,
    required this.pageText,
    required this.sourceOffset,
    required this.segmentStart,
    required this.segmentEnd,
    required this.viewportY,
  });

  final int revision, sourceOffset, segmentStart, segmentEnd;
  final String pageText;
  final double viewportY;

  static ReaderReadingAnchor? parse(Object? value) {
    if (value is! Map || value['version'] != 1) return null;
    final revision = value['revision'], text = value['page_text'];
    final offset = value['source_offset'];
    final start = value['segment_start'], end = value['segment_end'];
    final y = value['viewport_y'];
    if (revision is! int ||
        revision < 1 ||
        text is! String ||
        text.isEmpty ||
        text.length > 65536 ||
        offset is! int ||
        start is! int ||
        end is! int ||
        start < 0 ||
        end > text.length ||
        start >= end ||
        offset < start ||
        offset > end ||
        y is! num ||
        !y.isFinite ||
        y.abs() > 10000) {
      return null;
    }
    return ReaderReadingAnchor(
      revision: revision,
      pageText: text,
      sourceOffset: offset,
      segmentStart: start,
      segmentEnd: end,
      viewportY: y.toDouble(),
    );
  }

  Json toJson() => {
    'version': 1,
    'revision': revision,
    'page_text': pageText,
    'source_offset': sourceOffset,
    'segment_start': segmentStart,
    'segment_end': segmentEnd,
    'viewport_y': viewportY,
  };

  /// An unchanged page has exact source coordinates. After an edit, only a
  /// unique unchanged source paragraph may recover them; ambiguity fails closed.
  int? resolve(String currentText) {
    if (currentText == pageText) return sourceOffset;
    final segment = pageText.substring(segmentStart, segmentEnd);
    final found = currentText.indexOf(segment);
    if (found < 0 || currentText.indexOf(segment, found + 1) >= 0) return null;
    return found + sourceOffset - segmentStart;
  }
}
