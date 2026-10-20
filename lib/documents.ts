export interface ReadingDocument {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  progress: number;
}

export interface DocumentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const STORAGE_KEY = 'tingjian.documents.v1';
export const MAX_CONTENT_LENGTH = 200_000;
export const MAX_TITLE_LENGTH = 200;

const sampleDate = '2026-10-20T00:00:00.000Z';

export const sampleDocuments: ReadingDocument[] = [
  {
    id: 'sample-everyday',
    title: '把日子，读成一首诗',
    content: `有时候，我们需要的不是更多消息，而是一小段可以安静下来的时间。

清晨的光落在窗边，杯中的水还留着温度。你翻开一本书，或者点开一篇一直想读的文章。那些原本沉默的文字，有了声音，也有了呼吸。

不必急着理解每一句话。让它们慢慢经过你，像风经过树叶，像一条小河穿过熟悉的村庄。也许某一个词，会让你想起很久以前的自己；也许某一句话，会恰好回答今天的疑问。

阅读并不总要抵达一个结论。有时，它只是让我们从忙碌中抬起头，重新看见一朵花的颜色、一场雨的方向，和身边那些值得珍惜的人。

把想读的文字留在这里。做饭时听一段，散步时听一段，睡前再听一段。那些来不及仔细阅读的稿件，也可以用声音，慢慢走进生活。

愿你的每一天，都有几分钟属于自己。愿平常的日子，也能被读成一首诗。`,
    createdAt: sampleDate,
    updatedAt: sampleDate,
    progress: 0,
  },
  {
    id: 'sample-pages',
    title: '在书页之间，遇见自己',
    content: `书架上的每一本书，都像一扇开向别处的窗。

年轻的时候，我们读书，是想知道远方是什么样子。后来才渐渐发现，走得越远，越能看清自己。一本书里的故乡，一段故事中的告别，都可能与我们的生活悄悄重合。

我喜欢在页边留下很轻的记号。不是为了记住某种标准答案，而是为了记住那一刻的心情。多年以后再翻开，同一句话又有了新的意思。文字没有改变，改变的是读它的人。

所以，不必责怪自己读得太慢，也不必因为忘记情节而失落。读过的文字，总会以某种方式留在身体里，成为看待世界的角度，或是在困难时刻支撑我们的一点力量。

今天，试着为自己选一小段文字。可以是一本旧书，也可以是刚刚写好的稿件。闭上眼睛，听它被缓缓读出来。

你会发现，阅读的另一端，不只是作者，也有一个等待被理解的自己。`,
    createdAt: sampleDate,
    updatedAt: sampleDate,
    progress: 0,
  },
  {
    id: 'sample-slow',
    title: '写给慢一点的自己',
    content: `亲爱的自己，今天也辛苦了。

你或许还有没有完成的计划，还有没来得及回复的消息。日历一页页翻过去，总觉得应该再快一些，再努力一些，才不会落在后面。

可是，花有花的季节，树有树的年轮。不是所有成长，都能在短时间里被看见。那些认真生活的日子，那些反复尝试的清晨，正在一点一点，成为你的底气。

如果今天很累，就允许自己休息。去楼下走一圈，看看傍晚的云；给很久没联系的朋友问个好；或者，听完这一小段文字，什么也不做。

慢一点，不代表放弃。它是把注意力从远处收回来，重新放到眼前的一餐饭、一段路、一次深呼吸里。等你恢复了力气，再继续出发也不迟。

愿你能够努力，也能够松弛；能够向前走，也能够停下来。愿你在追赶生活的时候，始终记得，好好照顾那个一直陪着自己的你。`,
    createdAt: sampleDate,
    updatedAt: sampleDate,
    progress: 0,
  },
];

export function createDocument(title: string, content: string): ReadingDocument {
  const normalizedTitle = title.trim() || content.trim().split(/\r?\n/)[0]?.slice(0, 30) || '未命名稿件';
  if (!content.trim()) throw new Error('请先粘贴或输入稿件内容。');
  if (content.length > MAX_CONTENT_LENGTH) throw new Error('稿件过长，请分成不超过 20 万字的小篇保存。');
  if (normalizedTitle.length > MAX_TITLE_LENGTH) throw new Error('标题请保持在 200 字以内。');
  const now = new Date().toISOString();
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `doc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    title: normalizedTitle,
    content,
    createdAt: now,
    updatedAt: now,
    progress: 0,
  };
}

function isDocument(value: unknown): value is ReadingDocument {
  if (!value || typeof value !== 'object') return false;
  const doc = value as ReadingDocument;
  return typeof doc.id === 'string' && doc.id.length > 0 && doc.id.length <= 120
    && typeof doc.title === 'string' && doc.title.trim().length > 0 && doc.title.length <= MAX_TITLE_LENGTH
    && typeof doc.content === 'string' && doc.content.trim().length > 0 && doc.content.length <= MAX_CONTENT_LENGTH
    && typeof doc.createdAt === 'string' && Number.isFinite(Date.parse(doc.createdAt))
    && typeof doc.updatedAt === 'string' && Number.isFinite(Date.parse(doc.updatedAt))
    && typeof doc.progress === 'number' && Number.isFinite(doc.progress) && doc.progress >= 0 && doc.progress <= 1;
}

export function loadDocuments(storage?: DocumentStorage): {documents: ReadingDocument[]; error: string | null} {
  try {
    const target = storage ?? globalThis.localStorage;
    if (!target) throw new Error('Storage unavailable');
    const raw = target.getItem(STORAGE_KEY);
    if (raw === null) return {documents: sampleDocuments.map(doc => ({...doc})), error: null};
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Invalid document collection');
    const ids = new Set<string>();
    const documents = parsed.filter((doc): doc is ReadingDocument => {
      if (!isDocument(doc) || ids.has(doc.id)) return false;
      ids.add(doc.id);
      return true;
    });
    return {
      documents,
      error: documents.length === parsed.length ? null : '部分本地稿件无法读取，原始数据尚未被修改。建议先导出可读取的稿件。',
    };
  } catch {
    return {documents: [], error: '暂时无法读取本地稿件，原始数据尚未被修改。请检查浏览器存储权限。'};
  }
}

export function saveDocuments(documents: ReadingDocument[], storage?: DocumentStorage): {ok: boolean; error: string | null} {
  try {
    if (!Array.isArray(documents) || !documents.every(isDocument)) throw new Error('Invalid documents');
    if (new Set(documents.map(doc => doc.id)).size !== documents.length) throw new Error('Duplicate documents');
    const target = storage ?? globalThis.localStorage;
    if (!target) throw new Error('Storage unavailable');
    const previous = target.getItem(STORAGE_KEY);
    if (previous !== null) {
      // Preserve unreadable old data before an intentional subsequent save.
      let needsRecovery = false;
      try {
        const parsed: unknown = JSON.parse(previous);
        needsRecovery = !Array.isArray(parsed) || !parsed.every(isDocument)
          || new Set(parsed.map(doc => doc.id)).size !== parsed.length;
      } catch {
        needsRecovery = true;
      }
      if (needsRecovery) target.setItem(`${STORAGE_KEY}.recovery.${Date.now()}`, previous);
    }
    target.setItem(STORAGE_KEY, JSON.stringify(documents));
    return {ok: true, error: null};
  } catch {
    return {ok: false, error: '保存失败：浏览器存储可能已满或被禁用。请先下载稿件备份。'};
  }
}
