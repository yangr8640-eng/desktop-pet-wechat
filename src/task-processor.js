// task-processor.js — AI Agent loop: receive task → reason → use tools → respond

const { callAIWithToolsSync } = require('./ai');
const { executeTool, getToolDefinitions, logToolCall } = require('./system-tools');
const { buildSystemPrompt } = require('./ai');

const MAX_TOOL_ROUNDS = 10;
const TOTAL_TIMEOUT_MS = 60000;

// ══════════════════════════════════════
// Process a task (user message) through the AI agent loop
// ══════════════════════════════════════

async function processTask(userMessage, options = {}) {
  const {
    onThinking,       // (step) => void         — AI is reasoning
    onToolCall,       // (name, params) => void  — about to execute tool
    onToolResult,     // (name, result) => void   — tool result received
    onResponse,       // (text) => void          — final response chunk
    onError,          // (message) => void       — error occurred
    systemExtra = '', // extra system prompt text
    history = []      // conversation history [{role, content}]
  } = options;

  const timeout = setTimeout(() => {
    if (onError) onError('任务执行超时（60秒）');
  }, TOTAL_TIMEOUT_MS);

  try {
    const tools = getToolDefinitions();

    // Build agent system prompt
    const agentSystemPrompt = buildAgentSystemPrompt();

    const messages = [
      { role: 'system', content: agentSystemPrompt },
      ...history.slice(-20), // Keep recent history
      { role: 'user', content: `${userMessage}\n\n(请使用可用的工具来完成任务，不要询问确认，直接执行。)` }
    ];

    let finalResponse = '';
    let allToolCalls = [];

    // Agent loop
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (onThinking) onThinking(round + 1);

      let result;
      try {
        result = await callAIWithToolsSync(messages, tools);
      } catch (err) {
        clearTimeout(timeout);
        if (onError) onError(`AI调用失败: ${err.message}`);
        return { success: false, error: err.message };
      }

      if (result.aborted) {
        clearTimeout(timeout);
        return { success: false, error: '任务被取消', response: result.content };
      }

      const { content, toolCalls } = result;

      // No tool calls — AI gave final answer
      if (!toolCalls || toolCalls.length === 0) {
        finalResponse = content || '(AI没有返回内容)';
        clearTimeout(timeout);
        if (onResponse) onResponse(finalResponse);
        return {
          success: true,
          response: finalResponse,
          toolCalls: allToolCalls
        };
      }

      // AI wants to call tools
      if (onResponse) onResponse(content || '');

      // Record assistant message (may include tool_calls)
      const assistantMsg = { role: 'assistant', content: content || null };
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls.map(tc => ({
          id: tc.id || `call_${Date.now()}`,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments }
        }));
      }
      messages.push(assistantMsg);

      // Execute each tool call
      for (const tc of toolCalls) {
        let toolParams;
        try {
          toolParams = JSON.parse(tc.arguments || '{}');
        } catch {
          toolParams = {};
        }

        if (onToolCall) onToolCall(tc.name, toolParams);

        let toolResult;
        try {
          toolResult = await executeTool(tc.name, toolParams);
          logToolCall(tc.name, toolParams, toolResult);
        } catch (err) {
          toolResult = `[工具执行错误: ${err.message}]`;
        }

        if (onToolResult) onToolResult(tc.name, toolResult);

        allToolCalls.push({ name: tc.name, params: toolParams, result: toolResult });

        messages.push({
          role: 'tool',
          tool_call_id: tc.id || `call_${Date.now()}`,
          content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
        });
      }
    }

    // Exceeded max rounds
    clearTimeout(timeout);
    const fallbackMsg = '已达到最大工具调用次数，请根据已获取的信息给出最终回复。';
    messages.push({ role: 'user', content: fallbackMsg });

    try {
      const final = await callAIWithToolsSync(messages, []);
      finalResponse = final.content || '(AI无法给出最终回复)';
      if (onResponse) onResponse(finalResponse);
      return { success: true, response: finalResponse, toolCalls: allToolCalls };
    } catch (err) {
      return { success: false, error: err.message, toolCalls: allToolCalls };
    }
  } catch (err) {
    clearTimeout(timeout);
    if (onError) onError(`任务处理异常: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ══════════════════════════════════════
// Build the agent system prompt
// ══════════════════════════════════════

function buildAgentSystemPrompt() {
  const os = require('os');
  const homeDir = os.homedir();
  const platform = process.platform === 'darwin' ? 'macOS' :
                   process.platform === 'win32' ? 'Windows' : 'Linux';
  const hostname = os.hostname();

  return `你是一个桌面宠物AI助手，同时也是用户的电脑管家。你可以通过工具调用来操作电脑。

【系统信息】
- 操作系统: ${platform}
- 主机名: ${hostname}
- 用户主目录: ${homeDir}
- 当前时间: ${new Date().toLocaleString('zh-CN')}

【重要规则】
1. 当用户让你执行电脑操作时，直接使用工具执行，不要询问确认
2. 读写文件操作限制在用户主目录 ${homeDir} 下
3. 执行命令时使用合适的shell语法
4. 执行结果直接汇报给用户，简洁明了
5. 如果某个工具调用失败，尝试其他方式或向用户说明原因
6. 你是通过微信与用户沟通，回复应该简洁友好，适合在聊天界面阅读
7. 使用中文回复

【可用工具】
你可以使用以下工具来完成用户的任务。调用工具时，系统会执行实际操作并返回结果。`;
}

module.exports = { processTask, buildAgentSystemPrompt };
