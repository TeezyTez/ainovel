/// Sanitized v2 recall codes carried by the existing HTTP operation/error DTO.
/// A read failure is not a story outcome and does not authorize retrying a refusal.
library;

String? experienceRecallFailure(String? code) => const {
  'recall_budget_exhausted': '历史读取预算已用尽，无法核实本次生成所需依据',
  'recall_item_capacity': '所需历史资料超出单次读取容量，未用猜测替代',
  'recall_scope_mismatch': '历史资料的工作区、经历或分支范围不符，已停止本次生成',
  'recall_revision_unavailable': '所需历史位置目前不可读取，未改用其他版本',
  'recall_query_incomplete': '历史查询未能完整返回所需资料，未把缺失内容当成新事实',
}[code];
