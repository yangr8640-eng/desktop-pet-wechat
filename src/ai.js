const { store, getActiveModelProvider, getModelProviders } = require('./store');
const { getTheme } = require('../themes');

let activeStreamController = null;

function cancelActiveStream() {
  if (activeStreamController) {
    activeStreamController.abort();
    activeStreamController = null;
  }
}

async function callAI(messages) {
  const provider = getActiveModelProvider();
  if (!provider.apiKey) {
    return `你还没设置${provider.name}的API Key哦！请在聊天窗口的设置里输入API Key~`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const resp = await fetch(provider.apiBaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: provider.modelName,
        messages,
        temperature: 0.8,
        max_tokens: 2000
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`API错误(${resp.status}): ${errText}`);
    }

    const data = await resp.json();
    return data.choices[0].message.content;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return '请求超时，请稍后重试';
    }
    throw err;
  }
}

async function validateModelApiKey(providerId) {
  const id = providerId || store.get('activeModelProviderId') || 'deepseek';
  const providers = getModelProviders();
  const provider = providers.find(p => p.id === id);
  if (!provider || !provider.apiKey || !provider.apiKey.trim()) {
    return { valid: false, reason: 'no-key' };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(provider.apiBaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: provider.modelName,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (resp.ok || resp.status === 429) {
      return { valid: true };
    }
    if (resp.status === 401 || resp.status === 403) {
      return { valid: false, reason: 'invalid-key' };
    }
    return { valid: true };
  } catch {
    return { valid: true, reason: 'network-error' };
  }
}

async function generateConversationTitle(userMessage, aiResponse) {
  const summaryPrompt = [
    { role: 'system', content: '你是一个标题生成器。根据对话内容生成一个简短的标题（10个字以内，不要引号，不要句号）。只输出标题本身，不要任何其他文字。' },
    { role: 'user', content: `用户: ${userMessage.slice(0, 200)}\n\nAI: ${aiResponse.slice(0, 200)}\n\n请为以上对话生成一个简短标题。` }
  ];
  try {
    return await callAI(summaryPrompt);
  } catch {
    return null;
  }
}

function buildSystemPrompt(searchContext) {
  const now = new Date();
  const todayStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
  const theme = getTheme(store.get('activeTheme') || 'claude');

  let content = `今天是${todayStr}。

你叫"${theme.name}"，是一个可爱的桌面宠物。你的性格：
${theme.personality}`;

  if (searchContext) {
    content += searchContext;
  }

  const personality = store.get('personalityPrompt');
  if (personality) {
    content += `\n\n【用户偏好】\n${personality}`;
  }

  return {
    role: 'system',
    content
  };
}

async function callAIStream(messages, onChunk, onDone, onError) {
  const provider = getActiveModelProvider();
  if (!provider.apiKey) {
    onError(`你还没设置${provider.name}的API Key哦！`);
    return;
  }

  cancelActiveStream();
  activeStreamController = new AbortController();
  const controller = activeStreamController;
  let aborted = false;
  controller.signal.addEventListener('abort', () => { aborted = true; });

  let resp;
  try {
    resp = await fetch(provider.apiBaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: provider.modelName,
        messages,
        temperature: 0.8,
        max_tokens: 2000,
        stream: true
      }),
      signal: controller.signal
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      if (activeStreamController === controller) activeStreamController = null;
      return;
    }
    onError(`网络错误: ${err.message}`);
    if (activeStreamController === controller) activeStreamController = null;
    return;
  }

  if (!resp.ok) {
    try {
      const errText = await resp.text();
      onError(`API错误(${resp.status}): ${errText}`);
    } catch {
      onError(`API错误(${resp.status})`);
    }
    if (activeStreamController === controller) activeStreamController = null;
    return;
  }

  try {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (aborted) {
          if (activeStreamController === controller) activeStreamController = null;
          return;
        }
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.delta?.content;
          if (content) {
            fullContent += content;
            onChunk(content, fullContent);
          }
        } catch { /* skip unparseable lines */ }
      }
    }

    if (fullContent) {
      onDone(fullContent);
    } else {
      onError('AI没有返回任何内容');
    }
  } catch (err) {
    if (err.name === 'AbortError' || aborted) {
      if (activeStreamController === controller) activeStreamController = null;
      return;
    }
    onError(`读取响应时出错: ${err.message}`);
  }

  if (activeStreamController === controller) activeStreamController = null;
}

// Promise-based wrapper for callAIStream
function callAIStreamAsync(messages, onChunk) {
  return new Promise((resolve, reject) => {
    callAIStream(messages, onChunk, resolve, reject);
  });
}

// Streaming with automatic retry (exponential backoff)
async function callAIStreamWithRetry(messages, onChunk, onDone, onError, maxRetries) {
  if (maxRetries === undefined) maxRetries = 2;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Don't retry if the stream was manually cancelled
    if (activeStreamController && activeStreamController.signal.aborted) return;

    if (attempt > 0) {
      const delay = Math.pow(2, attempt - 1) * 1000;
      await new Promise(r => setTimeout(r, delay));
    }

    try {
      const fullContent = await callAIStreamAsync(messages, onChunk);
      onDone(fullContent);
      return;
    } catch (err) {
      lastError = err;
      if (activeStreamController && activeStreamController.signal.aborted) return;
    }
  }

  onError(`重试${maxRetries}次后仍然失败: ${lastError}`);
}

