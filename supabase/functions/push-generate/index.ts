// 离线推送·兜底生成执行器（Supabase Edge Function 版）
// 部署：Dashboard → Edge Functions → 新建函数 push-generate → 粘贴本文件 →
//      关闭 JWT 校验（Enforce JWT verification = off，本函数用 cron_secret 自校验）
// 职责：认领预约 → 解密快照 → 原样重放 LLM 请求 → 原始输出写 push_outbox →
//      分条推送（800ms 节奏）→ 标记完成。逻辑与 netlify 版一致。
// 注意：本文件为自包含移植，若改动 lib/llm-provider-adapter 的解析或
//      lib/push-preview-split 的分条规则，需同步更新这里。

type ProviderKind = "openai-compatible" | "anthropic" | "gemini";

// ── 内嵌：Web Push 协议原生实现（RFC8291 aes128gcm + RFC8292 VAPID）──
// npm:web-push 依赖 Node 加密接口，在 Deno Edge 运行时不可靠，这里用 WebCrypto 手写。

function b64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes: Uint8Array): string {
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

const utf8 = (value: string) => new TextEncoder().encode(value);

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm as unknown as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as unknown as BufferSource, info: info as unknown as BufferSource },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

async function encryptWebPushPayload(p256dhB64: string, authB64: string, payload: string): Promise<Uint8Array> {
  const uaPublic = b64urlToBytes(p256dhB64);
  const authSecret = b64urlToBytes(authB64);
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic as unknown as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, ephemeral.privateKey, 256));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));

  const ikm = await hkdf(authSecret, ecdh, concatBytes(utf8("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek as unknown as BufferSource, "AES-GCM", false, ["encrypt"]);
  const plaintext = concatBytes(utf8(payload), new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as unknown as BufferSource },
    aesKey,
    plaintext as unknown as BufferSource,
  ));

  // aes128gcm 头：salt(16) + rs(4, 4096) + idlen(1) + as_public(65)
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concatBytes(header, ciphertext);
}

