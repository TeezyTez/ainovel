part of 'experience_screen.dart';

extension _ReaderContext on _ExperienceScreenState {
  Json _contextScope(ExperienceView view) => {
    'worldKey': view.id,
    'branchId': view.branchId,
    'baseVersion': view.revision,
  };

  Future<void> _selectContext(ExperienceView view, List<String> ids) async {
    final selection = {..._contextScope(view), 'objectIds': ids};
    try {
      readerSelectedObjects(selection, c.current!);
      await _personal.update({
        'object_selection': ids.isEmpty ? null : selection,
      });
    } on FormatException catch (error) {
      _toast(error.message);
    }
  }

  Widget _contextChips() {
    final selection = _personal.values['object_selection'];
    if (selection is! Map || c.current == null) return const SizedBox.shrink();
    final objects = readerContextObjects(c.current!);
    final stale = selection['baseVersion'] != c.current!.revision;
    return Wrap(
      spacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Text(stale ? '选择已过期，请重新选择' : '只对下一次输入有效'),
        for (final id in selection['objectIds'] as List? ?? [])
          Chip(
            label: Text(
              objects.where((o) => o['id'] == id).firstOrNull?['name']
                      as String? ??
                  '已失效资料',
            ),
          ),
        TextButton(
          onPressed: stale ? null : () => _contextPanel({'kind': 'compare'}),
          child: const Text('比较已选'),
        ),
        TextButton(
          onPressed: () => _personal.update({'object_selection': null}),
          child: const Text('清除选择'),
        ),
      ],
    );
  }

  Future<void> _contextPanel(Json query) async {
    final view = c.current;
    if (view == null) return;
    final scope = c.scope, objects = readerContextObjects(view);
    await _sheet(
      StatefulBuilder(
        builder: (context, refresh) {
          void message(String kind, dynamic value) async {
            if (!mounted ||
                scope != c.scope ||
                c.current?.revision != view.revision)
              return;
            switch (kind) {
              case 'context-selection':
                try {
                  readerSelectedObjects(value, view);
                  await _personal.update({'object_selection': value});
                } on FormatException catch (error) {
                  _toast(error.message);
                }
              case 'context-presentation':
                if (value is Map &&
                    const ['auto', 'text', 'table'].contains(value['view']) &&
                    const ['name', 'updated'].contains(value['sort'])) {
                  await _personal.update({
                    'context_presentation': Map<String, dynamic>.from(value),
                  });
                }
              case 'context-pin':
                if (value == null ||
                    value is Map &&
                        const [
                          'overview',
                          'relationships',
                          'timeline',
                          'compare',
                          'list',
                        ].contains(value['kind'])) {
                  await _personal.update({'pinned_context': value});
                }
              case 'context-source':
                final object = objects
                    .where((o) => o['id'] == value)
                    .firstOrNull;
                if (object != null) {
                  Navigator.pop(context);
                  _jump(object['sourceVersion'] as int);
                }
              case 'context-close':
                Navigator.pop(context);
              case 'draft':
                if (value is String && value.length <= 1000) {
                  Navigator.pop(context);
                  await _draftText(value);
                }
            }
          }

          return ReaderPanel(
            title: '已知资料视图',
            children: [
              Wrap(
                spacing: 8,
                children: [
                  for (final entry in const {
                    'overview': '此刻情况',
                    'relationships': '人物关系',
                    'timeline': '时间与约定',
                    'compare': '对照已选',
                  }.entries)
                    TextButton(
                      onPressed: () => refresh(
                        () => query = {
                          'kind': entry.key,
                          if (entry.key == 'relationships') 'filter': 'person',
                        },
                      ),
                      child: Text(entry.value),
                    ),
                ],
              ),
              ReaderArtifactSurface(
                data: {
                  'surface': 'context',
                  'scope': _contextScope(view),
                  'query': query,
                  'selection': _personal.values['object_selection'],
                  'presentation': _personal.values['context_presentation'],
                  'pinned':
                      jsonEncode(_personal.values['pinned_context']) ==
                      jsonEncode(query),
                  'dark': Theme.of(context).brightness == Brightness.dark,
                  'situation': {
                    'objects': objects,
                    'clock':
                        view.publicGameplay?.clock(
                          view.revision,
                          view.reader?.storyTime ??
                              view.pages.lastOrNull?.storyTime ??
                              '故事时间尚未明确',
                        ) ??
                        {
                          'label':
                              view.reader?.storyTime ??
                              view.pages.lastOrNull?.storyTime ??
                              '故事时间尚未明确',
                        },
                    'summary': view.title,
                  },
                },
                onMessage: message,
                fallback: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('资料均来自当前分支已保存的公开记录。'),
                    for (final object
                        in objects
                            .where(
                              (o) =>
                                  query['kind'] != 'relationships' ||
                                  o['kind'] == 'person',
                            )
                            .where(
                              (o) =>
                                  query['kind'] != 'timeline' ||
                                  o['kind'] == 'event',
                            ))
                      ListTile(
                        title: Text(object['name'] as String),
                        subtitle: Text(object['summary'] as String),
                        onTap: () {
                          Navigator.pop(context);
                          _jump(object['sourceVersion'] as int);
                        },
                      ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
