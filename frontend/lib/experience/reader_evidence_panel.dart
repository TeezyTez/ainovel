import '../portal/portal_icon.dart';
import 'dart:convert';
import 'reader_artifact_surface.dart';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'experience_models.dart';
import 'reader_projection.dart';
import 'reader_panels.dart';

class ReaderEvidencePanel extends StatefulWidget {
  const ReaderEvidencePanel({
    super.key,
    required this.kind,
    required this.projection,
    required this.onObject,
    required this.onAction,
    required this.onSource,
    required this.onExport,
    required this.initialValues,
    required this.onValues,
    this.readonly = false,
    this.blocked = false,
    this.onRestore,
    this.onCancel,
    this.onHistory,
  });
  final String kind;
  final ReaderProjection projection;
  final ValueChanged<KnownInformation> onObject;
  final ValueChanged<String> onAction;
  final ValueChanged<int> onSource;
  final ValueChanged<ReaderEvidence> onExport;
  final Json initialValues;
  final ValueChanged<Json> onValues;
  final bool readonly, blocked;
  final ValueChanged<int>? onRestore;
  final VoidCallback? onCancel, onHistory;
  @override
  State<ReaderEvidencePanel> createState() => _ReaderEvidencePanelState();
}

class _ReaderEvidencePanelState extends State<ReaderEvidencePanel> {
  final transform = TransformationController();
  late Json params = Map.of(widget.initialValues);
  String filter = '', selectedPlace = '';
  final Map<String, int> sortColumns = {};
  final Map<String, bool> ascending = {};
  final Map<String, String> errors = {};
  @override
  void dispose() {
    transform.dispose();
    super.dispose();
  }

  String name(String id) =>
      widget.projection.information
          .where((i) => i.id == 'entity:$id')
          .map((i) => i.name)
          .firstOrNull ??
      '已知对象';
  Widget source(ReaderEvidence record) => ExpansionTile(
    title: Text('记录依据 · 第 ${record.sourceRevision} 页'),
    children: [
      SelectableText(record.quote),
      TextButton(
        onPressed: () => widget.onSource(record.sourceRevision),
        child: const Text('回看原文'),
      ),
    ],
  );
  Widget objectButton(String id) => TextButton(
    onPressed: () {
      final item = widget.projection.information
          .where((i) => i.id == 'entity:$id')
          .firstOrNull;
      if (item != null) widget.onObject(item);
    },
    child: Text(name(id)),
  );
  void save(ReaderEvidence record, String id, String value) {
    final values = Map<String, dynamic>.from(
      params[record.factId] as Map? ?? {},
    );
    values[id] = value;
    setState(() => params[record.factId] = values);
    widget.onValues(Map.of(params));
  }