async function buildVapidAuth(endpoint: string, subject: string, publicKeyB64: string, privateKeyB64: string): Promise<string> {
  const pub = b64urlToBytes(publicKeyB64);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: privateKeyB64,
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
  };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = bytesToB64url(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToB64url(utf8(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  })));
  const signingInput = `${header}.${claims}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    utf8(signingInput) as unknown as BufferSource,
  ));
  return `vapid t=${signingInput}.${bytesToB64url(signature)}, k=${publicKeyB64}`;
}

/** 发送一条 Web Push；返回 HTTP 状态码（201=成功，404/410=订阅失效）。 */
async function sendWebPushRaw(
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  vapid: { publicKey: string; privateKey: string; subject: string },
  ttl: number,
): Promise<number> {
  const body = await encryptWebPushPayload(sub.p256dh, sub.auth, payload);
  const authorization = await buildVapidAuth(sub.endpoint, vapid.subject, vapid.publicKey, vapid.privateKey);
  const response = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: "high",
    },
    body: body as unknown as BodyInit,
  });
  await response.text().catch(() => "");
  return response.status;
}

// ── 内嵌：lib/llm-provider-adapter 的响应文本提取 ──
function stripHallucinatedTimestamps(text: string): string {
  return text
    .replace(/[（(]\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?(?:\s+[^)）]*)?[)）]\s*/g, "")
    .replace(/\(system\s*time\s*[:：][^)]*\)\s*/gi, "");
}

function textFromUnknownContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      const item = part && typeof part === "object" ? part as Record<string, unknown> : {};
      if (typeof item.text === "string") return item.text;
      return "";
    }).filter(Boolean).join("\n");
  }
  return content == null ? "" : String(content);
}

function extractResponseText(providerKind: ProviderKind, data: unknown): string {
  if (providerKind === "anthropic") {
    const blocks = (data as { content?: unknown[] }).content;
    let text = "";
    for (const block of Array.isArray(blocks) ? blocks : []) {
      const item = block as { type?: string; text?: string };
      if (item.type === "text") text += item.text ?? "";
    }
    return stripHallucinatedTimestamps(text);
  }
  if (providerKind === "gemini") {
    const parts = (data as { candidates?: Array<{ content?: { parts?: unknown[] } }> }).candidates?.[0]?.content?.parts || [];
    let text = "";
    for (const part of parts) {
      const item = part as { text?: string; thought?: boolean; functionCall?: unknown };
      if (!item.functionCall && !item.thought) text += item.text ?? "";
    }
    return stripHallucinatedTimestamps(text);
  }
  const d = data as { choices?: Array<{ message?: { content?: unknown }; text?: string }>; output?: { text?: string }; response?: string };
  const messageText = textFromUnknownContent(d.choices?.[0]?.message?.content).trim();
  const text = messageText
    || (typeof d.choices?.[0]?.text === "string" ? d.choices[0].text.trim() : "")
    || (typeof d.output?.text === "string" ? d.output.text.trim() : "")
    || (typeof d.response === "string" ? d.response.trim() : "");
  return stripHallucinatedTimestamps(text);
}

// ── 内嵌：lib/push-preview-split 的弹窗预览分条 ──
const RICH_MEDIA_NAMES = new Set(["红包", "转账", "照片", "位置", "表情包", "引用", "语音", "音乐"]);

function stripStateValues(text: string): string {
  const regex = /\[([^\[\]:：]+)[：:](\d+(?:\.\d+)?)\]/g;
  return text.replace(regex, (m, rawName: string) => {
    const name = rawName.trim();
    if (!name || /^\d+$/.test(name) || RICH_MEDIA_NAMES.has(name)) return m;
    return "";
  });
}

function stripBracketBlock(text: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`\\[${escaped}\\]([\\s\\S]*?)\\[\\/${escaped}\\]`, "g"), "");
}

function humanizeSegment(segment: string): string {
  const marker = segment.match(/^\[([^\][：:]{1,12})[：:]([\s\S]*?)\]$/);
  if (!marker) return segment;
  const kind = marker[1];
  if (/表情包/.test(kind)) return "[表情包]";
  if (/图片|照片|图片描述/.test(kind)) return `发了一张照片: ${marker[2].slice(0, 40)}`;
  if (/语音通话/.test(kind)) return "发起了语音通话";
  if (/视频通话/.test(kind)) return "发起了视频通话";
  if (/语音/.test(kind)) return "[语音]";
  if (/红包/.test(kind)) return "[红包]";
  if (/转账/.test(kind)) return "[转账]";
  if (/位置/.test(kind)) return "[位置]";
  if (/拍一拍|拍了拍/.test(kind)) return "拍了拍你";
  return segment;
}

function splitResponseForPushPreview(rawText: string): string[] {
  let text = stripStateValues(rawText);
  text = stripBracketBlock(text, "状态栏");
  text = stripBracketBlock(text, "内心");
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return text
    .split(/\n\n+/)
    .map(segment => humanizeSegment(segment.trim()))
    .map(segment => segment.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

// ── 内嵌：lib/server/push-job-crypto 的解密（Web Crypto 实现，格式兼容） ──
type EncryptedPayload = { v: 1; iv: string; tag: string; ct: string };

function base64ToBytes(value: string): Uint8Array {
  const raw = atob(value);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function encryptPayload(plain: string, secret: string): Promise<EncryptedPayload> {
  const keyBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${secret}:push-job-v1`));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const combined = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(plain) as unknown as BufferSource,
  ));
  const ct = combined.slice(0, combined.length - 16);
  const tag = combined.slice(combined.length - 16);
  const toB64 = (bytes: Uint8Array) => {
    let raw = "";
    for (const b of bytes) raw += String.fromCharCode(b);
    return btoa(raw);
  };
  return { v: 1, iv: toB64(iv), tag: toB64(tag), ct: toB64(ct) };
}

