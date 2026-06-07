// system-tools.js — Tool registry for AI agent (file ops, shell, search)

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const HOME_DIR = os.homedir();

// ─── Tool Registry ───

const tools = {};

function defineTool(name, config) {
  tools[name] = config;
}

async function executeTool(name, params) {
  const tool = tools[name];
  if (!tool) throw new Error(`Unknown tool: ${name}`);

  // Security: validate file paths are within allowed scope
  if (tool.permission !== 'exec' && params.path) {
    const resolved = path.resolve(params.path);
    if (!resolved.startsWith(HOME_DIR)) {
      throw new Error(`Access denied: "${params.path}" is outside home directory`);
    }
  }
  if (params.directory) {
    const resolved = path.resolve(params.directory);
    if (!resolved.startsWith(HOME_DIR)) {
      throw new Error(`Access denied: "${params.directory}" is outside home directory`);
    }
  }

  return await tool.execute(params);
}

function getToolDefinitions() {
  return Object.entries(tools).map(([name, tool]) => ({
    type: 'function',
    function: {
      name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: tool.parameters,
        required: tool.required || []
      }
    }
  }));
}

function getToolNames() {
  return Object.keys(tools);
}

// ═══════════════════════════════════════════
// Tool: read_file
// ═══════════════════════════════════════════
defineTool('read_file', {
  description: '读取文件内容。支持文本文件、PDF、Word文档。',
  permission: 'read',
  parameters: {
    path: { type: 'string', description: '文件的绝对路径' },
    max_length: { type: 'number', description: '最大读取字符数，默认20000' }
  },
  required: ['path'],
  async execute(params) {
    const filePath = path.resolve(params.path);
    const maxLength = params.max_length || 20000;

    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
      return `[错误: 文件不存在或无法读取: ${filePath}]`;
    }

    const ext = path.extname(filePath).toLowerCase();

    try {
      switch (ext) {
        case '.txt':
        case '.md':
        case '.json':
        case '.csv':
        case '.log':
        case '.xml':
        case '.yaml':
        case '.yml':
        case '.js':
        case '.ts':
        case '.jsx':
        case '.tsx':
        case '.py':
        case '.rb':
        case '.go':
        case '.rs':
        case '.java':
        case '.c':
        case '.cpp':
        case '.h':
        case '.sh':
        case '.bash':
        case '.zsh':
        case '.toml':
        case '.ini':
        case '.cfg':
        case '.env':
        case '.html':
        case '.css':
        case '.svg': {
          const content = fs.readFileSync(filePath, 'utf-8');
          if (content.length > maxLength) {
            return content.slice(0, maxLength) + `\n\n[文件过长，已截断，共 ${content.length} 字符]`;
          }
          return content;
        }
        case '.pdf': {
          try {
            const pdfParse = require('pdf-parse');
            const buffer = fs.readFileSync(filePath);
            const data = await pdfParse(buffer);
            const text = data.text || '(PDF内容为空)';
            if (text.length > maxLength) {
              return text.slice(0, maxLength) + '\n\n[PDF过长，已截断]';
            }
            return text;
          } catch {
            return '[错误: 无法解析PDF文件，请确认pdf-parse已安装]';
          }
        }
        case '.docx': {
          try {
            const mammoth = require('mammoth');
            const result = await mammoth.extractRawText({ path: filePath });
            const text = result.value || '(文档内容为空)';
            if (text.length > maxLength) {
              return text.slice(0, maxLength) + '\n\n[文档过长，已截断]';
            }
            return text;
          } catch {
            return '[错误: 无法解析docx文件，请确认mammoth已安装]';
          }
        }
        default:
          return `[不支持的文件格式: ${ext}]`;
      }
    } catch (err) {
      return `[读取文件失败: ${err.message}]`;
    }
  }
});

// ═══════════════════════════════════════════
// Tool: write_file
// ═══════════════════════════════════════════
defineTool('write_file', {
  description: '写入或创建文件。会覆盖已存在的文件。',
  permission: 'write',
  parameters: {
    path: { type: 'string', description: '文件的绝对路径' },
    content: { type: 'string', description: '要写入的文件内容' }
  },
  required: ['path', 'content'],
  async execute(params) {
    const filePath = path.resolve(params.path);

    // Ensure parent directory exists
    const dir = path.dirname(filePath);
    try {
      await fs.promises.mkdir(dir, { recursive: true });
    } catch (err) {
      return `[错误: 无法创建目录 ${dir}: ${err.message}]`;
    }

    try {
      fs.writeFileSync(filePath, params.content, 'utf-8');
      const stat = fs.statSync(filePath);
      return `[成功] 文件已写入: ${filePath} (${stat.size} 字节)`;
    } catch (err) {
      return `[错误: 写入文件失败: ${err.message}]`;
    }
  }
});

// ═══════════════════════════════════════════
// Tool: list_directory
// ═══════════════════════════════════════════
defineTool('list_directory', {
  description: '列出目录中的文件和子目录',
  permission: 'read',
  parameters: {
    directory: { type: 'string', description: '目录的绝对路径，默认用户主目录' }
  },
  required: [],
  async execute(params) {
    const dirPath = path.resolve(params.directory || HOME_DIR);

    try {
      await fs.promises.access(dirPath, fs.constants.R_OK);
    } catch {
      return `[错误: 目录不存在或无法读取: ${dirPath}]`;
    }

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const items = entries.slice(0, 200).map(entry => {
        const fullPath = path.join(dirPath, entry.name);
        let type = entry.isDirectory() ? '📁' : '📄';
        let size = '';
        try {
          if (!entry.isDirectory()) {
            const stat = fs.statSync(fullPath);
            size = formatSize(stat.size);
          }
        } catch { /* skip */ }
        return `${type} ${entry.name}${size ? ' (' + size + ')' : ''}`;
      });

      const header = `📂 ${dirPath} (${entries.length} 个项目)\n`;
      if (entries.length > 200) {
        items.push(`... 还有 ${entries.length - 200} 个项目未显示`);
      }
      return header + items.join('\n');
    } catch (err) {
      return `[错误: 列出目录失败: ${err.message}]`;
    }
  }
});

