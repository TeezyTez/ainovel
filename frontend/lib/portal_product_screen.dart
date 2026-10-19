/// Native product UI; all formal story writes go through the Go controller.
library;
import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'experience/demo_world_catalog.dart';
import 'experience/experience_controller.dart';
import 'experience/experience_journal.dart';
import 'experience/experience_models.dart';
import 'experience/experience_screen.dart';
import 'portal/portal_discover.dart';
import 'portal/portal_home.dart';
import 'portal/portal_library.dart';
import 'portal/portal_world_detail.dart';
import 'portal/portal_world_studio.dart';

import 'portal/portal_preferences.dart';
import 'portal/portal_settings.dart';
import 'portal/portal_service_client.dart';
import 'portal/portal_file_io.dart';
import 'portal/portal_route.dart';
import 'portal/portal_navigation.dart';
import 'portal/portal_demo_repository.dart';
import 'portal/portal_demo_reader.dart';

enum _PortalPage { home, discover, detail, shelf, studio, create, reader, demo, settings }
class _RecentEntry{
  const _RecentEntry(this.title,this.detail,this.excerpt,this.time,this.onOpen);
  final String title,detail;
  final String? excerpt;
  final DateTime time;
  final VoidCallback onOpen;
}

class PortalProductScreen extends StatefulWidget {
  const PortalProductScreen({super.key, required this.controller, required this.onPreferences,this.service,this.initialPath,this.ready,this.artifactClient});
  final ExperienceController controller;
  final VoidCallback onPreferences;
  final PortalServiceClient? service;
  final String? initialPath;
  final Future<void>? ready;
  final PortalServiceClient Function()? artifactClient;
  @override State<PortalProductScreen> createState() => _PortalProductScreenState();
}
class _PortalProductScreenState extends State<PortalProductScreen> {
  _PortalPage _page = _PortalPage.home;
  DemoWorldPreset? _world;
  PortalWorldVersion? _customWorld, _editVersion;
  List<PortalWorldVersion> _worlds = [];
  Json _personal = {};
  Json _worldLinks = {};
  String? _worldLinkViewKey;
  List<PortalDemoEntry> _demoEntries=[];
  PortalDemoEntry? _activeDemo;
  bool _resumeDemo=false;
  String? _resumeDemoSessionId;
  bool _starting = false;
  int _navigationEpoch=0;
  _PortalPage? _startOriginPage;
  late final PortalPreferences _preferences;
  late final PortalWorldRepository _repository;
  late final PortalDemoRepository _demoRepository;
  late final PortalServiceClient _service;
  late final PortalRouteBridge _routes;
  final List<Json> _events = [];
  bool _modelAvailable = false;
  bool _modelChecked = false;
  int _settingsSection=0;
  ExperienceView? _recentView;
  ExperienceController get c => widget.controller;
  ThemeMode get _theme => switch (_preferences.theme) { 'dark' => ThemeMode.dark, 'system' => ThemeMode.system, _ => ThemeMode.light };
  String get _libraryScope => experienceScope(c.session.backendUrl, c.session.workspaceId, 'library', 'personal-v1');
  String get _worldLinkScope => experienceScope(c.session.backendUrl, c.session.workspaceId, 'story-worlds', 'versions');
  Json? get _authorWorld {
    final link = _worldLinks[c.current?.id];
    if(link is! Map)return null;
    final branches=link['branches'];
    var branch=c.current?.branchId;
    final visited=<String>{};
    while(branch!=null&&visited.add(branch)){
      final version=branches is Map?branches[branch]:null;
      if(version is Map && version['snapshot'] is Map)return Map<String,dynamic>.from(version['snapshot']);
      branch=c.current?.branches.where((b)=>b.id==branch).firstOrNull?.parentId;
    }
    return link['snapshot'] is Map ? Map<String,dynamic>.from(link['snapshot']) : null;
  }
  List<ExperienceSummary> get _recent => c.shelf.where((s) {
    final meta = _personal[s.id];
    return meta is! Map || (meta['archived'] != true && meta['trashed_at'] == null);
  }).toList()..sort((a,b)=>b.updatedAt.compareTo(a.updatedAt));
  List<_RecentEntry> get _recentEntries=>[
    for(final story in _recent)_RecentEntry(portalStoryDisplayTitle(story,localName:_personal[story.id] is Map?_personal[story.id]['display_name'] as String?:null),_recentView?.id==story.id?_recentProgress(_recentView!):'一段独立的经历',_recentView?.id==story.id?portalStorySnippet(_recentView?.pages.lastOrNull?.text??'',limit:95):null,DateTime.tryParse(story.updatedAt)??DateTime(1970),()=>unawaited(_open(story))),
    for(final demo in _demoEntries.where((e)=>!e.archived&&e.trashedAt==null))_RecentEntry(demo.title,demo.readOnly?'只读开场':'${demo.step} 回合 · 预设演示',demo.latestProse,demo.updatedAt,()=>_openDemo(demo.id)),
  ]..sort((a,b)=>b.time.compareTo(a.time));
  String _recentProgress(ExperienceView view){
    final count=portalStoryTurnCount(view);
    final branch=view.branches.where((b)=>b.id==view.branchId).firstOrNull;
    final meaningful=branch!=null&&(view.branches.length>1||branch.parentId!=null||!const ['主分支','主线','main','最初的故事'].contains(branch.name));
    return '$count 回合${count==0?' · 开场':''}${meaningful?' · 分支：${branch.name}':''}';
  }
  @override void initState() {
    super.initState();
    _preferences = PortalPreferences(journal: c.journal, backendUrl: c.session.backendUrl, workspaceId: c.session.workspaceId);
    _repository = PortalWorldRepository(journal: c.journal, backendUrl: c.session.backendUrl, workspaceId: c.session.workspaceId);
    _demoRepository=PortalDemoRepository(journal:c.journal,backendUrl:c.session.backendUrl,workspaceId:c.session.workspaceId);
    _service = widget.service ?? PortalServiceClient(() => c.session.backendUrl);
    _routes = PortalRouteBridge((path) => unawaited(_route(path)));
    c.addListener(_changed);
    _preferences.addListener(_appearance);
    unawaited(_boot());
  }
  Future<void> _boot() async {
    final epoch=_navigationEpoch;
    await widget.ready;
    await _preferences.hydrate();
    await _loadLocal();
    if (!mounted) return;
    if(epoch==_navigationEpoch){
      final path=widget.initialPath??_routes.current;
      if(widget.initialPath!=null)_routes.go(path);
      await _route(path);
    }
    try { await _checkModel(); } catch (_) {}
  }
  Future<Json> _checkModel() async {
    try {
      final status=await _service.modelStatus();
      if(mounted)setState(()=>_modelAvailable=status['available']==true);
      return status;
    } catch (_) {
      if(mounted)setState(()=>_modelAvailable=false);
      rethrow;
    } finally {if(mounted)setState(()=>_modelChecked=true);}
  }
  Future<void> _loadLocal() async {
    try {
      final versions = await _repository.loadVersions();
      final metadata = await c.journal.read(_libraryScope);
      final links = await c.journal.read(_worldLinkScope);
      final demos=await _demoRepository.loadEntries();
      final latest = <String, PortalWorldVersion>{};
      for (final version in versions) {
        if (version.version >= (latest[version.draft.id]?.version ?? -1)) latest[version.draft.id] = version;
      }
      if (mounted) setState(() { _worlds = latest.values.toList()..sort((a,b) => b.savedAt.compareTo(a.savedAt)); _personal = metadata['personal'] is Map ? Map<String,dynamic>.from(metadata['personal']) : {}; _worldLinks = links;_demoEntries=demos; });
    } catch (_) { _notice('本机世界与书架整理信息读取失败，请刷新重试。'); }
    unawaited(_loadRecent());
  }
  Future<void> _loadRecent() async {
    if (_recent.isEmpty) return;
    final id = _recent.first.id;
    if (_recentView?.id == id && _recentView?.revision == c.current?.revision) return;
    try { final view = await c.api.view(id); if (mounted && _recent.isNotEmpty && _recent.first.id == id) setState(() => _recentView = view); } catch (_) {}
  }
  void _appearance() {
    final theme = _preferences.theme == 'dark' ? 'ink' : _preferences.theme == 'system' ? 'system' : 'mist';
    if (c.session.themeId != theme) c.session.themeId = theme;
    if (c.session.reduceMotion != _preferences.reducedMotion) c.session.reduceMotion = _preferences.reducedMotion;
    if (mounted) setState(() {});
  }
  @override void dispose() { c.removeListener(_changed); _preferences.removeListener(_appearance); _preferences.dispose(); _service.close(); _routes.dispose(); super.dispose(); }
  void _changed() {
    if (!mounted) return;
    if (c.current != null && (_page == _PortalPage.create || _starting&&_page==_startOriginPage)) { _page = _PortalPage.reader; _routes.go('/story/${c.current!.id}'); }
    final key=c.current==null?null:'${c.current!.id}:${c.current!.branchId}';
    if(key!=_worldLinkViewKey){_worldLinkViewKey=key;unawaited(_loadWorldLinks());}
    setState(() {});
  }
  Future<void> _loadWorldLinks()async{
    try{
      final scope=_worldLinkScope,links=await c.journal.read(_worldLinkScope);
      if(mounted&&scope==_worldLinkScope)setState(()=>_worldLinks=links);
    }catch(_){_notice('作者世界版本暂时无法读取，请稍后重试。');}
  }
  void _notice(String message) { if (mounted) ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(message))); }
  Future<void> _route(String path) async {
    final epoch=++_navigationEpoch;
    try {
      final parts = Uri.parse(path).pathSegments;
      if (parts.isEmpty) { _go(_PortalPage.home, history: false); return; }
      switch (parts.first) {
        case 'stories': _go(_PortalPage.shelf, history: false);
        case 'settings': _go(_PortalPage.settings, history: false);
        case 'create': _editVersion = null; _go(_PortalPage.studio, history: false);
        case 'discover': _go(_PortalPage.discover, history: false);
        case 'story':
          if (parts.length > 1) {
            if(_demoEntries.any((entry)=>entry.id==parts[1])){await _openDemo(parts[1],history:false);break;}
            await c.open(parts[1]);
            if(!mounted||epoch!=_navigationEpoch)return;
            if (mounted && c.current?.id == parts[1]) _go(_PortalPage.reader, history: false);
            else { _notice('这段经历尚不可用。'); _go(_PortalPage.shelf, history: false); }
          }
        case 'world':
          if (parts.length > 1) {
            final preset = demoWorldPresets.where((w) => w.id == parts[1]).firstOrNull;
            final custom = _worlds.where((w) => w.draft.id == parts[1]).firstOrNull;
            if (preset != null) _openWorld(preset, history: false);
            else if (custom != null) _openCustom(custom, history: false);
            else { _notice('未找到这个世界。'); _go(_PortalPage.discover, history: false); }
          }
        case 'edit':
          final version = parts.length > 1 ? _worlds.where((v) => v.draft.id == parts[1]).firstOrNull : null;
          if (version != null) { _editVersion = version; _go(_PortalPage.studio, history: false); }
          else { _notice('未找到可编辑的世界版本。'); _go(_PortalPage.shelf, history: false); }
        default: _go(_PortalPage.home, history: false);
      }
    } catch (_) { if(epoch==_navigationEpoch)_notice('页面地址无法打开。'); }
  }
  void _go(_PortalPage page, {bool history = true}) {
    if (!mounted) return;
    _navigationEpoch++;
    // Demo's "发现" links back to the portal; its atlas is on that same page.
    if(page==_PortalPage.discover)page=_PortalPage.home;
    setState(() => _page = page);
    if (history) _routes.go(switch (page) {
      _PortalPage.home => '/', _PortalPage.discover => '/discover', _PortalPage.shelf => '/stories',
      _PortalPage.settings => '/settings', _PortalPage.studio => _editVersion == null ? '/create' : '/edit/${_editVersion!.draft.id}',
      _PortalPage.demo => '/story/${_activeDemo!.id}',
      _PortalPage.detail => _resumeDemoSessionId!=null?'/story/$_resumeDemoSessionId':'/world/${_world?.id ?? _customWorld!.draft.id}', _ => c.current == null ? '/create' : '/story/${c.current!.id}',
    });
    _events.add({'event':'navigate','page':page.name,'at':DateTime.now().toUtc().toIso8601String()});
    if (_events.length > 500) _events.removeAt(0);
    if (page == _PortalPage.shelf || page == _PortalPage.home || page == _PortalPage.discover) { unawaited(c.refreshShelf().then((_) => _loadLocal())); }
  }
  void _create() { _editVersion = null; _go(_PortalPage.studio); }
  void _edit(PortalWorldVersion version) { _editVersion = version; _go(_PortalPage.studio); }
  Future<void> _copy(PortalWorldVersion version) async {
    try { final copy=await _repository.saveVersion(portalCopyWorld(version.draft));await _loadLocal();if(mounted)_edit(copy); }
    catch(_){_notice('世界副本未能保存，请重试。');}
  }
  Future<void> _deleteStory(String id) async {
    await _service.delete(id);
    if(c.current?.id==id)await c.newSeed();
  }
  Future<void> _startWorld(String seed, PortalWorldVersion version) => _startSeed(seed, worldVersion: version);
  Json _authorPayload(PortalWorldDraft draft){
    final value=draft.toJson();
    return {for(final key in ['title','description','era','rules','identity','location','goal','opening','narrative'])key:value[key],
      'characters':[for(final person in draft.characters){'name':person.name,'role':person.role,'public':person.public,'goal':person.goal,'history':person.history,'secret':person.secret}]};
  }
  Future<void> _startSeed(String seed, {PortalWorldVersion? worldVersion}) async {
    if (_starting) return;
    setState(() {_starting = true;_startOriginPage=_page;});
    try {
      await c.newSeed();if(!mounted)return;
      if(c.blocked||c.storageError!=null){_go(_PortalPage.create);return;}
      await c.saveDraft(seed); if (!mounted) return;
      await c.send(
        authorWorld:worldVersion==null?null:_authorPayload(worldVersion.draft),
        worldVersion:worldVersion==null?null:{'id':worldVersion.draft.id,'version':worldVersion.version,'title':worldVersion.draft.title,'public_seed':seed},
      );
      final created=c.current;
      if(created==null&&mounted&&_page==_startOriginPage){_go(_PortalPage.create);}
      if(created!=null)await _loadWorldLinks();
    }
    catch (_) { _notice('开始故事未完成，草稿仍保留。请在创作页查看状态后重试。'); }
    finally { if (mounted) setState(() {_starting = false;_startOriginPage=null;}); }
  }
  void _startSelectedWorld(String seed) {
    final selected=_customWorld ?? PortalWorldVersion(draft:PortalWorldDraft.fromJson({...portalDraftFromPreset(_world!).toJson(),'id':_world!.id}),version:1,savedAt:DateTime.now());
    unawaited(_startSeed(seed,worldVersion:selected));
  }
  Future<void> _rewriteWorld()async{
    final view=c.current;
    if(view==null||c.blocked)return;
    final versions=await _repository.loadVersions();
    if(!mounted)return;
    final author=_authorWorld;
    final matching=versions.where((v)=>author==null||v.draft.id==author['id']).toList()..sort((a,b)=>b.version.compareTo(a.version));
    PortalWorldVersion? selected=matching.firstOrNull;
    final choice=await showDialog<String>(context:context,builder:(dialogContext)=>StatefulBuilder(builder:(context,setDialog)=>AlertDialog(title:const Text('改写世界设定'),content:SizedBox(width:520,child:SingleChildScrollView(child:Column(mainAxisSize:MainAxisSize.min,crossAxisAlignment:CrossAxisAlignment.start,children:[const Text('选择已保存的世界版本，在当前片刻建立分支。此前正文和经历保留，新设定用于此后的故事。'),const SizedBox(height:20),
      if(matching.isEmpty)const Text('这个世界还没有可选的新版本。可以先编辑并保存，再返回这段故事采用。')
      else ...[DropdownButtonFormField<PortalWorldVersion>(initialValue:selected,isExpanded:true,decoration:const InputDecoration(labelText:'世界版本'),items:[for(final v in matching)DropdownMenuItem(value:v,child:Text('${v.draft.title} · v${v.version}',overflow:TextOverflow.ellipsis))],onChanged:(v)=>setDialog(()=>selected=v)),const SizedBox(height:16),Text(selected!.draft.description),const SizedBox(height:12),for(final rule in selected!.draft.rules)Padding(padding:const EdgeInsets.only(bottom:8),child:Text('· $rule'))],
    ]))),actions:[TextButton(onPressed:()=>Navigator.pop(context),child:const Text('取消')),if(author!=null)TextButton(onPressed:()=>Navigator.pop(context,'edit'),child:const Text('编辑当前世界')),FilledButton(onPressed:selected==null?null:()=>Navigator.pop(context,'apply'),child:const Text('采用版本并建立分支'))])));
    if(!mounted||choice==null)return;
    if(choice=='edit'&&author!=null){_edit(PortalWorldVersion(draft:PortalWorldDraft.fromJson(author),version:1,savedAt:DateTime.now()));return;}
    if(choice!='apply'||selected==null)return;
    if(c.current?.id!=view.id||c.current?.branchId!=view.branchId||c.current?.revision!=view.revision||c.blocked){_notice('故事已变化，请重新选择要采用的版本。');return;}
    final version=selected!;
    await c.forkChange(view.revision,'世界设定 · ${version.draft.title} v${version.version}',{'world_version':{'id':version.draft.id,'version':version.version,'title':version.draft.title,'public_seed':version.draft.toPublicSeed()},'author_world':_authorPayload(version.draft)});
    final updated=c.current;
    if(updated==null||updated.id!=view.id||updated.branchId==view.branchId||c.unknown||c.error!=null)return;
    await _loadWorldLinks();_notice('已在新分支采用所选世界版本。');
  }
  Future<void> _open(ExperienceSummary item) async {
    final epoch=++_navigationEpoch;
    await c.open(item.id, branch: item.activeBranchId);
    if (mounted && epoch==_navigationEpoch && c.current?.id == item.id) _go(_PortalPage.reader);
  }
  void _openWorld(DemoWorldPreset world, {bool history = true,bool resumeDemo=false,String? resumeDemoSessionId}) { _world = world; _customWorld = null;_resumeDemo=resumeDemo;_resumeDemoSessionId=resumeDemoSessionId; _go(_PortalPage.detail, history: history); }
  Future<void> _openDemo(String id,{bool history=true})async{
    final epoch=++_navigationEpoch;
    final entry=await _demoRepository.entry(id);
    if(!mounted||epoch!=_navigationEpoch)return;
    if(entry==null){_notice('未找到这段演示经历。');return;}
    _activeDemo=entry;
    _go(_PortalPage.demo,history:history);
    unawaited(_loadLocal());
  }
  void _openCustom(PortalWorldVersion world, {bool history = true}) { _world = null; _customWorld = world;_resumeDemo=false;_resumeDemoSessionId=null; _go(_PortalPage.detail, history: history); }
  ExperienceSummary? get _previous {
    final worldId=_world?.id??_customWorld?.draft.id;
    final title = _world?.title ?? _customWorld?.draft.title;
    if(worldId==null||title==null)return null;
    return _recent.where((story){
      final link=_worldLinks[story.id];
      if(link is Map){
        final branches=link['branches'];
        final branch=branches is Map?branches[story.activeBranchId]:null;
        final snapshot=branch is Map&&branch['snapshot'] is Map?branch['snapshot']:link['snapshot'];
        if(snapshot is Map&&snapshot['id'] is String)return snapshot['id']==worldId;
      }
      // Only pre-binding built-in stories need legacy title compatibility.
      // Custom worlds can share a title and must use their immutable ID.
      return _customWorld==null&&story.seed.split('\n').any((line)=>line.trim()=='世界名称：$title'||line.trim()=='世界：$title');
    }).firstOrNull;
  }
  Future<void> _exportAll() async {
    final journal = c.journal;
    final server = await _service.exportRecords();
    final local = journal is LocalExperienceJournal ? await journal.exportWorkspace(c.session.backendUrl, c.session.workspaceId) : <String,dynamic>{};
    await savePortalFile('elselife-backup-${DateTime.now().toIso8601String().substring(0,10)}.json', jsonEncode({'format':'elselife-backup','version':1,'server':server,'local':local}));
  }
  Future<void> _importAll() async {
    final raw = await pickPortalBackup(); if (raw == null || !mounted) return;
    final data = object(jsonDecode(raw));
    if (data['format'] != 'elselife-backup' || data['version'] != 1 || data['server'] is! Map || data['local'] is! Map) throw const FormatException('不支持的备份');
    LocalExperienceJournal.validateWorkspaceBackup(object(data['local']));
    final stories=(object(data['server'])['experiences'] as List? ?? []);
    final branchCount=stories.whereType<Map>().fold<int>(0,(count,story)=>count+(story['branches'] is List?(story['branches'] as List).length:0));
    final local=object(data['local']);
    final catalog=local['["world-studio","catalog"]'];
    final versions=catalog is Map && catalog['versions'] is List ? catalog['versions'] as List : [];
    final worlds=versions.whereType<Map>().map((v)=>(v['snapshot'] as Map?)?['id']).whereType<String>().toSet().length;
    final confirmed = await showDialog<bool>(context: context, builder: (context) => AlertDialog(title: const Text('导入记录'),
      content: Text('备份包含 ${stories.length} 段故事、$branchCount 个分支、$worlds 个世界及 ${local.length} 项本机记录。\n\n新增备份中的记录，已有记录保留。'), actions: [TextButton(onPressed: () => Navigator.pop(context,false), child: const Text('取消')),
      FilledButton(onPressed: () => Navigator.pop(context,true), child: const Text('导入'))]));
    if (confirmed != true) return;
    final result=await _service.importRecords(object(data['server']));
    final journal = c.journal;
    try {
      if (journal is LocalExperienceJournal) await journal.importWorkspace(c.session.backendUrl,c.session.workspaceId,local);
    } catch (_) { throw StateError('故事记录已导入，本机世界或阅读标记保存失败。请再次导入同一备份重试，已有故事不会重复新增。'); }
    await _preferences.hydrate(); await c.refreshShelf(); await _loadLocal();
    _notice('已导入 ${(result['imported'] as List?)?.length ?? 0} 段故事；保留 ${(result['skipped'] as List?)?.length ?? 0} 段已有故事。');
  }
  Future<void> _clearDemo() async {
    await _demoRepository.trashAll();
    final row = await c.journal.read(_libraryScope);
    final personal = row['personal'] is Map ? Map<String,dynamic>.from(row['personal']) : <String,dynamic>{};
    for (final entry in personal.entries) {
      if (entry.value is Map && entry.value['demo'] == true) personal[entry.key] = {...Map<String,dynamic>.from(entry.value), 'trashed_at':DateTime.now().millisecondsSinceEpoch};
    }
    await c.journal.patch(_libraryScope, {'personal':personal}); await _loadLocal();
  }
  @override Widget build(BuildContext context) {
    switch (_page) {
      case _PortalPage.home:
        return Scaffold(body: SafeArea(child: PortalHome(onExplore: () => _go(_PortalPage.discover), onCreate: _create, onOpenShelf: () => _go(_PortalPage.shelf), onOpenWorld: _openWorld,
          onSettings: () => _go(_PortalPage.settings), journal:c.journal, backendUrl:c.session.backendUrl,workspaceId:c.session.workspaceId,
          themeMode:_theme,onThemeChanged:(v) => unawaited(_preferences.setValue('theme',v.name)),reduceMotion:_preferences.reducedMotion, modelAvailable:_modelAvailable,
          customWorlds:_worlds,onOpenCustomWorld:_openCustom, recentTitle:_recentEntries.firstOrNull?.title,
          recentContext:_recentEntries.firstOrNull?.detail,
          recentExcerpt:_recentEntries.firstOrNull?.excerpt, onResume:_recentEntries.firstOrNull?.onOpen,
          recentWorlds:[for(final item in _recentEntries.take(5)) (title:item.title,detail:item.detail,onOpen:item.onOpen)],
        )));
      case _PortalPage.create:
      case _PortalPage.reader:
        return ExperienceScreen(controller:c,artifactClient:widget.artifactClient,preferences:_preferences,authorWorld:_authorWorld,onRewriteWorld:()=>unawaited(_rewriteWorld()),onAssist:_service.assist,onCancelAssist:_service.cancelAssistance,onPreferences:() => _go(_PortalPage.settings),onPortalHome:() => _go(_PortalPage.home),onPortalDiscover:() => _go(_PortalPage.discover),onPortalShelf:() => _go(_PortalPage.shelf));
      case _PortalPage.demo:
        final entry=_activeDemo!;
        final preset=demoWorldPresets.where((w)=>w.id==entry.worldId).firstOrNull;
        final opening=entry.readonlyOpening?['opening'] as String? ?? (preset==null?'':portalDraftFromPreset(preset).opening);
        return PortalDemoReader(key:ValueKey(entry.id),repository:_demoRepository,sessionId:entry.id,opening:opening,preferences:_preferences,authorWorld:entry.readOnly?entry.readonlyOpening:(preset==null?null:portalDraftFromPreset(preset).toJson()),onHome:()=>_go(_PortalPage.home),onDiscover:()=>_go(_PortalPage.home),onShelf:()=>_go(_PortalPage.shelf),onPreferences:()=>_go(_PortalPage.settings),onChanged:()=>unawaited(_loadLocal()));
      case _PortalPage.studio:
        return _interior(scrollable:false,child:PortalWorldStudio(key:ValueKey(_editVersion?.draft.id),backendUrl:c.session.backendUrl,workspaceId:c.session.workspaceId,journal:c.journal,
          initialVersion:_editVersion,narrativeDefaults:_preferences.values,modelAvailable:_modelAvailable,onGenerateDraft:_service.generate,onCancelGeneration:_service.cancelGeneration,onSavedWorld:(version) { unawaited(_loadLocal()); _openCustom(version); },onStart:_startSeed,onStartWorld:_startWorld,onBack:() => _go(_PortalPage.home)));
      case _PortalPage.discover:
        return _interior(scrollable:false,child:PortalDiscover(onOpenWorld:_openWorld,onCreate:_create,journal:c.journal,backendUrl:c.session.backendUrl,workspaceId:c.session.workspaceId,customWorlds:_worlds,onOpenCustomWorld:_openCustom));
      case _PortalPage.detail:
        return _interior(scrollable:false,child:_customWorld == null ? PortalWorldDetail(key:ValueKey('${_world!.id}:$_resumeDemo:$_resumeDemoSessionId'),world:_world!,modelAvailable:_modelAvailable,modelChecked:_modelChecked,selfScrolling:true,demoJournal:c.journal,demoScope:experienceScope(c.session.backendUrl,c.session.workspaceId,'portal-demo',_world!.id),autoResumeDemo:_resumeDemo,resumeDemoSessionId:_resumeDemoSessionId,onDemoOpened:(id)=>unawaited(_openDemo(id)),onDemoChanged:()=>unawaited(_loadLocal()),onSettings:()=>_go(_PortalPage.settings),onBack:() => _go(_PortalPage.discover),onStart:_startSelectedWorld,starting:_starting,previous:_previous,onResume:(s) => unawaited(_open(s)),onEditWorld:_edit,onCopyWorld:_copy,narrativeDefaults:_preferences.values)
          : PortalWorldDetail.custom(customVersion:_customWorld!,modelAvailable:_modelAvailable,modelChecked:_modelChecked,selfScrolling:true,demoJournal:c.journal,demoScope:experienceScope(c.session.backendUrl,c.session.workspaceId,'portal-demo',_customWorld!.draft.id),onDemoOpened:(id)=>unawaited(_openDemo(id)),onDemoChanged:()=>unawaited(_loadLocal()),onSettings:()=>_go(_PortalPage.settings),onBack:() => _go(_PortalPage.discover),onStart:_startSelectedWorld,starting:_starting,previous:_previous,onResume:(s) => unawaited(_open(s)),onEditWorld:_edit,onCopyWorld:_copy,narrativeDefaults:_preferences.values));
      case _PortalPage.shelf:
        return _interior(child:PortalLibrary(controller:c,onOpen:(s) => unawaited(_open(s)),onCreate:_create,onExplore:() => _go(_PortalPage.discover),
          onOpenWorldVersion:_openCustom,onEditWorldVersion:_edit,onDeletePermanently:_deleteStory,onImportRecords:_importAll,onOpenDemo:_openDemo,onDemoChanged:()=>unawaited(_loadLocal())));
      case _PortalPage.settings:
        return _interior(child:PortalSettings(preferences:_preferences,initialSection:_settingsSection,onSectionChanged:(section)=>_settingsSection=section,eventCount:_events.length,checkModel:_checkModel,exportAll:_exportAll,importAll:_importAll,clearDemo:_clearDemo,
          exportEvents:() => savePortalFile('elselife-events.json',jsonEncode(_events)),onContentPreferences:widget.onPreferences));
    }
  }
  Widget _interior({required Widget child, bool scrollable=true}) {
    final width=MediaQuery.sizeOf(context).width;
    final narrow=width<=800;
    final gutter=width<=360?16.0:width<=700?20.0:width<=1000?28.0:40.0;
    final settings=_page==_PortalPage.settings;
    final top=settings?(width<=600?29.0:narrow?36.0:56.0):(width<=700?30.0:width<=1000?40.0:52.0);
    final bottom=settings?(width<=600?38.0:narrow?48.0:80.0):(width<=700?58.0:width<=1000?72.0:90.0);
    return Scaffold(body:SafeArea(child:Column(children:[
      _navigation(),
      Expanded(child:scrollable ? SingleChildScrollView(child:Center(child:ConstrainedBox(constraints:BoxConstraints(maxWidth:settings?1120:1220),child:Padding(padding:EdgeInsets.fromLTRB(gutter,top,gutter,bottom),child:Material(type:MaterialType.transparency,child:child))))) : Material(type:MaterialType.transparency,child:child)),
      if(narrow) _navigation(bottom:true),
    ])));
  }
  Widget _navigation({bool bottom=false}) => PortalNavigation(
    bottom: bottom,
    section: switch (_page) {
      _PortalPage.shelf => PortalSection.shelf,
      _PortalPage.studio => PortalSection.studio,
      _PortalPage.settings => PortalSection.settings,
      _ => PortalSection.discover,
    },
    onHome: () => _go(_PortalPage.home), onDiscover: () => _go(_PortalPage.home),
    onShelf: () => _go(_PortalPage.shelf), onCreate: _create,
    onSettings: () => _go(_PortalPage.settings),
    themeMode: _theme, onThemeChanged: (v) => unawaited(_preferences.setValue('theme',v.name)),
    recentWorlds: [for(final item in _recentEntries.take(5)) (title:item.title,detail:item.detail,onOpen:item.onOpen)],
  );
}
