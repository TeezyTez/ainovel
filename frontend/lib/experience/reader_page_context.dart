import 'dart:convert';

import 'experience_models.dart';

/// Presentation of one committed page, never a reconstruction of world state.
class ReaderPageContext {
  const ReaderPageContext({
    required this.page,
    required this.available,
    required this.comparisonAvailable,
    this.comparedRevision,
    required this.information,
    required this.changes,
  });
  final ExperiencePage page;
  final bool available, comparisonAvailable;
  final int? comparedRevision;
  final List<KnownInformation> information;
  final List<ReaderContextChange> changes;
}

class ReaderContextChange {
  const ReaderContextChange(this.item, {this.before});
  final KnownInformation item;
  final KnownInformation? before;
  bool get isUpdate => before != null;
}

class ReaderContextReference {
  const ReaderContextReference(this.item, this.revision);
  final KnownInformation item;
  final int revision;
}

class ReaderPageContextIndex {
  ReaderPageContextIndex(ExperienceView view) {
    final pages =
        view.pages.where((page) => page.revision <= view.revision).toList()
          ..sort((a, b) => a.revision.compareTo(b.revision));
    ReaderPageContext? previous;
    for (final page in pages) {
      List<KnownInformation>? information;
      if (page.reader?.revision == page.revision) {
        information = page.reader!.information;
      } else if (page.revision == view.revision) {
        information = view.reader?.revision == page.revision
            ? view.reader!.information
            : view.information;
      }
      final available = information != null;
      final items = List<KnownInformation>.unmodifiable(information ?? []);
      final opening = page.revision == 1;
      final comparisonAvailable =
          available && (opening || previous?.available == true);
      final beforeById = {
        for (final item in previous?.information ?? <KnownInformation>[])
          item.id: item,
      };
      final changes = <ReaderContextChange>[];
      for (final item in items) {
        final signature = _signature(item);
        final appearances = _appearances.putIfAbsent(item.id, () => {});
        appearances.putIfAbsent(signature, () => page.revision);
        if (!comparisonAvailable) continue;
        final before = opening ? null : beforeById[item.id];
        if (before == null || _signature(before) != signature) {
          changes.add(ReaderContextChange(item, before: before));
        }
      }
      final context = ReaderPageContext(
        page: page,
        available: available,
        comparisonAvailable: comparisonAvailable,
        comparedRevision: comparisonAvailable && !opening
            ? previous!.page.revision
            : null,
        information: items,
        changes: List.unmodifiable(changes),
      );
      _pages[page.revision] = context;
      previous = context;
    }
  }

  final Map<int, ReaderPageContext> _pages = {};
  final Map<String, Map<String, int>> _appearances = {};
  final Map<KnownInformation, String> _signatures = Map.identity();
  final Map<(int, String, String, int), List<ReaderContextReference>>
  _relatedCache = {};

  ReaderPageContext? at(int revision) => _pages[revision];

  /// First saved public snapshot containing this form of a record. Provenance
  /// metadata is not evidence that an earlier reader could see the record.
  int? appearanceOf(KnownInformation item, {required int throughRevision}) {
    final first = _appearances[item.id]?[_signature(item)];
    return first != null && first <= throughRevision ? first : null;
  }

  /// Prior records sharing an explicit, publicly named association. Their
  /// adjacency does not assert a causal relationship or a new story fact.
  List<ReaderContextReference> earlierRelated(
    KnownInformation item, {
    required int revision,
    int limit = 3,
  }) => _relatedCache.putIfAbsent((
    revision,
    item.id,
    _signature(item),
    limit,
  ), () => _earlierRelated(item, revision: revision, limit: limit));

  List<ReaderContextReference> _earlierRelated(
    KnownInformation item, {
    required int revision,
    required int limit,
  }) {
    final context = at(revision);
    if (limit <= 0 || context == null || !context.available) return const [];
    final publicIds = context.information.map((item) => item.id).toSet();
    if (!context.information.any(
      (current) =>
          current.id == item.id && _signature(current) == _signature(item),
    )) {
      return const [];
    }
    final pivots = item.relatedIds.where(publicIds.contains).toSet();
    if (item.id.startsWith('entity:') ||
        const {
          'person',
          'character',
          'location',
          'item',
          'resource',
        }.contains(item.kind)) {
      pivots.add(item.id);
    }
    if (pivots.isEmpty) return const [];

    final seen = <String>{item.id};
    final references = <ReaderContextReference>[];
    for (final earlier in _pages.values.toList().reversed) {
      if (earlier.page.revision >= revision || !earlier.available) continue;
      for (final candidate in earlier.information) {
        // Use only the latest earlier form of an ID, even when an older form
        // had different associations. Repeated snapshots are not new records.
        if (!seen.add(candidate.id) ||
            !candidate.relatedIds.any(pivots.contains)) {
          continue;
        }
        final source = appearanceOf(
          candidate,
          throughRevision: earlier.page.revision,
        );
        if (source != null) {
          references.add(ReaderContextReference(candidate, source));
        }
      }
    }
    references.sort((a, b) {
      final byRevision = b.revision.compareTo(a.revision);
      return byRevision != 0 ? byRevision : a.item.id.compareTo(b.item.id);
    });
    return List.unmodifiable(references.take(limit));
  }

  String _signature(KnownInformation item) => _signatures.putIfAbsent(item, () {
    final related = item.relatedIds.toSet().toList()..sort();
    final fields =
        item.fields.map((field) => jsonEncode(_ordered(field))).toList()
          ..sort();
    return jsonEncode([
      item.name,
      item.text,
      item.kind,
      item.status,
      item.certainty,
      fields,
      related,
    ]);
  });
}

Object? _ordered(Object? value) {
  if (value is Map) {
    final keys = value.keys.cast<String>().toList()..sort();
    return {for (final key in keys) key: _ordered(value[key])};
  }
  if (value is List) return value.map(_ordered).toList(growable: false);
  return value;
}
