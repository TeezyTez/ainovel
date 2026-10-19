part of 'experience_screen.dart';

extension _ReaderBranches on _ExperienceScreenState {
  Future<bool> _confirmReader(
    String title,
    String message,
    String action,
  ) async =>
      await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: Text(title),
          content: Text(message),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: Text(action),
            ),
          ],
        ),
      ) ??
      false;

  Future<void> _branches() async {
    final view = c.current;
    if (view == null) return;
    await _sheet(
      AnimatedBuilder(
        animation: Listenable.merge([c, _checkpoints]),
        builder: (context, _) {
          final archived =
              (_checkpoints.values['archived_branches'] as List? ?? [])
                  .cast<String>();
          return ReaderPanel(
            title: '分支与存档',
            children: [
              const Text('切换分支，继续不同的经历。命名片刻保存在此设备；恢复会建立新分支。'),
              TextButton(
                onPressed: _checkpoints.loaded && !c.blocked
                    ? () => _saveMoment()
                    : null,
                child: const Text('保存此刻'),
              ),
              if (_checkpoints.error != null)
                Row(
                  children: [
                    Expanded(child: Text(_checkpoints.error!)),
                    TextButton(
                      onPressed: _checkpoints.retry,
                      child: const Text('重试保存或读取'),
                    ),
                  ],
                ),
              for (final branch in view.branches)
                ListTile(
                  title: Text(
                    '${branch.name}${branch.id == view.branchId ? ' · 当前' : ''}${archived.contains(branch.id) ? ' · 已封存' : ''}',
                  ),
                  subtitle: Text(
                    '第 ${branch.revision} 页${branch.parentRevision == null ? '' : ' · 从第 ${branch.parentRevision} 页分出'}',
                  ),
                  trailing: Wrap(
                    children: [
                      if (branch.id != view.branchId)
                        TextButton(
                          onPressed: c.blocked
                              ? null
                              : () {
                                  Navigator.pop(context);
                                  c.open(view.id, branch: branch.id);
                                },
                          child: const Text('切换'),
                        ),
                      TextButton(
                        onPressed: () => _checkpoints.update({
                          'archived_branches': archived.contains(branch.id)
                              ? archived.where((id) => id != branch.id).toList()
                              : [...archived, branch.id],
                        }),
                        child: Text(
                          archived.contains(branch.id) ? '恢复分支' : '封存分支',
                        ),
                      ),
                    ],
                  ),
                ),
              const Divider(),
              const Text('命名存档'),
              if (_checkpoints.entries.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 16),
                  child: Text('还没有保存的节点。'),
                ),
              for (final moment in _checkpoints.entries.where(
                (e) => e['kind'] == 'checkpoint',
              ))
                ListTile(
                  title: Text('${moment['text']}'),
                  subtitle: Text(
                    '第 ${moment['revision']} 页 · ${moment['created_at']}\n恢复时新建分支，保留当前进度',
                  ),
                  trailing: TextButton(
                    onPressed: c.blocked
                        ? null
                        : () async {
                            Navigator.pop(context);
                            await _restoreMoment(moment);
                          },
                    child: const Text('从此刻继续'),
                  ),
                ),
              TextButton(
                onPressed: () {
                  Navigator.pop(context);
                  _readerHistory();
                },
                child: const Text('搜索与回顾原文'),
              ),
            ],
          );
        },
      ),
    );
  }

  Future<void> _saveMoment() async {
    final view = c.current, scope = _checkpoints.scope;
    if (view == null || c.blocked || !_checkpoints.loaded) return;
    final name = await showDialog<Map<String, String>>(
      context: context,
      builder: (_) => ExperienceEditDialog(
        title: '给这个片刻一个名字',
        description: '只为当前分支第 ${view.revision} 页保存一个本机名字，不改变故事。',
        firstLabel: '片刻名称',
        first: view.pages.lastOrNull?.storyTime ?? '当前片刻',
        confirmLabel: '保存此刻',
      ),
    );
    if (name == null ||
        !mounted ||
        _checkpoints.scope != scope ||
        c.current?.branchId != view.branchId ||
        c.current?.revision != view.revision)
      return;
    final text = name['first']!.trim();
    if (text.isEmpty) {
      _toast('请给这个片刻一个名字。');
      return;
    }
    await _checkpoints.annotate(
      'checkpoint',
      view.revision,
      '',
      text: text,
      objectId: view.branchId,
    );
    if (_checkpoints.error == null) _toast('这个片刻已保存在此设备。');
  }

  Future<void> _restoreMoment(Json moment) async {
    final view = c.current, owner = c.owner;
    if (view == null || c.blocked) return;
    if (!await _confirmReader(
      '从命名存档继续',
      '将从“${moment['text']}”保存的节点建立新分支；此节点以后的事实不会带入，当前进度保留。',
      '恢复并继续',
    ))
      return;
    if (!mounted || c.owner != owner || c.current?.id != view.id || c.blocked)
      return;
    final source = moment['object_id'] as String,
        revision = moment['revision'] as int;
    if (c.current?.branchId != source) await c.open(view.id, branch: source);
    if (!mounted ||
        c.owner != owner ||
        c.current?.id != view.id ||
        c.current?.branchId != source ||
        c.blocked)
      return;
    if (revision != 0 && !c.current!.pages.any((p) => p.revision == revision)) {
      _toast('这条分支没有找到保存的页码，未建立分支。');
      return;
    }
    await c.fork(revision, '${moment['text']} · 继续');
  }

  Future<void> _regenerate() async {
    if (widget.localReadOnly) return;
    final view = c.current, owner = c.owner, scope = c.scope;
    final last = view?.pages.lastOrNull;
    if (view == null || last == null || last.mode == 'begin') {
      _toast('开场之后还没有可重新生成的回应。');
      return;
    }
    if (c.blocked) return;
    if (!await _confirmReader(
      '重新生成最后一个回应',
      '将从上个回应之前建立分支，并重发当时的${last.mode == 'read' ? '继续阅读请求' : '表达'}。旧结果与后果保留在旧分支。',
      '建立分支并重生成',
    ))
      return;
    if (!mounted ||
        c.owner != owner ||
        c.scope != scope ||
        c.current?.revision != view.revision ||
        c.blocked)
      return;
    final mode = last.mode;
    if (!const {'act', 'read', 'ask'}.contains(mode)) {
      _toast('这段内容没有可重发的原始请求。');
      return;
    }
    await c.fork(last.revision - 1, '替代回应 ${view.branches.length + 1}');
    // A timeout/unknown receipt must never trigger a second action on the old branch.
    if (!mounted ||
        c.owner != owner ||
        c.current?.id != view.id ||
        c.current?.branchId == view.branchId ||
        c.current?.revision != last.revision - 1 ||
        c.blocked ||
        c.storageError != null)
      return;
    final destination = c.scope;
    await c.saveDraft(last.input, selectedMode: mode == 'read' ? 'act' : mode);
    if (!mounted ||
        c.owner != owner ||
        c.scope != destination ||
        c.blocked ||
        c.storageError != null)
      return;
    await c.send(explicitMode: mode);
  }

  Future<void> _assistance(String kind) async {
    if (widget.localReadOnly) return;
    final view = c.current, owner = c.owner, scope = c.scope;
    final last = view?.pages.lastOrNull;
    if (view == null || last == null || last.mode == 'begin') {
      _toast('还没有可调整的回应。');
      return;
    }
    if (c.blocked) return;
    if (widget.onAssist == null) {
      _toast('当前连接未提供检查与改写服务，请检查连接。');
      return;
    }
    bool current() =>
        mounted &&
        c.owner == owner &&
        c.scope == scope &&
        c.current?.revision == view.revision &&
        !c.blocked;
    final requests = Map<String, dynamic>.from(
      _personal.values['assistance_requests'] as Map? ?? {},
    );
    await _sheet(
      ReaderAssistancePanel(
        kind: kind,
        branchId: view.branchId,
        revision: view.revision,
        original: last.text,
        initialRequest: '${requests[kind] ?? ''}',
        isCurrent: current,
        onRequest: (body) => widget.onAssist!(view.id, body),
        onCancel: () => widget.onCancelAssist?.call(),
        onDraft: (text) {
          if (c.scope == scope) {
            requests[kind] = text;
            _personal.update({'assistance_requests': Map.of(requests)});
          }
        },
        onApply: (result) async {
          if (!current() ||
              result['kind'] != kind ||
              result['branch_id'] != view.branchId ||
              result['base_revision'] != view.revision)
            throw StateError('故事已经改变，请重新生成。');
          final change = kind == 'polish'
              ? <String, dynamic>{
                  'polish': {'text': result['text']},
                }
              : <String, dynamic>{
                  'repair': {'candidate': result['proposal']},
                };
          await c.forkChange(
            view.revision,
            kind == 'polish' ? '换种写法' : '修复回应',
            change,
          );
          if (!mounted ||
              c.owner != owner ||
              c.current?.id != view.id ||
              c.current?.branchId == view.branchId ||
              c.blocked ||
              c.storageError != null)
            throw StateError(c.error ?? c.storageError ?? '新分支尚未确认，请先查询原请求。');
          if (kind == 'polish') {
            final origins = Map<String, dynamic>.from(
              _checkpoints.values['polish_origins'] as Map? ?? {},
            );
            origins[c.current!.branchId] = {
              'branch_id': view.branchId,
              'revision': view.revision,
            };
            await _checkpoints.update({'polish_origins': origins});
          }
        },
      ),
    );
  }

  Future<void> _undoPolish() async {
    final view = c.current, owner = c.owner;
    if (view == null || c.blocked) return;
    final origins = _checkpoints.values['polish_origins'] as Map?;
    final origin = origins?[view.branchId];
    if (origin is! Map || origin['branch_id'] is! String) {
      _toast('当前分支没有可返回的本机润色记录。');
      return;
    }
    if (!await _confirmReader(
      '撤销最近一次润色',
      '将回到润色前的原分支。当前表达分支和它之后的新进度仍保留，可在分支与存档中再次打开。',
      '返回润色前分支',
    ))
      return;
    if (!mounted ||
        c.owner != owner ||
        c.current?.id != view.id ||
        c.current?.branchId != view.branchId ||
        c.blocked)
      return;
    await c.open(view.id, branch: origin['branch_id'] as String);
  }

  Future<void> _authorView() async {
    final world = widget.authorWorld;
    if (world == null) {
      _toast('这段经历没有已确认关联的作者版本。');
      return;
    }
    final owner = c.owner, experience = c.current?.id;
    if (!await _confirmReader(
      '进入作者视图',
      '以下资料可能揭示幕后秘密。普通人物面板不会显示这些内容。',
      '我知道，查看幕后',
    ))
      return;
    if (!mounted || c.owner != owner || c.current?.id != experience) return;
    final characters = objects(world['characters'] ?? []);
    await _sheet(
      ReaderPanel(
        title: '作者视图 · 幕后资料',
        children: [
          if (world['title'] is String) Text('${world['title']}'),
          if (world['version'] != null) Text('世界 V${world['version']}'),
          if (characters.isEmpty) const Text('没有幕后人物资料。'),
          for (final character in characters)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${character['name'] ?? '未命名人物'}',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  for (final field in const {
                    'goal': '目标',
                    'history': '经历',
                    'secret': '秘密',
                  }.entries)
                    SelectableText(
                      '${field.value}：${'${character[field.key] ?? ''}'.trim().isEmpty ? '未设定' : character[field.key]}',
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
