// Compose healthcheck target. Deliberately does not touch the engine or the
// agents: this reports whether the web server is up, not whether the platform
// is. Folding a downstream check in here would make `web` flap unhealthy for
// reasons that have nothing to do with `web`.
export function GET() {
  return Response.json({ status: 'ok' });
}