  Widget recordView(ReaderEvidence r) => Card(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  r.label,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              objectButton(r.entityId),
            ],
          ),
          if (r.value.isNotEmpty)
            Text(
              '${r.value}${r.unit}',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
          if (r.status.isNotEmpty) Text(r.status),
          if (r.dueAt.isNotEmpty) Text('时间：${r.dueAt}'),
          if (r.kind == 'route') ...[
            Wrap(
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                objectButton(r.entityId),
                const Text(' → '),
                objectButton(r.targetId),
              ],
            ),
            Text(
              '${_bearings[r.bearing] ?? '方位未记录'} · ${r.distanceMeters == null ? '距离未测定' : '${r.distanceMeters} 米'} · ${const {'open': '已记录通路', 'blocked': '封锁', 'unknown': '通行状态未明'}[r.passage] ?? '通行状态未明'}',
            ),
            if (!widget.readonly)
              TextButton(
                onPressed: widget.blocked || r.passage == 'blocked'
                    ? null
                    : () => widget.onAction(
                        r.input.isNotEmpty
                            ? r.input
                            : '我想尝试从${name(r.entityId)}前往${name(r.targetId)}。如果遇到额外费用、限制或重要决定，请先交回给我。',
                      ),
                child: const Text('按这条记录尝试前往'),
              ),
          ],
          if (r.kind == 'action') ...[
            Text(r.input),
            const Text('结果由后续正式故事确认。'),
            if (!widget.readonly)
              TextButton(
                onPressed: widget.blocked
                    ? null
                    : () => widget.onAction(r.input),
                child: const Text('起草这个行动'),
              ),
          ],
          if (r.columns.isNotEmpty) _table(r),
          for (final field in r.fields) _field(r, field),
          if (errors[r.factId] != null)
            Text(
              errors[r.factId]!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          if (r.kind == 'artifact')
            Wrap(
              spacing: 8,
              children: [
                if (!widget.readonly && r.fields.isNotEmpty)
                  TextButton(
                    onPressed: widget.blocked ? null : () => _artifactAction(r),
                    child: const Text('将参数用于行动草稿'),
                  ),
                TextButton(
                  onPressed: () => widget.onExport(r),
                  child: const Text('导出这份作品记录'),
                ),
                if (!widget.readonly && r.fields.isNotEmpty)
                  TextButton(
                    onPressed: () {
                      setState(() => params.remove(r.factId));
                      widget.onValues(Map.of(params));
                    },
                    child: const Text('恢复记录中的参数'),
                  ),
              ],
            ),
          source(r),
        ],
      ),
    ),
  );
  Widget _field(ReaderEvidence record, ReaderField field) {
    final value =
        '${(params[record.factId] as Map?)?[field.id] ?? field.value}';
    if (widget.readonly)
      return ListTile(
        title: Text(field.label),
        subtitle: Text(value.isEmpty ? '当时未填写' : value),
      );
    if (field.kind == 'checkbox')
      return CheckboxListTile(
        title: Text(field.label),
        value: value == 'true',
        onChanged: (v) => save(record, field.id, '$v'),
      );
    if (field.kind == 'select')
      return DropdownButtonFormField<String>(
        key: ValueKey('${record.factId}:${field.id}:$value'),
        initialValue: field.options.contains(value) ? value : null,
        decoration: InputDecoration(labelText: field.label),
        items: [
          for (final option in field.options)
            DropdownMenuItem(value: option, child: Text(option)),
        ],
        onChanged: (v) {
          if (v != null) save(record, field.id, v);
        },
      );
    return TextFormField(
      key: ValueKey('${record.factId}:${field.id}'),
      initialValue: value,
      decoration: InputDecoration(
        labelText: '${field.label}${field.required ? ' *' : ''}',
      ),
      keyboardType: field.kind == 'number'
          ? TextInputType.number
          : TextInputType.text,
      onChanged: (v) => save(record, field.id, v),
    );
  }

  void _artifactAction(ReaderEvidence r) {
    final values = <String, String>{
      for (final f in r.fields)
        f.id: '${(params[r.factId] as Map?)?[f.id] ?? f.value}',
    };
    for (final f in r.fields) {
      final value = values[f.id]!.trim();
      if (f.required && value.isEmpty ||
          f.kind == 'number' &&
              value.isNotEmpty &&
              num.tryParse(value) == null) {
        setState(() => errors[r.factId] = '请检查${f.label}。');
        return;
      }
    }
    setState(() => errors.remove(r.factId));
    widget.onAction(
      '${r.input.isEmpty ? '关于${r.label}，我选择以下参数，请按已知规则尝试。' : r.input}\n${r.fields.map((f) => '${f.label}：${values[f.id]}').join('\n')}',
    );
  }

  Widget _table(ReaderEvidence r) {
    final rows = r.rows
        .where(
          (row) =>
              row.length == r.columns.length &&
              row.join(' ').toLowerCase().contains(filter.toLowerCase()),
        )
        .toList();
    final col = sortColumns[r.factId];
    if (col != null)
      rows.sort((a, b) {
        final x = num.tryParse(a[col]), y = num.tryParse(b[col]);
        return ((ascending[r.factId] ?? true) ? 1 : -1) *
            (x != null && y != null
                ? x.compareTo(y)
                : a[col].compareTo(b[col]));
      });
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        sortColumnIndex: col,
        sortAscending: ascending[r.factId] ?? true,
        columns: [
          for (var i = 0; i < r.columns.length; i++)
            DataColumn(
              label: Text(r.columns[i]),
              onSort: (column, up) => setState(() {
                sortColumns[r.factId] = column;
                ascending[r.factId] = up;
              }),
            ),
        ],
        rows: [
          for (final row in rows)
            DataRow(cells: [for (final cell in row) DataCell(Text(cell))]),
        ],
      ),
    );
  }

  Widget _map(List<ReaderEvidence> records) {
    final routes = records
        .where((r) => r.kind == 'route' && r.bearing.isNotEmpty)
        .toList();
    if (routes.isEmpty)
      return const Padding(
        padding: EdgeInsets.all(16),
        child: Text('已知地点 · 尚无可绘制的方位依据。查看地点记录不会移动角色。'),
      );
    final positions = <String, Offset>{
      routes.first.entityId: const Offset(320, 240),
    };
    // Only explicit compass bearings create geometry. No relation-based guessed coordinates.
    final scale = routes
        .map((r) => r.distanceMeters ?? 100)
        .fold<int>(1, math.max);
    for (var pass = 0; pass < routes.length; pass++) {
      for (final r in routes) {
        final delta =
            _directions[r.bearing]! *
            (r.distanceMeters == null
                ? 110.0
                : r.distanceMeters! / scale * 180);
        if (positions.containsKey(r.entityId) &&
            !positions.containsKey(r.targetId))
          positions[r.targetId] = positions[r.entityId]! + delta;
        if (positions.containsKey(r.targetId) &&
            !positions.containsKey(r.entityId))
          positions[r.entityId] = positions[r.targetId]! - delta;
      }
    }
    final minX = positions.values.map((p) => p.dx).reduce(math.min),
        minY = positions.values.map((p) => p.dy).reduce(math.min);
    final shifted = {
      for (final e in positions.entries)
        e.key: e.value - Offset(minX - 90, minY - 60),
    };
    final width = math.max(
          640.0,
          shifted.values.map((p) => p.dx).reduce(math.max) + 90,
        ),
        height = math.max(
          420.0,
          shifted.values.map((p) => p.dy).reduce(math.max) + 60,
        );
    return Column(
      children: [
        Text(
          routes.every((r) => r.distanceMeters != null)
              ? '按记录距离与方位示意'
              : '方位示意 · 未知距离不按比例',
        ),
        SizedBox(
          height: 340,
          child: ClipRect(
            child: InteractiveViewer(
              transformationController: transform,
              minScale: .3,
              maxScale: 3,
              constrained: false,
              child: SizedBox(
                width: width,
                height: height,
                child: Stack(
                  children: [
                    CustomPaint(
                      size: Size(width, height),
                      painter: _ReaderMapPainter(
                        shifted,
                        routes,
                        Theme.of(context).colorScheme.primary,
                      ),
                    ),
                    for (final e in shifted.entries)
                      Positioned(
                        left: e.value.dx - 70,
                        top: e.value.dy - 24,
                        width: 140,
                        child: FilledButton.tonal(
                          onPressed: () =>
                              setState(() => selectedPlace = e.key),
                          child: Text(name(e.key), textAlign: TextAlign.center),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
        Wrap(
          spacing: 8,
          children: [
            IconButton(
              tooltip: '缩小地图',
              onPressed: () =>
                  transform.value = transform.value.clone()
                    ..scaleByDouble(.8, .8, 1, 1),
              icon: const Icon(Icons.remove),
            ),
            TextButton(
              onPressed: () => transform.value = Matrix4.identity(),
              child: const Text('适应地图'),
            ),
            IconButton(
              tooltip: '放大地图',
              onPressed: () =>
                  transform.value = transform.value.clone()
                    ..scaleByDouble(1.25, 1.25, 1, 1),
              icon: const PortalIcon('plus'),
            ),
          ],
        ),
        if (selectedPlace.isNotEmpty)
          Row(
            children: [
              Expanded(child: Text('已选：${name(selectedPlace)}')),
              TextButton(
                onPressed: () => setState(() => selectedPlace = ''),
                child: const Text('取消选中'),
              ),
            ],
          ),
        const Text('地理依据来自正式事实；图中不会补画未记录的道路。'),
      ],
    );
  }

  Widget _artifactWorkbench(ReaderEvidence? record) {
    final revisions =
        widget.projection.records
            .where(
              (r) =>
                  record != null &&
                  r.kind == record.kind &&
                  r.entityId == record.entityId &&
                  r.targetId == record.targetId &&
                  r.label == record.label,
            )
            .toList()
          ..sort((a, b) => a.sourceRevision.compareTo(b.sourceRevision));
    return ReaderArtifactSurface(
      key: ValueKey(record?.factId ?? 'empty-artifact'),
      data: {
        'records': [if (record != null) record.toJson()],
        'revisions': revisions.map((r) => r.toJson()).toList(),
        'params': params,
        'readonly': widget.readonly,
        'busy': widget.blocked,
        'dark': Theme.of(context).brightness == Brightness.dark,
        'reduced': MediaQuery.disableAnimationsOf(context),
        'canRestore': widget.onRestore != null,
        'canCancel': widget.onCancel != null,
      },
      onMessage: (kind, value) => _artifactMessage(kind, value, record),
      fallback: record == null ? const SizedBox.shrink() : recordView(record),
    );
  }

  void _artifactMessage(String kind, dynamic value, ReaderEvidence? record) {
    if (kind == 'source' &&
        value is int &&
        value >= 0 &&
        value <= widget.projection.revision) {
      widget.onSource(value);
      return;
    }
    if (kind == 'export') {
      if (record != null) widget.onExport(record);
      return;
    }
    if (kind == 'restore' &&
        value is String &&
        !widget.readonly &&
        !widget.blocked) {
      final r = widget.projection.records
          .where((r) => r.factId == value)
          .firstOrNull;
      if (r != null) widget.onRestore?.call(r.sourceRevision);
      return;
    }
    if (kind == 'cancel') {
      widget.onCancel?.call();
      return;
    }
    if (widget.readonly || widget.blocked) return;
    if (kind == 'draft' &&
        value is String &&
        value.trim().isNotEmpty &&
        value.length <= 20000)
      widget.onAction(value);
    if (kind == 'params' && value is Map) {
      final next = Map<String, dynamic>.of(params);
      for (final r in widget.projection.currentRecords) {
        final incoming = value[r.factId];
        if (incoming is! Map) continue;
        next[r.factId] = {
          for (final f in r.fields)
            if (incoming[f.id] is String &&
                (incoming[f.id] as String).length <= 1000)
              f.id: incoming[f.id],
        };
      }
      // Do not rebuild the platform view while a user is typing.
      params = next;
      widget.onValues(Map.of(params));
    }
    if (kind == 'import' && value is Map) _importPreview(value);
  }

  Future<void> _importPreview(dynamic value) async {
    final text = const JsonEncoder.withIndent('  ').convert(value);
    if (text.length > 1100000) return;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('导入的作品参考'),
        content: SizedBox(
          width: 640,
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('这份内容只保存在本机，不会覆盖故事、恢复历史或执行文件中的代码。'),
                const SizedBox(height: 16),
                SelectableText(text),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('关闭'),
          ),
          if (!widget.readonly)
            FilledButton(
              onPressed: () {
                setState(() => params['_import'] = value);
                widget.onValues(Map.of(params));
                Navigator.pop(dialogContext);
              },
              child: const Text('保存在本机'),
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final kind = widget.kind;
    final kinds = switch (kind) {
      'map' => {'location', 'route'},
      'inventory' => {'item'},
      'status' => {'metric'},
      'time' => {'schedule'},
      'artifact' => {'artifact', 'action'},
      _ => <String>{},
    };
    final all = widget.projection.currentRecords
        .where((r) => kinds.isEmpty || kinds.contains(r.kind))
        .toList();
    final records = all
        .where(
          (r) =>
              (selectedPlace.isEmpty ||
                  r.entityId == selectedPlace ||
                  r.targetId == selectedPlace) &&
              (r.columns.isNotEmpty ||
                  '${r.label} ${r.quote} ${r.value}'.toLowerCase().contains(
                    filter.toLowerCase(),
                  )),
        )
        .toList();
    return ReaderPanel(
      title:
          const {
            'map': '地图与路线',
            'inventory': '身上与物品',
            'status': '状态与规则',
            'time': '时间与日程',
            'artifact': '交互作品',
          }[kind] ??
          '当时的已知情况',
      children: [
        Text(
          '第 ${widget.projection.revision} 页 · ${widget.projection.storyTime}${widget.readonly ? ' · 历史快照，只读' : ''}',
        ),
        const Text('查看、筛选和填写参数都不会推进故事。'),
        if (widget.projection.gameplay != null && kind != 'artifact')
          ReaderArtifactSurface(
            data: {
              'surface': 'gameplay',
              'kind': kind == 'time'
                  ? 'timeline'
                  : kind == 'snapshot'
                  ? 'all'
                  : kind,
              'readonly': true,
              'scope': {'baseVersion': widget.projection.revision},
              'state': widget.projection.gameplay!.sourceState(
                widget.projection.revision,
                widget.projection.storyTime,
              ),
              'dark': Theme.of(context).brightness == Brightness.dark,
            },
            onMessage: (kind, value) {
              if (kind == 'gameplay-history') widget.onHistory?.call();
              if (kind == 'source') widget.onSource(widget.projection.revision);
              if (kind == 'context-close') Navigator.pop(context);
            },
            fallback: const Text('原版玩法资料视图可在网页版查看。'),
          ),
        TextField(
          decoration: const InputDecoration(
            labelText: '查找记录或表格内容',
            prefixIcon: PortalIcon('search'),
          ),
          onChanged: (v) => setState(() => filter = v),
        ),
        if (kind == 'map' && widget.projection.gameplay?.game == null)
          _map(all),
        if (records.isEmpty && widget.projection.gameplay == null)
          const Text('尚无相应的已知结构化记录；没有记录，不代表不存在。'),
        if (kind == 'artifact') ...[
          if (records.isEmpty) _artifactWorkbench(null),
          for (final record in records) _artifactWorkbench(record),
        ] else
          for (final r in records) recordView(r),
        if (kind == 'artifact' && params['_import'] != null)
          TextButton(
            onPressed: () => _importPreview(params['_import']),
            child: const Text('查看本机导入参考'),
          ),
        if (kind != 'artifact') ...[
          Text(kind == 'map' ? '全部已知地点' : '其他已知记录'),
          for (final i in widget.projection.information.where(
            (i) => kind == 'map'
                ? i.kind == 'location'
                : kind == 'inventory'
                ? i.kind == 'item'
                : kind == 'status'
                ? const {'fact', 'rule', 'status'}.contains(i.kind)
                : kind == 'time'
                ? const {'event', 'agreement', 'schedule'}.contains(i.kind)
                : true,
          ))
            ListTile(
              title: Text(i.name),
              subtitle: Text(i.text),
              onTap: () => widget.onObject(i),
            ),
        ],
      ],
    );
  }
}

const _bearings = {
  'N': '北',
  'NE': '东北',
  'E': '东',
  'SE': '东南',
  'S': '南',
  'SW': '西南',
  'W': '西',
  'NW': '西北',
};
const _directions = {
  'N': Offset(0, -1),
  'NE': Offset(.7071, -.7071),
  'E': Offset(1, 0),
  'SE': Offset(.7071, .7071),
  'S': Offset(0, 1),
  'SW': Offset(-.7071, .7071),
  'W': Offset(-1, 0),
  'NW': Offset(-.7071, -.7071),
};

class _ReaderMapPainter extends CustomPainter {
  _ReaderMapPainter(this.positions, this.routes, this.color);
  final Map<String, Offset> positions;
  final List<ReaderEvidence> routes;
  final Color color;
  @override
  void paint(Canvas canvas, Size size) {
    for (final r in routes) {
      final a = positions[r.entityId], b = positions[r.targetId];
      if (a == null || b == null) continue;
      canvas.drawLine(
        a,
        b,
        Paint()
          ..color = r.passage == 'blocked'
              ? Colors.red.shade400
              : color.withValues(alpha: .5)
          ..strokeWidth = 2,
      );
    }
  }

  @override
  bool shouldRepaint(_ReaderMapPainter oldDelegate) =>
      oldDelegate.positions != positions ||
      oldDelegate.routes != routes ||
      oldDelegate.color != color;
}
