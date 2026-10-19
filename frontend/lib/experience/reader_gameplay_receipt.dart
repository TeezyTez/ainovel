import 'package:flutter/material.dart';
import 'experience_models.dart';

/// An outcome issued only by the authoritative operation commit.
class ReaderGameplayReceipt {
  ReaderGameplayReceipt(Json json)
    : requestId = string(json, 'request_id'),
      artifactId = string(json, 'artifact_id'),
      artifactRevision = string(json, 'artifact_revision'),
      definitionDigest = string(json, 'definition_digest'),
      kind = string(json, 'kind'),
      actionId = string(json, 'action_id'),
      baseRevision = integer(json, 'base_revision'),
      revision = integer(json, 'revision'),
      result = string(json, 'result'),
      location = string(json, 'location'),
      changes = objects(
        json['changes'],
      ).map(ReaderGameplayChange.new).toList(growable: false),
      transit = json['transit'] == null
          ? null
          : ReaderGameplayTransit(object(json['transit'])) {
    if (json['schemaVersion'] != 1 ||
        !const {'dynamic', 'game', 'journey'}.contains(kind) ||
        revision != baseRevision + 1 ||
        requestId.isEmpty ||
        artifactId.isEmpty ||
        artifactRevision.isEmpty ||
        actionId.isEmpty) {
      throw const FormatException('正式行动回执格式不正确');
    }
  }
  final String requestId,
      artifactId,
      artifactRevision,
      definitionDigest,
      kind,
      actionId,
      result,
      location;
  final int baseRevision, revision;
  final List<ReaderGameplayChange> changes;
  final ReaderGameplayTransit? transit;
}

class ReaderGameplayChange {
  ReaderGameplayChange(Json json)
    : entityId = string(json, 'entity_id'),
      kind = string(json, 'kind'),
      before = json['before'],
      after = json['after'] {
    bool literal(Object? value) =>
        value == null || value is String || (value is num && value.isFinite);
    if (!const {'delta', 'status'}.contains(kind) ||
        !json.containsKey('before') ||
        !json.containsKey('after') ||
        !literal(before) ||
        !literal(after)) {
      throw const FormatException('正式行动变化格式不正确');
    }
  }
  final String entityId, kind;
  final Object? before, after;
}

class ReaderGameplayTransit {
  ReaderGameplayTransit(Json json)
    : routeId = string(json, 'routeId'),
      locationId = string(json, 'locationId'),
      completed = json['completed'] as bool,
      elapsedMinutes = json['elapsedMinutes'] == null
          ? null
          : integer(json, 'elapsedMinutes'),
      paidCosts = objects(
        json['paidCosts'],
      ).map(ReaderGameplayCost.new).toList(growable: false),
      quote = string(json, 'quote');
  final String routeId, locationId, quote;
  final bool completed;
  final int? elapsedMinutes;
  final List<ReaderGameplayCost> paidCosts;
}

class ReaderGameplayCost {
  ReaderGameplayCost(Json json)
    : entityId = string(json, 'entityId'),
      amount = json['amount'] as num {
    if (!amount.isFinite || amount < 0)
      throw const FormatException('正式行程费用格式不正确');
  }
  final String entityId;
  final num amount;
}

class ReaderGameplayReceiptView extends StatelessWidget {
  const ReaderGameplayReceiptView({
    super.key,
    required this.receipt,
    required this.information,
  });
  final ReaderGameplayReceipt receipt;
  final List<KnownInformation> information;
  String name(String id) =>
      information.where((entry) => entry.id == id).firstOrNull?.name ?? id;
  String literal(Object? value) => value?.toString() ?? '未明确';

  @override
  Widget build(BuildContext context) {
    final transit = receipt.transit;
    return Semantics(
      label: transit == null ? '已保存的行动结算' : '已保存的行程结果',
      child: Container(
        margin: const EdgeInsets.only(top: 16),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surfaceContainerLow,
          border: Border(
            left: BorderSide(
              color: Theme.of(context).colorScheme.outlineVariant,
              width: 2,
            ),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              transit == null
                  ? '已完成 · ${receipt.result}'
                  : '${transit.completed ? '已抵达' : '途中停下'} · ${name(transit.locationId)}',
            ),
            if (transit != null) ...[
              Text(
                transit.elapsedMinutes == null
                    ? '耗时未明确'
                    : '经过 ${transit.elapsedMinutes} 分钟',
              ),
              for (final cost in transit.paidCosts)
                Text('已付 ${name(cost.entityId)} ${cost.amount}'),
              if (transit.quote.isNotEmpty) Text(transit.quote),
            ],
            for (final change in receipt.changes)
              Text(
                '${name(change.entityId)}：${literal(change.before)} → ${literal(change.after)}',
              ),
            if (transit == null && receipt.location.isNotEmpty)
              Text('所在位置：${receipt.location}'),
          ],
        ),
      ),
    );
  }
}
