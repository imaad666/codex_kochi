export function initSse(res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();
}

export function sseWrite(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data ?? {})}\n\n`);
}

export function createSseEmitter(res) {
  return {
    emit(event, data) {
      sseWrite(res, event, data);
    },
  };
}

export function sseEnd(res) {
  res.end();
}
