/// Local world writing studio. Saved versions stay on this device; the formal
/// experience currently accepts a public seed, not standalone world versions.
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../experience/experience_journal.dart';
import 'portal_world_file_picker_stub.dart'
    if (dart.library.html) 'portal_world_file_picker_web.dart'
    as picker;
import 'portal_world_import_file.dart';
import 'portal_world_studio_data.dart';
import 'portal_icon.dart';
import 'portal_text_export_stub.dart'
    if (dart.library.html) 'portal_text_export_web.dart'
    as text_export;

export 'portal_world_studio_data.dart'
    show
        PortalWorldDraft,
        PortalWorldCharacterDraft,
        PortalWorldVersion,
        PortalWorldRepository,
        PortalWorldImport,
        parsePortalWorldImport,
        portalDraftFromPreset,
        portalCopyWorld;

class PortalWorldStudio extends StatefulWidget {
  const PortalWorldStudio({
    super.key,
    required this.backendUrl,
    required this.workspaceId,
    required this.onStart,
    this.onBack,
    this.journal,
    this.initialVersion,
    this.onSavedWorld,
    this.onGenerateDraft,
    this.onCancelGeneration,
    this.onStartWorld,
    this.narrativeDefaults = const {},
    this.modelAvailable = true,
  });

  final String backendUrl;
  final String workspaceId;
  final Future<void> Function(String publicSeed) onStart;
  final VoidCallback? onBack;
  final ExperienceJournal? journal;
  final PortalWorldVersion? initialVersion;
  final ValueChanged<PortalWorldVersion>? onSavedWorld;
  final Future<PortalWorldDraft> Function(String idea)? onGenerateDraft;
  final VoidCallback? onCancelGeneration;
  final Future<void> Function(String publicSeed, PortalWorldVersion version)?
  onStartWorld;
  final Map<String, dynamic> narrativeDefaults;
  final bool modelAvailable;

  @override
  State<PortalWorldStudio> createState() => _PortalWorldStudioState();
}

class _PortalWorldStudioState extends State<PortalWorldStudio> {
  bool get _dark => Theme.of(context).brightness == Brightness.dark;
  Color get _background => Theme.of(context).scaffoldBackgroundColor;
  Color get _paper => Theme.of(context).colorScheme.surface;
  Color get _wash => Theme.of(context).colorScheme.surfaceContainerHigh;
  Color get _ink => Theme.of(context).colorScheme.onSurface;
  Color get _muted => Theme.of(context).colorScheme.onSurfaceVariant;
  Color get _signal => Theme.of(context).colorScheme.primary;
  Color get _line => Theme.of(context).colorScheme.outlineVariant;

  late final PortalWorldRepository _repository;
  PortalWorldDraft _draft = PortalWorldDraft();
  List<PortalWorldVersion> _versions = [];
  final Map<String, TextEditingController> _fields = {};
  final Map<String, Map<String, TextEditingController>> _characters = {};
  Timer? _saveTimer;
  bool _loading = true;
  bool _saving = false;
  bool _starting = false;
  bool _generating = false;
  int _generationEpoch = 0;
  bool _detailsOpen = false;
  bool _charactersOpen = false;
  bool _narrativeOpen = false;
  String? _error;
  String _saveLabel = '草稿保存在此设备';

  PortalWorldDraft _freshDraft() {
    final defaults = widget.narrativeDefaults;
    String choice(String key, String fallback) =>
        defaults[key] is String && (defaults[key] as String).trim().isNotEmpty
        ? (defaults[key] as String).trim()
        : fallback;
    return PortalWorldDraft()
      ..perspective = choice('perspective', '第二人称')
      ..length = choice('length', '适中')
      ..style = choice('style', '细腻克制')
      ..pace = choice('pace', '从容');
  }

  @override
  void initState() {
    super.initState();
    _repository = PortalWorldRepository(
      journal: widget.journal ?? LocalExperienceJournal(),
      backendUrl: widget.backendUrl,
      workspaceId: widget.workspaceId,
    );
    _load();
  }

  Future<void> _load() async {
    try {
      final draft = await _repository.loadDraft();
      final versions = await _repository.loadVersions();
      if (!mounted) return;
      final selected = widget.initialVersion;
      _draft = selected == null
          ? draft ?? _freshDraft()
          : draft?.id == selected.draft.id
          ? draft!
          : selected.draft.snapshot();
      _versions = versions;
      _detailsOpen = _draft.title.isNotEmpty || _draft.opening.isNotEmpty;
      _charactersOpen = _draft.characters.isNotEmpty;
      _installControllers();
      setState(() => _loading = false);
    } catch (error) {
      if (!mounted) return;
      _installControllers();
      setState(() {
        _loading = false;
        _error = '本机创作草稿暂时无法读取：$error';
      });
    }
  }