async function decryptPayload(payload: EncryptedPayload, serviceKey: string): Promise<string> {
  const keyBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${serviceKey}:push-job-v1`));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  const ct = base64ToBytes(payload.ct);
  const tag = base64ToBytes(payload.tag);
  const combined = new Uint8Array(ct.length + tag.length);
  combined.set(ct);
  combined.set(tag, ct.length);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(payload.iv) as unknown as BufferSource },
    key,
    combined as unknown as BufferSource,
  );
  return new TextDecoder().decode(plain);
}

// ── 主流程 ──
type JobRow = { id: string; user_id: string; trigger_key: string; kind: string; payload: EncryptedPayload };
type SubscriptionRow = { endpoint: string; p256dh: string; auth: string };
type JobPayload = {
  request: { url: string; headers: Record<string, string>; body: Record<string, unknown>; providerKind: ProviderKind };
  notify?: { title?: string; url?: string };
  /** 角色绑定的微信 bot：force 用于真实微信快捷动作结果续跑，保证第二轮仍回到微信。 */
  weixin?: { botId?: string; force?: boolean };
  merge?: Record<string, unknown> & { sessionId?: string };
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const DAILY_GENERATION_CAP = 50;

Deno.serve(async (req: Request) => {
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) return new Response("missing env", { status: 200 });

  const { jobId, token } = await req.json().catch(() => ({})) as { jobId?: string; token?: string };
  if (!jobId || !token) return new Response("bad request", { status: 400 });

  const restHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const rest = (path: string, init?: RequestInit) => fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...restHeaders, ...(init?.headers ?? {}) },
  });

  const secretResponse = await rest("push_server_config?id=eq.main&select=cron_secret,payload_key,site_origin&limit=1");
  const secretRows = secretResponse.ok ? await secretResponse.json() as { cron_secret?: string | null; payload_key?: string | null; site_origin?: string | null }[] : [];
  const cronSecret = secretRows[0]?.cron_secret || "";
  const payloadKey = secretRows[0]?.payload_key || "";
  const siteOrigin = secretRows[0]?.site_origin || "";
  if (!cronSecret || String(token) !== cronSecret) {
    return new Response("forbidden", { status: 403 });
  }

  const claim = await rest(`push_jobs?id=eq.${encodeURIComponent(jobId)}&status=eq.pending&kind=in.(followup,reply_bailout,timed_task)`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "running", updated_at: new Date().toISOString() }),
  });
  const claimed = claim.ok ? await claim.json() as JobRow[] : [];
  const job = claimed[0];
  if (!job) return new Response("already claimed", { status: 200 });

  const finish = (status: "done" | "failed", note: string) => rest(`push_jobs?id=eq.${encodeURIComponent(job.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status, result_note: note.slice(0, 300), updated_at: new Date().toISOString() }),
  }).catch(() => undefined);

  // 分段进度：卡死时 result_note 会停在最后完成的一步，精确定位死点
  const startedAt = Date.now();
  const progress = (note: string) => rest(`push_jobs?id=eq.${encodeURIComponent(job.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ result_note: `[${Math.round((Date.now() - startedAt) / 1000)}s] ${note}`.slice(0, 300), updated_at: new Date().toISOString() }),
  }).catch(() => undefined);

  // pg_net 的请求超时只有几秒：必须立即响应，重活放进 waitUntil 后台继续。
  const runJob = async (): Promise<void> => {
  try {
    if (!payloadKey) {
      await finish("failed", "payload_key missing (open push settings once to bootstrap)");
      return;
    }
    const payload = JSON.parse(await decryptPayload(job.payload, payloadKey)) as JobPayload;

    if (subs.length === 0) {
      await finish("done", "no_subscription");
      return;
    }

    // 硬闸：每账号每天最多 50 条服务端兜底生成，超出只存任务记录不烧 token。
    const dayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00Z`;
    const capResponse = await rest(
      `push_outbox?user_id=eq.${encodeURIComponent(job.user_id)}&created_at=gte.${encodeURIComponent(dayStart)}&meta->>pushGenerated=eq.true&select=id&limit=${DAILY_GENERATION_CAP + 1}`,
    );
    const todayRows = capResponse.ok ? await capResponse.json() as unknown[] : [];
    if (todayRows.length >= DAILY_GENERATION_CAP) {
      await finish("done", `daily cap (${DAILY_GENERATION_CAP}) reached`);
      return;
    }

    await progress("llm request started");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300_000);
    let llmResponse: Response;
    try {
      llmResponse = await fetch(payload.request.url, {
        method: "POST",
        headers: payload.request.headers,
        body: JSON.stringify(payload.request.body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!llmResponse.ok) {
      const errorText = await llmResponse.text().catch(() => "");
      await finish("failed", `api ${llmResponse.status}: ${errorText.slice(0, 200)}`);
      return;
    }
    const data = await llmResponse.json();
    let rawText = extractResponseText(payload.request.providerKind, data).trim();
    if (!rawText) {
      await finish("failed", "empty response");
      return;
    }

    // ── 离线来电：复用小手机既有的通话协议，并兼容已经预约的旧任务 ──
    // 仅在回复开头 200 字内识别严格的「我（向某人）发起了语音通话」标签，
    // 普通叙述中的“某人发起了通话”不会误触发。标签从正文剥离，不进聊天记录。
    const callMarkers = [
      /\[我向[^\]\r\n]{1,80}发起了语音通话\]/,
      /【我向[^】\r\n]{1,80}发起了语音通话】/,
      /\[我发起了语音通话\]/,
      /【我发起了语音通话】/,
      /【拨打电话】/,
    ];
    let deliverAsCall = false;
    {
      const head = rawText.slice(0, 200);
      const matched = callMarkers
        .map(pattern => {
          const match = pattern.exec(head);
          return match ? { marker: match[0], index: match.index } : null;
        })
        .filter((item): item is { marker: string; index: number } => item !== null)
        .sort((a, b) => a.index - b.index)[0];
      if (matched) {
        deliverAsCall = true;
        rawText = (rawText.slice(0, matched.index) + rawText.slice(matched.index + matched.marker.length)).trim();
        if (!rawText) rawText = "……";
      }
    }

    await progress(`llm ok, ${rawText.length} chars${deliverAsCall ? ", call" : ""}`);
    const outboxResponse = await rest("push_outbox", {
      method: "POST",
      body: JSON.stringify([{
        id: `out_${crypto.randomUUID()}`,
        user_id: job.user_id,
        job_id: job.id,
        session_id: payload.merge?.sessionId ?? null,
        trigger_key: job.trigger_key,
        raw_text: rawText,
        meta: {
          ...(payload.merge ?? {}),
          pushGenerated: true,
        },
      }]),
    });
    if (!outboxResponse.ok) {
      const detail = await outboxResponse.text().catch(() => "");
      await finish("failed", `outbox write failed: ${detail.slice(0, 180) || outboxResponse.status}`);
      return;
    }
    await progress("outbox written, pushing");

    const vapidResponse = await rest("push_server_config?id=eq.main&select=vapid_public_key,vapid_private_key&limit=1");
    const vapidRows = vapidResponse.ok ? await vapidResponse.json() as { vapid_public_key: string; vapid_private_key: string }[] : [];
    const vapidRow = vapidRows[0];
    let pushed = 0;
    const pushErrors: string[] = [];
    // 安卓壳（FloatShell App）的合成订阅（endpoint 以 shell: 开头）不走 Web Push，
    // 改由 Supabase Realtime 广播送达壳内长连接。
    const webSubs = subs.filter(sub => !sub.endpoint.startsWith("shell:"));
    const hasShellSub = webSubs.length < subs.length;
    const vapid = vapidRow
      ? { publicKey: vapidRow.vapid_public_key, privateKey: vapidRow.vapid_private_key, subject: siteOrigin || "mailto:push@ai-phone.local" }
      : null;
    if (!vapid && webSubs.length > 0) pushErrors.push("no vapid config");
    const title = payload.notify?.title || "小手机";
    const callSessionId = typeof payload.merge?.sessionId === "string" ? payload.merge.sessionId : "";
    // 来电：单条推送（不分段），点开带 ring 参数直达振铃；正文照常进 outbox
    const targetUrl = deliverAsCall && callSessionId
      ? `/?ring=${encodeURIComponent(callSessionId)}&rt=${Date.now()}`
      : (payload.notify?.url || "/");
    let parts = deliverAsCall
      ? ["来电话了…"]
      : splitResponseForPushPreview(rawText).slice(0, 6);
    if (parts.length === 0) parts = ["发来一条消息"];

    for (let index = 0; index < parts.length; index += 1) {
      if (index > 0) await sleep(500);
      const partBody = parts[index].slice(0, 80);
      const message = JSON.stringify({
        type: deliverAsCall ? "incoming_call" : "chat_outbox",
        title: deliverAsCall ? `📞 ${title}` : title,
        body: partBody,
        tag: `${job.id}-${index}`,
        url: targetUrl,
        ...(deliverAsCall ? { sessionId: callSessionId, callTs: Date.now() } : {}),
      });
      if (vapid) {
        for (const sub of webSubs) {
          try {
            const status = await sendWebPushRaw(sub, message, vapid, 3600);
            if (status === 404 || status === 410) {
              await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: "DELETE" }).catch(() => undefined);
            } else if (status >= 400) {
              pushErrors.push(`http ${status}`);
            } else {
              pushed += 1;
            }
          } catch (err) {
            pushErrors.push((err instanceof Error ? err.message : String(err)).slice(0, 80));
          }
        }
      }
      if (hasShellSub) {
        try {
          const response = await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
            method: "POST",
            headers: restHeaders,
            body: JSON.stringify({
              messages: [{
                topic: `shellpush:${job.user_id}`,
                event: "notify",
                payload: {
                  title: deliverAsCall ? `📞 ${title}` : title,
                  body: partBody,
                  url: targetUrl,
                  // 老壳不认识这些字段 → 照常显示普通通知，自然向下兼容
                  ...(deliverAsCall ? { kind: "call", characterName: title, sessionId: callSessionId, callTs: Date.now() } : {}),
                },
              }],
            }),
          });
          await response.text().catch(() => undefined);
          if (response.ok) pushed += 1;
          else pushErrors.push(`shell http ${response.status}`);
        } catch (err) {
          pushErrors.push(`shell ${(err instanceof Error ? err.message : String(err)).slice(0, 60)}`);
        }
      }
      await progress(`pushed ${index + 1}/${parts.length}${pushErrors.length ? `, errors: ${pushErrors[0]}` : ""}`);
    }

    // 冷场重连的下一发：连发上限内自动排队（用户回来后客户端会撤销并按新周期重挂）
    const idleRepeat = payload.merge?.idleRepeat as
      | { intervalMs?: number; maxIntervalMs?: number; growthCount?: number; remaining?: number; quietWin?: { startMin: number; endMin: number; tzOffsetMin: number } | null }
      | undefined;
    if (idleRepeat && Number(idleRepeat.remaining) > 0 && Number(idleRepeat.intervalMs) > 0) {
      const minMs=Number(idleRepeat.intervalMs),maxMs=Math.max(minMs,Number(idleRepeat.maxIntervalMs)||minMs);
      const intervalMs=(minMs+Math.random()*(maxMs-minMs))*(1+(Number(idleRepeat.growthCount)||0)*.5);
      let nextFire = Date.now() + intervalMs;
      // 落在安静时段内则顺延到时段结束
      const quiet = idleRepeat.quietWin;
      if (quiet && Number.isFinite(quiet.startMin) && Number.isFinite(quiet.endMin)) {
        const localMinutes = (Math.floor(nextFire / 60000) + quiet.tzOffsetMin) % 1440;
        const inQuiet = quiet.startMin < quiet.endMin
          ? localMinutes >= quiet.startMin && localMinutes < quiet.endMin
          : localMinutes >= quiet.startMin || localMinutes < quiet.endMin;
        if (inQuiet) {
          const untilEnd = (quiet.endMin - localMinutes + 1440) % 1440;
          nextFire += untilEnd * 60000 + (1+Math.floor(Math.random()*20))*60000;
        }
      }
      const nextMerge = {
        ...payload.merge,
        armAt: new Date(nextFire).toISOString(),
        idleReconnect: { ...(payload.merge?.idleReconnect as Record<string, unknown> ?? {}), firedAt: nextFire },
        idleRepeat: Number(idleRepeat.remaining) - 1 > 0
          ? { ...idleRepeat, growthCount:(Number(idleRepeat.growthCount)||0)+1, remaining: Number(idleRepeat.remaining) - 1 }
          : undefined,
      };
      const nextPayload = { ...payload, merge: nextMerge };
      await rest("push_jobs", {
        method: "POST",
        body: JSON.stringify([{
          id: `job_${crypto.randomUUID()}`,
          user_id: job.user_id,
          trigger_key: `${job.trigger_key}+`,
          kind: "timed_task",
          execute_at: new Date(nextFire + 15_000).toISOString(),
          status: "pending",
          payload: await encryptPayload(JSON.stringify(nextPayload), payloadKey),
        }]),
      }).catch(() => undefined);
    }

    await finish("done", `generated, pushed ${pushed}${pushErrors.length ? `, errors: ${pushErrors.slice(0, 3).join(" | ")}` : ""}`);
  } catch (err) {
    await finish("failed", err instanceof Error ? err.message : String(err));
  }
  };

  const work = runJob();
  const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(work);
  else await work;
  return new Response("accepted", { status: 200 });
});
