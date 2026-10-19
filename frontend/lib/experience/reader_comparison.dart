part of 'experience_screen.dart';

extension _ReaderComparison on _ExperienceScreenState {
  Future<void> _compareSnapshots() async {
    final current = c.current;
    if (current == null) return;
    final owner = c.owner;
    var leftId = current.branchId, rightId = current.branchId;
    ExperienceView? left = current, right = current;
    var leftRevision = current.pages.length > 1
        ? current.pages[current.pages.length - 2].revision
        : current.revision;
    var rightRevision = current.revision;
    var busy = false;
    String? error;
    List<KnownInformation>? information(ExperienceView? view, int revision) {
      if (view == null) return null;
      final page = view.pages.where((p) => p.revision == revision).firstOrNull;
      return page?.reader?.information ??
          (view.revision == revision ? view.information : null);
    }

    await _sheet(
      StatefulBuilder(
        builder: (context, refresh) {
          final before = information(left, leftRevision),
              after = information(right, rightRevision);
          final ids = <String>{
            ...?before?.map((i) => i.id),
            ...?after?.map((i) => i.id),
          };
          final changes = <Widget>[];
          if (before != null && after != null) {
            for (final id in ids) {
              final a = before.where((i) => i.id == id).firstOrNull,
                  b = after.where((i) => i.id == id).firstOrNull;
              if (a?.name == b?.name &&
                  a?.text == b?.text &&
                  a?.kind == b?.kind &&
                  jsonEncode(a?.relatedIds) == jsonEncode(b?.relatedIds))
                continue;
              changes.add(
                ListTile(
                  title: Text(
                    '${a == null
                        ? '新见到'
                        : b == null
                        ? '此刻未见'
                        : '记录变化'} · ${b?.name ?? a!.name}',
                  ),
                  subtitle: SelectableText(
                    '左侧：${a?.text ?? '当时未记录'}\n右侧：${b?.text ?? '当时未记录'}',
                  ),
                ),
              );
            }
          }
          return ReaderPanel(
            title: '对照已记录的变化',
            children: [
              const Text('选择分支与确切页码，对照当时的正文和公开记录。查看不会合并事实或推进故事。'),
              for (final isLeft in [true, false]) ...[
                DropdownButtonFormField<String>(
                  key: ValueKey(
                    isLeft ? 'compare-left-branch' : 'compare-right-branch',
                  ),
                  initialValue: isLeft ? leftId : rightId,
                  decoration: InputDecoration(
                    labelText: isLeft ? '左侧分支' : '右侧分支',
                  ),
                  items: [
                    for (final b in current.branches)
                      DropdownMenuItem(value: b.id, child: Text(b.name)),
                  ],
                  onChanged: busy
                      ? null
                      : (id) => refresh(() {
                          if (id == null) return;
                          if (isLeft) {
                            leftId = id;
                            left = null;
                          } else {
                            rightId = id;
                            right = null;
                          }
                        }),
                ),
                if ((isLeft ? left : right) != null &&
                    (isLeft ? left! : right!).pages.isNotEmpty)
                  DropdownButtonFormField<int>(
                    key: ValueKey(
                      '${isLeft ? 'left' : 'right'}-${isLeft ? leftId : rightId}-page-${isLeft ? leftRevision : rightRevision}',
                    ),
                    initialValue: isLeft ? leftRevision : rightRevision,
                    decoration: InputDecoration(
                      labelText: isLeft ? '左侧片刻' : '右侧片刻',
                    ),
                    items: [
                      for (final p in (isLeft ? left! : right!).pages)
                        DropdownMenuItem(
                          value: p.revision,
                          child: Text('第 ${p.revision} 页 · ${p.storyTime}'),
                        ),
                    ],
                    onChanged: busy
                        ? null
                        : (revision) => refresh(() {
                            if (revision == null) return;
                            if (isLeft) {
                              leftRevision = revision;
                            } else {
                              rightRevision = revision;
                            }
                          }),
                  ),
              ],
              FilledButton(
                onPressed: busy
                    ? null
                    : () async {
                        refresh(() {
                          busy = true;
                          error = null;
                        });
                        try {
                          final results = await Future.wait([
                            c.api.view(current.id, branch: leftId),
                            c.api.view(current.id, branch: rightId),
                          ]);
                          if (!context.mounted || c.owner != owner) return;
                          refresh(() {
                            left = results[0];
                            right = results[1];
                            leftRevision = left!.revision;
                            rightRevision = right!.revision;
                            busy = false;
                          });
                        } catch (_) {
                          if (context.mounted)
                            refresh(() {
                              busy = false;
                              error = '无法读取分支，请重试。';
                            });
                        }
                      },
                child: Text(busy ? '正在读取…' : '读取分支'),
              ),
              if (error != null) Text(error!),
              for (final isLeft in [true, false])
                if ((isLeft ? left : right) != null)
                  for (final p in (isLeft ? left! : right!).pages.where(
                    (p) =>
                        p.revision == (isLeft ? leftRevision : rightRevision),
                  ))
                    ExpansionTile(
                      key: ValueKey('compare-prose-$isLeft-${p.revision}'),
                      title: Text(
                        '${isLeft ? '左侧' : '右侧'} · 第 ${p.revision} 页 · ${p.storyTime}',
                      ),
                      children: [SelectableText(p.text)],
                    ),
              if (before == null || after == null)
                const Text('所选片刻尚无可用的公开状态快照；保留当时正文，不用现在的记录代填。')
              else if (changes.isEmpty)
                const Text('这两个片刻没有已记录的公开资料变化。')
              else
                ...changes,
            ],
          );
        },
      ),
    );
  }
}