  @override
  void didUpdateWidget(covariant PortalWorldStudio oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.initialVersion?.draft.id != widget.initialVersion?.draft.id ||
        oldWidget.initialVersion?.version != widget.initialVersion?.version ||
        oldWidget.backendUrl != widget.backendUrl ||
        oldWidget.workspaceId != widget.workspaceId) {
      _cancelGeneration(notify: false);
      _saveTimer?.cancel();
      _repository = PortalWorldRepository(
        journal: widget.journal ?? LocalExperienceJournal(),
        backendUrl: widget.backendUrl,
        workspaceId: widget.workspaceId,
      );
      _loading = true;
      _load();
    }
  }

  void _disposeControllers() {
    for (final controller in _fields.values) {
      controller.dispose();
    }
    for (final group in _characters.values) {
      for (final controller in group.values) {
        controller.dispose();
      }
    }
    _fields.clear();
    _characters.clear();
  }

  void _installControllers() {
    _disposeControllers();
    final values = <String, String>{
      'seed': _draft.seed,
      'title': _draft.title,
      'description': _draft.description,
      'era': _draft.era,
      'rules': _draft.rules.join('\n'),
      'identity': _draft.identity,
      'location': _draft.location,
      'goal': _draft.goal,
      'opening': _draft.opening,
      'style': _draft.style,
    };
    for (final entry in values.entries) {
      _fields[entry.key] = TextEditingController(text: entry.value);
    }
    for (final character in _draft.characters) {
      _characters[character.id] = {
        'name': TextEditingController(text: character.name),
        'role': TextEditingController(text: character.role),
        'public': TextEditingController(text: character.public),
        'goal': TextEditingController(text: character.goal),
        'history': TextEditingController(text: character.history),
        'secret': TextEditingController(text: character.secret),
      };
    }
  }

  void _collect() {
    String value(String key) => _fields[key]?.text ?? '';
    _draft
      ..seed = value('seed')
      ..title = value('title')
      ..description = value('description')
      ..era = value('era')
      ..rules = value('rules')
          .split('\n')
          .map((rule) => rule.trim())
          .where((rule) => rule.isNotEmpty)
          .toList()
      ..identity = value('identity')
      ..location = value('location')
      ..goal = value('goal')
      ..opening = value('opening')
      ..style = value('style');
    for (final character in _draft.characters) {
      final fields = _characters[character.id];
      if (fields == null) continue;
      String characterValue(String key) => fields[key]?.text ?? '';
      character
        ..name = characterValue('name')
        ..role = characterValue('role')
        ..public = characterValue('public')
        ..goal = characterValue('goal')
        ..history = characterValue('history')
        ..secret = characterValue('secret');
    }
  }

  void _scheduleSave() {
    _collect();
    _saveTimer?.cancel();
    if (mounted) setState(() => _saveLabel = '正在保存本机草稿…');
    _saveTimer = Timer(Duration(milliseconds: 450), () {
      unawaited(_saveDraft());
    });
  }

  Future<void> _saveDraft() async {
    _saveTimer?.cancel();
    _collect();
    try {
      await _repository.saveDraft(_draft);
      if (mounted) setState(() => _saveLabel = '草稿保存在此设备');
    } catch (error) {
      if (mounted) {
        setState(() {
          _saveLabel = '草稿保存失败';
          _error = '本机草稿保存失败：$error';
        });
      }
    }
  }

  @override
  void dispose() {
    if (_generating) widget.onCancelGeneration?.call();
    _generationEpoch++;
    _saveTimer?.cancel();
    _disposeControllers();
    super.dispose();
  }

  void _addCharacter() {
    _collect();
    if (_draft.characters.length >= 30) {
      _showMessage('人物最多 30 位。');
      return;
    }
    setState(() {
      _draft.characters.add(PortalWorldCharacterDraft());
      _installControllers();
      _charactersOpen = true;
    });
    _scheduleSave();
  }

  void _removeCharacter(String id) {
    _collect();
    setState(() {
      _draft.characters.removeWhere((character) => character.id == id);
      _installControllers();
    });
    _scheduleSave();
  }

  void _loadVersion(PortalWorldVersion version) {
    _collect();
    _saveTimer?.cancel();
    setState(() {
      _draft = version.draft.snapshot();
      _detailsOpen = true;
      _installControllers();
      _error = null;
      _saveLabel = '正在保存本机草稿…';
    });
    unawaited(_saveDraft());
  }

  void _newWorld() {
    _collect();
    _saveTimer?.cancel();
    setState(() {
      _draft = _freshDraft();
      _detailsOpen = false;
      _installControllers();
      _error = null;
    });
    unawaited(_saveDraft());
  }

  Future<void> _saveVersion() async {
    if (_saving) return;
    _saveTimer?.cancel();
    _collect();
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final version = await _repository.saveVersion(_draft);
      if (!mounted) return;
      final versions = await _repository.loadVersions();
      if (!mounted) return;
      setState(() {
        _versions = versions;
        _saveLabel = '${version.draft.title} · 本机第 ${version.version} 版已保存';
      });
      if (widget.onSavedWorld != null) {
        widget.onSavedWorld!(version);
      } else {
        await _previewOpening();
      }
    } on FormatException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (error) {
      if (mounted) setState(() => _error = '本机世界保存失败：$error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _previewOpening() async {
    _collect();
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: _paper,
        title: Text('开场预览', style: TextStyle(color: _ink)),
        content: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: 650),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '这是你编辑的开场正文，不会启动生成或推进故事。',
                  style: TextStyle(color: _muted, fontSize: 13),
                ),
                SizedBox(height: 20),
                Text(
                  _draft.title.isEmpty ? '未命名世界' : _draft.title,
                  style: TextStyle(
                    color: _ink,
                    fontFamily: 'NotoSerifSC',
                    fontSize: 24,
                  ),
                ),
                SizedBox(height: 16),
                SelectableText(
                  _draft.opening.isEmpty
                      ? '还没有开场文字。可以在「开场」中写下第一幕。'
                      : _draft.opening,
                  style: TextStyle(color: _ink, height: 1.9, fontSize: 16),
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text('返回编辑'),
          ),
        ],
      ),
    );
  }

  void _showMessage(String message) {
    ScaffoldMessenger.maybeOf(
      context,
    )?.showSnackBar(SnackBar(content: Text(message)));
  }

  void _cancelGeneration({bool notify = true}) {
    if (!_generating) return;
    _generationEpoch++;
    widget.onCancelGeneration?.call();
    if (!mounted) return;
    setState(() => _generating = false);
    if (notify) _showMessage('已取消生成，原资料和输入仍保留。');
  }

  Future<void> _startWithSeed(
    String seed, {
    PortalWorldVersion? version,
    bool preserveDraft = true,
  }) async {
    if (_starting) return;
    setState(() => _starting = true);
    try {
      if (preserveDraft) await _saveDraft();
      if (version != null && widget.onStartWorld != null) {
        await widget.onStartWorld!(seed, version);
      } else {
        await widget.onStart(seed);
      }
    } catch (error) {
      if (mounted) setState(() => _error = '开始故事失败：$error');
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  Future<void> _generateDraft() async {
    final generate = widget.onGenerateDraft;
    if (generate == null ||
        _generating ||
        _saving ||
        _starting ||
        !widget.modelAvailable) {
      return;
    }
    _collect();
    final idea = _draft.seed.trim();
    if (idea.isEmpty) {
      _showMessage('先写下一点故事想法。');
      return;
    }
    final before = jsonEncode(_draft.toJson());
    final epoch = ++_generationEpoch;
    setState(() {
      _generating = true;
      _error = null;
    });
    try {
      await _saveDraft();
      if (!mounted || epoch != _generationEpoch) return;
      final response = await generate(idea);
      if (!mounted || epoch != _generationEpoch) return;
      _collect();
      if (jsonEncode(_draft.toJson()) != before) {
        _showMessage('草稿已改变，请重新生成。');
        return;
      }
      final proposal = PortalWorldDraft.fromJson({
        ...response.toJson(),
        'id': _draft.id,
        'seed': _draft.seed,
      });
      final accepted =
          await showDialog<bool>(
            context: context,
            builder: (context) => AlertDialog(
              backgroundColor: _paper,
              title: Text('审阅世界草案', style: TextStyle(color: _ink)),
              content: ConstrainedBox(
                constraints: const BoxConstraints(
                  maxWidth: 720,
                  maxHeight: 570,
                ),
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '先审阅公开设定、人物幕后资料和开场；采用后仍可逐项修改，不会自动开始故事。',
                        style: TextStyle(color: _muted, height: 1.7),
                      ),
                      const SizedBox(height: 14),
                      SelectableText(
                        const JsonEncoder.withIndent(
                          '  ',
                        ).convert(proposal.toJson()),
                        style: TextStyle(
                          color: _ink,
                          fontSize: 12,
                          height: 1.55,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(context, false),
                  child: const Text('保留原草稿'),
                ),
                FilledButton(
                  onPressed: () => Navigator.pop(context, true),
                  child: const Text('采用并继续编辑'),
                ),
              ],
            ),
          ) ??
          false;
      if (!accepted || !mounted || epoch != _generationEpoch) return;
      _collect();
      if (jsonEncode(_draft.toJson()) != before) {
        _showMessage('草稿已改变，请重新生成。');
        return;
      }
      setState(() {
        _draft = proposal;
        _detailsOpen = true;
        _charactersOpen = proposal.characters.isNotEmpty;
        _installControllers();
      });
      await _saveDraft();
    } catch (error) {
      if (mounted && epoch == _generationEpoch) {
        setState(() => _error = '草案生成失败：$error。故事想法已保留。');
      }
    } finally {
      if (mounted && epoch == _generationEpoch) {
        setState(() => _generating = false);
      }
    }
  }

  Future<void> _startFromIdea() async {
    final generate = widget.onGenerateDraft;
    if (!widget.modelAvailable ||
        generate == null ||
        _generating ||
        _saving ||
        _starting) {
      return;
    }
    _collect();
    final idea = _draft.seed.trim();
    if (idea.isEmpty) {
      _showMessage('先写下一点故事想法。');
      return;
    }
    final before = jsonEncode(_draft.toJson());
    final epoch = ++_generationEpoch;
    setState(() {
      _generating = true;
      _error = null;
    });
    try {
      await _saveDraft();
      if (!mounted || epoch != _generationEpoch) return;
      final response = await generate(idea);
      if (!mounted || epoch != _generationEpoch) return;
      _collect();
      if (jsonEncode(_draft.toJson()) != before) {
        _showMessage('草稿已改变，请重新生成。');
        return;
      }
      final proposal = PortalWorldDraft.fromJson({
        ...response.toJson(),
        'id': _draft.id,
        'seed': _draft.seed,
      });
      final seed = proposal.toPublicSeed();
      setState(() {
        _generating = false;
        _saving = true;
      });
      final version = await _repository.saveVersion(proposal);
      if (!mounted || epoch != _generationEpoch) return;
      final versions = await _repository.loadVersions();
      if (!mounted || epoch != _generationEpoch) return;
      setState(() {
        _versions = versions;
        _saveLabel = '${version.draft.title} · 本机第 ${version.version} 版已保存';
      });
      await _startWithSeed(seed, version: version, preserveDraft: false);
    } on FormatException catch (error) {
      if (mounted && epoch == _generationEpoch) {
        setState(() => _error = error.message);
      }
    } catch (error) {
      if (mounted && epoch == _generationEpoch) {
        setState(() => _error = '世界生成未完成：$error。故事想法已保留，可以重试。');
      }
    } finally {
      if (mounted && epoch == _generationEpoch) {
        setState(() {
          _generating = false;
          _saving = false;
        });
      }
    }
  }

  Future<void> _startSaved(PortalWorldVersion version) async {
    String seed;
    try {
      seed = version.draft.toPublicSeed();
    } on FormatException catch (error) {
      _showMessage(error.message);
      return;
    }
    final accepted = await _confirmPublicSeed(
      seed,
      title: '以本机世界开始故事',
      explanation: '以下公开设定会用于生成第一幕并开始故事。人物目标、关系经历和幕后秘密留在本机创作版本中，当前故事不会使用。',
    );
    if (accepted && mounted) {
      await _startWithSeed(seed, version: version, preserveDraft: false);
    }
  }

  Future<bool> _confirmPublicSeed(
    String seed, {
    required String title,
    required String explanation,
  }) async {
    return await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            backgroundColor: _paper,
            title: Text(title, style: TextStyle(color: _ink)),
            content: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: 680, maxHeight: 560),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    explanation,
                    style: TextStyle(color: _muted, height: 1.6),
                  ),
                  SizedBox(height: 16),
                  Flexible(
                    child: SingleChildScrollView(
                      child: SelectableText(
                        seed,
                        style: TextStyle(
                          color: _ink,
                          height: 1.7,
                          fontSize: 13,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: Text('返回'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: Text('继续'),
              ),
            ],
          ),
        ) ??
        false;
  }

  Future<void> _importMaterial() async {
    final content = TextEditingController();
    var filename = '资料.txt';
    PortalWorldImport? result;
    String? error;
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, refresh) {
          void parse(String text, String name) {
            try {
              final parsed = parsePortalWorldImport(text, name);
              refresh(() {
                result = parsed;
                error = null;
                filename = name;
              });
            } on FormatException catch (failure) {
              refresh(() {
                result = null;
                error = failure.message;
              });
            } catch (failure) {
              refresh(() {
                result = null;
                error = '$failure';
              });
            }
          }

          return AlertDialog(
            backgroundColor: _paper,
            title: Text('导入创作资料', style: TextStyle(color: _ink)),
            content: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: 700, maxHeight: 650),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '支持 TXT、Markdown、文字 JSON 角色卡和世界书。先解析预览，再采用到草案；不会自动生成或执行脚本。',
                      style: TextStyle(color: _muted, height: 1.65),
                    ),
                    SizedBox(height: 14),
                    OutlinedButton.icon(
                      onPressed: () async {
                        try {
                          final PortalWorldImportFile? file = await picker
                              .pickPortalWorldFile();
                          if (file == null) return;
                          content.text = file.content;
                          parse(file.content, file.name);
                        } on FormatException catch (failure) {
                          refresh(() {
                            result = null;
                            error = failure.message;
                          });
                        }
                      },
                      icon: const PortalIcon('arrow', size: 18),
                      label: Text('选择文字资料'),
                    ),
                    SizedBox(height: 8),
                    Text(
                      '也可以粘贴文字资料：',
                      style: TextStyle(color: _muted, fontSize: 12),
                    ),
                    SizedBox(height: 8),
                    TextField(
                      controller: content,
                      maxLines: 6,
                      minLines: 3,
                      style: TextStyle(color: _ink),
                      decoration: _decoration('粘贴 TXT、Markdown 或 JSON 内容'),
                    ),
                    SizedBox(height: 10),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        ChoiceChip(
                          label: Text('普通文字'),
                          selected: !filename.endsWith('.json'),
                          onSelected: (_) => refresh(() {
                            filename = '资料.txt';
                            result = null;
                          }),
                        ),
                        ChoiceChip(
                          label: Text('JSON'),
                          selected: filename.endsWith('.json'),
                          onSelected: (_) => refresh(() {
                            filename = '资料.json';
                            result = null;
                          }),
                        ),
                        TextButton(
                          onPressed: () => parse(content.text, filename),
                          child: Text('解析并预览'),
                        ),
                      ],
                    ),
                    if (error != null)
                      Padding(
                        padding: EdgeInsets.only(top: 10),
                        child: Text(
                          error!,
                          style: TextStyle(color: Color(0xFFFFA9A9)),
                        ),
                      ),
                    if (result != null) ...[
                      SizedBox(height: 18),
                      for (final warning in result!.warnings)
                        Padding(
                          padding: EdgeInsets.only(bottom: 5),
                          child: Text(
                            warning,
                            style: TextStyle(color: _muted, fontSize: 12),
                          ),
                        ),
                      Container(
                        width: double.infinity,
                        padding: EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: _wash,
                          borderRadius: BorderRadius.circular(9),
                          border: Border.all(color: _line),
                        ),
                        child: SelectableText(
                          JsonEncoder.withIndent('  ').convert(result!.fields),
                          style: TextStyle(
                            color: _ink,
                            fontSize: 12,
                            height: 1.55,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: Text('取消'),
              ),
              FilledButton(
                onPressed: result == null
                    ? null
                    : () {
                        _collect();
                        setState(() {
                          _draft.applyImport(result!);
                          _detailsOpen = true;
                          _installControllers();
                        });
                        _scheduleSave();
                        Navigator.pop(dialogContext);
                      },
                child: Text('采用到当前创作草案'),
              ),
            ],
          );
        },
      ),
    );
    content.dispose();
  }

  InputDecoration _decoration(String hint) => InputDecoration(
    hintText: hint,
    hintStyle: TextStyle(color: Color(0xFF77798E)),
    filled: true,
    fillColor: _wash,
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(8),
      borderSide: BorderSide(color: _line),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(8),
      borderSide: BorderSide(color: _signal),
    ),
    contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
    counterText: '',
  );

  Widget _field(
    String label,
    String key, {
    int max = 500,
    int lines = 1,
    String hint = '',
    bool required = false,
    bool prose = false,
    TextEditingController? controller,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '$label${required ? ' *' : ''}',
          style: TextStyle(color: _ink, fontSize: 13, height: 1.7),
        ),
        SizedBox(height: 8),
        TextField(
          controller: controller ?? _fields[key],
          maxLength: max,
          minLines: lines > 1 ? lines : null,
          maxLines: lines > 1 ? null : 1,
          onChanged: (_) => _scheduleSave(),
          style: TextStyle(
            color: _ink,
            fontSize: prose ? 17 : 15,
            fontFamily: prose ? 'NotoSansSC' : null,
            height: prose ? 1.9 : 1.6,
          ),
          decoration: _decoration(hint),
        ),
      ],
    );
  }

  Widget _chapter(
    String number,
    String title,
    Widget body,
    bool compact, {
    bool tablet = false,
  }) {
    return Container(
      padding: EdgeInsets.symmetric(vertical: compact ? 28 : 34),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: _line)),
      ),
      child: compact
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _chapterHeading(number, title),
                SizedBox(height: 22),
                body,
              ],
            )
          : Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: tablet ? 118 : 148,
                  child: _chapterHeading(number, title),
                ),
                Expanded(child: body),
              ],
            ),
    );
  }

  Widget _chapterHeading(String number, String title) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        number,
        style: TextStyle(
          color: _signal,
          fontFamily: 'SpaceGrotesk',
          fontSize: 11,
          letterSpacing: 2.2,
        ),
      ),
      SizedBox(height: 8),
      Text(
        title,
        style: TextStyle(color: _ink, fontFamily: 'NotoSerifSC', fontSize: 25),
      ),
    ],
  );

  Widget _grid(List<Widget> children, bool compact) => compact
      ? Column(
          children: [
            for (final child in children) ...[child, SizedBox(height: 20)],
          ],
        )
      : Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (var i = 0; i < children.length; i++) ...[
              if (i > 0) SizedBox(width: 22),
              Expanded(child: children[i]),
            ],
          ],
        );

  Widget _select(
    String label,
    String value,
    List<String> options,
    ValueChanged<String> update,
  ) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label, style: TextStyle(color: _ink, fontSize: 13)),
      SizedBox(height: 8),
      DropdownButtonFormField<String>(
        initialValue: options.contains(value) ? value : options.first,
        dropdownColor: _paper,
        style: TextStyle(color: _ink),
        decoration: _decoration(''),
        items: [
          for (final option in options)
            DropdownMenuItem(value: option, child: Text(option)),
        ],
        onChanged: (next) {
          if (next != null) {
            update(next);
            _scheduleSave();
          }
        },
      ),
    ],
  );

  Widget _characterCard(
    PortalWorldCharacterDraft character,
    int index,
    bool compact,
  ) {
    final fields = _characters[character.id]!;
    return Container(
      margin: EdgeInsets.only(bottom: 18),
      padding: EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: _wash,
        borderRadius: BorderRadius.circular(11),
        border: Border.all(color: _line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '人物 ${index + 1}',
                  style: TextStyle(
                    color: _ink,
                    fontFamily: 'NotoSerifSC',
                    fontSize: 19,
                  ),
                ),
              ),
              TextButton(
                onPressed: () => _removeCharacter(character.id),
                child: Text('移除'),
              ),
            ],
          ),
          SizedBox(height: 18),
          _grid([
            _field(
              '姓名',
              'name',
              controller: fields['name'],
              max: 100,
              required: true,
            ),
            _field('身份', 'role', controller: fields['role'], max: 200),
          ], compact),
          SizedBox(height: 20),
          _field(
            '公开介绍 / 外在表现',
            'public',
            controller: fields['public'],
            max: 3000,
            lines: 3,
          ),
          SizedBox(height: 20),
          _field('人物自己的目标', 'goal', controller: fields['goal'], max: 500),
          SizedBox(height: 20),
          _field(
            '关系与重要经历',
            'history',
            controller: fields['history'],
            max: 1000,
          ),
          SizedBox(height: 20),
          _field(
            '幕后秘密 · 仅作者可见',
            'secret',
            controller: fields['secret'],
            max: 3000,
            lines: 3,
          ),
        ],
      ),
    );
  }

  Widget _expander(
    String title,
    bool open,
    VoidCallback toggle, {
    String? detail,
  }) => InkWell(
    onTap: toggle,
    child: Container(
      padding: EdgeInsets.symmetric(vertical: 20),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: _line)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(title, style: TextStyle(color: _ink, fontSize: 16)),
          ),
          if (detail != null)
            Text(detail, style: TextStyle(color: _muted, fontSize: 12)),
          SizedBox(width: 12),
          PortalIcon(open ? 'close' : 'plus', size: 17, color: _signal),
        ],
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Material(
        color: _background,
        child: Center(child: CircularProgressIndicator(color: _signal)),
      );
    }
    return Material(
      color: _background,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final compact = constraints.maxWidth <= 600;
          final tablet = constraints.maxWidth <= 800;
          final phone = constraints.maxWidth <= 360;
          final horizontalPadding = phone
              ? 16.0
              : compact
              ? 20.0
              : tablet
              ? 24.0
              : constraints.maxWidth <= 1100
              ? 32.0
              : 40.0;
          final titleSize = phone
              ? 29.0
              : compact
              ? 32.0
              : (constraints.maxWidth * .035).clamp(34.0, 44.0).toDouble();
          return Stack(
            fit: StackFit.expand,
            children: [
              SingleChildScrollView(
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 980),
                    child: Padding(
                      padding: EdgeInsets.fromLTRB(
                        horizontalPadding,
                        compact
                            ? 29
                            : tablet
                            ? 36
                            : 56,
                        horizontalPadding,
                        compact
                            ? 38
                            : tablet
                            ? 116
                            : 140,
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'WORLD STUDIO',
                            style: TextStyle(
                              color: _muted,
                              fontFamily: 'SpaceGrotesk',
                              letterSpacing: 1.5,
                              fontSize: 10,
                            ),
                          ),
                          SizedBox(height: 12),
                          Text(
                            _versions.any((v) => v.draft.id == _draft.id)
                                ? '编辑世界'
                                : '创造一个世界',
                            style: TextStyle(
                              color: _ink,
                              fontFamily: 'NotoSerifSC',
                              fontSize: titleSize,
                              height: 1.45,
                            ),
                          ),
                          SizedBox(height: compact ? 9 : 12),
                          Text(
                            _versions.any((v) => v.draft.id == _draft.id)
                                ? '打磨规则、人物与开场，让这个世界更接近你的想象。'
                                : '从一个念头开始，写下属于你的世界与第一幕。',
                            style: TextStyle(
                              color: _muted,
                              fontSize: compact ? 12 : 13,
                              height: 1.8,
                            ),
                          ),
                          SizedBox(height: compact ? 22 : 25),
                          Container(
                            height: 1,
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                colors: [
                                  _signal,
                                  Color(0xFF83AFC2),
                                  Colors.transparent,
                                ],
                              ),
                            ),
                          ),
                          SizedBox(height: compact ? 27 : 36),
                          if (_versions.any((v) => v.draft.id == _draft.id))
                            _notice('修改另存为新版本，已有故事保留原设定。此处的版本目前仅保存在本机。'),
                          Container(
                            padding: compact
                                ? EdgeInsets.fromLTRB(
                                    phone ? 19 : 23,
                                    phone ? 21 : 24,
                                    phone ? 19 : 23,
                                    phone ? 21 : 24,
                                  )
                                : const EdgeInsets.fromLTRB(35, 33, 35, 27),
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(
                                compact ? 12 : 14,
                              ),
                              border: Border.all(color: Color(0x65BDB0DF)),
                              gradient: RadialGradient(
                                center: Alignment.topRight,
                                radius: 1.9,
                                colors: [
                                  Color(_dark ? 0xFF27213A : 0xFFECE8F4),
                                  _paper,
                                ],
                              ),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '◇  故事想法',
                                  style: TextStyle(
                                    color: _signal,
                                    fontSize: 12,
                                    letterSpacing: 2,
                                  ),
                                ),
                                SizedBox(height: 16),
                                TextField(
                                  controller: _fields['seed'],
                                  maxLength: 8000,
                                  minLines: compact ? 5 : 4,
                                  maxLines: 8,
                                  onChanged: (_) => _scheduleSave(),
                                  style: TextStyle(
                                    color: _ink,
                                    fontFamily: 'NotoSerifSC',
                                    fontSize: compact ? 19 : 22,
                                    height: 1.95,
                                  ),
                                  decoration: InputDecoration(
                                    hintText: '例如：在一座只说真话的小城，开一家茶铺。',
                                    hintStyle: TextStyle(
                                      color: Color(0xFF8C899D),
                                    ),
                                    border: InputBorder.none,
                                    counterText: '',
                                  ),
                                ),
                                SizedBox(height: 18),
                                Text(
                                  _versions.any((v) => v.draft.id == _draft.id)
                                      ? '修改想法后，可重新生成草案再审阅。'
                                      : '写下你的设想，生成世界与第一幕后直接开始。',
                                  style: TextStyle(
                                    color: _muted,
                                    height: 1.85,
                                    fontSize: compact ? 12 : 13,
                                  ),
                                ),
                                SizedBox(height: 25),
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.end,
                                  children: [
                                    if (!_versions.any(
                                      (v) => v.draft.id == _draft.id,
                                    ))
                                      Flexible(
                                        fit: compact
                                            ? FlexFit.tight
                                            : FlexFit.loose,
                                        child: FilledButton(
                                          onPressed:
                                              _starting ||
                                                  _generating ||
                                                  _saving ||
                                                  widget.onGenerateDraft ==
                                                      null ||
                                                  !widget.modelAvailable
                                              ? null
                                              : _startFromIdea,
                                          child: Text(
                                            _generating ? '正在准备第一幕…' : '生成并开始',
                                          ),
                                        ),
                                      ),
                                    if (_generating &&
                                        widget.onCancelGeneration != null) ...[
                                      SizedBox(width: 10),
                                      OutlinedButton(
                                        onPressed: () => _cancelGeneration(),
                                        child: const Text('取消'),
                                      ),
                                    ],
                                  ],
                                ),
                                if (_generating || !widget.modelAvailable) ...[
                                  SizedBox(height: 19),
                                  Divider(color: _line, height: 1),
                                  SizedBox(height: 16),
                                  Text(
                                    _generating
                                        ? '正在准备人物、世界与第一幕。你的想法已保留。'
                                        : '模型暂不可用，可以手动填写并保存。原始设想仍会自动保留。',
                                    style: TextStyle(
                                      color: _muted,
                                      fontSize: 12,
                                      height: 1.8,
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                          SizedBox(height: 30),
                          _expander(
                            '先编辑设定',
                            _detailsOpen,
                            () => setState(() => _detailsOpen = !_detailsOpen),
                          ),
                          if (_detailsOpen) ...[
                            Padding(
                              padding: EdgeInsets.only(top: 3, bottom: 0),
                              child: Text(
                                '可以直接填写，也可以先生成草案再修改。保存后先预览，不会自动开始故事。',
                                style: TextStyle(
                                  color: _muted,
                                  fontSize: 13,
                                  height: 1.7,
                                ),
                              ),
                            ),
                            Padding(
                              padding: const EdgeInsets.only(
                                top: 21,
                                bottom: 32,
                              ),
                              child: Row(
                                children: [
                                  if (widget.onGenerateDraft != null)
                                    OutlinedButton.icon(
                                      onPressed:
                                          _generating ||
                                              _saving ||
                                              _starting ||
                                              !widget.modelAvailable
                                          ? null
                                          : _generateDraft,
                                      icon: _generating
                                          ? const SizedBox(
                                              width: 16,
                                              height: 16,
                                              child: CircularProgressIndicator(
                                                strokeWidth: 2,
                                              ),
                                            )
                                          : const PortalIcon('spark'),
                                      label: Text(
                                        _generating ? '正在形成草案…' : '生成草案',
                                      ),
                                    ),
                                  if (!_generating) ...[
                                    if (!compact)
                                      const Spacer()
                                    else
                                      const SizedBox(width: 10),
                                    OutlinedButton(
                                      onPressed: _importMaterial,
                                      child: const Text('导入文字资料'),
                                    ),
                                  ],
                                ],
                              ),
                            ),
                            _chapter(
                              '01',
                              '世界',
                              Column(
                                children: [
                                  _field(
                                    '世界名称',
                                    'title',
                                    max: 100,
                                    required: true,
                                    hint: '为这个世界起一个名字',
                                  ),
                                  SizedBox(height: 23),
                                  _field(
                                    '世界简介',
                                    'description',
                                    max: 4000,
                                    lines: 3,
                                  ),
                                  SizedBox(height: 23),
                                  _field('时代 / 环境', 'era', max: 500),
                                  SizedBox(height: 23),
                                  _field(
                                    '基本规则 · 每行一条',
                                    'rules',
                                    max: 8000,
                                    lines: 4,
                                  ),
                                ],
                              ),
                              compact,
                              tablet: tablet,
                            ),
                            _chapter(
                              '02',
                              '开场',
                              Column(
                                children: [
                                  _grid([
                                    _field(
                                      '玩家身份',
                                      'identity',
                                      max: 500,
                                      required: true,
                                    ),
                                    _field(
                                      '起始地点',
                                      'location',
                                      max: 500,
                                      required: true,
                                    ),
                                  ], compact),
                                  SizedBox(height: 23),
                                  _field('可选个人目标', 'goal', max: 1000),
                                  SizedBox(height: 23),
                                  _field(
                                    '开场正文',
                                    'opening',
                                    max: 12000,
                                    lines: 6,
                                    required: true,
                                    prose: true,
                                  ),
                                ],
                              ),
                              compact,
                              tablet: tablet,
                            ),
                            _expander(
                              '人物与幕后资料',
                              _charactersOpen,
                              () => setState(
                                () => _charactersOpen = !_charactersOpen,
                              ),
                              detail: '${_draft.characters.length} 位人物',
                            ),
                            if (_charactersOpen) ...[
                              SizedBox(height: 8),
                              for (var i = 0; i < _draft.characters.length; i++)
                                _characterCard(
                                  _draft.characters[i],
                                  i,
                                  compact,
                                ),
                              OutlinedButton.icon(
                                onPressed: _addCharacter,
                                icon: const PortalIcon('plus'),
                                label: Text('添加人物'),
                              ),
                              SizedBox(height: 26),
                            ],
                            _expander(
                              '叙述偏好',
                              _narrativeOpen,
                              () => setState(
                                () => _narrativeOpen = !_narrativeOpen,
                              ),
                            ),
                            if (_narrativeOpen)
                              Padding(
                                padding: EdgeInsets.only(top: 18, bottom: 28),
                                child: Column(
                                  children: [
                                    _grid([
                                      _select(
                                        '视角',
                                        _draft.perspective,
                                        ['第二人称', '第一人称', '第三人称'],
                                        (value) => setState(
                                          () => _draft.perspective = value,
                                        ),
                                      ),
                                      _select(
                                        '篇幅',
                                        _draft.length,
                                        ['简短', '适中', '舒展'],
                                        (value) => setState(
                                          () => _draft.length = value,
                                        ),
                                      ),
                                    ], compact),
                                    SizedBox(height: 20),
                                    _grid([
                                      _field('文风', 'style', max: 200),
                                      _select(
                                        '节奏',
                                        _draft.pace,
                                        ['从容', '适中', '紧凑'],
                                        (value) =>
                                            setState(() => _draft.pace = value),
                                      ),
                                    ], compact),
                                  ],
                                ),
                              ),
                            SizedBox(height: 16),
                            if (compact)
                              _editorBar(compact: true, phone: phone),
                          ],
                          if (_error != null)
                            Padding(
                              padding: EdgeInsets.only(top: 18),
                              child: _notice(_error!, error: true),
                            ),
                          if (_versions.isNotEmpty) ...[
                            const SizedBox(height: 34),
                            _savedWorlds(),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              if (!compact && _detailsOpen)
                Positioned(
                  left: horizontalPadding,
                  right: horizontalPadding,
                  bottom: 18,
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 900),
                      child: _editorBar(compact: false),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }

  Widget _editorBar({required bool compact, bool phone = false}) {
    final preview = OutlinedButton(
      onPressed: _previewOpening,
      child: const Text('预览开场'),
    );
    final save = FilledButton(
      onPressed: _saving ? null : _saveVersion,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            _saving
                ? '正在保存…'
                : _versions.any((v) => v.draft.id == _draft.id)
                ? '保存新版本'
                : '保存并预览',
          ),
          const SizedBox(width: 6),
          const PortalIcon('arrow-up-right', size: 15),
        ],
      ),
    );
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 17),
      decoration: BoxDecoration(
        color: _paper,
        borderRadius: BorderRadius.circular(11),
        border: Border.all(color: _line),
        boxShadow: const [
          BoxShadow(
            color: Color(0x2429252C),
            blurRadius: 24,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: compact
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_saveLabel, style: TextStyle(color: _muted, fontSize: 12)),
                const SizedBox(height: 14),
                if (phone) ...[
                  SizedBox(width: double.infinity, child: preview),
                  const SizedBox(height: 10),
                  SizedBox(width: double.infinity, child: save),
                ] else
                  Row(
                    children: [
                      Expanded(child: preview),
                      const SizedBox(width: 10),
                      Expanded(child: save),
                    ],
                  ),
              ],
            )
          : Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 16,
              runSpacing: 12,
              children: [
                Text(_saveLabel, style: TextStyle(color: _muted, fontSize: 12)),
                Wrap(spacing: 9, runSpacing: 9, children: [preview, save]),
              ],
            ),
    );
  }

  Widget _notice(String message, {bool error = false}) => Container(
    width: double.infinity,
    margin: EdgeInsets.only(bottom: 22),
    padding: EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: error ? Color(_dark ? 0xFF38232D : 0xFFF9E9EF) : _wash,
      borderRadius: BorderRadius.circular(9),
      border: Border.all(color: _line),
    ),
    child: Text(
      message,
      style: TextStyle(
        color: error ? Color(_dark ? 0xFFFFBFC5 : 0xFFAE3655) : _muted,
        height: 1.8,
        fontSize: 13,
      ),
    ),
  );

  Future<void> _exportVersion(PortalWorldVersion version) async {
    final accepted =
        await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: const Text('导出本机世界版本'),
            content: const Text(
              'JSON 包含人物目标、关系经历和幕后秘密，只适合作者自己备份。分享给读者时请使用公开资料。',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('取消'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(dialogContext, true),
                child: const Text('导出 JSON'),
              ),
            ],
          ),
        ) ??
        false;
    if (!accepted || !mounted) return;
    final safeTitle = version.draft.title.replaceAll(
      RegExp(r'[\\/:*?"<>|]'),
      '_',
    );
    final content = const JsonEncoder.withIndent('  ').convert({
      ...version.draft.toJson(),
      'version': version.version,
      'savedAt': version.savedAt.toUtc().toIso8601String(),
      'localOnly': true,
    });
    final downloaded = await text_export.exportPortalText(
      '$safeTitle-第${version.version}版.json',
      content,
      'application/json;charset=utf-8',
    );
    if (mounted) _showMessage(downloaded ? '世界版本已导出。' : '世界版本 JSON 已复制到剪贴板。');
  }

  Future<void> _versionHistory(String worldId) async {
    final versions =
        _versions.where((item) => item.draft.id == worldId).toList()
          ..sort((a, b) => b.version.compareTo(a.version));
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('本机版本记录'),
        content: SizedBox(
          width: 590,
          child: ListView(
            shrinkWrap: true,
            children: [
              for (final version in versions)
                ListTile(
                  title: Text(
                    '${version.draft.title} · 第 ${version.version} 版',
                  ),
                  subtitle: Text(
                    version.savedAt.toLocal().toString().split('.').first,
                  ),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      TextButton(
                        onPressed: () {
                          Navigator.pop(dialogContext);
                          _loadVersion(version);
                        },
                        child: const Text('恢复为草稿'),
                      ),
                      TextButton(
                        onPressed: () {
                          Navigator.pop(dialogContext);
                          _exportVersion(version);
                        },
                        child: const Text('导出'),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('关闭'),
          ),
        ],
      ),
    );
  }

  Widget _savedWorlds() {
    final latest = <String, PortalWorldVersion>{};
    for (final version in _versions) {
      final old = latest[version.draft.id];
      if (old == null || old.version < version.version) {
        latest[version.draft.id] = version;
      }
    }
    return Container(
      width: double.infinity,
      margin: EdgeInsets.only(bottom: 28),
      padding: EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: _paper,
        borderRadius: BorderRadius.circular(11),
        border: Border.all(color: _line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '本机创作版本',
                  style: TextStyle(
                    color: _ink,
                    fontSize: 17,
                    fontFamily: 'NotoSerifSC',
                  ),
                ),
              ),
              TextButton.icon(
                onPressed: _newWorld,
                icon: const PortalIcon('plus'),
                label: Text('新建世界'),
              ),
            ],
          ),
          SizedBox(height: 5),
          Text(
            '这些版本只保存在此设备。选择一个版本继续编辑，或用公开设定开始故事。',
            style: TextStyle(color: _muted, fontSize: 12, height: 1.7),
          ),
          SizedBox(height: 15),
          for (final version in latest.values)
            Container(
              padding: EdgeInsets.symmetric(vertical: 12),
              decoration: BoxDecoration(
                border: Border(top: BorderSide(color: _line)),
              ),
              child: Wrap(
                spacing: 12,
                runSpacing: 9,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(
                    '${version.draft.title} · 第 ${version.version} 版',
                    style: TextStyle(color: _ink),
                  ),
                  TextButton(
                    onPressed: () => _loadVersion(version),
                    child: Text('编辑新版本'),
                  ),
                  if (widget.onSavedWorld != null)
                    TextButton(
                      onPressed: () => widget.onSavedWorld!(version),
                      child: const Text('查看世界'),
                    ),
                  TextButton(
                    onPressed: () => _startSaved(version),
                    child: Text('以此版本开始故事'),
                  ),
                  TextButton(
                    onPressed: () => _versionHistory(version.draft.id),
                    child: const Text('版本记录'),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
