// core/chat-core.mjs
// OpenAI v5 스트리밍 공용 래퍼
// 사용처에서 OpenAI client, model, messages를 넘겨주고
// onStart/onDelta/onDone 콜백으로 UI 업데이트를 연결해 사용.

export async function streamChat({
  client,
  model,
  messages,
  onStart,    // () => void
  onDelta,    // (chunk: string) => void
  onDone      // (full: string) => void
}) {
  if (!client) throw new Error('streamChat: OpenAI client is required');
  if (!model) throw new Error('streamChat: model is required');
  if (!Array.isArray(messages)) throw new Error('streamChat: messages must be an array');

  onStart?.();

  let full = '';
  try {
    const stream = await client.chat.completions.create({
      model,
      messages,
      stream: true
    });

    for await (const part of stream) {
      const delta = part?.choices?.[0]?.delta?.content;
      if (delta) {
        full += delta;
        onDelta?.(delta);
      }
    }
  } catch (err) {
    // 호출측에서 에러 표시를 하도록 던짐
    throw err;
  } finally {
    onDone?.(full);
  }
}

