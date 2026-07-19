export interface SseEvent {
  event: string;
  data: string;
}

// Native EventSource only supports GET requests, but our /ask endpoint is a
// POST (it needs a JSON body). This reads the same text/event-stream format
// by hand from a fetch() response instead.
export async function* readSseStream(response: Response): AsyncGenerator<SseEvent> {
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const raw of events) {
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice('event: '.length);
        else if (line.startsWith('data: ')) dataLines.push(line.slice('data: '.length));
      }
      if (dataLines.length > 0) {
        yield { event, data: dataLines.join('\n') };
      }
    }
  }
}
