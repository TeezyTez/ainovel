{{flutter_js}}
{{flutter_build_config}}

// Local releases must not reuse a previous build from Flutter's legacy worker.
// The generated release token changes with the build; unknown query keys bypass
// an already-installed worker's fixed resource map during the transition.
const release = {{flutter_service_worker_version}};
for (const build of _flutter.buildConfig.builds) {
  if (build.mainJsPath) build.mainJsPath += '?release=' + encodeURIComponent(release);
}
_flutter.loader.load();
