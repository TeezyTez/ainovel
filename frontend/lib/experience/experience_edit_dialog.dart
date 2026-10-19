/// Dialog拥有编辑器直到退场卸载，不能在pop future返回时提前dispose。
library;

import 'package:flutter/material.dart';

class ExperienceEditDialog extends StatefulWidget {
  const ExperienceEditDialog({
    super.key,
    required this.title,
    required this.description,
    required this.firstLabel,
    required this.first,
    required this.confirmLabel,
    this.secondLabel,
    this.second = '',
    this.firstReadOnly = false,
  });
  final String title, description, firstLabel, first, confirmLabel, second;
  final String? secondLabel;
  final bool firstReadOnly;
  @override
  State<ExperienceEditDialog> createState() => _ExperienceEditDialogState();
}

class _ExperienceEditDialogState extends State<ExperienceEditDialog> {
  late final TextEditingController _first = TextEditingController(
    text: widget.first,
  );
  late final TextEditingController _second = TextEditingController(
    text: widget.second,
  );
  @override
  void dispose() {
    _first.dispose();
    _second.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.title),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(widget.description),
          TextField(
            controller: _first,
            key: const Key('preference-dimension'),
            readOnly: widget.firstReadOnly,
            decoration: InputDecoration(labelText: widget.firstLabel),
          ),
          if (widget.secondLabel != null)
            TextField(
              controller: _second,
              key: const Key('preference-value'),
              minLines: 2,
              maxLines: 6,
              decoration: InputDecoration(labelText: widget.secondLabel),
            ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('不修改'),
      ),
      FilledButton(
        onPressed: () {
          if (_first.text.trim().isEmpty ||
              _first.value.composing.isValid &&
                  !_first.value.composing.isCollapsed ||
              _second.value.composing.isValid &&
                  !_second.value.composing.isCollapsed) {
            return;
          }
          Navigator.pop(context, {
            'first': _first.text,
            'second': _second.text,
          });
        },
        child: Text(widget.confirmLabel),
      ),
    ],
  );
}