// ─── AI with Tools (Function Calling) ───

// Parse streaming tool_call deltas from SSE chunks.
// OpenAI-compatible APIs emit tool_calls as delta fragments;
// we accumulate them per index and emit onEvent('tool_calls', ...)
// when arguments for an index complete.
function callAIWithTools(messages, tools, onEvent) {
  return new Promise((resolve, reject) => {
    const provider = getActiveModelProvider();
    if (!provider.apiKey) {
      const msg = `你还没设置${provider.name}的API Key哦！`;
      if (onEvent) onEvent({ type: 'error', message: msg });
      reject(new Error(msg));
      return;
    }

    cancelActiveStream();
    activeStreamController = new AbortController();
    const controller = activeStreamController;
    let aborted = false;
    controller.signal.addEventListener('abort', () => { aborted = true; });

    const toolDefs = tools.map(t => ({
      type: 'function',
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters
      }
    }));

    (async () => {
      let resp;
      try {
        resp = await fetch(provider.apiBaseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.apiKey}`
          },
          body: JSON.stringify({
            model: provider.modelName,
            messages,
            tools: toolDefs,
            temperature: 0.7,
            max_tokens: 4096,
            stream: true
          }),
          signal: controller.signal
        });
      } catch (err) {
        if (err.name === 'AbortError') {
          if (activeStreamController === controller) activeStreamController = null;
          resolve({ content: null, toolCalls: null, aborted: true });
          return;
        }
        const msg = `网络错误: ${err.message}`;
        if (onEvent) onEvent({ type: 'error', message: msg });
        if (activeStreamController === controller) activeStreamController = null;
        reject(new Error(msg));
        return;
      }

      if (!resp.ok) {
        try {
          const errText = await resp.text();
          const msg = `API错误(${resp.status}): ${errText}`;
          if (onEvent) onEvent({ type: 'error', message: msg });
          reject(new Error(msg));
        } catch {
          const msg = `API错误(${resp.status})`;
          if (onEvent) onEvent({ type: 'error', message: msg });
          reject(new Error(msg));
        }
        if (activeStreamController === controller) activeStreamController = null;
        return;
      }

      try {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';
        const toolCallAccum = {}; // { index: { id, name, arguments } }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            if (aborted) {
              if (activeStreamController === controller) activeStreamController = null;
              resolve({ content: null, toolCalls: null, aborted: true });
              return;
            }
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            if (data === '[DONE]') continue;

            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta;
              if (!delta) continue;

              // Regular text content
              const content = delta.content;
              if (content) {
                fullContent += content;
                if (onEvent) onEvent({ type: 'chunk', text: content, fullText: fullContent });
              }

              // Tool calls in delta
              const toolCalls = delta.tool_calls;
              if (toolCalls) {
                for (const tc of toolCalls) {
                  const idx = tc.index != null ? tc.index : 0;
                  if (!toolCallAccum[idx]) {
                    toolCallAccum[idx] = { id: '', name: '', arguments: '' };
                  }
                  if (tc.id) toolCallAccum[idx].id = tc.id;
                  if (tc.function) {
                    if (tc.function.name) toolCallAccum[idx].name += tc.function.name;
                    if (tc.function.arguments) toolCallAccum[idx].arguments += tc.function.arguments;
                  }
                }
              }
            } catch { /* skip unparseable lines */ }
          }
        }

        // Build final tool calls list
        const toolCallsList = Object.values(toolCallAccum).filter(tc => tc.name);
        const hasToolCalls = toolCallsList.length > 0;

        if (hasToolCalls && onEvent) {
          onEvent({ type: 'tool_calls', toolCalls: toolCallsList });
        }
        if (onEvent) onEvent({ type: 'done', fullText: fullContent, toolCalls: toolCallsList });

        resolve({
          content: fullContent || null,
          toolCalls: hasToolCalls ? toolCallsList : null,
          aborted: false
        });
      } catch (err) {
        if (err.name === 'AbortError' || aborted) {
          if (activeStreamController === controller) activeStreamController = null;
          resolve({ content: null, toolCalls: null, aborted: true });
          return;
        }
        const msg = `读取响应时出错: ${err.message}`;
        if (onEvent) onEvent({ type: 'error', message: msg });
        reject(new Error(msg));
      }

      if (activeStreamController === controller) activeStreamController = null;
    })();
  });
}

// Non-streaming helper: accumulate all chunks, return final result
async function callAIWithToolsSync(messages, tools) {
  let fullText = '';
  let toolCalls = null;

  const result = await callAIWithTools(messages, tools, (event) => {
    if (event.type === 'chunk') {
      fullText = event.fullText;
    } else if (event.type === 'tool_calls') {
      toolCalls = event.toolCalls;
    }
  });

  return { content: result.content, toolCalls: result.toolCalls || toolCalls, aborted: result.aborted };
}

module.exports = { callAI, callAIStream, callAIStreamWithRetry, cancelActiveStream, validateModelApiKey, generateConversationTitle, buildSystemPrompt, callAIWithTools, callAIWithToolsSync };
