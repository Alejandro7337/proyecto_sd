export function regionUrl(href, port) {
  const url = new URL(href);
  const codespacesHost = url.hostname.replace(
    /-\d+\.app\.github\.dev$/,
    `-${port}.app.github.dev`
  );
  if (codespacesHost !== url.hostname) {
    url.hostname = codespacesHost;
    url.port = "";
  } else {
    url.port = String(port);
  }
  url.hash = "";
  return url.href;
}
