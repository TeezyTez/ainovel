import 'experience_models.dart';
import '../portal/portal_service_client.dart';
import 'reader_artifact_repository.dart';

/// A fixed link saved when the following formal page was committed.
class ReaderInteractionSnapshot {
  ReaderInteractionSnapshot(Json value)
    : originBranchId = string(value, 'origin_branch_id'),
      artifactId = string(value, 'artifact_id'),
      revisionId = string(value, 'revision_id'),
      baseRevision = integer(value, 'base_revision'),
      stateRevision = integer(value, 'state_revision'),
      state = object(value['state']) {
    if (artifactId.isEmpty || revisionId.isEmpty || baseRevision < 1)
      throw const FormatException('历史作品引用不完整');
  }
  final String originBranchId, artifactId, revisionId;
  final int baseRevision, stateRevision;
  final Json state;
  Future<PreparedReaderArtifact> read(
    PortalServiceClient client,
    String experienceId,
    String branchId,
  ) async {
    final response = await client.request(
      'GET',
      '/v1/experiences/${Uri.encodeComponent(experienceId)}/artifacts/${Uri.encodeComponent(artifactId)}?branch_id=${Uri.encodeComponent(originBranchId)}&revision_id=${Uri.encodeComponent(revisionId)}',
    );
    final artifact = PreparedReaderArtifact(object(response['artifact']));
    final scope = object(artifact.payload['scope']);
    bool belongs(Json value) =>
        value['worldKey'] == experienceId &&
        value['sessionId'] == experienceId &&
        value['branchId'] == originBranchId &&
        value['baseVersion'] == baseRevision;
    if (artifact.id != artifactId ||
        artifact.revisionId != revisionId ||
        artifact.baseRevision != baseRevision ||
        !belongs(scope) ||
        object(artifact.payload['state'])['version'] != baseRevision ||
        artifact.payload['definition'] is Map &&
            !belongs(object(object(artifact.payload['definition'])['scope'])))
      throw const FormatException('历史作品响应不属于此页保存的版本');
    return artifact;
  }
}
