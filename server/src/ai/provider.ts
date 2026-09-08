/**
 * AI Provider 客户端(OpenAI 兼容 chat/completions)。
 * API Key 只存在于服务端环境变量;向上游转发时才使用,绝不回传给客户端。
 * 错误一律收敛为统一的 ProviderError,避免向上游错误细节泄露内部配置。
 */

export class ProviderError extends Error {
  constructor(
    public code: 'AI_TIMEOUT' | 'AI_PROVIDER_ERROR',
    message: string,
  ) {
    super(message)
  }
}

export interface ChatParams {
  baseUrl: string
  apiKey: string
  model: string
  system: string
  user: string
  temperature?: number
  timeoutMs: number
}

interface ChatChoiceMessage {
  content?: string | null
}

interface ChatCompletionResponse {
  choices?: { message?: ChatChoiceMessage }[]
  error?: { message?: string }
}

export async function chatCompletion(p: ChatParams): Promise<{ content: string; model: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), p.timeoutMs)
  let res: Response
  try {
    res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
      body: JSON.stringify({
        model: p.model,
        messages: [
          { role: 'system', content: p.system },
          { role: 'user', content: p.user },
        ],
        temperature: p.temperature ?? 0.4,
      }),
      signal: controller.signal,
    })
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new ProviderError('AI_TIMEOUT', 'AI 服务响应超时')
    }
    throw new ProviderError('AI_PROVIDER_ERROR', 'AI 服务暂时不可用')
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    // 不透传上游错误详情(可能包含 Key 相关信息),只保留状态类别
    throw new ProviderError('AI_PROVIDER_ERROR', `AI 服务返回异常(${res.status})`)
  }
  let json: ChatCompletionResponse
  try {
    json = (await res.json()) as ChatCompletionResponse
  } catch {
    throw new ProviderError('AI_PROVIDER_ERROR', 'AI 服务返回格式异常')
  }
  const content = json.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new ProviderError('AI_PROVIDER_ERROR', 'AI 返回内容为空')
  }
  return { content, model: p.model }
}
