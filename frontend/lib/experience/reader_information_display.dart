import 'experience_models.dart';

/// Labels immutable entity records without inferring a current world state.
extension ReaderInformationDisplay on KnownInformation {
  bool get isInitialEntityRecord => id.startsWith('entity:');
  bool get isHistoricalFact => id.startsWith('fact:');

  String get displaySummary => isInitialEntityRecord
      ? '初次记载：$text'
      : isHistoricalFact
      ? '${recordedRevision == null ? '历史记录' : '记录版本 $recordedRevision'}：$text'
      : text;

  String? get recordHeading => isInitialEntityRecord
      ? '初次记载${sourceVersion == null ? '' : ' · 第 $sourceVersion 页'}'
      : isHistoricalFact && recordedRevision != null
      ? '记录版本 $recordedRevision'
      : sourceVersion == null
      ? (isHistoricalFact ? '历史记录' : null)
      : '来源：第 $sourceVersion 页';

  String get associationLabel => isInitialEntityRecord ? '初次关联' : '关联';

  String relatedNames(List<KnownInformation> information) => relatedIds
      .map(
        (id) =>
            information
                .where((item) => item.id == id)
                .map((item) => item.name)
                .firstOrNull ??
            '尚无公开资料',
      )
      .join('、');
}

const initialEntityRecordNotice = '初次记载与关联不代表当前持有或关系；后续变化以正式事实和记录为准。';
const historicalFactRecordNotice = '记录版本不代表获知时间；历史表述需结合后续正式记录理解。';