// ═══════════════════════════════════════════
// Tool: get_file_info
// ═══════════════════════════════════════════
defineTool('get_file_info', {
  description: '获取文件的元信息（大小、修改时间、类型等）',
  permission: 'read',
  parameters: {
    path: { type: 'string', description: '文件的绝对路径' }
  },
  required: ['path'],
  async execute(params) {
    const filePath = path.resolve(params.path);

    try {
      const stat = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      return [
        `文件: ${path.basename(filePath)}`,
        `路径: ${filePath}`,
        `大小: ${formatSize(stat.size)}`,
        `类型: ${ext || '(无扩展名)'}`,
        `创建时间: ${stat.birthtime.toISOString()}`,
        `修改时间: ${stat.mtime.toISOString()}`,
        `是否为目录: ${stat.isDirectory() ? '是' : '否'}`,
        `是否为文件: ${stat.isFile() ? '是' : '否'}`
      ].join('\n');
    } catch (err) {
      return `[错误: 获取文件信息失败: ${err.message}]`;
    }
  }
});

// ═══════════════════════════════════════════
// Tool: run_command
// ═══════════════════════════════════════════
defineTool('run_command', {
  description: '在终端执行 shell 命令并返回输出。可用于运行脚本、安装软件、管理系统等。',
  permission: 'exec',
  parameters: {
    command: { type: 'string', description: '要执行的命令（如: ls -la, cat file.txt）' },
    cwd: { type: 'string', description: '工作目录，默认用户主目录' },
    timeout: { type: 'number', description: '超时时间（秒），默认30秒，最大120秒' }
  },
  required: ['command'],
  async execute(params) {
    const cwd = params.cwd ? path.resolve(params.cwd) : HOME_DIR;
    const timeoutSec = Math.min(params.timeout || 30, 120);

    // Parse command into program + args
    const parts = parseShellCommand(params.command);
    if (!parts) {
      return '[错误: 无法解析命令]';
    }

    return new Promise((resolve) => {
      const child = execFile(parts.program, parts.args, {
        cwd,
        timeout: timeoutSec * 1000,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
        env: { ...process.env, HOME: HOME_DIR }
      }, (error, stdout, stderr) => {
        if (error) {
          if (error.killed) {
            resolve(`[错误: 命令执行超时 (${timeoutSec}秒)]\n\n标准输出:\n${stdout || '(无)'}\n\n标准错误:\n${stderr || '(无)'}`);
          } else {
            resolve(`[命令退出码: ${error.code}]\n\n标准输出:\n${stdout || '(无)'}\n\n标准错误:\n${stderr || '(无)'}`);
          }
        } else {
          const out = stdout || '(无输出)';
          if (out.length > 5000) {
            resolve(out.slice(0, 5000) + `\n\n[输出过长已截断，共 ${out.length} 字符]`);
          } else {
            resolve(out);
          }
        }
      });
    });
  }
});

// ═══════════════════════════════════════════
// Tool: web_search (delegates to existing search module)
// ═══════════════════════════════════════════
defineTool('web_search', {
  description: '联网搜索最新信息。用于查询实时数据、新闻、文档等。',
  permission: 'read',
  parameters: {
    query: { type: 'string', description: '搜索关键词' }
  },
  required: ['query'],
  async execute(params) {
    try {
      const { performWebSearch, formatSearchContext } = require('./search');
      const results = await performWebSearch(params.query);
      if (!results || results.length === 0) {
        return '未找到相关搜索结果。';
      }
      return formatSearchContext(params.query, results);
    } catch (err) {
      return `[搜索失败: ${err.message}]`;
    }
  }
});

// ─── Helpers ───

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function parseShellCommand(cmd) {
  const trimmed = cmd.trim();
  if (!trimmed) return null;

  // On Windows, handle cmd.exe builtins by wrapping
  if (process.platform === 'win32') {
    return { program: 'cmd.exe', args: ['/c', trimmed] };
  }

  // On Unix, use bash to handle pipes, redirects, etc.
  return { program: '/bin/bash', args: ['-c', trimmed] };
}

// ─── Agent log ───

const LOG_PATH = path.join(HOME_DIR, '.desktop-pet', 'agent-log.jsonl');

function logToolCall(toolName, params, result) {
  try {
    const dir = path.dirname(LOG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      tool: toolName,
      params: sanitizeParams(params),
      resultPreview: typeof result === 'string' ? result.slice(0, 200) : result
    });
    fs.appendFileSync(LOG_PATH, entry + '\n', 'utf-8');
  } catch { /* silent */ }
}

function sanitizeParams(params) {
  const safe = { ...params };
  if (safe.content && safe.content.length > 200) {
    safe.content = safe.content.slice(0, 200) + '...';
  }
  return safe;
}

function getAgentLog(limit = 50) {
  try {
    if (!fs.existsSync(LOG_PATH)) return [];
    const lines = fs.readFileSync(LOG_PATH, 'utf-8').trim().split('\n');
    return lines.slice(-limit).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

// ─── Exports ───

module.exports = {
  defineTool,
  executeTool,
  getToolDefinitions,
  getToolNames,
  logToolCall,
  getAgentLog,
  HOME_DIR
};
